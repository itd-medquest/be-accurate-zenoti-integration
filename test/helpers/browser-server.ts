import { createTestDatabase } from './mysql-database.js';
// Isolated browser fixture: a disposable MySQL database and intercepted vendor calls only.
import { randomBytes } from 'node:crypto';
import 'dotenv/config';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
if (process.env.ACCURATE_MOCK_SERVER !== 'true')
  throw new Error('Set ACCURATE_MOCK_SERVER=true to start the isolated fixture.');
Object.assign(process.env, {
  DATABASE_URL: await createTestDatabase(),
  PORT: '4001',
  FRONTEND_URL: 'http://localhost:3001',
  BETTER_AUTH_URL: 'http://localhost:4001',
  RUN_WORKER: 'true',
  INTEGRATION_MODE: 'simulation',
  RESEND_API_KEY: '',
  BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
  ENCRYPTION_KEY: randomBytes(32).toString('hex'),
});
// Source uploads also stay outside the user's working data directory.
process.chdir(mkdtempSync(join(tmpdir(), 'intgrte-browser-fixture-')));
const originalFetch = globalThis.fetch;
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
const response = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const customerFixture = process.env.CUSTOMER_CREATION_FIXTURE === 'true';
const customers = [{ id: 10, customerNo: 'MPA-99', name: 'Existing Customer' }];
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (!url.hostname.endsWith('.accurate.id')) return originalFetch(input, init);
  if (url.pathname === '/api/api-token.do')
    return response({
      s: true,
      d: { database: { id: 999, alias: 'Test Company', host: 'https://public.accurate.id' } },
    });
  if (customerFixture && url.pathname.endsWith('/customer/save.do')) {
    const input: Record<string, unknown> = JSON.parse(String(init?.body));
    const customer = {
      id: 100 + customers.length,
      customerNo: String(input.customerNo),
      name: String(input.name),
    };
    if (customers.some((row) => row.customerNo === customer.customerNo))
      return response({ s: false, d: ['Customer number already used'] });
    customers.push(customer);
    return response({ s: true, r: customer });
  }
  if (
    customerFixture &&
    url.pathname.endsWith('/list.do') &&
    /\/(customer|customer-category|branch|currency|price-category|payment-term)\/list.do$/.test(
      url.pathname,
    )
  ) {
    const kind = url.pathname.split('/').at(-2);
    let rows: Record<string, unknown>[] = [];
    if (kind === 'customer') {
      const search = url.searchParams.get('filter.keywords.val')?.toLowerCase();
      const number = url.searchParams.get('filter.no.val');
      rows = customers.filter(
        (row) =>
          (!search ||
            row.name.toLowerCase().includes(search) ||
            row.customerNo.toLowerCase().includes(search)) &&
          (!number ||
            (url.searchParams.get('filter.no.op') === 'EQUAL'
              ? row.customerNo === number
              : row.customerNo.includes(number))),
      );
    } else if (kind === 'customer-category') rows = [{ id: 1, name: 'Astetic' }];
    else if (kind === 'branch') rows = [{ id: 300, name: 'PT Mylab Prima Inovatif' }];
    else if (kind === 'currency') rows = [{ id: 1, code: 'IDR', name: 'Indonesian Rupiah' }];
    else if (kind === 'price-category') rows = [{ id: 1, name: 'Umum' }];
    else if (kind === 'payment-term') rows = [{ id: 1, name: 'C.O.D' }];
    return response({ s: true, d: rows, sp: { pageCount: rows.length ? 1 : 0 } });
  }
  if (customerFixture && url.pathname.endsWith('/customer/detail.do'))
    return response({
      s: true,
      d: customers.find((row) => String(row.id) === url.searchParams.get('id')),
    });
  if (/\/(customer|item|branch)\/(list|detail).do$/.test(url.pathname)) {
    const master = url.pathname.includes('/branch/')
      ? { id: 300, name: 'Jakarta' }
      : url.pathname.includes('/customer/')
        ? { id: 10, customerNo: 'MPA-TEST', name: 'Customer Test' }
        : { id: 20, no: 'ITEM-TEST', name: 'Layanan Test', unit1Name: 'Jasa' };
    return response({ s: true, d: url.pathname.endsWith('/list.do') ? [master] : master });
  }
  if (url.pathname.endsWith('/sales-invoice/list.do')) {
    const row = remote.get(url.searchParams.get('filter.number.val') ?? '');
    return response({ s: true, d: row ? [{ id: row.id, number: row.number }] : [] });
  }
  if (url.pathname.endsWith('/sales-invoice/detail.do'))
    return response({
      s: true,
      d: [...remote.values()].find((row) => row.id === url.searchParams.get('id')),
    });
  if (url.pathname.endsWith('/sales-invoice/save.do')) {
    const payload = new URLSearchParams(String(init?.body));
    let total = 0;
    for (let i = 0; payload.has(`detailItem[${i}].itemNo`); i++)
      total +=
        Number(payload.get(`detailItem[${i}].unitPrice`)) *
        Number(payload.get(`detailItem[${i}].quantity`));
    const row = {
      id: String(1000 + remote.size),
      number: payload.get('number') ?? '',
      customer: { customerNo: payload.get('customerNo') ?? '' },
      branch: { id: 300 },
      currency: { code: 'IDR' },
      totalAmount: Math.round(total),
      transDate: payload.get('transDate') ?? '',
    };
    remote.set(row.number, row);
    return response({ s: true, r: { id: row.id } });
  }
  throw new Error(`Unmocked Accurate request blocked: ${url.pathname}`);
};
await (await import('../../src/db/migrate.js')).migrate();
await (await import('../../src/db/seed.js')).seed();
await import('../../src/server.js');
