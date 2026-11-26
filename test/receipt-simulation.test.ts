import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDatabase, closeTestDatabases } from './helpers/mysql-database.js';

Object.assign(process.env, {
  DATABASE_URL: await createTestDatabase(),
  NODE_ENV: 'test',
  RUN_WORKER: 'false',
  BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
  ENCRYPTION_KEY: randomBytes(32).toString('hex'),
});
const { db, closeDb } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrate.js');
const schema = await import('../src/db/schema/index.js');
const receipt = await import('../src/services/receipts.service.js');
const delivery = await import('../src/services/receipt-delivery.service.js');
const sync = await import('../src/services/sync.service.js');
const { encrypt } = await import('../src/utils/encryption.js');
const { companyConnectionId } = await import('../src/utils/company-connection.js');
const nativeFetch = globalThis.fetch;
let externalCalls = 0;
globalThis.fetch = async () => {
  externalCalls++;
  throw new Error('Simulation must never contact an external service');
};
const actorId = randomUUID();
const adminId = randomUUID();
const filters = { search: '', branch: '', status: '' as const, page: 1, pageSize: 25 as const };
const credentials = (mode: 'simulation' | 'live') =>
  encrypt(
    JSON.stringify({
      version: 1,
      mode,
      apiToken: mode === 'live' ? 'unused-test-token' : '',
      signatureSecret: mode === 'live' ? 'unused-test-secret' : '',
      taxPolicy: 'gross-no-tax',
    }),
  );
before(async () => {
  await migrate();
  await db.insert(schema.user).values({
    id: actorId,
    role: 'finance',
    active: true,
    name: 'Test Finance',
    email: 'sim@example.test',
  });
  await db
    .insert(schema.integrationConfigs)
    .values({ id: 'accurate', enabled: true, encryptedSecret: credentials('simulation') });
  await db.insert(schema.user).values({
    id: adminId,
    name: 'Admin',
    email: 'rate-admin@example.test',
    role: 'super_admin',
    active: true,
  });
});
after(async () => {
  globalThis.fetch = nativeFetch;
  try {
    await closeDb();
  } finally {
    await closeTestDatabases();
  }
});

async function fixture(split = false, beforePrepare?: (branchId: string) => Promise<void>) {
  const invoiceId = randomUUID(),
    branchId = randomUUID(),
    number = 'INV-' + invoiceId.slice(0, 8);
  const receiptNumber = 'RC-' + invoiceId.slice(0, 8);
  const payments = [
    {
      id: `${invoiceId}:receipt:${receiptNumber}:1`,
      method: 'qris' as const,
      amount: 200001,
      paidAt: '2026-11-01T00:00:00+07:00',
    },
    ...(split
      ? [
          {
            id: `${invoiceId}:receipt:${receiptNumber}:2`,
            method: 'bank' as const,
            amount: 9000,
            paidAt: '2026-11-01T00:00:00+07:00',
          },
        ]
      : []),
  ];
  const total = payments.reduce((sum, payment) => sum + payment.amount, 0);
  await db.insert(schema.branches).values({
    id: branchId,
    name: 'Simulation test',
    centerId: branchId,
    accurateDatabaseId: 'legacy-sim',
    accurateBranchId: 'legacy-branch',
  });
  await db.insert(schema.invoices).values({
    id: invoiceId,
    sourceId: invoiceId,
    number,
    branchId,
    customer: 'Test Customer',
    customerId: 'TEST-CUSTOMER',
    date: new Date('2026-11-01T00:00:00+07:00'),
    businessStatus: 'CLOSED',
    paymentStatus: 'PAID',
    total,
    outstanding: 0,
    items: [
      {
        id: 'item',
        name: 'Treatment',
        kind: 'service',
        quantity: 1,
        unitPrice: total,
        discount: 0,
        tax: 0,
        mapped: true,
      },
    ],
    payments,
  });
  assert.equal((await receipt.receiptOverview({ ...filters, branch: branchId })).items.length, 0);
  await sync.enqueue(invoiceId, actorId);
  await sync.processOne();
  const overview = await receipt.receiptOverview({ ...filters, branch: branchId });
  assert.equal(overview.items.length, 1);
  assert.equal(overview.items[0].mode, 'simulation');
  assert.equal(overview.items[0].status, 'TO_REVIEW');
  await beforePrepare?.(branchId);
  const draft = await receipt.prepareReceipt(invoiceId, overview.items[0].sourceKey, actorId);
  return { invoiceId, branchId, receiptNumber, draft };
}
async function save(
  f: Awaited<ReturnType<typeof fixture>>,
  draft = f.draft,
  amountMode: 'FULL' | 'NET' | 'GROSS' = 'FULL',
  inputAmount?: number,
  method = 'QRIS',
  rateOverrideBps?: number | null,
) {
  const detail = await receipt.receiptDetail(draft.id);
  const mapping = detail.configuration.mappings.find(
    (row) => row.bank === 'BCA' && row.method === method,
  );
  assert.ok(mapping);
  return receipt.saveReceiptDraft(
    draft.id,
    {
      mappingId: mapping.id,
      mappingVersion: mapping.version,
      paymentDate: '2026-11-01',
      paymentReference: 'SIM-REF',
      notes: '',
      version: draft.version,
      amountMode,
      ...(rateOverrideBps === undefined ? {} : { rateOverrideBps }),
      ...(inputAmount === undefined ? {} : { inputAmount }),
    },
    actorId,
  );
}
async function finish(row: Awaited<ReturnType<typeof save>>) {
  await delivery.submitReceipt(row.id, row.version, actorId);
  await Promise.all([delivery.processOneReceipt(), delivery.processOneReceipt()]);
  const result = await receipt.receiptDetail(row.id);
  assert.equal(result.draft.status, 'SUCCEEDED', result.draft.error ?? '');
  assert.equal(result.draft.mode, 'simulation');
  return result;
}

test('completed simulated invoices continue into receipts without credentials, destinations or external requests', async () => {
  const f = await fixture();
  const config = await receipt.receiptConfiguration(f.branchId);
  assert.equal(config.mappings.length, 8);
  assert.ok(config.mappings.every((row) => row.accountNo.startsWith('SIM-')));
  const search = await receipt.searchAccounts({
    branchId: f.branchId,
    kind: 'bank',
    search: 'BCA',
    page: 1,
  });
  assert.equal(search.items.length, 1);
  const saved = await save(f);
  assert.equal(saved.feeAmount, 1401);
  assert.equal(saved.netAmount, 198600);
  const completed = await finish(saved);
  assert.equal(completed.settlement.invoiceRemaining, 0);
  assert.equal(completed.draft.number, f.receiptNumber);
  assert.equal((await delivery.submitReceipt(saved.id, saved.version, actorId)).id, saved.id);
  assert.equal(
    (await receipt.prepareReceipt(f.invoiceId, completed.source.key, actorId)).id,
    saved.id,
  );
  const overview = await receipt.receiptOverview({ ...filters, branch: f.branchId });
  assert.equal(overview.items[0].status, 'SUCCEEDED');
  assert.equal((await db.select().from(schema.accurateDeliveries)).length, 0);
  assert.equal(
    (
      await db
        .select()
        .from(schema.accurateReceipts)
        .where(eq(schema.accurateReceipts.invoiceId, f.invoiceId))
    ).length,
    1,
  );
  assert.equal(externalCalls, 0);
});

test('a disabled company connection still allows local simulation review, draft saving and completion', async () => {
  const f = await fixture(false, async (branchId) => {
    await db.insert(schema.integrationConfigs).values({
      id: companyConnectionId(branchId),
      enabled: false,
      encryptedSecret: credentials('simulation'),
    });
  });
  const detail = await receipt.receiptDetail(f.draft.id);
  assert.equal(detail.validation.editable, true, detail.validation.message ?? '');
  assert.equal(detail.delivery.enabled, true, detail.delivery.message);
  assert.equal(detail.configuration.mappings.length, 8);
  assert.equal(detail.balance?.outstanding, 200001);
  const config = await receipt.receiptConfiguration(f.branchId);
  assert.ok(config.database.id.startsWith('SIMULATION:'));
  const accounts = await receipt.searchAccounts({
    branchId: f.branchId,
    kind: 'bank',
    search: '',
    page: 1,
  });
  assert.equal(accounts.items.length, 2);
  const completed = await finish(await save(f));
  assert.equal(completed.settlement.invoiceRemaining, 0);
  const connection = await db.query.integrationConfigs.findFirst({
    where: eq(schema.integrationConfigs.id, companyConnectionId(f.branchId)),
  });
  assert.equal(connection?.enabled, false);
  assert.equal((await db.select().from(schema.accurateDeliveries)).length, 0);
  assert.equal(externalCalls, 0);
});

test('local simulation remains blocked for an inactive company even when its connection mode is simulation', async () => {
  const f = await fixture();
  await db.update(schema.branches).set({ active: false }).where(eq(schema.branches.id, f.branchId));
  const detail = await receipt.receiptDetail(f.draft.id);
  assert.equal(detail.validation.editable, false);
  assert.equal(detail.delivery.enabled, false);
  await assert.rejects(save(f), { status: 409 });
  await assert.rejects(delivery.submitReceipt(f.draft.id, f.draft.version, actorId), {
    status: 409,
  });
  assert.equal(externalCalls, 0);
});

test('simulation preserves partial settlements, independent payments, fees, suffixes and source immutability', async () => {
  const f = await fixture(true);
  const [before] = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.id, f.invoiceId));
  const first = await finish(await save(f, f.draft, 'NET', 99300));
  assert.equal(first.settlement.invoiceRemaining, 109001);
  assert.equal(first.actions.canContinue, true);
  const overview = await receipt.receiptOverview({ ...filters, branch: f.branchId });
  assert.equal(overview.items[0].status, 'PARTIAL');
  const second = await receipt.prepareReceipt(f.invoiceId, first.source.key, actorId);
  assert.equal(second.number, f.receiptNumber + '-A');
  await assert.rejects(save(f, second, 'GROSS', 100002), /melebihi/);
  await finish(await save(f, second, 'NET', 99300));
  const bankKey = first.settlement.payments.find((payment) => payment.method === 'bank')?.key;
  assert.ok(bankKey);
  const bank = await receipt.prepareReceipt(f.invoiceId, bankKey, actorId);
  assert.equal(bank.number, f.receiptNumber + '-B');
  const last = await finish(await save(f, bank, 'FULL', undefined, 'BANK_TRANSFER'));
  assert.equal(last.settlement.invoiceRemaining, 0);
  assert.equal(last.draft.feeAmount, 0);
  const [after] = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.id, f.invoiceId));
  assert.deepEqual(after.payments, before.payments);
  assert.equal(after.total, before.total);
  assert.equal(externalCalls, 0);
});

test('queued simulations cannot become live receipts when connection mode changes', async () => {
  const f = await fixture();
  const saved = await save(f);
  await delivery.submitReceipt(saved.id, saved.version, actorId);
  await db
    .update(schema.integrationConfigs)
    .set({ encryptedSecret: credentials('live') })
    .where(eq(schema.integrationConfigs.id, 'accurate'));
  try {
    await delivery.processOneReceipt();
    const held = await receipt.receiptDetail(saved.id);
    assert.equal(held.draft.status, 'NEEDS_REVIEW');
    assert.equal(held.draft.attemptedAt, null);
    assert.equal(held.draft.mode, 'simulation');
    assert.equal(held.validation.editable, false);
    assert.equal(externalCalls, 0);
  } finally {
    await db
      .update(schema.integrationConfigs)
      .set({ encryptedSecret: credentials('simulation') })
      .where(eq(schema.integrationConfigs.id, 'accurate'));
  }
});

test('unprocessed invoices and mismatched source versions do not enter the ready simulation flow', async () => {
  const f = await fixture();
  await db.update(schema.invoices).set({ version: 2 }).where(eq(schema.invoices.id, f.invoiceId));
  const overview = await receipt.receiptOverview({ ...filters, branch: f.branchId });
  assert.equal(overview.items[0].status, 'NEEDS_REVIEW');
  await assert.rejects(save(f), /Versi invoice/);
  assert.equal(externalCalls, 0);
});

test('simulation receipts never settle, reserve numbering or supply mappings for a later live invoice', async () => {
  const f = await fixture();
  await finish(await save(f));
  const [invoice] = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.id, f.invoiceId));
  await db.insert(schema.accurateDeliveries).values({
    invoiceId: f.invoiceId,
    branchId: f.branchId,
    databaseId: '99',
    targetBranchId: '300',
    sourceVersion: invoice.version,
    requestedNumber: invoice.number,
    payload: { number: invoice.number, customerNo: invoice.customerId, transDate: '01/11/2026' },
    expectedTotal: invoice.total,
    status: 'SUCCEEDED',
    targetId: '700',
    targetNumber: invoice.number,
  });
  const overview = await receipt.receiptOverview({ ...filters, branch: f.branchId });
  const live = overview.items.find((row) => row.mode === 'live');
  assert.ok(live);
  assert.equal(live.status, 'TO_REVIEW');
  assert.equal(live.settlement?.settled, 0);
  assert.equal(live.settlement?.remaining, invoice.total);
  const draft = await receipt.prepareReceipt(f.invoiceId, live.sourceKey, actorId);
  assert.equal(draft.mode, 'live');
  assert.equal(draft.number, f.receiptNumber);
  assert.equal(draft.grossAmount, invoice.total);
  assert.equal(draft.mappingId, null);
  assert.equal(externalCalls, 0);
});

async function changeRate(branchId: string, rateBps: number, bank = 'BCA', method = 'QRIS') {
  const config = await receipt.receiptConfiguration(branchId);
  const mapping = config.mappings.find((row) => row.bank === bank && row.method === method);
  assert.ok(mapping);
  return receipt.saveReceiptMapping(
    {
      branchId,
      bank: bank === 'BNI' ? 'BNI' : 'BCA',
      method: method === 'BANK_TRANSFER' ? 'BANK_TRANSFER' : 'QRIS',
      accountId: mapping.accountId,
      feeAccountId: mapping.feeAccountId,
      version: mapping.version,
      rateBps,
    },
    adminId,
  );
}

test('settings rates are scoped to company, bank and method and apply to new saves', async () => {
  const f = await fixture();
  const mapping = await changeRate(f.branchId, 150);
  const saved = await save(f);
  assert.equal(saved.rateBps, 150);
  assert.equal(saved.rateOverrideBps, null);
  assert.equal(saved.feeAmount, 3001);
  assert.equal(saved.netAmount, 197000);
  const config = await receipt.receiptConfiguration(f.branchId);
  assert.equal(
    config.mappings.find((row) => row.bank === 'BNI' && row.method === 'QRIS')?.rateBps,
    null,
  );
  assert.equal(
    config.mappings.find((row) => row.bank === 'BCA' && row.method === 'CREDIT_CARD')?.rateBps,
    null,
  );
  await assert.rejects(
    receipt.saveReceiptMapping(
      {
        branchId: f.branchId,
        bank: 'BCA',
        method: 'QRIS',
        accountId: mapping.accountId,
        feeAccountId: mapping.feeAccountId,
        version: mapping.version,
        rateBps: 200,
      },
      actorId,
    ),
    { status: 403 },
  );
  const completed = await finish(saved);
  await changeRate(f.branchId, 210);
  const history = await receipt.receiptDetail(completed.draft.id);
  assert.equal(history.draft.rateBps, 150);
  assert.equal(history.draft.feeAmount, 3001);
  assert.equal(history.draft.netAmount, 197000);
  assert.equal(externalCalls, 0);
});

test('Finance can override a receipt rate and reset it without modifying Settings', async () => {
  const f = await fixture();
  const mapping = await changeRate(f.branchId, 200);
  const overridden = await save(f, f.draft, 'FULL', undefined, 'QRIS', 180);
  assert.equal(overridden.rateBps, 180);
  assert.equal(overridden.rateOverrideBps, 180);
  assert.equal(overridden.feeAmount, 3601);
  assert.equal(overridden.netAmount, 196400);
  const settings = await db.query.receiptAccountMappings.findFirst({
    where: eq(schema.receiptAccountMappings.id, mapping.id),
  });
  assert.equal(settings?.rateBps, 200);
  assert.equal(settings?.version, mapping.version);
  const reset = await save(f, overridden, 'FULL', undefined, 'QRIS', null);
  assert.equal(reset.rateBps, 200);
  assert.equal(reset.rateOverrideBps, null);
  assert.equal(reset.feeAmount, 4001);
  const zero = await save(f, reset, 'FULL', undefined, 'QRIS', 0);
  assert.equal(zero.feeAmount, 0);
  assert.equal(zero.netAmount, 200001);
  const completed = await finish(zero);
  await assert.rejects(save(f, completed.draft, 'FULL', undefined, 'QRIS', 250), { status: 409 });
  assert.equal(
    (
      await db.query.receiptAccountMappings.findFirst({
        where: eq(schema.receiptAccountMappings.id, mapping.id),
      })
    )?.rateBps,
    200,
  );
  assert.equal(externalCalls, 0);
});

test('custom rates retain exact net inversion and cumulative rounding for partial receipts', async () => {
  const f = await fixture();
  await changeRate(f.branchId, 200);
  const first = await finish(await save(f, f.draft, 'NET', 98200, 'QRIS', 180));
  assert.equal(first.draft.grossAmount, 100000);
  assert.equal(first.draft.feeAmount, 1800);
  const second = await receipt.prepareReceipt(f.invoiceId, first.source.key, actorId);
  const detail = await receipt.receiptDetail(second.id);
  assert.ok(
    detail.settlement.feeBasisByRate.some(
      (row) => row.rateBps === 180 && row.gross === 100000 && row.fee === 1800,
    ),
  );
  const last = await finish(await save(f, second, 'NET', 98200, 'QRIS', 180));
  assert.equal(last.draft.grossAmount, 100001);
  assert.equal(last.draft.feeAmount, 1801);
  assert.equal(last.settlement.invoiceRemaining, 0);
  assert.equal(first.draft.feeAmount + last.draft.feeAmount, 3601);
  assert.equal(externalCalls, 0);
});

test('a changed default applies to the remaining receipt stage without rewriting a successful stage', async () => {
  const f = await fixture();
  const first = await finish(await save(f, f.draft, 'GROSS', 100000, 'QRIS', 180));
  await changeRate(f.branchId, 190);
  const second = await receipt.prepareReceipt(f.invoiceId, first.source.key, actorId);
  const last = await finish(await save(f, second));
  assert.equal(last.draft.rateBps, 190);
  assert.equal(last.draft.feeAmount, 1901);
  assert.equal(last.settlement.invoiceRemaining, 0);
  const history = await receipt.receiptDetail(first.draft.id);
  assert.equal(history.draft.rateBps, 180);
  assert.equal(history.draft.feeAmount, 1800);
  assert.equal(externalCalls, 0);
});

test('a nonzero transfer rate requires an expense account and is allocated separately from the bank amount', async () => {
  const f = await fixture(true);
  const config = await receipt.receiptConfiguration(f.branchId);
  const mapping = config.mappings.find(
    (row) => row.bank === 'BCA' && row.method === 'BANK_TRANSFER',
  );
  assert.ok(mapping);
  const input = {
    branchId: f.branchId,
    bank: 'BCA' as const,
    method: 'BANK_TRANSFER' as const,
    accountId: mapping.accountId,
    feeAccountId: null,
    version: mapping.version,
    rateBps: 100,
  };
  await assert.rejects(receipt.saveReceiptMapping(input, adminId), { status: 422 });
  await receipt.saveReceiptMapping({ ...input, feeAccountId: '201' }, adminId);
  const detail = await receipt.receiptDetail(f.draft.id);
  const key = detail.settlement.payments.find((row) => row.method === 'bank')?.key;
  assert.ok(key);
  const draft = await receipt.prepareReceipt(f.invoiceId, key, actorId);
  const completed = await finish(await save(f, draft, 'FULL', undefined, 'BANK_TRANSFER'));
  assert.equal(completed.draft.grossAmount, 9000);
  assert.equal(completed.draft.feeAmount, 90);
  assert.equal(completed.draft.netAmount, 8910);
  assert.equal(externalCalls, 0);
});
