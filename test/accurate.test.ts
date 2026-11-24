import { after as afterDatabase } from 'node:test';
import { createTestDatabase, closeTestDatabases } from './helpers/mysql-database.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import { mkdtemp, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { receiptPdf } from './helpers/receipt-fixture.js';
import { redemptionPages } from './helpers/redemption-fixture.js';
import { parsePdfPages } from '../src/utils/parsers/pdf.js';
import { chargeableItems } from '../src/utils/redemption.js';
import type { ImportCandidate } from '../src/types/import.types.js';

Object.assign(process.env, {
  DATABASE_URL: await createTestDatabase(),
  RUN_WORKER: 'false',
  INTEGRATION_MODE: 'simulation',
  IMPORT_PACKAGE_TAX_POLICY: 'proportional',
  BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
  ENCRYPTION_KEY: randomBytes(32).toString('hex'),
});
const { app } = await import('../src/app.js');
const { db, closeDb } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrate.js');
const schema = await import('../src/db/schema/index.js');
const { eq } = await import('drizzle-orm');
const { hashPassword } = await import('better-auth/crypto');
const { processOne, enqueue } = await import('../src/services/sync.service.js');
const imports = await import('../src/services/import.service.js');
const { buildAccuratePayload } = await import('../src/utils/accurate-payload.js');
const { applySavedMappings, mappingSourceKey } = await import('../src/utils/accurate-mapping.js');
const { parsePdf } = await import('../src/utils/parsers/pdf.js');
const { accurateHost } = await import('../src/services/integrations/accurate-client.js');
const { decrypt } = await import('../src/utils/encryption.js');
const nativeFetch = globalThis.fetch;
const token = 'test-token-only',
  signatureSecret = 'test-signature-secret';
const remote = new Map<
  string,
  {
    id: string;
    number: string;
    customer: { customerNo: string };
    branch: { id: number };
    currency: { code: string };
    totalAmount: number;
    transDate: string;
  }
>();
let writes = 0,
  reads = 0,
  mismatch = false,
  timeoutAfterSave = false,
  rejectSave = false;
let lastPayload = new URLSearchParams();
let server: Server, base: string;
const cookies: Record<string, string> = {};
const password = 'Test-password-8675309!';
const response = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (!url.hostname.endsWith('.accurate.id')) return nativeFetch(input, init);
  reads++;
  const headers = new Headers(init?.headers);
  assert.equal(headers.get('Authorization'), `Bearer ${token}`);
  assert.equal(headers.has('X-Session-ID'), false);
  assert.equal(
    headers.get('X-Api-Signature'),
    createHmac('sha256', signatureSecret)
      .update(headers.get('X-Api-Timestamp') ?? '')
      .digest('base64'),
  );
  if (url.pathname === '/api/api-token.do')
    return response({
      s: true,
      d: { database: { id: 999, alias: 'Test Company', host: 'https://public.accurate.id' } },
    });
  if (/\/(customer|item|branch)\/list.do$/.test(url.pathname)) {
    if (url.pathname.includes('/branch/'))
      return response({ s: true, d: [{ id: 300, name: 'Jakarta' }] });
    if (url.pathname.includes('/customer/'))
      return response({ s: true, d: [{ id: 10, customerNo: 'MPA-TEST', name: 'Customer Test' }] });
    return response({ s: true, d: [{ id: 20, no: 'ITEM-TEST', name: 'Layanan Test' }] });
  }
  if (/\/(customer|item|branch)\/detail.do$/.test(url.pathname)) {
    if (url.pathname.includes('/branch/'))
      return response({ s: true, d: { id: 300, name: 'Jakarta' } });
    if (url.pathname.includes('/customer/'))
      return response({ s: true, d: { id: 10, customerNo: 'MPA-TEST', name: 'Customer Test' } });
    return response({
      s: true,
      d: { id: 20, no: 'ITEM-TEST', name: 'Layanan Test', unit1Name: 'Jasa' },
    });
  }
  if (url.pathname.endsWith('/sales-invoice/list.do')) {
    const target = remote.get(url.searchParams.get('filter.number.val') ?? '');
    return response({ s: true, d: target ? [{ id: target.id, number: target.number }] : [] });
  }
  if (url.pathname.endsWith('/sales-invoice/detail.do'))
    return response({
      s: true,
      d: [...remote.values()].find((row) => row.id === url.searchParams.get('id')),
    });
  if (url.pathname.endsWith('/sales-invoice/save.do')) {
    writes++;
    assert.equal(init?.method, 'POST');
    assert.equal(headers.get('Content-Type'), 'application/x-www-form-urlencoded');
    lastPayload = new URLSearchParams(String(init?.body));
    if (rejectSave) return response({ s: false, d: [`Rejected ${token} ${signatureSecret}`] });
    let total = 0;
    for (let i = 0; lastPayload.has(`detailItem[${i}].itemNo`); i++)
      total +=
        Number(lastPayload.get(`detailItem[${i}].unitPrice`)) *
        Number(lastPayload.get(`detailItem[${i}].quantity`));
    const row = {
      id: String(1000 + writes),
      number: lastPayload.get('number')!,
      customer: { customerNo: lastPayload.get('customerNo')! },
      branch: { id: 300 },
      currency: { code: 'IDR' },
      totalAmount: Math.round(total) - (mismatch ? 1 : 0),
      transDate: lastPayload.get('transDate')!,
    };
    remote.set(row.number, row);
    if (timeoutAfterSave) throw new Error('Lost response after remote commit');
    return response({ s: true, r: { id: row.id } });
  }
  throw new Error(`Unexpected endpoint ${url.pathname}`);
};
async function request(path: string, role = 'super_admin', method = 'GET', body?: unknown) {
  return nativeFetch(`${base}/api${path}`, {
    method,
    headers: {
      Origin: 'http://localhost:3000',
      ...(cookies[role] ? { Cookie: cookies[role] } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
before(async () => {
  await migrate();
  await db.insert(schema.branches).values({
    id: 'branch-test',
    name: 'Jakarta Test',
    centerId: 'center-test',
    accurateDatabaseId: 'demo',
    accurateBranchId: 'JKT',
  });
  await db.insert(schema.integrationConfigs).values({ id: 'accurate', enabled: true });
  for (const role of ['super_admin', 'finance', 'viewer']) {
    await db
      .insert(schema.user)
      .values({ id: role, name: role, email: `${role}@example.test`, role });
    await db.insert(schema.account).values({
      id: randomUUID(),
      userId: role,
      accountId: role,
      providerId: 'credential',
      password: await hashPassword(password),
    });
  }
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  base = `http://127.0.0.1:${address.port}`;
  for (const role of ['super_admin', 'finance', 'viewer']) {
    const result = await request('/auth/sign-in/email', '', 'POST', {
      email: `${role}@example.test`,
      password,
    });
    assert.equal(result.status, 200);
    cookies[role] = result.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; ');
  }
});
after(async () => {
  globalThis.fetch = nativeFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeDb();
});

async function batchFixture(number: string, mapped = true) {
  const batchId = randomUUID(),
    rowId = randomUUID(),
    fileId = randomUUID();
  const candidate: ImportCandidate = {
    sourceId: randomUUID(),
    number: `RECEIPT-${number}`,
    sourceInvoiceNumber: number,
    customer: 'Customer Test',
    customerId: 'ZENOTI-TEST',
    date: '2026-11-07',
    dueDate: null,
    currency: 'IDR',
    businessStatus: 'CLOSED',
    subtotal: 179279,
    discount: 1622523,
    tax: 19721,
    total: 199000,
    totalPaid: 199000,
    outstanding: 0,
    items: [
      {
        id: 'line-1',
        name: 'Indiba Facial',
        kind: 'service',
        quantity: 1,
        unitPrice: 1801802,
        discount: 1622523,
        tax: 19721,
        mapped: true,
      },
    ],
    payments: [{ id: `PAY-${number}`, method: 'qris', amount: 199000, paidAt: '2026-11-07' }],
    benefits: [],
    packageName: null,
    sourceFormat: 'PDF',
    warnings: [],
    errors: [],
    accountingReviewedAt: mapped ? new Date().toISOString() : undefined,
    accurateSelection: mapped
      ? {
          databaseId: '999',
          targetBranchId: '300',
          customer: { id: '10', code: 'MPA-TEST', name: 'Customer Test' },
          items: {
            'line-1': { id: '20', code: 'ITEM-TEST', name: 'Layanan Test', unitName: 'Jasa' },
          },
        }
      : undefined,
  };
  await db
    .insert(schema.importBatches)
    .values({ id: batchId, branchId: 'branch-test', uploaderId: 'finance' });
  await db.insert(schema.importFiles).values({
    id: fileId,
    batchId,
    name: 'test.pdf',
    storedName: randomUUID(),
    hash: randomUUID(),
    size: 100,
    format: 'PDF',
  });
  await db
    .insert(schema.importRows)
    .values({ id: rowId, batchId, fileId, position: 1, candidate, status: 'REVIEW' });
  return { batchId, rowId, candidate };
}
async function submit(number: string) {
  const fixture = await batchFixture(number);
  const batch = await imports.getImport(fixture.batchId);
  const result = await imports.submitImport(batch.id, batch.version, [fixture.rowId], 'finance');
  assert.ok(result.rows[0].invoiceId);
  return { ...fixture, invoiceId: result.rows[0].invoiceId! };
}

test('modern receipt retains invoice number and safely falls back when UUID is truncated', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'accurate-pdf-')),
    path = join(folder, 'receipt.pdf');
  try {
    await writeFile(
      path,
      receiptPdf({ invoiceNumber: 'MPA-R-4733', receiptNumber: 'MPA-R-R3892', truncatedId: true }),
    );
    const [candidate] = await parsePdf(path);
    assert.equal(candidate.sourceInvoiceNumber, 'MPA-R-4733');
    assert.equal(candidate.number, 'MPA-R-R3892');
    assert.equal(candidate.sourceId, 'zenoti:invoice:MPA-R-4733');
    assert.equal(candidate.total, 200000);
    assert.deepEqual(candidate.errors, []);
  } finally {
    await unlink(path);
  }
});
test('readiness reports simulation and missing credentials before live configuration', async () => {
  const result = await request('/accurate/status', 'viewer');
  assert.equal(result.status, 200);
  const status = await result.json();
  assert.equal(status.mode, 'simulation');
  assert.equal(status.configured, false);
});
test('encrypted settings require both credentials, sign requests and expose no secrets', async () => {
  assert.equal(
    (
      await request('/settings/accurate', 'finance', 'PATCH', {
        enabled: true,
        accurate: { mode: 'live' },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request('/settings/accurate', 'super_admin', 'PATCH', {
        enabled: true,
        accurate: { mode: 'live' },
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await request('/settings/accurate', 'super_admin', 'PATCH', {
        enabled: true,
        accurate: { mode: 'live', apiToken: token, signatureSecret },
      })
    ).status,
    200,
  );
  const settings = await request('/settings');
  const text = await settings.text();
  assert.ok(!text.includes(token) && !text.includes(signatureSecret));
  assert.equal(JSON.parse(text).accurate.taxPolicy, 'gross-no-tax');
  const stored = await db.query.integrationConfigs.findFirst({
    where: eq(schema.integrationConfigs.id, 'accurate'),
  });
  assert.ok(stored?.encryptedSecret && !stored.encryptedSecret.includes(token));
  assert.equal(JSON.parse(decrypt(stored.encryptedSecret)).apiToken, token);
  assert.equal((await request('/settings/accurate/test', 'super_admin', 'POST')).status, 200);
  assert.equal(writes, 0);
  assert.ok(reads > 0);
  assert.throws(() => accurateHost('https://accurate.id.evil.test'));
  assert.throws(() => accurateHost('http://public.accurate.id'));
  assert.throws(() => accurateHost('https://public.accurate.id/private'));
  assert.throws(() => accurateHost('https://public.accurate.id@127.0.0.1'));
});
test('verified destination and versioned per-row mappings are restricted and invalidate review', async () => {
  assert.equal((await request('/accurate/masters?kind=customer', 'viewer')).status, 403);
  assert.equal(
    (
      await request('/accurate/destinations/branch-test', 'finance', 'PUT', {
        targetBranchId: '300',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request('/accurate/destinations/branch-test', 'super_admin', 'PUT', {
        targetBranchId: '300',
      })
    ).status,
    200,
  );
  const fixture = await batchFixture('MAP-001', false);
  let batch = await imports.getImport(fixture.batchId);
  assert.ok(batch.rows[0].errors.some((error) => error.includes('customer')));
  // Recording an inspection is separate from readiness; it cannot bypass mapping.
  batch = await imports.markImportRowReviewed(batch.id, fixture.rowId, batch.version, 'finance');
  assert.ok(batch.rows[0].candidate.accountingReviewedAt);
  assert.ok(batch.rows[0].errors.some((error) => error.includes('customer')));
  await assert.rejects(
    () => imports.submitImport(batch.id, batch.version, [fixture.rowId], 'finance'),
    /customer/,
  );
  assert.equal(writes, 0);
  const customer = await request(
    `/accurate/imports/${batch.id}/rows/${fixture.rowId}/mapping`,
    'finance',
    'PUT',
    { version: batch.version, kind: 'customer', masterId: '10' },
  );
  assert.equal(customer.status, 200, await customer.text());
  assert.equal(
    (
      await request(
        `/accurate/imports/${batch.id}/rows/${fixture.rowId}/mapping`,
        'finance',
        'PUT',
        { version: batch.version, kind: 'item', itemId: 'line-1', masterId: '20' },
      )
    ).status,
    409,
  );
  batch = await imports.getImport(batch.id);
  assert.equal(
    (
      await request(
        `/accurate/imports/${batch.id}/rows/${fixture.rowId}/mapping`,
        'finance',
        'PUT',
        { version: batch.version, kind: 'item', itemId: 'line-1', masterId: '20' },
      )
    ).status,
    200,
  );
  batch = await imports.getImport(batch.id);
  assert.ok(!batch.rows[0].candidate.accountingReviewedAt);
  batch = await imports.markImportRowReviewed(batch.id, fixture.rowId, batch.version, 'finance');
  assert.deepEqual(batch.rows[0].errors, []);
  assert.equal(writes, 0);
});
test('payload preserves quantities, sends gross unit prices and never includes receipt/payment fields', async () => {
  const fixture = await batchFixture('PAYLOAD-001');
  fixture.candidate.items[0] = {
    ...fixture.candidate.items[0],
    quantity: 4,
    unitPrice: 1801801.75,
    discount: 0,
    tax: 792793,
  };
  Object.assign(fixture.candidate, {
    subtotal: 7207207,
    discount: 0,
    tax: 792793,
    total: 8000000,
    totalPaid: 8000000,
  });
  fixture.candidate.payments[0].amount = 8000000;
  const payload = buildAccuratePayload(fixture.candidate, {
    databaseId: '999',
    targetBranchId: '300',
  });
  assert.equal(payload.taxable, 'false');
  assert.equal(payload['detailItem[0].quantity'], '4');
  assert.equal(payload['detailItem[0].unitPrice'], '2000000');
  assert.equal(
    Object.keys(payload).some((key) => /payment|bank|detailInvoice|itemDisc|tax1/i.test(key)),
    false,
  );
  fixture.candidate.items[0] = {
    ...fixture.candidate.items[0],
    quantity: 3,
    unitPrice: 600601,
    discount: 1622524,
    tax: 19721,
  };
  Object.assign(fixture.candidate, {
    subtotal: 179279,
    discount: 1622524,
    tax: 19721,
    total: 199000,
    totalPaid: 199000,
  });
  fixture.candidate.payments[0].amount = 199000;
  const fraction = buildAccuratePayload(fixture.candidate, {
    databaseId: '999',
    targetBranchId: '300',
  });
  assert.equal(fraction['detailItem[0].unitPrice'], '66333.333333');
  assert.equal(fraction['detailItem[0].quantity'], '3');
});
test('saved mappings populate new candidates without sharing mutable selections or confirming review', async () => {
  const fixture = await batchFixture('CACHE-001', false);
  const mappings = [
    {
      kind: 'customer',
      sourceKey: mappingSourceKey('ZENOTI-TEST'),
      targetId: '10',
      targetCode: 'MPA-TEST',
      targetName: 'Customer Test',
      unitName: '',
    },
    {
      kind: 'item',
      sourceKey: mappingSourceKey('service:Indiba Facial'),
      targetId: '20',
      targetCode: 'ITEM-TEST',
      targetName: 'Layanan Test',
      unitName: 'Jasa',
    },
  ];
  applySavedMappings(fixture.candidate, { databaseId: '999', targetBranchId: '300' }, mappings);
  assert.equal(fixture.candidate.accurateSelection?.customer?.code, 'MPA-TEST');
  assert.equal(fixture.candidate.accurateSelection?.items['line-1'].unitName, 'Jasa');
  assert.equal(fixture.candidate.accountingReviewedAt, undefined);
  mappings[1].targetCode = 'CHANGED';
  assert.equal(fixture.candidate.accurateSelection?.items['line-1'].code, 'ITEM-TEST');
  await assert.rejects(
    async () =>
      buildAccuratePayload(fixture.candidate, { databaseId: '999', targetBranchId: '300' }),
    /Konfirmasikan pemeriksaan/,
  );
});
test('live submit freezes payload; worker saves only sales invoice and verifies target before success', async () => {
  const fixture = await submit('LIVE-001');
  assert.equal(writes, 0);
  await processOne();
  const invoice = await db.query.invoices.findFirst({
    where: eq(schema.invoices.id, fixture.invoiceId),
  });
  assert.equal(invoice?.syncStatus, 'SYNCED');
  assert.equal(invoice.number, 'LIVE-001');
  assert.equal(writes, 1);
  assert.equal(lastPayload.get('taxable'), 'false');
  assert.equal(lastPayload.get('detailItem[0].unitPrice'), '199000');
  assert.equal(lastPayload.has('detailInvoice[0].invoiceNo'), false);
  assert.equal(lastPayload.has('bankNo'), false);
  const target = await db.query.invoiceSyncs.findFirst({
    where: eq(schema.invoiceSyncs.invoiceId, fixture.invoiceId),
  });
  assert.deepEqual(target?.paymentIds, []);
  assert.equal(target?.databaseId, '999');
  const listed = await (await request('/accurate/delivered-invoices', 'finance')).json();
  assert.ok(listed.some((row: { invoiceId: string }) => row.invoiceId === fixture.invoiceId));
  await imports.submitImport(fixture.batchId, 1, [fixture.rowId], 'finance');
  assert.equal(writes, 1);
});
test('total mismatch is held and retries never overwrite or repost an existing target', async () => {
  mismatch = true;
  const fixture = await submit('LIVE-MISMATCH');
  await processOne();
  mismatch = false;
  const invoice = await db.query.invoices.findFirst({
    where: eq(schema.invoices.id, fixture.invoiceId),
  });
  assert.equal(invoice?.syncStatus, 'NEEDS_REVIEW');
  const before = writes;
  await enqueue(fixture.invoiceId, 'finance');
  await processOne();
  assert.equal(writes, before);
  const listed = await (await request('/accurate/delivered-invoices', 'finance')).json();
  assert.ok(!listed.some((row: { invoiceId: string }) => row.invoiceId === fixture.invoiceId));
});
test('timeout after remote commit reconciles by lookup and performs no second write', async () => {
  timeoutAfterSave = true;
  const fixture = await submit('LIVE-TIMEOUT');
  await processOne();
  timeoutAfterSave = false;
  const before = writes;
  await enqueue(fixture.invoiceId, 'finance');
  await processOne();
  assert.equal(writes, before);
  const invoice = await db.query.invoices.findFirst({
    where: eq(schema.invoices.id, fixture.invoiceId),
  });
  assert.equal(invoice?.syncStatus, 'SYNCED');
});
test('business error HTTP 200 is a failure and credentials are masked', async () => {
  rejectSave = true;
  const fixture = await submit('LIVE-REJECT');
  await processOne();
  rejectSave = false;
  const invoice = await db.query.invoices.findFirst({
    where: eq(schema.invoices.id, fixture.invoiceId),
  });
  assert.equal(invoice?.syncStatus, 'NEEDS_REVIEW');
  assert.ok(!invoice.error?.includes(token) && !invoice.error?.includes(signatureSecret));
  const before = writes;
  await enqueue(fixture.invoiceId, 'finance');
  await processOne();
  assert.equal(writes, before);
});
test('switching mode pauses frozen live delivery; old simulation jobs never become real writes', async () => {
  const fixture = await submit('LIVE-PAUSE');
  await request('/settings/accurate', 'super_admin', 'PATCH', {
    enabled: true,
    accurate: { mode: 'simulation' },
  });
  const before = writes;
  await processOne();
  assert.equal(writes, before);
  const invoice = await db.query.invoices.findFirst({
    where: eq(schema.invoices.id, fixture.invoiceId),
  });
  assert.equal(invoice?.syncStatus, 'NEEDS_REVIEW');
  const simulation = await submit('SIM-BOUND');
  await request('/settings/accurate', 'super_admin', 'PATCH', {
    enabled: true,
    accurate: { mode: 'live' },
  });
  await processOne();
  assert.equal(writes, before);
  assert.equal(
    await db.query.accurateDeliveries.findFirst({
      where: eq(schema.accurateDeliveries.invoiceId, simulation.invoiceId),
    }),
    undefined,
  );
  // An explicit reupload + review + submit may promote a previously simulated record.
  const source = await db.query.importRows.findFirst({
    where: eq(schema.importRows.id, simulation.rowId),
  });
  assert.ok(source);
  const promoted = await batchFixture('SIM-BOUND');
  await db
    .update(schema.importRows)
    .set({ candidate: source.candidate })
    .where(eq(schema.importRows.id, promoted.rowId));
  const preview = await imports.getImport(promoted.batchId);
  assert.equal(preview.rows[0].status, 'REVIEW');
  await imports.submitImport(preview.id, preview.version, [promoted.rowId], 'finance');
  await processOne();
  assert.equal(writes, before + 1);
  const delivery = await db.query.accurateDeliveries.findFirst({
    where: eq(schema.accurateDeliveries.invoiceId, simulation.invoiceId),
  });
  assert.equal(delivery?.status, 'SUCCEEDED');
});
test('two receipts for one invoice cannot create two live deliveries, even with distinct source identities', async () => {
  const one = await submit('LIVE-UNIQUE');
  const two = await batchFixture('LIVE-UNIQUE');
  await assert.rejects(
    imports.submitImport(two.batchId, 1, [two.rowId], 'finance'),
    /sudah memiliki pengiriman/,
  );
  await processOne();
  const rows = await db
    .select()
    .from(schema.accurateDeliveries)
    .where(eq(schema.accurateDeliveries.requestedNumber, 'LIVE-UNIQUE'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].invoiceId, one.invoiceId);
});
test('pre-existing external invoice is held for review and is never adopted or overwritten silently', async () => {
  const existing = [...remote.values()][0];
  remote.set('ALREADY-EXTERNAL', { ...existing, id: '88888', number: 'ALREADY-EXTERNAL' });
  const fixture = await submit('ALREADY-EXTERNAL'),
    before = writes;
  await processOne();
  assert.equal(writes, before);
  const invoice = await db.query.invoices.findFirst({
    where: eq(schema.invoices.id, fixture.invoiceId),
  });
  assert.equal(invoice?.syncStatus, 'NEEDS_REVIEW');
});

test('a live mixed batch saves full redemption locally and posts only the paid service, excluding Consultation', async () => {
  const full = await batchFixture('LIVE-REDEEM-FULL'),
    mixed = await batchFixture('LIVE-REDEEM-MIXED');
  const parsed = (allRedeemed: boolean, fixture: typeof full) => {
    const [c] = parsePdfPages(redemptionPages(allRedeemed, fixture.candidate.sourceInvoiceNumber));
    c.businessStatus = 'CLOSED';
    c.accountingReviewedAt = new Date().toISOString();
    c.accurateSelection = structuredClone(fixture.candidate.accurateSelection);
    if (c.accurateSelection)
      c.accurateSelection.items = Object.fromEntries(
        chargeableItems(c.items).map((item) => [
          item.id,
          { id: '20', code: 'ITEM-TEST', name: 'Test', unitName: 'Jasa' },
        ]),
      );
    return c;
  };
  await db
    .update(schema.importRows)
    .set({ candidate: parsed(true, full) })
    .where(eq(schema.importRows.id, full.rowId));
  await db
    .update(schema.importRows)
    .set({ candidate: parsed(false, mixed), batchId: full.batchId })
    .where(eq(schema.importRows.id, mixed.rowId));
  const before = writes;
  const result = await imports.submitImport(full.batchId, 1, [full.rowId, mixed.rowId], 'finance');
  const local = result.rows.find((row) => row.id === full.rowId)!;
  assert.equal(local.syncStatus, 'LOCAL_ONLY');
  assert.equal(local.delivery, null);
  await processOne();
  assert.equal(writes, before + 1);
  assert.equal(lastPayload.get('detailItem[0].unitPrice'), '150000');
  assert.equal(lastPayload.has('detailItem[1].itemNo'), false);
  assert.equal(lastPayload.get('description')?.includes('Consultation'), false);
  const delivery = await db.query.accurateDeliveries.findFirst({
    where: eq(
      schema.accurateDeliveries.invoiceId,
      result.rows.find((row) => row.id === mixed.rowId)!.invoiceId!,
    ),
  });
  assert.equal(delivery?.status, 'SUCCEEDED');
  assert.equal(delivery?.expectedTotal, 150000);
  await assert.rejects(enqueue(local.invoiceId!, 'finance'), /full redeem/);
});

test('adding a Finance item verifies and saves its mapping atomically; deleting removes only its row mapping', async () => {
  const fixture = await batchFixture('ADD-MAPPED-UI');
  const endpoint = `/imports/${fixture.batchId}/rows/${fixture.rowId}/items`;
  const input = {
    version: 1,
    name: 'Manual mapped treatment',
    kind: 'service' as const,
    quantity: 1,
    unitPrice: 10000,
    discountPercent: 0,
    taxPercent: 0,
    reason: 'Additional service confirmed from source',
    accurateMasterId: '20',
  };
  const beforeWrites = writes;
  assert.equal((await request(endpoint, 'viewer', 'POST', input)).status, 403);
  assert.equal(
    (await request(endpoint, 'finance', 'POST', { ...input, version: 999 })).status,
    409,
  );
  assert.equal(
    (await request(endpoint, 'finance', 'POST', { ...input, accurateMasterId: 'not-an-id' }))
      .status,
    400,
  );
  assert.equal(
    (await request(endpoint, 'finance', 'POST', { ...input, accurateMasterId: '21' })).status,
    422,
  );
  assert.equal((await imports.getImport(fixture.batchId)).rows[0].candidate.items.length, 1);
  // An audit write failure must also roll back the shared mapping and new item.
  await assert.rejects(
    imports.addImportItem(fixture.batchId, fixture.rowId, 1, input, 'x'.repeat(101)),
  );
  const rolledBack = await imports.getImport(fixture.batchId);
  assert.equal(rolledBack.version, 1);
  assert.deepEqual(rolledBack.rows[0].candidate, fixture.candidate);
  const mappingKey = mappingSourceKey(`service:${input.name}`);
  const failedMapping = await db.query.accurateMappings.findFirst({
    where: eq(schema.accurateMappings.sourceKey, mappingKey),
  });
  assert.equal(failedMapping, undefined);
  const response = await request(endpoint, 'finance', 'POST', input);
  assert.equal(response.status, 201, await response.clone().text());
  const saved = await imports.getImport(fixture.batchId);
  const candidate = saved.rows[0].candidate;
  const added = candidate.items[1];
  assert.equal(saved.version, 2);
  assert.deepEqual(candidate.accurateSelection?.items[added.id], {
    id: '20',
    code: 'ITEM-TEST',
    name: 'Layanan Test',
    unitName: 'Jasa',
  });
  assert.deepEqual(
    candidate.accurateSelection?.customer,
    fixture.candidate.accurateSelection?.customer,
  );
  assert.equal(candidate.accountingReviewedAt, undefined);
  assert.equal(candidate.total, fixture.candidate.total);
  const log = (
    await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, fixture.rowId))
  ).find((row) => row.action === 'accurate.mapping.select');
  assert.ok(log);
  const deleted = await request(
    `${endpoint}/${encodeURIComponent(added.id)}`,
    'finance',
    'DELETE',
    { version: saved.version },
  );
  assert.equal(deleted.status, 200);
  const after = await imports.getImport(fixture.batchId);
  assert.equal(after.rows[0].candidate.items.length, 1);
  assert.equal(after.rows[0].candidate.accurateSelection?.items[added.id], undefined);
  assert.deepEqual(
    after.rows[0].candidate.accurateSelection?.items['line-1'],
    fixture.candidate.accurateSelection?.items['line-1'],
  );
  assert.ok(
    await db.query.accurateMappings.findFirst({
      where: eq(schema.accurateMappings.sourceKey, mappingKey),
    }),
  );
  assert.equal(writes, beforeWrites);
});

test('simulation preview exposes the saved Accurate destination and mappings without enabling live delivery', async () => {
  const fixture = await batchFixture('SIMULATION-MAPPING-READ');
  const beforeWrites = writes;
  try {
    const changed = await request('/settings/accurate', 'super_admin', 'PATCH', {
      enabled: true,
      accurate: { mode: 'simulation' },
    });
    assert.equal(changed.status, 200);
    const preview = await imports.getImport(fixture.batchId);
    assert.equal(preview.mode, 'simulation');
    assert.equal(preview.accurateDestination?.databaseId, '999');
    assert.equal(preview.accurateDestination?.targetBranchId, '300');
    assert.deepEqual(
      preview.rows[0].candidate.accurateSelection,
      fixture.candidate.accurateSelection,
    );
    assert.equal(writes, beforeWrites);
  } finally {
    const restored = await request('/settings/accurate', 'super_admin', 'PATCH', {
      enabled: true,
      accurate: { mode: 'live' },
    });
    assert.equal(restored.status, 200);
  }
});

// Run after HTTP/file cleanup hooks, including when an earlier teardown failed.
afterDatabase(async () => {
  try {
    await closeDb();
  } finally {
    await closeTestDatabases();
  }
});
