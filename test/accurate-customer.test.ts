import { after as afterDatabase } from 'node:test';
import { createTestDatabase, closeTestDatabases } from './helpers/mysql-database.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { nextMpaCustomerNumber } from '../src/utils/accurate-customer.js';
import type { ImportCandidate } from '../src/types/import.types.js';

Object.assign(process.env, {
  DATABASE_URL: await createTestDatabase(),
  RUN_WORKER: 'false',
  INTEGRATION_MODE: 'simulation',
  BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
  ENCRYPTION_KEY: randomBytes(32).toString('hex'),
});
const { app } = await import('../src/app.js');
const { db, closeDb } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrate.js');
const schema = await import('../src/db/schema/index.js');
const { eq } = await import('drizzle-orm');
const { encrypt } = await import('../src/utils/encryption.js');
const { hashPassword } = await import('better-auth/crypto');
const nativeFetch = globalThis.fetch;
const customers = [
  { id: 1, customerNo: 'MPA-99', name: 'Existing 99' },
  { id: 2, customerNo: 'MPA-9', name: 'Existing 9' },
  ...Array.from({ length: 101 }, (_, i) => ({
    id: 3 + i,
    customerNo: `MPA-legacy-${i}`,
    name: `Legacy ${i}`,
  })),
];
let server: Server, base: string;
const cookies: Record<string, string> = {};
let writes = 0,
  dropResponse = false,
  reject = false,
  missingPagination = false,
  missingMaster = false,
  ambiguousMaster = false,
  wrongDetail = false,
  detailUnavailable = false;
let sent: Record<string, unknown> = {};
const visits: URL[] = [];
const response = (body: unknown) => new Response(JSON.stringify(body));
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (!url.hostname.endsWith('.accurate.id')) return nativeFetch(input, init);
  visits.push(url);
  if (url.pathname === '/api/api-token.do')
    return response({
      s: true,
      d: { database: { id: 999, alias: 'Test Company', host: 'https://public.accurate.id' } },
    });
  const kind = url.pathname.split('/').at(-2);
  if (url.pathname.endsWith('/list.do')) {
    let rows: Record<string, unknown>[] = [];
    if (kind === 'customer') {
      rows = [...customers].sort((a, b) => b.id - a.id);
      const keyword = url.searchParams.get('filter.keywords.val');
      const number = url.searchParams.get('filter.no.val');
      if (keyword)
        rows = rows.filter((row) => String(row.name).toLowerCase().includes(keyword.toLowerCase()));
      if (number)
        rows = rows.filter((row) =>
          url.searchParams.get('filter.no.op') === 'EQUAL'
            ? row.customerNo === number
            : String(row.customerNo).includes(number),
        );
    } else if (kind === 'customer-category')
      rows = missingMaster
        ? []
        : ambiguousMaster
          ? [
              { id: 1, name: 'Astetic' },
              { id: 2, name: 'Astetic' },
            ]
          : [{ id: 1, name: 'Astetic' }];
    else if (kind === 'branch') rows = [{ id: 300, name: 'PT Mylab Prima Inovatif' }];
    else if (kind === 'currency') rows = [{ id: 50, code: 'IDR', name: 'Indonesian Rupiah' }];
    else if (kind === 'price-category') rows = [{ id: 70, name: 'Umum' }];
    else if (kind === 'payment-term') rows = [{ id: 80, name: 'C.O.D' }];
    else throw new Error(`Unexpected master ${kind}`);
    const page = Number(url.searchParams.get('sp.page') ?? 1);
    return response({
      s: true,
      d: rows.slice((page - 1) * 100, page * 100),
      ...(!missingPagination && kind !== 'payment-term'
        ? { sp: { pageCount: Math.ceil(rows.length / 100) } }
        : {}),
    });
  }
  if (url.pathname.endsWith('/customer/save.do')) {
    writes++;
    assert.equal(new Headers(init?.headers).get('Content-Type'), 'application/json');
    sent = JSON.parse(String(init?.body));
    if (reject)
      return response({ s: false, d: ['Rejected test-customer-token test-customer-secret'] });
    const customer = {
      id: 1000 + writes,
      customerNo: String(sent.customerNo),
      name: String(sent.name),
    };
    customers.push(customer);
    if (dropResponse) throw new Error('Lost response after remote save');
    return response({ s: true, r: { id: customer.id, customerNo: customer.customerNo } });
  }
  if (url.pathname.endsWith('/customer/detail.do')) {
    if (detailUnavailable) throw new Error('Detail unavailable after successful POST');
    const row = customers.find((row) => String(row.id) === url.searchParams.get('id'));
    return response({ s: true, d: wrongDetail ? { ...row, customerNo: 'WRONG' } : row });
  }
  throw new Error(`Unexpected external endpoint: ${url.pathname}`);
};
async function request(path: string, role = 'super_admin', method = 'GET', body?: unknown) {
  return nativeFetch(`${base}/api${path}`, {
    method,
    headers: {
      Origin: 'http://localhost:3000',
      Cookie: cookies[role] ?? '',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
before(async () => {
  await migrate();
  await db.insert(schema.branches).values({
    id: 'customer-branch',
    name: 'PT. MMI',
    centerId: 'test-center',
    accurateDatabaseId: 'demo',
    accurateBranchId: 'JKT',
  });
  await db.insert(schema.accurateDestinations).values({
    branchId: 'customer-branch',
    databaseId: '999',
    databaseName: 'Test Company',
    targetBranchId: '300',
    targetBranchName: 'PT Mylab Prima Inovatif',
  });
  await db.insert(schema.integrationConfigs).values({
    id: 'accurate',
    enabled: true,
    encryptedSecret: encrypt(
      JSON.stringify({
        version: 1,
        mode: 'live',
        taxPolicy: 'gross-no-tax',
        apiToken: 'test-customer-token',
        signatureSecret: 'test-customer-secret',
      }),
    ),
  });
  for (const role of ['super_admin', 'finance', 'viewer']) {
    await db
      .insert(schema.user)
      .values({ id: role, name: role, role, email: `${role}@example.test` });
    await db.insert(schema.account).values({
      id: randomUUID(),
      userId: role,
      accountId: role,
      providerId: 'credential',
      password: await hashPassword('Test-password-8675309!'),
    });
  }
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  base = `http://127.0.0.1:${address.port}`;
  for (const role of ['super_admin', 'finance', 'viewer']) {
    const result = await request('/auth/sign-in/email', role, 'POST', {
      email: `${role}@example.test`,
      password: 'Test-password-8675309!',
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

async function fixture() {
  const batchId = randomUUID(),
    rowId = randomUUID(),
    fileId = randomUUID();
  const candidate: ImportCandidate = {
    sourceId: randomUUID(),
    number: `INVOICE-${randomUUID()}`,
    customer: 'New Customer',
    customerId: 'ZENOTI-NEW',
    date: '2026-11-16',
    dueDate: null,
    currency: 'IDR',
    businessStatus: 'CLOSED',
    subtotal: 100,
    discount: 0,
    tax: 0,
    total: 100,
    totalPaid: 100,
    outstanding: 0,
    benefits: [],
    packageName: null,
    sourceFormat: 'PDF',
    warnings: [],
    errors: [],
    items: [
      {
        id: 'service',
        kind: 'service',
        name: 'Test Service',
        quantity: 1,
        unitPrice: 100,
        discount: 0,
        tax: 0,
        mapped: true,
      },
    ],
    payments: [],
  };
  await db
    .insert(schema.importBatches)
    .values({ id: batchId, branchId: 'customer-branch', uploaderId: 'super_admin', mode: 'live' });
  await db.insert(schema.importFiles).values({
    id: fileId,
    batchId,
    name: 'anonymous.pdf',
    storedName: randomUUID(),
    hash: randomUUID(),
    size: 100,
    format: 'PDF',
  });
  await db
    .insert(schema.importRows)
    .values({ id: rowId, batchId, fileId, position: 1, candidate, status: 'REVIEW' });
  const path = `/accurate/imports/${batchId}/rows/${rowId}/customer`;
  return { batchId, rowId, candidate, path };
}
async function preparation(path: string) {
  const result = await request(`${path}/prepare?version=1`);
  assert.equal(result.status, 200, JSON.stringify(await result.clone().json()));
  return result.json();
}
function body(plan: { requestId: string; databaseId: string; customerNo: string }, name: string) {
  return {
    requestId: plan.requestId,
    databaseId: plan.databaseId,
    customerNo: plan.customerNo,
    version: 1,
    name,
  };
}

test('numeric MPA sequence handles digit boundaries, leading zeroes and large values', () => {
  assert.equal(
    nextMpaCustomerNumber([
      { customerNo: 'MPA-9' },
      { customerNo: 'MPA-99' },
      { customerNo: 'MPA-010' },
      { customerNo: 'MPA-other-999' },
    ]),
    'MPA-100',
  );
  assert.equal(
    nextMpaCustomerNumber([{ customerNo: 'MPA-99999999999999999999' }]),
    'MPA-100000000000000000000',
  );
  assert.throws(() => nextMpaCustomerNumber([{ customerNo: 'MPA-invalid' }]), /tidak ditemukan/);
});
test('only super admin can prepare or create; denied requests never contact Accurate', async () => {
  const { path } = await fixture();
  const reads = visits.length;
  for (const role of ['finance', 'viewer']) {
    assert.equal((await request(`${path}/prepare?version=1`, role)).status, 403);
    assert.equal((await request(path, role, 'POST', {})).status, 403);
  }
  assert.equal(visits.length, reads);
});
test('prepare scans descending across every page and resolves all default masters without a write', async () => {
  const { path } = await fixture();
  const before = writes;
  const plan = await preparation(path);
  assert.equal(plan.customerNo, 'MPA-100');
  assert.equal(plan.defaults.categoryName, 'Astetic');
  assert.equal(plan.defaults.branchId, 300);
  assert.equal(plan.defaults.currencyCode, 'IDR');
  assert.equal(plan.defaults.priceCategoryName, 'Umum');
  assert.equal(plan.defaults.discountCategoryName, 'Umum');
  assert.equal(plan.defaults.termName, 'C.O.D');
  assert.ok(
    visits.some(
      (url) =>
        url.searchParams.get('sp.page') === '2' && url.searchParams.get('sp.sort') === 'id|desc',
    ),
  );
  assert.equal(writes, before);
});
test('missing pagination and missing/ambiguous masters block preparation', async () => {
  const { path } = await fixture();
  for (const flag of ['pagination', 'missing', 'ambiguous']) {
    missingPagination = flag === 'pagination';
    missingMaster = flag === 'missing';
    ambiguousMaster = flag === 'ambiguous';
    assert.equal((await request(`${path}/prepare?version=1`)).status, 422);
  }
  missingPagination = missingMaster = ambiguousMaster = false;
});
test('create only sends General/Sales fields; replay is read-only and source row stays unchanged', async () => {
  const fixtureData = await fixture();
  const plan = await preparation(fixtureData.path);
  const input = body(plan, 'New Customer One');
  const before = writes;
  const result = await request(fixtureData.path, 'super_admin', 'POST', input);
  assert.equal(result.status, 200, JSON.stringify(await result.clone().json()));
  assert.equal((await result.json()).code, 'MPA-100');
  assert.deepEqual(
    Object.keys(sent).sort(),
    [
      'name',
      'customerNo',
      'categoryName',
      'branchId',
      'currencyCode',
      'priceCategoryName',
      'discountCategoryName',
      'termName',
    ].sort(),
  );
  assert.equal(sent.branchId, 300);
  assert.equal(writes, before + 1);
  assert.equal((await request(fixtureData.path, 'super_admin', 'POST', input)).status, 200);
  assert.equal(writes, before + 1);
  const row = await db.query.importRows.findFirst({
    where: eq(schema.importRows.id, fixtureData.rowId),
  });
  assert.deepEqual(row?.candidate, fixtureData.candidate);
  assert.equal(await db.$count(schema.invoices), 0);
  assert.equal(await db.$count(schema.jobs), 0);
});
test('changed MPA sequence and existing normalized customer names never create a customer', async () => {
  const { path } = await fixture();
  const plan = await preparation(path);
  const before = writes;
  customers.push({ id: 9990, customerNo: plan.customerNo, name: 'External Addition' });
  assert.equal(
    (await request(path, 'super_admin', 'POST', body(plan, 'Should Refresh'))).status,
    409,
  );
  const fresh = await preparation(path);
  assert.equal(
    (await request(path, 'super_admin', 'POST', body(fresh, '  new   CUSTOMER One  '))).status,
    409,
  );
  assert.equal(writes, before);
});
test('stale draft, altered destination and extra fields block writes', async () => {
  const { path, batchId } = await fixture();
  const plan = await preparation(path);
  const before = writes;
  assert.equal(
    (await request(path, 'super_admin', 'POST', { ...body(plan, 'Extra'), currencyCode: 'USD' }))
      .status,
    400,
  );
  await db
    .update(schema.importBatches)
    .set({ version: 2 })
    .where(eq(schema.importBatches.id, batchId));
  assert.equal((await request(path, 'super_admin', 'POST', body(plan, 'Stale'))).status, 409);
  await db.update(schema.accurateDestinations).set({ targetBranchId: '301' });
  assert.equal((await request(`${path}/prepare?version=2`)).status, 422);
  await db.update(schema.accurateDestinations).set({ targetBranchId: '300' });
  assert.equal(writes, before);
});
test('lost save response reconciles by number without repeating POST, even for a new request ID', async () => {
  const { path } = await fixture();
  const plan = await preparation(path);
  const input = body(plan, 'Lost Response Customer');
  const before = writes;
  dropResponse = true;
  assert.equal((await request(path, 'super_admin', 'POST', input)).status, 409);
  dropResponse = false;
  detailUnavailable = true;
  assert.equal(
    (await request(path, 'super_admin', 'POST', { ...input, requestId: randomUUID() })).status,
    409,
  );
  detailUnavailable = false;
  assert.equal((await request(path, 'super_admin', 'POST', input)).status, 200);
  assert.equal(writes, before + 1);
});
test('post-save detail outage remains uncertain and can be reconciled without another save', async () => {
  const { path } = await fixture();
  const plan = await preparation(path);
  const input = body(plan, 'Detail Outage Customer');
  const before = writes;
  detailUnavailable = true;
  assert.equal((await request(path, 'super_admin', 'POST', input)).status, 409);
  detailUnavailable = false;
  assert.equal((await request(path, 'super_admin', 'POST', input)).status, 200);
  assert.equal(writes, before + 1);
});
test('explicit rejection is redacted, not retried, and conflicting idempotency input is rejected', async () => {
  const { path } = await fixture();
  const plan = await preparation(path);
  const input = body(plan, 'Rejected Customer');
  const before = writes;
  reject = true;
  const result = await request(path, 'super_admin', 'POST', input);
  assert.equal(result.status, 422);
  assert.doesNotMatch(await result.text(), /test-customer-token|test-customer-secret/);
  reject = false;
  assert.equal((await request(path, 'super_admin', 'POST', input)).status, 422);
  assert.equal(
    (await request(path, 'super_admin', 'POST', { ...input, name: 'Different' })).status,
    409,
  );
  assert.equal(writes, before + 1);
});
test('concurrent submissions reserve the same number before the external write', async () => {
  const { path } = await fixture();
  const plan = await preparation(path);
  const input = body(plan, 'Concurrent Customer');
  const before = writes;
  const responses = await Promise.all([
    request(path, 'super_admin', 'POST', input),
    request(path, 'super_admin', 'POST', { ...input, requestId: randomUUID() }),
  ]);
  assert.ok(responses.some((result) => result.status === 200));
  assert.ok(responses.every((result) => result.status === 200 || result.status === 409));
  assert.equal(writes, before + 1);
});
test('an uncertain name remains reserved even if another MPA number appears', async () => {
  const { path } = await fixture();
  const plan = await preparation(path);
  const input = body(plan, 'Pending Name Customer');
  const before = writes;
  dropResponse = true;
  assert.equal((await request(path, 'super_admin', 'POST', input)).status, 409);
  dropResponse = false;
  const hidden = customers.pop();
  assert.ok(hidden);
  customers.push({
    id: 99999,
    customerNo: `MPA-${BigInt(plan.customerNo.slice(4)) + 1n}`,
    name: 'Unrelated External Customer',
  });
  const refreshed = await preparation(path);
  assert.equal(
    (await request(path, 'super_admin', 'POST', body(refreshed, input.name))).status,
    409,
  );
  assert.equal(writes, before + 1);
  customers.push(hidden);
  assert.equal((await request(path, 'super_admin', 'POST', input)).status, 200);
});
test('a mismatched post-save detail is never accepted as a successful creation', async () => {
  const { path } = await fixture();
  const plan = await preparation(path);
  const input = body(plan, 'Mismatched Detail Customer');
  const before = writes;
  wrongDetail = true;
  assert.equal((await request(path, 'super_admin', 'POST', input)).status, 409);
  assert.equal((await request(path, 'super_admin', 'POST', input)).status, 409);
  wrongDetail = false;
  assert.equal((await request(path, 'super_admin', 'POST', input)).status, 200);
  assert.equal(writes, before + 1);
});

// Run after HTTP/file cleanup hooks, including when an earlier teardown failed.
afterDatabase(async () => {
  try {
    await closeDb();
  } finally {
    await closeTestDatabases();
  }
});
