import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { createTestDatabase, closeTestDatabases } from './helpers/mysql-database.js';

process.env.DATABASE_URL = await createTestDatabase();
process.env.BETTER_AUTH_SECRET = randomBytes(32).toString('hex');
process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
process.env.RUN_WORKER = 'false';
const { db, closeDb } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrate.js');
const { branches, invoices, integrationConfigs, accurateDestinations } =
  await import('../src/db/schema/index.js');
const { createCompany, deleteCompany, listCompanies } =
  await import('../src/services/companies.service.js');
const { configureConnection, getSettings, testConnection } =
  await import('../src/services/settings.service.js');
const { accurateConnection, connectedAccurate } =
  await import('../src/services/accurate-connection.service.js');
const { searchMasters, saveDestination } =
  await import('../src/services/accurate-mapping.service.js');
const { companyConnectionId } = await import('../src/utils/company-connection.js');
const nativeFetch = globalThis.fetch;
const remoteTokens: string[] = [];
const remoteWrites: string[] = [];
const remoteInvoices = new Map<
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
const profiles: Record<string, { id: number; name: string; secret: string }> = {
  'legacy-test-token': { id: 101, name: 'Legacy Company', secret: 'legacy-test-secret' },
  'company-a-test-token': { id: 201, name: 'Company A', secret: 'company-a-test-secret' },
  'company-b-test-token': { id: 301, name: 'Company B', secret: 'company-b-test-secret' },
};
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (!url.hostname.endsWith('.accurate.id'))
    throw new Error('Unexpected outbound request in company test');
  const headers = new Headers(init?.headers);
  const token = headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  const profile = profiles[token];
  assert.ok(profile, 'Only synthetic company credentials may be used');
  remoteTokens.push(token);
  assert.equal(
    headers.get('X-Api-Signature'),
    createHmac('sha256', profile.secret)
      .update(headers.get('X-Api-Timestamp') ?? '')
      .digest('base64'),
  );
  const response = (d: unknown) =>
    new Response(JSON.stringify({ s: true, d }), {
      headers: { 'Content-Type': 'application/json' },
    });
  if (url.pathname === '/api/api-token.do')
    return response({
      database: { id: profile.id, alias: profile.name, host: 'https://public.accurate.id' },
    });
  if (url.pathname.endsWith('/branch/list.do'))
    return response([{ id: profile.id, name: profile.name }]);
  if (url.pathname.endsWith('/branch/detail.do'))
    return response({ id: profile.id, name: profile.name });
  if (url.pathname.endsWith('/sales-invoice/list.do')) {
    const row = remoteInvoices.get(`${token}:${url.searchParams.get('filter.number.val')}`);
    return response(row ? [{ id: row.id, number: row.number }] : []);
  }
  if (url.pathname.endsWith('/sales-invoice/save.do')) {
    remoteWrites.push(token);
    const payload = new URLSearchParams(String(init?.body));
    const row = {
      id: String(profile.id * 10),
      number: payload.get('number')!,
      customer: { customerNo: payload.get('customerNo')! },
      branch: { id: profile.id },
      currency: { code: 'IDR' },
      totalAmount: Number(payload.get('detailItem[0].unitPrice')),
      transDate: payload.get('transDate')!,
    };
    remoteInvoices.set(`${token}:${row.number}`, row);
    return response({ id: row.id });
  }
  if (url.pathname.endsWith('/sales-invoice/detail.do'))
    return response(
      [...remoteInvoices.entries()].find(
        ([key, row]) => key.startsWith(`${token}:`) && row.id === url.searchParams.get('id'),
      )?.[1],
    );
  throw new Error('Unexpected Accurate operation in company test');
};
before(async () => {
  await migrate();
  await db.insert(branches).values({
    id: 'legacy',
    name: 'Existing Company',
    centerId: 'legacy-center',
    accurateDatabaseId: 'demo',
    accurateBranchId: 'JKT',
  });
  await configureConnection(
    'accurate',
    {
      enabled: true,
      accurate: {
        mode: 'live',
        apiToken: 'legacy-test-token',
        signatureSecret: 'legacy-test-secret',
      },
    },
    'admin',
  );
});
after(async () => {
  globalThis.fetch = nativeFetch;
  await closeDb();
  await closeTestDatabases();
});

test('new companies never inherit legacy secrets and legacy configuration is preserved', async () => {
  const company = await createCompany('Company without credentials', 'admin');
  const current = await accurateConnection(undefined, company.id);
  assert.equal(current.enabled, false);
  assert.equal(current.credentials, undefined);
  assert.equal(current.mode, 'live');
  await assert.rejects(connectedAccurate(true, company.id), { status: 409 });
  assert.equal(
    (await accurateConnection(undefined, 'legacy')).credentials?.apiToken,
    'legacy-test-token',
  );
  const settings = await getSettings(company.id);
  assert.equal(settings.accurate.hasApiToken, false);
  assert.ok(!JSON.stringify(settings).includes('legacy-test-token'));
  await deleteCompany(company.id, company.name, 'admin');
  await assert.rejects(accurateConnection(undefined, company.id), { status: 404 });
});

test('each company uses its own token, signature, profile and master data; omitted secrets stay saved', async () => {
  for (const name of ['Company A', 'Company B']) {
    const company = await createCompany(name, 'admin');
    const prefix = name === 'Company A' ? 'company-a' : 'company-b';
    await configureConnection(
      'accurate',
      {
        enabled: true,
        accurate: {
          mode: 'live',
          apiToken: `${prefix}-test-token`,
          signatureSecret: `${prefix}-test-secret`,
        },
      },
      'admin',
      company.id,
    );
    await configureConnection(
      'accurate',
      { enabled: true, accurate: { mode: 'live' } },
      'admin',
      company.id,
    );
    const expected = name === 'Company A' ? '201' : '301';
    assert.equal((await testConnection('accurate', 'admin', company.id)).database?.id, expected);
    const masters = await searchMasters({
      branchId: company.id,
      kind: 'branch',
      search: '',
      page: 1,
    });
    assert.equal(masters.database.id, expected);
    assert.equal(masters.items[0].name, name);
    const status = await saveDestination(company.id, expected, 'admin');
    assert.equal(status.destinations[0].databaseId, expected);
    assert.ok(status.destinations.every((row) => row.branchId === company.id));
    const settings = await getSettings(company.id);
    assert.ok(!JSON.stringify(settings).includes(`${prefix}-test`));
  }
  const listed = await listCompanies();
  assert.ok(!JSON.stringify(listed).includes('-test-token'));
  assert.ok(!JSON.stringify(listed).includes('-test-secret'));
  assert.equal((await accurateConnection()).credentials?.apiToken, 'legacy-test-token');
  assert.ok(remoteTokens.includes('company-a-test-token'));
  assert.ok(remoteTokens.includes('company-b-test-token'));
});

test('company deletion requires its exact name, preserves transaction history and removes unused local settings', async () => {
  const company = await createCompany('Protected Company', 'admin');
  await assert.rejects(deleteCompany(company.id, 'wrong name', 'admin'), { status: 400 });
  await db.insert(invoices).values({
    id: randomUUID(),
    sourceId: randomUUID(),
    number: 'INV-PROTECTED',
    customer: 'Test',
    customerId: 'TEST',
    branchId: company.id,
    date: new Date(),
    businessStatus: 'CLOSED',
    paymentStatus: 'PAID',
    total: 100,
    outstanding: 0,
    items: [],
    payments: [],
  });
  await assert.rejects(deleteCompany(company.id, company.name, 'admin'), { status: 409 });
  assert.equal((await listCompanies()).find((row) => row.id === company.id)?.canDelete, false);
  const removable = (await listCompanies()).find((row) => row.name === 'Company A');
  assert.ok(removable?.canDelete);
  await deleteCompany(removable.id, removable.name, 'admin');
  assert.equal(
    (await listCompanies()).some((row) => row.id === removable.id),
    false,
  );
  assert.equal(
    (await db.select().from(integrationConfigs)).some(
      (row) => row.id === companyConnectionId(removable.id),
    ),
    false,
  );
  assert.equal(
    (await db.select().from(accurateDestinations)).some((row) => row.branchId === removable.id),
    false,
  );
});

test('invoice enqueue and worker delivery honor the company connection while the legacy connection is disabled', async () => {
  const { sampleInvoices } = await import('../src/db/fixtures/invoices.js');
  const { accurateDeliveries } = await import('../src/db/schema/index.js');
  const { enqueue, processOne } = await import('../src/services/sync.service.js');
  const company = (await listCompanies()).find((row) => row.name === 'Company B');
  assert.ok(company);
  const invoice = {
    ...sampleInvoices(company.id)[1],
    id: randomUUID(),
    sourceId: randomUUID(),
    number: 'INV-COMPANY-B',
    date: new Date('2026-11-19T00:00:00Z'),
    syncStatus: 'PENDING',
  };
  await db.insert(invoices).values(invoice);
  await db
    .insert(accurateDeliveries)
    .values({
      invoiceId: invoice.id,
      branchId: company.id,
      databaseId: '301',
      targetBranchId: '301',
      sourceVersion: invoice.version,
      requestedNumber: invoice.number,
      payload: {
        number: invoice.number,
        customerNo: 'MPA-B',
        transDate: '19/11/2026',
        currencyCode: 'IDR',
        branchId: '301',
        'detailItem[0].unitPrice': String(invoice.total),
      },
      expectedTotal: invoice.total,
    });
  await configureConnection('accurate', { enabled: false }, 'admin');
  await enqueue(invoice.id, 'admin');
  assert.equal(await processOne(), true);
  assert.deepEqual(remoteWrites, ['company-b-test-token']);
  const saved = (await db.select().from(invoices)).find((row) => row.id === invoice.id);
  assert.equal(saved?.syncStatus, 'SYNCED');
  await configureConnection('accurate', { enabled: true }, 'admin');
});

test('concurrent duplicate company registration cannot create duplicate names', async () => {
  const results = await Promise.allSettled([
    createCompany('Concurrent Company', 'admin'),
    createCompany('Concurrent Company', 'admin'),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
});
