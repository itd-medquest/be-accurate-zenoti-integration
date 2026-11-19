import { after as afterDatabase } from 'node:test';
import { createTestDatabase, closeTestDatabases } from './helpers/mysql-database.js';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { receiptAmounts, receiptSourceGroups } from '../src/utils/receipt-amounts.js';

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: await createTestDatabase(),
  RUN_WORKER: 'false',
  BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
  ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  FRONTEND_URL: 'http://localhost:3000',
});
const { app } = await import('../src/app.js');
const { db, closeDb } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrate.js');
const schema = await import('../src/db/schema/index.js');
const { eq } = await import('drizzle-orm');
const { hashPassword } = await import('better-auth/crypto');
const { encrypt } = await import('../src/utils/encryption.js');
const password = randomBytes(24).toString('hex');
const branchId = randomUUID(),
  invoiceId = randomUUID();
const cookies: Record<string, string> = {};
let server: Server, base: string;
let writes = 0;
const nativeFetch = globalThis.fetch;
const accounts = [
  {
    id: 101,
    no: '110101',
    name: 'Bank contoh BCA',
    accountType: 'CASH_BANK',
    suspended: false,
    currency: { id: 50, code: 'IDR' },
  },
  {
    id: 102,
    no: '110102',
    name: 'Bank contoh BNI',
    accountType: 'CASH_BANK',
    suspended: false,
    currency: { id: 50, code: 'IDR' },
  },
  {
    id: 201,
    no: '610001',
    name: 'Beban administrasi contoh',
    accountType: 'EXPENSE',
    suspended: false,
    currency: { id: 50, code: 'IDR' },
  },
];
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (!url.hostname.endsWith('.accurate.id')) return nativeFetch(input, init);
  if (/sales-(receipt|invoice)\/save.do$/.test(url.pathname)) {
    writes++;
    throw new Error('Unexpected financial write');
  }
  if (url.pathname === '/api/api-token.do')
    return Response.json({
      s: true,
      d: { database: { id: 99, alias: 'Perusahaan Uji', host: 'https://public.accurate.id' } },
    });
  if (url.pathname.endsWith('/glaccount/detail.do'))
    return Response.json({
      s: true,
      d: accounts.find((row) => String(row.id) === url.searchParams.get('id')),
    });
  if (url.pathname.endsWith('/glaccount/list.do')) {
    const type = url.searchParams.get('filter.accountType.val');
    const search = url.searchParams.get('filter.keywords.val');
    assert.equal(url.searchParams.get('filter.suspended'), 'false');
    assert.equal(url.searchParams.get('filter.leafOnly'), 'true');
    return Response.json({
      s: true,
      d: accounts.filter(
        (row) => (!type || row.accountType === type) && (!search || row.no.includes(search)),
      ),
    });
  }
  if (url.pathname.endsWith('/sales-receipt/detail.do'))
    return Response.json({
      s: true,
      d: {
        id: 999,
        number: url.searchParams.get('number'),
        chequeAmount: 148500,
        customerEmail: 'flat-private@example.test',
        bankContactPhone: 'private-phone-value',
        customer: {
          customerNo: 'EXAMPLE',
          email: 'private@example.test',
          name: 'Private customer',
        },
        detailInvoice: [{ paymentAmount: 148500, detailDiscount: [{ amount: 1500 }] }],
      },
    });
  throw new Error('Unexpected vendor read: ' + url.pathname);
};

before(async () => {
  await migrate();
  const hash = await hashPassword(password);
  await db.insert(schema.branches).values({
    id: branchId,
    name: 'Perusahaan Uji',
    centerId: 'TEST',
    accurateDatabaseId: 'legacy',
    accurateBranchId: 'OLD',
  });
  await db.insert(schema.accurateDestinations).values({
    branchId,
    databaseId: '99',
    databaseName: 'Perusahaan Uji',
    targetBranchId: '300',
    targetBranchName: 'Cabang Uji',
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
  await db.insert(schema.invoices).values({
    id: invoiceId,
    sourceId: 'SOURCE-EXAMPLE',
    number: 'INV-EXAMPLE',
    branchId,
    customer: 'Customer Uji',
    customerId: 'EXAMPLE',
    date: new Date('2026-11-01T00:00:00+07:00'),
    businessStatus: 'CLOSED',
    paymentStatus: 'PAID',
    syncStatus: 'SYNCED',
    total: 200001,
    outstanding: 0,
    items: [],
    payments: [
      {
        id: 'SOURCE-EXAMPLE:receipt:RECEIPT-EXAMPLE:1',
        method: 'qris',
        amount: 200001,
        paidAt: '2026-11-01T00:00:00+07:00',
      },
    ],
  });
  await db.insert(schema.accurateDeliveries).values({
    invoiceId,
    branchId,
    databaseId: '99',
    targetBranchId: '300',
    sourceVersion: 1,
    requestedNumber: 'INV-EXAMPLE',
    payload: { number: 'INV-EXAMPLE', customerNo: 'EXAMPLE' },
    expectedTotal: 200001,
    status: 'SUCCEEDED',
    targetId: '700',
    targetNumber: 'INV-EXAMPLE',
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address');
  base = `http://127.0.0.1:${address.port}`;
  for (const role of ['super_admin', 'finance', 'viewer']) {
    const id = randomUUID(),
      email = `${role}@example.test`;
    await db.insert(schema.user).values({ id, email, name: role, role });
    await db.insert(schema.account).values({
      id: randomUUID(),
      userId: id,
      accountId: id,
      providerId: 'credential',
      password: hash,
    });
    const login = await nativeFetch(`${base}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(login.status, 200);
    cookies[role] = login.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
  }
});
after(async () => {
  globalThis.fetch = nativeFetch;
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeDb();
});
function request(route: string, method = 'GET', body?: unknown, role = 'super_admin') {
  return nativeFetch(base + '/api/receipts' + route, {
    method,
    headers: {
      Cookie: cookies[role],
      Origin: 'http://localhost:3000',
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('approved bank rates always ceil fractional rupiah within supported bounds', () => {
  for (const bank of ['BCA', 'BNI'] as const)
    for (const method of ['CREDIT_CARD', 'DEBIT_CARD', 'QRIS', 'BANK_TRANSFER'] as const) {
      for (const gross of [1, 99, 150000, 200001, 2147483647]) {
        const result = receiptAmounts(gross, bank, method);
        assert.ok(BigInt(result.fee) * 10000n >= BigInt(gross) * BigInt(result.rateBps));
        assert.ok(
          result.rateBps === 0 ||
            BigInt(result.fee - 1) * 10000n < BigInt(gross) * BigInt(result.rateBps),
        );
        assert.equal(result.gross, result.fee + result.net);
      }
    }
  assert.equal(receiptAmounts(200001, 'BCA', 'QRIS').fee, 1401);
  assert.equal(receiptAmounts(150000, 'BNI', 'CREDIT_CARD').fee, 3000);
  assert.equal(receiptAmounts(150000, 'BNI', 'DEBIT_CARD').fee, 2700);
  assert.equal(receiptAmounts(150000, 'BCA', 'BANK_TRANSFER').fee, 0);
  assert.throws(() => receiptAmounts(1.1, 'BCA', 'QRIS'));
  assert.throws(() => receiptAmounts(2147483648, 'BCA', 'QRIS'));
});

test('source item allocations are grouped while distinct receipt transactions stay separate', () => {
  const common = { method: 'qris' as const, paidAt: '2026-11-01T00:00:00+07:00', amount: 100000 };
  const groups = receiptSourceGroups([
    { ...common, id: 'ITEM-A:collection' },
    { ...common, id: 'ITEM-B:collection' },
    { ...common, id: 'PDF-PAYMENT-A' },
    { ...common, id: 'PDF-PAYMENT-B' },
  ]);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].gross, 200000);
  assert.equal(groups[0].payments.length, 2);
  const reversed = receiptSourceGroups([
    { ...common, id: 'ITEM-B:collection' },
    { ...common, id: 'ITEM-A:collection' },
  ]);
  assert.equal(groups[0].key, reversed[0].key);
  assert.equal(groups[0].fingerprint, reversed[0].fingerprint);
  assert.throws(() =>
    receiptSourceGroups([
      { ...common, id: 'same' },
      { ...common, id: 'same' },
    ]),
  );
});

test('receipt routes enforce roles and redact contact fields from the read-only reference', async () => {
  assert.equal((await request('/', 'GET', undefined, 'viewer')).status, 403);
  assert.equal((await request('/mappings', 'PUT', {}, 'finance')).status, 403);
  const reference = await request('/reference?number=EXAMPLE-RC', 'GET', undefined, 'finance');
  assert.equal(reference.status, 200);
  const result = await reference.json();
  assert.equal(result.receipt.chequeAmount, 148500);
  assert.ok(!JSON.stringify(result).includes('private@example.test'));
  assert.ok(!JSON.stringify(result).includes('Private customer'));
  assert.ok(!JSON.stringify(result).includes('flat-private@example.test'));
  assert.ok(!JSON.stringify(result).includes('private-phone-value'));
  assert.equal(writes, 0);
});

let mappingId = '',
  draftId = '';
test('account mappings are scoped, verified, versioned and require a fee account', async () => {
  const body = {
    branchId,
    bank: 'BCA',
    method: 'QRIS',
    accountId: '101',
    feeAccountId: '201',
    version: 0,
  };
  assert.equal((await request('/mappings', 'PUT', { ...body, feeAccountId: null })).status, 422);
  assert.equal((await request('/mappings', 'PUT', { ...body, accountId: '201' })).status, 422);
  const response = await request('/mappings', 'PUT', body);
  assert.equal(response.status, 200);
  mappingId = (await response.json()).id;
  assert.equal((await request('/mappings', 'PUT', body)).status, 409);
  const config = await (await request('/configuration', 'GET', undefined, 'finance')).json();
  assert.equal(config.mappings[0].accountNo, '110101');
  assert.equal(config.rounding, 'ceil');
  assert.equal(writes, 0);
});

test('overview filters the complete source set and draft preparation is idempotent with no enqueue', async () => {
  const overview = await (await request('?search=Customer&from=2026-11-01&to=2026-11-01')).json();
  assert.equal(overview.total, 1);
  assert.equal(overview.summary.review, 1);
  assert.equal((await request('?from=2026-11-31')).status, 400);
  const input = { invoiceId, sourceKey: overview.items[0].sourceKey };
  const first = await request('/drafts', 'POST', input);
  assert.equal(first.status, 200);
  draftId = (await first.json()).id;
  const repeated = await Promise.all([
    request('/drafts', 'POST', input),
    request('/drafts', 'POST', input),
  ]);
  for (const response of repeated) assert.equal((await response.json()).id, draftId);
  assert.equal((await db.select().from(schema.accurateReceipts)).length, 1);
  assert.equal((await db.select().from(schema.jobs)).length, 0);
  assert.equal(writes, 0);
});

test('draft save calculates approved fees server-side and rejects stale versions and supplied rates', async () => {
  const body = {
    mappingId,
    mappingVersion: 1,
    paymentDate: '2026-11-01',
    paymentReference: 'SOURCE-RECEIPT-1',
    notes: 'Finance checked source',
    version: 1,
  };
  assert.equal((await request('/' + draftId, 'PUT', { ...body, rateBps: 0 })).status, 400);
  for (const receiptNumber of ['', '0', '000', '  ', 'A\nB', 'X'.repeat(256)])
    assert.equal((await request('/' + draftId, 'PUT', { ...body, receiptNumber })).status, 400);
  assert.equal(
    (await request('/' + draftId, 'PUT', { ...body, receiptNumber: 'OVERRIDE' })).status,
    422,
  );
  assert.equal((await request('/' + draftId, 'PUT', { ...body, mappingVersion: 99 })).status, 409);
  const previousCode = accounts[0].no;
  try {
    accounts[0].no = '110999';
    assert.equal((await request('/' + draftId, 'PUT', body)).status, 409);
  } finally {
    accounts[0].no = previousCode;
  }
  const response = await request('/' + draftId, 'PUT', body);
  assert.equal(response.status, 200);
  const draft = await response.json();
  assert.equal(draft.feeAmount, 1401);
  assert.equal(draft.netAmount, 198600);
  assert.equal(draft.version, 2);
  assert.equal(draft.status, 'DRAFT');
  assert.equal((await request('/' + draftId, 'PUT', body)).status, 409);
  assert.equal(
    (await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)))[0]
      .syncStatus,
    'SYNCED',
  );
  assert.equal(writes, 0);
});

test('submission rejects stale versions and never queues an unreviewed request', async () => {
  assert.equal(
    (await request('/' + draftId + '/submit', 'POST', { version: 2, confirmed: false }, 'finance'))
      .status,
    400,
  );
  assert.equal(
    (await request('/' + draftId + '/submit', 'POST', { version: 2, confirmed: true }, 'viewer'))
      .status,
    403,
  );
  const response = await request(
    '/' + draftId + '/submit',
    'POST',
    { version: 99, confirmed: true },
    'finance',
  );
  assert.equal(response.status, 409);
  const [saved] = await db
    .select()
    .from(schema.accurateReceipts)
    .where(eq(schema.accurateReceipts.id, draftId));
  assert.equal(saved.status, 'DRAFT');
  assert.equal(saved.payload, null);
  assert.equal(saved.queuedAt, null);
  assert.equal(writes, 0);
});

test('saved history and its financial snapshot survive source changes and a disconnected integration', async () => {
  await db.update(schema.invoices).set({ version: 2 }).where(eq(schema.invoices.id, invoiceId));
  const overview = await (await request('/')).json();
  assert.equal(overview.total, 1);
  assert.equal(overview.summary.attention, 1);
  assert.equal(overview.items[0].draft.id, draftId);
  assert.equal(overview.items[0].gross, 200001);
  assert.match(overview.items[0].error, /Versi invoice/);
  const detail = await (await request('/' + draftId)).json();
  assert.equal(detail.validation.editable, false);
  assert.equal(detail.draft.feeAmount, 1401);
  await db
    .update(schema.integrationConfigs)
    .set({ enabled: false })
    .where(eq(schema.integrationConfigs.id, 'accurate'));
  const offline = await request('/' + draftId);
  assert.equal(offline.status, 200);
  const data = await offline.json();
  assert.equal(data.validation.editable, false);
  assert.match(data.validation.message, /dinonaktifkan/);
  assert.equal(data.draft.netAmount, 198600);
  await db
    .update(schema.integrationConfigs)
    .set({ enabled: true })
    .where(eq(schema.integrationConfigs.id, 'accurate'));
  await db
    .update(schema.invoices)
    .set({
      version: 1,
      payments: [{ id: 'BAD-SOURCE', method: 'qris', amount: -1, paidAt: 'bad' }],
    })
    .where(eq(schema.invoices.id, invoiceId));
  const invalid = await (await request('/')).json();
  assert.equal(invalid.total, 1);
  assert.match(invalid.items[0].error, /tidak valid/);
  assert.equal(writes, 0);
});

// Run after HTTP/file cleanup hooks, including when an earlier teardown failed.
afterDatabase(async () => {
  try {
    await closeDb();
  } finally {
    await closeTestDatabases();
  }
});
