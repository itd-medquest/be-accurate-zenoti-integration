import { after as afterDatabase } from 'node:test';
import { createTestDatabase, closeTestDatabases } from './helpers/mysql-database.js';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AccurateReceiptPayload } from '../src/types/receipt.types.js';
import { emptyCandidate } from '../src/utils/import-validation.js';
import { readAccurateReceipt, readReceiptInvoice } from '../src/utils/accurate-receipt.js';

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
const draftService = await import('../src/services/receipts.service.js');
const delivery = await import('../src/services/receipt-delivery.service.js');
const { receiptSourceGroups } = await import('../src/utils/receipt-amounts.js');
const { encrypt } = await import('../src/utils/encryption.js');
const actorId = randomUUID();
const nativeFetch = globalThis.fetch;
const invoices = new Map<string, { id: string; number: string; total: number; owing: number }>();
const remoteReceipts = new Map<string, Record<string, unknown>>();
let serial = 1000,
  writes = 0,
  mode = 'normal',
  databaseId = '99';
const accounts = [
  {
    id: 101,
    no: '110101',
    name: 'Bank contoh',
    accountType: 'CASH_BANK',
    currency: { id: 50, code: 'IDR' },
    suspended: false,
  },
  {
    id: 201,
    no: '610001',
    name: 'Beban administrasi',
    accountType: 'EXPENSE',
    currency: { id: 50, code: 'IDR' },
    suspended: false,
  },
];
function invoiceData(invoice: { id: string; number: string; total: number; owing: number }) {
  return {
    id: invoice.id,
    number: invoice.number,
    totalAmount: invoice.total,
    primeOwing: invoice.owing,
    branchId: 300,
    customerId: 501,
    currencyId: 50,
    customer: { id: 501, customerNo: 'CUSTOMER-EXAMPLE' },
    currency: { id: 50, code: 'IDR' },
    transDate: '01/11/2026',
  };
}
function receiptData(
  payload: AccurateReceiptPayload,
  invoice: { id: string; number: string; total: number; owing: number },
) {
  const line = payload.detailInvoice[0],
    fee = line.detailDiscount?.reduce((sum, d) => sum + d.amount, 0) ?? 0;
  return {
    id: ++serial,
    number: payload.number,
    description: payload.description,
    branchId: 300,
    customerId: 501,
    currencyId: 50,
    customer: { id: 501, customerNo: 'CUSTOMER-EXAMPLE' },
    currency: { id: 50, code: 'IDR' },
    bank: accounts[0],
    bankId: 101,
    transDate: payload.transDate,
    rate: 1,
    useCredit: false,
    voidCheq: false,
    creditUsed: 0,
    existingCredit: 0,
    overPay: 0,
    returnOverpay: false,
    chequeAmount: payload.chequeAmount,
    totalPayment: payload.chequeAmount,
    totalDiscount: fee,
    paymentMethod: payload.paymentMethod,
    detailInvoice: [
      {
        invoiceId: invoice.id,
        invoice: invoiceData(invoice),
        paymentAmount: line.paymentAmount,
        invoicePayment: line.paymentAmount - fee,
        discountAmount: fee,
        pphAmount: 0,
        paidPph: false,
        detailDiscount: (line.detailDiscount ?? []).map((d) => ({
          amount: d.amount,
          accountId: 201,
          account: accounts[1],
        })),
      },
    ],
  };
}
const payloadSchema = z
  .object({
    number: z.string(),
    description: z.string(),
    branchId: z.number(),
    customerNo: z.string(),
    bankNo: z.string(),
    currencyCode: z.literal('IDR'),
    transDate: z.string(),
    chequeAmount: z.number(),
    paymentMethod: z.enum(['QRIS', 'BANK_TRANSFER', 'CREDIT_CARD', 'DEBIT_CARD']),
    detailInvoice: z.array(
      z.object({
        invoiceNo: z.string(),
        paymentAmount: z.number(),
        detailDiscount: z
          .array(z.object({ accountNo: z.string(), amount: z.number(), discountNotes: z.string() }))
          .optional(),
      }),
    ),
  })
  .strict();
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (!url.hostname.endsWith('.accurate.id'))
    throw new Error('Only isolated mock vendor requests are permitted');
  if (url.pathname === '/api/api-token.do')
    return Response.json({
      s: true,
      d: {
        database: { id: databaseId, alias: 'Test database', host: 'https://public.accurate.id' },
      },
    });
  if (url.pathname.endsWith('/glaccount/detail.do'))
    return Response.json({
      s: true,
      d: accounts.find((a) => String(a.id) === url.searchParams.get('id')),
    });
  if (url.pathname.endsWith('/glaccount/list.do'))
    return Response.json({
      s: true,
      d: accounts.filter(
        (a) =>
          !url.searchParams.get('filter.keywords.val') ||
          a.no.includes(url.searchParams.get('filter.keywords.val') ?? ''),
      ),
    });
  if (url.pathname.endsWith('/sales-invoice/detail.do')) {
    const row = invoices.get(url.searchParams.get('id') ?? '');
    if (!row) throw new Error('Missing mock invoice');
    return Response.json({
      s: true,
      d: {
        ...invoiceData(row),
        ...(mode === 'inconsistent-balance' ? { owingForPayment: row.owing + 1 } : {}),
      },
    });
  }
  if (url.pathname.endsWith('/sales-receipt/list.do')) {
    const row = remoteReceipts.get(url.searchParams.get('filter.number.val') ?? '');
    return Response.json({ s: true, d: row ? [{ id: row.id, number: row.number }] : [] });
  }
  if (url.pathname.endsWith('/sales-receipt/detail.do'))
    return Response.json({ s: true, d: remoteReceipts.get(url.searchParams.get('number') ?? '') });
  if (url.pathname.endsWith('/sales-receipt/save.do')) {
    writes++;
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('Content-Type'), 'application/json');
    const payload = payloadSchema.parse(JSON.parse(String(init?.body)));
    assert.equal(payload.bankNo, '110101');
    assert.ok(!('id' in payload));
    if (mode === 'rejected')
      return Response.json({ s: false, d: ['Akun biaya belum diizinkan untuk diskon.'] });
    if (mode === 'timeout-before') throw new Error('Network interrupted before a confirmed result');
    const invoice = [...invoices.values()].find(
      (i) => i.number === payload.detailInvoice[0].invoiceNo,
    );
    if (!invoice) throw new Error('Missing mock invoice');
    if (mode !== 'unchanged-balance') invoice.owing -= payload.detailInvoice[0].paymentAmount;
    const row = receiptData(payload, invoice);
    if (mode === 'mismatch') row.chequeAmount = payload.chequeAmount - 1;
    remoteReceipts.set(payload.number, row);
    if (mode === 'timeout-after') throw new Error('Response lost after remote save');
    return Response.json({ s: true, r: { id: row.id } });
  }
  throw new Error('Unexpected vendor route: ' + url.pathname);
};
before(async () => {
  await migrate();
  await db.insert(schema.user).values({
    id: actorId,
    name: 'Finance test',
    email: 'finance-receipt@example.test',
    role: 'finance',
    active: true,
  });
  await db.insert(schema.integrationConfigs).values({
    id: 'accurate',
    enabled: true,
    encryptedSecret: encrypt(
      JSON.stringify({
        version: 1,
        apiToken: randomBytes(24).toString('hex'),
        signatureSecret: randomBytes(24).toString('hex'),
        mode: 'live',
        taxPolicy: 'gross-no-tax',
      }),
    ),
  });
});
after(async () => {
  globalThis.fetch = nativeFetch;
  await closeDb();
});
async function fixture(
  method: 'QRIS' | 'BANK_TRANSFER' | 'CREDIT_CARD' | 'DEBIT_CARD' = 'QRIS',
  split = false,
  format: 'PDF' | 'XLSX' = 'PDF',
  documentReceipt?: string,
) {
  mode = 'normal';
  const branchId = randomUUID(),
    id = randomUUID(),
    targetId = String(++serial),
    number = 'INV-' + serial,
    receiptNumber = documentReceipt ?? 'RECEIPT-' + serial;
  const payments = Array.from({ length: split ? 2 : 1 }, (_, index) => ({
    id:
      format === 'PDF'
        ? `${id}:receipt:${receiptNumber}:${index + 1}`
        : `${id}:item-${index}:collection`,
    method:
      method === 'QRIS'
        ? ('qris' as const)
        : method === 'BANK_TRANSFER'
          ? ('bank' as const)
          : ('card' as const),
    amount: 200001,
    paidAt: '2026-11-01T00:00:00+07:00',
  }));
  const total = payments.reduce((sum, p) => sum + p.amount, 0);
  invoices.set(targetId, { id: targetId, number, total, owing: total });
  await db.insert(schema.branches).values({
    id: branchId,
    name: 'Receipt company',
    centerId: branchId,
    accurateDatabaseId: '99',
    accurateBranchId: '300',
  });
  await db.insert(schema.invoices).values({
    id,
    branchId,
    sourceId: id,
    number,
    customer: 'Customer test',
    customerId: 'CUSTOMER-EXAMPLE',
    date: new Date('2026-11-01T00:00:00+07:00'),
    businessStatus: 'CLOSED',
    paymentStatus: 'PAID',
    syncStatus: 'SYNCED',
    total,
    outstanding: 0,
    items: [],
    payments,
  });
  await db.insert(schema.accurateDeliveries).values({
    invoiceId: id,
    branchId,
    databaseId: '99',
    targetBranchId: '300',
    sourceVersion: 1,
    requestedNumber: number,
    payload: { number, customerNo: 'CUSTOMER-EXAMPLE', transDate: '01/11/2026' },
    expectedTotal: total,
    status: 'SUCCEEDED',
    targetId,
    targetNumber: number,
  });
  if (format === 'XLSX') {
    const batchId = randomUUID(),
      fileId = randomUUID();
    const candidate = {
      ...emptyCandidate('XLSX'),
      sourceId: id,
      number: receiptNumber,
      sourceInvoiceNumber: number,
      payments,
      sourceEntries: [
        {
          row: 5,
          invoiceNumber: number,
          receiptNumber,
          itemName: 'Service',
          quantity: 1,
          net: total,
          tax: 0,
          total,
        },
      ],
    };
    await db
      .insert(schema.importBatches)
      .values({ id: batchId, branchId, uploaderId: actorId, status: 'SUBMITTED' });
    await db.insert(schema.importFiles).values({
      id: fileId,
      batchId,
      name: 'source.xlsx',
      storedName: 'test-only.xlsx',
      hash: 'test',
      size: 1,
      format: 'XLSX',
    });
    await db.insert(schema.importRows).values({
      id: randomUUID(),
      batchId,
      fileId,
      position: 1,
      candidate,
      status: 'QUEUED',
      invoiceId: id,
    });
  }
  const mappingId = randomUUID();
  await db.insert(schema.receiptAccountMappings).values({
    id: mappingId,
    branchId,
    databaseId: '99',
    bank: 'BCA',
    method,
    accountId: '101',
    accountNo: '110101',
    accountName: 'Bank contoh',
    feeAccountId: method === 'BANK_TRANSFER' ? null : '201',
    feeAccountNo: method === 'BANK_TRANSFER' ? null : '610001',
    feeAccountName: method === 'BANK_TRANSFER' ? null : 'Beban administrasi',
  });
  const drafts = [];
  for (const group of split ? [] : receiptSourceGroups(payments)) {
    const row = await draftService.prepareReceipt(id, group.key, actorId);
    if (!receiptNumber.trim() || /^0+$/.test(receiptNumber)) {
      drafts.push(row);
      continue;
    }
    drafts.push(
      await draftService.saveReceiptDraft(
        row.id,
        {
          mappingId,
          mappingVersion: 1,
          paymentDate: '2026-11-01',
          paymentReference: 'REF-' + row.id,
          notes: '',
          version: row.version,
        },
        actorId,
      ),
    );
  }
  return {
    drafts,
    id,
    targetId,
    mappingId,
    number,
    receiptNumber,
    sourceKeys: receiptSourceGroups(payments).map((row) => row.key),
  };
}
const stored = async (id: string) =>
  (await db.select().from(schema.accurateReceipts).where(eq(schema.accurateReceipts.id, id)))[0];
async function enqueue(row: Awaited<ReturnType<typeof fixture>>['drafts'][number]) {
  return delivery.submitReceipt(row.id, row.version, actorId);
}

test('verified contract uses gross paymentAmount, net invoicePayment/chequeAmount and a separate expense discount', async () => {
  const { drafts, id, number, receiptNumber } = await fixture();
  const initial = writes;
  const queued = await enqueue(drafts[0]);
  assert.equal(queued.status, 'QUEUED');
  const frozen = await stored(queued.id);
  assert.ok(frozen.payload);
  assert.equal(frozen.number, receiptNumber);
  assert.equal(frozen.payload?.number, receiptNumber);
  assert.equal(frozen.payload?.detailInvoice[0].invoiceNo, number);
  assert.notEqual(receiptNumber, number);
  assert.equal(frozen.payload?.description, `Customer test - Pembayaran Invoices no ${number}`);
  assert.ok(!frozen.payload.description.includes('INTGRTE:'));
  assert.equal(frozen.payload?.detailInvoice[0].paymentAmount, 200001);
  assert.equal(frozen.payload?.detailInvoice[0].detailDiscount?.[0].amount, 1401);
  assert.equal(frozen.payload?.chequeAmount, 198600);
  await delivery.processOneReceipt();
  const row = await stored(queued.id);
  assert.equal(row.status, 'SUCCEEDED', row.error ?? '');
  assert.equal(writes, initial + 1);
  assert.equal(
    (await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)))[0].syncStatus,
    'SYNCED',
  );
  assert.equal((await db.select().from(schema.jobs)).length, 0);
});

test('missing or zero PDF and Sales Accrual receipts allow an audited manual number before any delivery', async () => {
  for (const format of ['PDF', 'XLSX'] as const) {
    for (const missing of ['', '0']) {
      const { drafts, mappingId, number, id } = await fixture('QRIS', false, format, missing);
      const initial = writes,
        row = drafts[0];
      assert.equal(row.number, '');
      const sourceBefore = (
        await db.select().from(schema.invoices).where(eq(schema.invoices.id, id))
      )[0];
      const detail = await draftService.receiptDetail(row.id);
      assert.equal(detail.receiptNumber, null);
      assert.equal(detail.source.receiptNumber, null);
      assert.equal(detail.actions.canSetNumber, true);
      assert.equal(detail.validation.editable, true);
      assert.equal(detail.delivery.enabled, false);
      await assert.rejects(enqueue(row), /Isi No. Receipt/);
      const input = {
        mappingId,
        mappingVersion: 1,
        paymentDate: '2026-11-01',
        paymentReference: 'REFERENCE-REMAINS-INTERNAL',
        notes: 'Finance checked',
        version: row.version,
      };
      await assert.rejects(
        draftService.saveReceiptDraft(row.id, input, actorId),
        /Isi No. Receipt/,
      );
      const manual = 'MANUAL-' + row.id;
      const saved = await draftService.saveReceiptDraft(
        row.id,
        { ...input, receiptNumber: manual },
        actorId,
      );
      assert.equal(saved.number, manual);
      assert.equal(saved.paymentReference, input.paymentReference);
      const refreshed = await draftService.receiptDetail(row.id);
      assert.equal(refreshed.receiptNumber, manual);
      assert.equal(refreshed.actions.canSetNumber, true);
      assert.equal(refreshed.delivery.enabled, true);
      const resaved = await draftService.saveReceiptDraft(
        row.id,
        { ...input, version: saved.version },
        actorId,
      );
      assert.equal(resaved.number, manual);
      await enqueue(resaved);
      await delivery.processOneReceipt();
      const completed = await stored(row.id);
      assert.equal(completed.status, 'SUCCEEDED', completed.error ?? '');
      assert.equal(completed.payload?.number, manual);
      assert.equal(completed.payload?.detailInvoice[0].invoiceNo, number);
      assert.equal((await draftService.receiptDetail(row.id)).actions.canSetNumber, false);
      assert.equal(writes, initial + 1);
      const sourceAfter = (
        await db.select().from(schema.invoices).where(eq(schema.invoices.id, id))
      )[0];
      assert.deepEqual(sourceAfter.payments, sourceBefore.payments);
      assert.equal(sourceAfter.number, sourceBefore.number);
      const audits = await db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.entityId, row.id));
      assert.equal(audits.filter((entry) => entry.action === 'receipt.number.manual').length, 1);
      await assert.rejects(
        draftService.saveReceiptDraft(
          row.id,
          { ...input, receiptNumber: 'CHANGED', version: completed.version },
          actorId,
        ),
        /sudah dikirim/,
      );
    }
  }
});

test('manual receipt numbers cannot override source numbers or collide within an Accurate database', async () => {
  const present = await fixture();
  const input = {
    mappingId: present.mappingId,
    mappingVersion: 1,
    paymentDate: '2026-11-01',
    paymentReference: 'REF',
    notes: '',
    version: present.drafts[0].version,
    receiptNumber: 'OVERRIDE',
  };
  await assert.rejects(
    draftService.saveReceiptDraft(present.drafts[0].id, input, actorId),
    /tidak dapat diganti/,
  );
  const missing = await fixture('QRIS', false, 'XLSX', '0');
  await assert.rejects(
    draftService.saveReceiptDraft(
      missing.drafts[0].id,
      {
        ...input,
        mappingId: missing.mappingId,
        version: missing.drafts[0].version,
        receiptNumber: present.receiptNumber,
      },
      actorId,
    ),
    /sudah dipakai/,
  );
  assert.equal((await draftService.receiptDetail(missing.drafts[0].id)).receiptNumber, null);
  assert.equal((await stored(missing.drafts[0].id)).version, missing.drafts[0].version);
});
test('all approved methods support full payment; direct transfer omits discount completely', async () => {
  for (const method of ['BANK_TRANSFER', 'CREDIT_CARD', 'DEBIT_CARD'] as const) {
    const { drafts } = await fixture(method);
    await enqueue(drafts[0]);
    await delivery.processOneReceipt();
    const row = await stored(drafts[0].id);
    assert.equal(row.status, 'SUCCEEDED', row.error ?? '');
    if (method === 'BANK_TRANSFER') {
      assert.equal(row.feeAmount, 0);
      assert.equal(row.payload?.detailInvoice[0].detailDiscount, undefined);
    }
  }
});
test('concurrent submits and workers use the source receipt number and send the same receipt only once', async () => {
  const { drafts, receiptNumber } = await fixture(),
    initial = writes;
  await Promise.all([enqueue(drafts[0]), enqueue(drafts[0])]);
  await Promise.all([delivery.processOneReceipt(), delivery.processOneReceipt()]);
  assert.equal(writes, initial + 1);
  assert.equal((await stored(drafts[0].id)).number, receiptNumber);
  assert.equal((await stored(drafts[0].id)).status, 'SUCCEEDED');
});

test('separate source payments require manual handling before any draft or financial write', async () => {
  const { id, sourceKeys } = await fixture('QRIS', true),
    initial = writes;
  const before = (await db.select().from(schema.accurateReceipts)).length;
  for (const sourceKey of sourceKeys)
    await assert.rejects(draftService.prepareReceipt(id, sourceKey, actorId), /ditangani manual/);
  const overview = await draftService.receiptOverview({
    search: '',
    branch: '',
    from: '',
    to: '',
    status: '',
    page: 1,
    pageSize: 50,
  });
  const row = overview.items.find((row) => row.invoiceId === id);
  assert.equal(row?.status, 'NEEDS_REVIEW');
  assert.match(row?.error ?? '', /ditangani manual/);
  assert.equal((await db.select().from(schema.accurateReceipts)).length, before);
  assert.equal(writes, initial);
});

test('a balance read failure leaves saved mappings editable while blocking delivery until verification succeeds', async () => {
  const { drafts } = await fixture(),
    initial = writes;
  mode = 'inconsistent-balance';
  const held = await draftService.receiptDetail(drafts[0].id);
  assert.equal(held.validation.editable, true);
  assert.equal(held.validation.message, null);
  assert.equal(held.configuration.mappings.length, 1);
  assert.equal(held.balance, null);
  assert.equal(held.delivery.enabled, false);
  assert.match(held.delivery.message, /saldo piutang/);
  await assert.rejects(enqueue(drafts[0]), /saldo piutang/);
  assert.equal(writes, initial);
  mode = 'normal';
  const valid = await draftService.receiptDetail(drafts[0].id);
  assert.equal(valid.balance?.outstanding, 200001);
  assert.equal(valid.delivery.enabled, true);
});

test('saving an unattempted legacy draft aligns No. Bukti with the source receipt number', async () => {
  const { drafts, number, receiptNumber, mappingId } = await fixture();
  await db
    .update(schema.accurateReceipts)
    .set({ number })
    .where(eq(schema.accurateReceipts.id, drafts[0].id));
  await assert.rejects(enqueue(drafts[0]), /No. Bukti harus sesuai/);
  const row = await stored(drafts[0].id);
  const saved = await draftService.saveReceiptDraft(
    row.id,
    {
      mappingId,
      mappingVersion: 1,
      paymentDate: row.paymentDate,
      paymentReference: row.paymentReference,
      notes: row.notes,
      version: row.version,
    },
    actorId,
  );
  assert.equal(saved.number, receiptNumber);
  assert.equal(saved.paymentReference, row.paymentReference);
  assert.equal(saved.attemptedAt, null);
  const queued = await enqueue(saved);
  assert.equal((await stored(queued.id)).payload?.number, receiptNumber);
  await delivery.processOneReceipt();
  const completed = await stored(queued.id);
  assert.equal(completed.status, 'SUCCEEDED');
  await assert.rejects(
    draftService.saveReceiptDraft(
      completed.id,
      {
        mappingId,
        mappingVersion: 1,
        paymentDate: completed.paymentDate,
        paymentReference: completed.paymentReference,
        notes: completed.notes,
        version: completed.version,
      },
      actorId,
    ),
    /sudah dikirim/,
  );
  assert.equal((await stored(completed.id)).number, receiptNumber);
});

test('Sales Accrual receipt comes from the linked import document, not invoice or Finance reference', async () => {
  const { drafts, number, receiptNumber } = await fixture('QRIS', false, 'XLSX');
  const detail = await draftService.receiptDetail(drafts[0].id);
  assert.equal(detail.source.receiptNumber, receiptNumber);
  assert.equal(detail.invoice.number, number);
  await enqueue(drafts[0]);
  await delivery.processOneReceipt();
  const completed = await stored(drafts[0].id);
  assert.equal(completed.status, 'SUCCEEDED', completed.error ?? '');
  assert.equal(completed.payload?.number, receiptNumber);
  assert.equal(completed.payload?.detailInvoice[0].invoiceNo, number);
  assert.ok(!JSON.stringify(completed.payload).includes(completed.paymentReference));
});

test('a frozen legacy invoice-based number survives delivery and timeout reconciliation unchanged', async () => {
  const { drafts, number } = await fixture(),
    initial = writes;
  await enqueue(drafts[0]);
  const queued = await stored(drafts[0].id);
  assert.ok(queued.payload);
  await db
    .update(schema.accurateReceipts)
    .set({ number, payload: { ...queued.payload, number } })
    .where(eq(schema.accurateReceipts.id, queued.id));
  mode = 'timeout-after';
  await delivery.processOneReceipt();
  assert.equal((await stored(queued.id)).status, 'NEEDS_REVIEW');
  const reconciled = await delivery.checkReceipt(queued.id, actorId);
  assert.equal(reconciled?.status, 'SUCCEEDED');
  assert.equal((await stored(queued.id)).payload?.number, number);
  assert.equal(writes, initial + 1);
});

test('invoice detail accepts mandatory primeOwing without receipt-only fields and rejects missing or conflicting balances', () => {
  const sample = invoiceData({ id: '123', number: 'INV-EXAMPLE', total: 200001, owing: 200001 });
  assert.equal(readReceiptInvoice(sample).outstanding, 200001);
  assert.equal(readReceiptInvoice({ ...sample, owingForPayment: '200001' }).outstanding, 200001);
  for (const primeOwing of [undefined, null, '', ' ', 1.1, -1])
    assert.throws(() => readReceiptInvoice({ ...sample, primeOwing }));
  for (const owingForPayment of [null, '', 1, 200001.1])
    assert.throws(() => readReceiptInvoice({ ...sample, owingForPayment }));
});
test('timeout after remote commit reconciles by GET without another POST; replay never sends twice', async () => {
  const { drafts } = await fixture(),
    initial = writes;
  await enqueue(drafts[0]);
  mode = 'timeout-after';
  await delivery.processOneReceipt();
  assert.equal((await stored(drafts[0].id)).status, 'NEEDS_REVIEW');
  await assert.rejects(
    delivery.reopenReceipt(drafts[0].id, (await stored(drafts[0].id)).version, actorId),
    /belum pasti/,
  );
  const result = await delivery.checkReceipt(drafts[0].id, actorId);
  assert.equal(result?.status, 'SUCCEEDED');
  await delivery.submitReceipt(drafts[0].id, drafts[0].version, actorId);
  assert.equal(await delivery.processOneReceipt(), false);
  assert.equal(writes, initial + 1);
});

test('legacy frozen descriptions still reconcile without rewriting or resending an existing receipt', async () => {
  const { drafts } = await fixture(),
    initial = writes;
  await enqueue(drafts[0]);
  const queued = await stored(drafts[0].id);
  assert.ok(queued.payload);
  const description = `INTGRTE:${queued.id} | REF-LEGACY`;
  await db
    .update(schema.accurateReceipts)
    .set({ payload: { ...queued.payload, description } })
    .where(eq(schema.accurateReceipts.id, queued.id));
  mode = 'timeout-after';
  await delivery.processOneReceipt();
  const uncertain = await stored(queued.id);
  assert.equal(uncertain.status, 'NEEDS_REVIEW');
  const reconciled = await delivery.checkReceipt(queued.id, actorId);
  assert.equal(reconciled?.status, 'SUCCEEDED');
  assert.equal((await stored(queued.id)).payload?.description, description);
  assert.equal(remoteReceipts.get(queued.number)?.description, description);
  assert.equal(writes, initial + 1);
});
test('unconfirmed missing result never permits a second write and leaves a clear reconciliation state', async () => {
  const { drafts } = await fixture(),
    initial = writes;
  await enqueue(drafts[0]);
  mode = 'timeout-before';
  await delivery.processOneReceipt();
  const row = await stored(drafts[0].id);
  await assert.rejects(delivery.checkReceipt(row.id, actorId), /belum ditemukan/);
  await assert.rejects(delivery.reopenReceipt(row.id, row.version, actorId), /belum pasti/);
  assert.equal(writes, initial + 1);
});
test('explicit vendor rejection may return to draft only after read-only absence verification', async () => {
  const { drafts } = await fixture(),
    initial = writes;
  await enqueue(drafts[0]);
  mode = 'rejected';
  await delivery.processOneReceipt();
  const row = await stored(drafts[0].id);
  assert.equal(row.verification?.writeRejected, true);
  const draft = await delivery.reopenReceipt(row.id, row.version, actorId);
  assert.equal(draft.status, 'DRAFT');
  mode = 'normal';
  await enqueue(draft);
  await delivery.processOneReceipt();
  assert.equal((await stored(row.id)).status, 'SUCCEEDED');
  assert.equal(writes, initial + 2);
});
test('changed mapping or insufficient current outstanding holds delivery before a POST', async () => {
  for (const change of ['mapping', 'outstanding']) {
    const { drafts, mappingId, targetId } = await fixture(),
      initial = writes;
    await enqueue(drafts[0]);
    if (change === 'mapping')
      await db
        .update(schema.receiptAccountMappings)
        .set({ version: 2 })
        .where(eq(schema.receiptAccountMappings.id, mappingId));
    else {
      const row = invoices.get(targetId);
      assert.ok(row);
      row.owing = 1;
    }
    await delivery.processOneReceipt();
    const row = await stored(drafts[0].id);
    assert.equal(row.status, 'NEEDS_REVIEW');
    assert.equal(row.attemptedAt, null);
    assert.equal(writes, initial);
    assert.equal((await delivery.reopenReceipt(row.id, row.version, actorId)).status, 'DRAFT');
  }
});
test('pre-existing receipt is never overwritten or adopted before an attempt', async () => {
  const { drafts, targetId } = await fixture(),
    initial = writes;
  await enqueue(drafts[0]);
  const row = await stored(drafts[0].id),
    invoice = invoices.get(targetId);
  assert.ok(row.payload && invoice);
  remoteReceipts.set(row.number, {
    ...receiptData(row.payload, invoice),
    description: 'Manual receipt',
  });
  await delivery.processOneReceipt();
  assert.equal((await stored(row.id)).status, 'NEEDS_REVIEW');
  assert.equal((await stored(row.id)).attemptedAt, null);
  assert.equal(writes, initial);
});
test('receipt mismatch or unchanged piutang never counts as success and cannot be blindly reposted', async () => {
  for (const behavior of ['mismatch', 'unchanged-balance']) {
    const { drafts } = await fixture(),
      initial = writes;
    await enqueue(drafts[0]);
    mode = behavior;
    await delivery.processOneReceipt();
    const row = await stored(drafts[0].id);
    assert.equal(row.status, 'NEEDS_REVIEW');
    await assert.rejects(delivery.checkReceipt(row.id, actorId));
    await assert.rejects(delivery.reopenReceipt(row.id, row.version, actorId));
    assert.equal(writes, initial + 1);
  }
});
test('stale worker recovery exposes reconciliation rather than requeueing an uncertain write', async () => {
  const { drafts } = await fixture();
  await enqueue(drafts[0]);
  await db
    .update(schema.accurateReceipts)
    .set({ status: 'SENDING', attemptedAt: new Date(), updatedAt: new Date(Date.now() - 600000) })
    .where(eq(schema.accurateReceipts.id, drafts[0].id));
  await delivery.recoverStaleReceipts();
  assert.equal((await stored(drafts[0].id)).status, 'NEEDS_REVIEW');
  assert.equal(await delivery.processOneReceipt(), false);
});
test('target database, currency and source changes block financial writes', async () => {
  for (const change of ['database', 'currency', 'source']) {
    const { drafts, id } = await fixture(),
      initial = writes;
    if (change === 'source') await enqueue(drafts[0]);
    try {
      if (change === 'database') databaseId = 'OTHER';
      else if (change === 'currency') accounts[0].currency.id = 51;
      else await db.update(schema.invoices).set({ version: 2 }).where(eq(schema.invoices.id, id));
      if (change === 'source') {
        await delivery.processOneReceipt();
        assert.equal((await stored(drafts[0].id)).status, 'NEEDS_REVIEW');
      } else await assert.rejects(enqueue(drafts[0]));
      assert.equal(writes, initial);
    } finally {
      databaseId = '99';
      accounts[0].currency.id = 50;
    }
  }
});
test('operator suspension after enqueue prevents the attempt before a POST', async () => {
  const { drafts } = await fixture(),
    initial = writes;
  await enqueue(drafts[0]);
  await db.update(schema.user).set({ active: false }).where(eq(schema.user.id, actorId));
  try {
    await delivery.processOneReceipt();
    const row = await stored(drafts[0].id);
    assert.equal(row.status, 'NEEDS_REVIEW');
    assert.equal(row.attemptedAt, null);
    assert.equal(writes, initial);
  } finally {
    await db.update(schema.user).set({ active: true }).where(eq(schema.user.id, actorId));
  }
});
test('contract parser rejects missing values and fractional amounts instead of treating them as zero', () => {
  assert.throws(() => readAccurateReceipt({}));
  const row = receiptData(
    {
      number: 'TEST',
      bankNo: '110101',
      customerNo: 'CUSTOMER-EXAMPLE',
      branchId: 300,
      currencyCode: 'IDR',
      transDate: '01/11/2026',
      chequeAmount: 147000,
      paymentMethod: 'CREDIT_CARD',
      description: 'INTGRTE:test',
      detailInvoice: [
        {
          invoiceNo: 'INV-TEST',
          paymentAmount: 150000,
          detailDiscount: [{ accountNo: '610001', amount: 3000, discountNotes: 'Bank fee' }],
        },
      ],
    },
    { id: '900', number: 'INV-TEST', total: 150000, owing: 0 },
  );
  const parsed = readAccurateReceipt(row);
  assert.equal(parsed.allocations[0].gross, 150000);
  assert.equal(parsed.allocations[0].net, 147000);
  assert.equal(readAccurateReceipt({ ...row, returnOverpay: false }).net, 147000);
  for (const returnOverpay of [true, 0, 1, 'false', 'true', null])
    assert.throws(() => readAccurateReceipt({ ...row, returnOverpay }));
  for (const chequeAmount of [null, '', '   ', 147000.1])
    assert.throws(() => readAccurateReceipt({ ...row, chequeAmount }));
  assert.throws(() => readAccurateReceipt({ ...row, useCredit: true }));
});

// Run after HTTP/file cleanup hooks, including when an earlier teardown failed.
afterDatabase(async () => {
  try {
    await closeDb();
  } finally {
    await closeTestDatabases();
  }
});
