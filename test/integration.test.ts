import { after as afterDatabase } from 'node:test';
import { createTestDatabase, closeTestDatabases } from './helpers/mysql-database.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { receiptPdf } from './helpers/receipt-fixture.js';
import { ocrReceiptPdf } from './helpers/ocr-receipt-fixture.js';
process.env.DATABASE_URL = await createTestDatabase();
process.env.BETTER_AUTH_SECRET = randomBytes(32).toString('hex');
process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
process.env.RUN_WORKER = 'false';
process.env.INTEGRATION_MODE = 'simulation';
process.env.IMPORT_PACKAGE_TAX_POLICY = 'proportional';
const { app } = await import('../src/app.js');
const { db, closeDb } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrate.js');
const {
  invoices,
  branches,
  user,
  account,
  simulatedDrafts,
  invoiceSyncs,
  integrationConfigs,
  jobs,
  importFiles,
  importBatches,
  auditLogs,
  session,
} = await import('../src/db/schema/index.js');
const { templateBuffer, parseExcel } = await import('../src/utils/parsers/excel.js');
const { parsePdf } = await import('../src/utils/parsers/pdf.js');
const { allocateTax, candidateErrors } = await import('../src/utils/import-validation.js');
const { enqueue, processOne, recoverStaleJobs } = await import('../src/services/sync.service.js');
const { sampleInvoices } = await import('../src/db/fixtures/invoices.js');
const { encrypt, decrypt } = await import('../src/utils/encryption.js');
const { hashPassword } = await import('better-auth/crypto');
const { eq } = await import('drizzle-orm');
let server: Server;
let base = '';
const cookies: Record<string, string> = {};
const password = 'Test-password-8675309!';

test('import overview respects authorization and validates read filters', async () => {
  assert.equal((await request('/imports/overview')).status, 401);
  assert.equal((await request('/imports/overview', 'viewer')).status, 403);
  const result = await request('/imports/overview?page=1&pageSize=10', 'finance');
  assert.equal(result.status, 200);
  const overview = await result.json();
  assert.ok(Array.isArray(overview.items));
  assert.equal(typeof overview.summary.sent, 'number');
  assert.equal((await request('/imports/overview?status=invalid', 'finance')).status, 400);
});
async function request(
  path: string,
  role?: string,
  method = 'GET',
  body?: unknown,
  origin = 'http://localhost:3000',
) {
  return fetch(`${base}/api${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(role ? { Cookie: cookies[role] } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
before(async () => {
  await migrate();
  await db.insert(branches).values({
    id: 'branch-jakarta',
    name: 'Jakarta',
    centerId: 'center-jakarta',
    accurateDatabaseId: 'demo',
    accurateBranchId: 'JKT',
  });
  await db.insert(integrationConfigs).values([
    { id: 'zenoti', enabled: true },
    { id: 'accurate', enabled: true },
  ]);
  await db.insert(invoices).values(sampleInvoices());
  for (const role of ['super_admin', 'finance', 'viewer']) {
    await db.insert(user).values({ id: role, name: role, email: `${role}@example.test`, role });
    await db.insert(account).values({
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
  if (!address || typeof address === 'string') throw new Error('Missing server address');
  base = `http://127.0.0.1:${address.port}`;
  for (const role of ['super_admin', 'finance', 'viewer']) {
    const result = await request('/auth/sign-in/email', undefined, 'POST', {
      email: `${role}@example.test`,
      password,
    });
    assert.equal(result.status, 200, await result.text());
    cookies[role] = result.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    assert.ok(cookies[role]);
  }
});
after(async () => {
  if (server)
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  for (const file of await db.select().from(importFiles))
    if (/^[a-f0-9-]{36}$/.test(file.storedName))
      await unlink(resolve('data/imports', file.storedName)).catch(() => {});
  await closeDb();
});
test('API requires authentication; viewer can read but cannot operate or manage users', async () => {
  assert.equal((await request('/imports', 'viewer')).status, 403);
  assert.equal((await request('/dashboard')).status, 401);
  assert.equal((await request('/dashboard', 'viewer')).status, 200);
  assert.equal((await request('/invoices/invoice-1/sync', 'viewer', 'POST')).status, 403);
  assert.equal((await request('/users', 'finance')).status, 403);
  assert.equal((await request('/settings', 'viewer')).status, 403);
});
test('public signup and cross-origin writes are rejected', async () => {
  const signup = await request('/auth/sign-up/email', undefined, 'POST', {
    name: 'Intruder',
    email: 'intruder@example.test',
    password,
    role: 'super_admin',
  });
  assert.notEqual(signup.status, 200);
  assert.equal(
    (
      await request(
        '/invoices/invoice-1/sync',
        'finance',
        'POST',
        undefined,
        'https://foreign.test',
      )
    ).status,
    403,
  );
});
test('queue prevents concurrent duplicate submissions and persists a draft', async () => {
  const results = await Promise.allSettled([
    enqueue('invoice-1', 'finance'),
    enqueue('invoice-1', 'finance'),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  await processOne();
  const invoice = await db.query.invoices.findFirst({ where: eq(invoices.id, 'invoice-1') });
  assert.equal(invoice?.syncStatus, 'SYNCED');
  const targets = await db.select().from(simulatedDrafts);
  assert.equal(targets.length, 1);
  assert.equal((await request('/invoices/invoice-1/sync', 'finance', 'POST')).status, 409);
  const sync = await db.query.invoiceSyncs.findFirst({
    where: eq(invoiceSyncs.invoiceId, 'invoice-1'),
  });
  assert.equal(sync?.targetStatus, 'DRAFT');
});
test('open invoice transitions to closed without changing target identity or duplicating payments', async () => {
  const prior = await db.query.invoiceSyncs.findFirst({
    where: eq(invoiceSyncs.invoiceId, 'invoice-1'),
  });
  const row = (await db.query.invoices.findFirst({ where: eq(invoices.id, 'invoice-1') }))!;
  const payment = {
    id: 'final-payment',
    method: 'bank' as const,
    amount: row.outstanding,
    paidAt: new Date().toISOString(),
  };
  await db
    .update(invoices)
    .set({
      businessStatus: 'CLOSED',
      paymentStatus: 'PAID',
      outstanding: 0,
      payments: [...row.payments, payment],
      version: 2,
      syncStatus: 'PENDING',
    })
    .where(eq(invoices.id, row.id));
  await enqueue(row.id, 'finance');
  await processOne();
  const current = await db.query.invoiceSyncs.findFirst({
    where: eq(invoiceSyncs.invoiceId, row.id),
  });
  assert.equal(current?.targetId, prior?.targetId);
  assert.equal(current?.paymentIds.length, 2);
  assert.equal(new Set(current?.paymentIds).size, 2);
});
test('timeout enters review; retry looks up previously saved draft and avoids duplicate writes', async () => {
  await enqueue('invoice-9', 'finance');
  await processOne();
  const review = await db.query.invoices.findFirst({ where: eq(invoices.id, 'invoice-9') });
  assert.equal(review?.syncStatus, 'NEEDS_REVIEW');
  const before = await db.query.simulatedDrafts.findFirst({
    where: eq(simulatedDrafts.reference, 'zenoti-9'),
  });
  assert.ok(before);
  await enqueue('invoice-9', 'finance');
  await processOne();
  const synced = await db.query.invoiceSyncs.findFirst({
    where: eq(invoiceSyncs.invoiceId, 'invoice-9'),
  });
  assert.equal(synced?.targetId, before.id);
  const rows = await db
    .select()
    .from(simulatedDrafts)
    .where(eq(simulatedDrafts.reference, 'zenoti-9'));
  assert.equal(rows.length, 1);
});
test('unmapped item fails; admin correction allows safe retry', async () => {
  await enqueue('invoice-6', 'finance');
  await processOne();
  assert.equal(
    (await db.query.invoices.findFirst({ where: eq(invoices.id, 'invoice-6') }))?.syncStatus,
    'FAILED',
  );
  assert.equal(
    (await request('/invoices/invoice-6/resolve-mapping', 'finance', 'POST')).status,
    403,
  );
  assert.equal(
    (await request('/invoices/invoice-6/resolve-mapping', 'super_admin', 'POST')).status,
    200,
  );
  await enqueue('invoice-6', 'finance');
  await processOne();
  assert.equal(
    (await db.query.invoices.findFirst({ where: eq(invoices.id, 'invoice-6') }))?.syncStatus,
    'SYNCED',
  );
});
test('refund and void remain in review and do not create target drafts', async () => {
  for (const id of ['invoice-12', 'invoice-18']) {
    await enqueue(id, 'finance');
    await processOne();
    assert.equal(
      (await db.query.invoices.findFirst({ where: eq(invoices.id, id) }))?.syncStatus,
      'NEEDS_REVIEW',
    );
    assert.equal(
      (await db.select().from(invoiceSyncs).where(eq(invoiceSyncs.invoiceId, id))).length,
      0,
    );
  }
});
test('gift cards, vouchers, tips and service charges use the same draft pipeline', async () => {
  for (const id of ['invoice-15', 'invoice-21', 'invoice-24', 'invoice-27']) {
    await enqueue(id, 'finance');
    await processOne();
    assert.equal(
      (await db.query.invoices.findFirst({ where: eq(invoices.id, id) }))?.syncStatus,
      'SYNCED',
    );
  }
});
test('repeated fetch does not duplicate invoices or overwrite corrected mappings', async () => {
  for (let i = 0; i < 2; i++) {
    const response = await request('/integrations/fetch', 'finance', 'POST');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).inserted, 0);
  }
  assert.equal((await db.select().from(invoices)).length, 36);
  assert.ok(
    (await db.query.invoices.findFirst({ where: eq(invoices.id, 'invoice-6') }))?.items.every(
      (i) => i.mapped,
    ),
  );
});
test('dashboard uses consistent invoice denominator and branch filters', async () => {
  const response = await request('/dashboard', 'viewer');
  const data = await response.json();
  assert.equal(data.summary.total, 36);
  assert.equal(data.rate, Math.round((data.summary.synced / 36) * 1000) / 10);
  assert.equal(
    (await (await request('/dashboard?branch=missing', 'viewer')).json()).summary.total,
    0,
  );
  assert.equal((await request('/invoices?status=INVALID', 'viewer')).status, 400);
});
test('secrets are encrypted, masked, and never returned; disabled integration blocks enqueue', async () => {
  const secret = 'sensitive-api-secret';
  const encrypted = encrypt(secret);
  assert.notEqual(encrypted, secret);
  assert.equal(decrypt(encrypted), secret);
  assert.equal(
    (await request('/settings/accurate', 'super_admin', 'PATCH', { enabled: false, secret }))
      .status,
    200,
  );
  const settings = await (await request('/settings', 'super_admin')).text();
  assert.ok(!settings.includes(secret));
  assert.ok(!settings.includes(encrypted));
  assert.equal((await request('/invoices/invoice-2/sync', 'finance', 'POST')).status, 409);
  await request('/settings/accurate', 'super_admin', 'PATCH', { enabled: true });
});
test('branch destination cannot drift after invoice import', async () => {
  assert.equal(
    (
      await request('/branches/branch-jakarta', 'super_admin', 'PATCH', {
        name: 'Jakarta',
        accurateDatabaseId: 'other',
        accurateBranchId: 'OTHER',
      })
    ).status,
    409,
  );
});

test('retired invoice list export and bulk-sync routes are absent', async () => {
  assert.equal((await request('/invoices/export', 'finance')).status, 404);
  assert.equal(
    (await request('/invoices/bulk-sync', 'finance', 'POST', { ids: ['invoice-1'] })).status,
    404,
  );
});
test('user suspension revokes existing sessions; audit contains login and operational actions', async () => {
  assert.equal(
    (await request('/users/super_admin', 'super_admin', 'PATCH', { role: 'viewer', active: false }))
      .status,
    409,
  );
  assert.equal(
    (await request('/users/viewer', 'super_admin', 'PATCH', { role: 'viewer', active: false }))
      .status,
    200,
  );
  assert.equal((await request('/dashboard', 'viewer')).status, 401);
  const login = await request('/auth/sign-in/email', undefined, 'POST', {
    email: 'viewer@example.test',
    password,
  });
  assert.equal(login.status, 403);
  const logs = await (await request('/audit', 'super_admin')).json();
  assert.ok(logs.some((l: { action: string }) => l.action === 'session.create'));
  assert.ok(logs.some((l: { action: string }) => l.action === 'user.update'));
  // Restore the viewer fixture so later role tests exercise 403, rather than an expired session.
  await request('/users/viewer', 'super_admin', 'PATCH', { role: 'viewer', active: true });
  const restored = await request('/auth/sign-in/email', undefined, 'POST', {
    email: 'viewer@example.test',
    password,
  });
  assert.equal(restored.status, 200);
  cookies.viewer = restored.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
});
test('admin creates users with real credential accounts and role changes revoke their sessions', async () => {
  const created = await request('/users', 'super_admin', 'POST', {
    name: 'New Finance',
    email: 'NewFinance@example.test',
    password,
    role: 'finance',
  });
  assert.equal(created.status, 201);
  const { id } = await created.json();
  assert.equal(
    (
      await request('/users', 'super_admin', 'POST', {
        name: 'Duplicate',
        email: 'newfinance@example.test',
        password,
        role: 'viewer',
      })
    ).status,
    409,
  );
  const login = await request('/auth/sign-in/email', undefined, 'POST', {
    email: 'newfinance@example.test',
    password,
  });
  assert.equal(login.status, 200);
  cookies.newfinance = login.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  assert.equal((await request('/me', 'newfinance')).status, 200);
  assert.equal(
    (await request(`/users/${id}`, 'super_admin', 'PATCH', { role: 'viewer', active: true }))
      .status,
    200,
  );
  assert.equal((await request('/me', 'newfinance')).status, 401);
});

test('deleting users requires an admin, blocks self deletion and reports missing users', async () => {
  assert.equal((await request('/users/missing-user', undefined, 'DELETE')).status, 401);
  for (const role of ['finance', 'viewer'])
    assert.equal((await request('/users/missing-user', role, 'DELETE')).status, 403);
  assert.equal((await request('/users/super_admin', 'super_admin', 'DELETE')).status, 409);
  assert.equal((await request('/users/missing-user', 'super_admin', 'DELETE')).status, 404);
});

test('deleting a user removes credentials and sessions but preserves audit history', async () => {
  const email = `delete-${randomUUID()}@example.test`;
  const created = await request('/users', 'super_admin', 'POST', {
    name: 'Delete fixture',
    email,
    password,
    role: 'finance',
  });
  assert.equal(created.status, 201);
  const { id } = await created.json();
  const login = await request('/auth/sign-in/email', undefined, 'POST', { email, password });
  assert.equal(login.status, 200);
  cookies.deleted = login.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  assert.equal((await request('/me', 'deleted')).status, 200);
  const auditId = randomUUID();
  await db
    .insert(auditLogs)
    .values({ id: auditId, actorId: id, action: 'fixture.previous-action' });
  assert.equal((await request(`/users/${id}`, 'super_admin', 'DELETE')).status, 200);
  assert.equal(await db.query.user.findFirst({ where: eq(user.id, id) }), undefined);
  assert.equal((await db.select().from(account).where(eq(account.userId, id))).length, 0);
  assert.equal((await db.select().from(session).where(eq(session.userId, id))).length, 0);
  assert.equal((await request('/me', 'deleted')).status, 401);
  assert.equal(
    (await request('/auth/sign-in/email', undefined, 'POST', { email, password })).status,
    401,
  );
  const listing = await (await request('/users', 'super_admin')).json();
  assert.ok(!listing.some((value: { id: string }) => value.id === id));
  const logs = await db.select().from(auditLogs);
  assert.ok(logs.some((value) => value.id === auditId && value.actorId === id));
  assert.ok(
    logs.some(
      (value) =>
        value.action === 'user.delete' && value.actorId === 'super_admin' && value.entityId === id,
    ),
  );
  assert.equal((await request(`/users/${id}`, 'super_admin', 'DELETE')).status, 404);
});

test('a user with upload history cannot be deleted, even after the batch is archived', async () => {
  const id = randomUUID(),
    batchId = randomUUID();
  await db
    .insert(user)
    .values({ id, name: 'Uploader fixture', email: `${id}@example.test`, role: 'finance' });
  await db
    .insert(importBatches)
    .values({ id: batchId, branchId: 'branch-jakarta', uploaderId: id, status: 'ARCHIVED' });
  const response = await request(`/users/${id}`, 'super_admin', 'DELETE');
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Nonaktifkan akun/);
  assert.ok(await db.query.user.findFirst({ where: eq(user.id, id) }));
  assert.ok(await db.query.importBatches.findFirst({ where: eq(importBatches.id, batchId) }));
  assert.equal(
    (await request(`/users/${id}`, 'super_admin', 'PATCH', { role: 'finance', active: false }))
      .status,
    200,
  );
});

test('opposing admin deletion and demotion preserve an active admin and recheck authority', async () => {
  const a = randomUUID(),
    b = randomUUID();
  await db.insert(user).values([
    { id: a, name: 'Admin A', email: `${a}@example.test`, role: 'super_admin' },
    { id: b, name: 'Admin B', email: `${b}@example.test`, role: 'super_admin' },
  ]);
  const { deleteUser, updateUser } = await import('../src/services/users.service.js');
  const results = await Promise.allSettled([
    deleteUser(a, b),
    updateUser(b, { role: 'viewer', active: true }, a),
  ]);
  assert.equal(results.filter((value) => value.status === 'fulfilled').length, 1);
  const remaining = (await db.select().from(user)).filter((value) => [a, b].includes(value.id));
  assert.equal(remaining.filter((value) => value.active && value.role === 'super_admin').length, 1);
  for (const value of remaining) {
    await updateUser(value.id, { role: 'viewer', active: false }, 'super_admin');
    await deleteUser(value.id, 'super_admin');
  }
});
test('invalid totals are held for review and a stale worker lease does not trigger a blind write', async () => {
  await db.update(invoices).set({ outstanding: 1 }).where(eq(invoices.id, 'invoice-31'));
  await enqueue('invoice-31', 'finance');
  await processOne();
  assert.equal(
    (await db.query.invoices.findFirst({ where: eq(invoices.id, 'invoice-31') }))?.syncStatus,
    'NEEDS_REVIEW',
  );
  const queued = await enqueue('invoice-32', 'finance');
  await db
    .update(jobs)
    .set({ status: 'RUNNING', lockedAt: new Date(Date.now() - 6 * 60000) })
    .where(eq(jobs.id, queued.id));
  await recoverStaleJobs();
  assert.equal(
    (await db.query.invoices.findFirst({ where: eq(invoices.id, 'invoice-32') }))?.syncStatus,
    'NEEDS_REVIEW',
  );
  assert.equal(
    (await db.select().from(invoiceSyncs).where(eq(invoiceSyncs.invoiceId, 'invoice-32'))).length,
    0,
  );
});

async function uploadFiles(files: { name: string; data: Buffer }[]) {
  const form = new FormData();
  form.set('branchId', 'branch-jakarta');
  for (const file of files) form.append('files', new Blob([new Uint8Array(file.data)]), file.name);
  return fetch(`${base}/api/imports`, {
    method: 'POST',
    headers: { Origin: 'http://localhost:3000', Cookie: cookies.finance },
    body: form,
  });
}
test('package breakdown preserves source final price and QRIS is fully paid, not outstanding', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'imp-receipt-'));
  const path = join(folder, 'receipt.pdf');
  await writeFile(path, receiptPdf());
  try {
    const [c] = await parsePdf(path);
    assert.deepEqual(
      c.items.map((i) => i.quantity * i.unitPrice - i.discount),
      [135135, 45045],
    );
    assert.deepEqual(
      c.items.map((i) => i.discountPercent),
      [70, 75],
    );
    assert.deepEqual(
      c.items.map((i) => i.tax),
      [14865, 4955],
    );
    assert.deepEqual(
      c.items.map((i) => i.unitPrice * i.quantity - i.discount + i.tax),
      [150000, 50000],
    );
    assert.equal(c.total, 200000);
    assert.equal(c.totalPaid, 200000);
    assert.equal(c.outstanding, 0);
    assert.equal(c.payments[0].method, 'qris');
    assert.equal(c.businessStatus, 'UNKNOWN');
    assert.ok(c.packageName);
    assert.deepEqual(candidateErrors(c), []);
  } finally {
    await unlink(path);
  }
  assert.equal(
    allocateTax([1, 1, 1], 2).reduce((a, b) => a + b, 0),
    2,
  );
});
let importBatch: any;
test('bulk PDF and XLSX upload creates preview only, with no invoice or job writes', async () => {
  const invoiceCount = (await db.select().from(invoices)).length;
  const jobCount = (await db.select().from(jobs)).length;
  const response = await uploadFiles([
    { name: 'receipt.pdf', data: receiptPdf() },
    { name: 'bulk.xlsx', data: await templateBuffer(true) },
  ]);
  assert.equal(response.status, 201, await response.clone().text());
  importBatch = await response.json();
  assert.equal(importBatch.rows.length, 2);
  assert.equal(importBatch.status, 'PREVIEW');
  assert.equal((await db.select().from(invoices)).length, invoiceCount);
  assert.equal((await db.select().from(jobs)).length, jobCount);
  // Current policy exposes the missing source status as a warning, not a validation error.
  const pdf = importBatch.rows.find((r: any) => r.candidate.sourceFormat === 'PDF');
  assert.equal(pdf.candidate.businessStatus, 'UNKNOWN');
  assert.ok(pdf.candidate.warnings.some((w: string) => w.includes('Status Open/Closed')));
});
test('Accounting review is versioned and submit requires explicit confirmation', async () => {
  const pdf = importBatch.rows.find((r: any) => r.candidate.sourceFormat === 'PDF');
  const review = await request(`/imports/${importBatch.id}/rows/${pdf.id}`, 'finance', 'PATCH', {
    version: importBatch.version,
    businessStatus: 'CLOSED',
  });
  assert.equal(review.status, 200);
  const updated = await review.json();
  assert.equal(
    (
      await request(`/imports/${importBatch.id}/submit`, 'finance', 'POST', {
        version: importBatch.version,
        rowIds: updated.rows.map((r: any) => r.id),
        accountingReviewed: true,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(`/imports/${importBatch.id}/submit`, 'finance', 'POST', {
        version: updated.version,
        rowIds: updated.rows.map((r: any) => r.id),
      })
    ).status,
    400,
  );
  importBatch = updated;
});
test('submit atomically enqueues reviewed invoices; repeated submit never duplicates jobs or drafts', async () => {
  const body = {
    version: importBatch.version,
    rowIds: importBatch.rows.map((r: any) => r.id),
    accountingReviewed: true,
  };
  const first = await request(`/imports/${importBatch.id}/submit`, 'finance', 'POST', body);
  assert.equal(first.status, 200, await first.clone().text());
  const response = await first.json();
  assert.equal(response.status, 'SUBMITTED');
  const count = (await db.select().from(jobs)).length;
  assert.equal(
    (await request(`/imports/${importBatch.id}/submit`, 'finance', 'POST', body)).status,
    200,
  );
  assert.equal((await db.select().from(jobs)).length, count);
  await processOne();
  await processOne();
  const invoice = await db.query.invoices.findFirst({
    where: eq(invoices.sourceId, '11111111-1111-4111-8111-111111111111'),
  });
  assert.equal(invoice?.syncStatus, 'SYNCED');
  assert.equal(invoice?.total, 200000);
  assert.equal(
    invoice?.items.reduce((n, i) => n + i.unitPrice * i.quantity - i.discount + i.tax, 0),
    200000,
  );
});
test('reuploading the same receipt is identified by invoice identity even under a different filename', async () => {
  const upload = await uploadFiles([{ name: 'different-name.pdf', data: receiptPdf() }]);
  assert.equal(upload.status, 201);
  let batch = await upload.json();
  const reviewed = await request(
    `/imports/${batch.id}/rows/${batch.rows[0].id}`,
    'finance',
    'PATCH',
    { version: batch.version, businessStatus: 'CLOSED' },
  );
  batch = await reviewed.json();
  assert.equal(batch.rows[0].status, 'DUPLICATE');
  const count = (await db.select().from(jobs)).length;
  const result = await request(`/imports/${batch.id}/submit`, 'finance', 'POST', {
    version: batch.version,
    rowIds: [batch.rows[0].id],
    accountingReviewed: true,
  });
  assert.equal(result.status, 200);
  assert.equal((await db.select().from(jobs)).length, count);
});
test('invalid totals and spreadsheet formulas are blocked without normalizing the source total', async () => {
  const Excel = (await import('exceljs')).default;
  const workbook = new Excel.Workbook();
  await workbook.xlsx.load((await templateBuffer(true)) as never);
  workbook.getWorksheet('Invoices')!.getCell('J2').value = 200001;
  const [bad] = await parseExcel(Buffer.from(await workbook.xlsx.writeBuffer()));
  assert.equal(bad.total, 200001);
  assert.ok(candidateErrors(bad).some((e) => e.includes('total invoice')));
  const response = await uploadFiles([
    { name: 'mismatch.xlsx', data: Buffer.from(await workbook.xlsx.writeBuffer()) },
  ]);
  const batch = await response.json();
  assert.equal(
    (
      await request(`/imports/${batch.id}/submit`, 'finance', 'POST', {
        version: batch.version,
        rowIds: [batch.rows[0].id],
        accountingReviewed: true,
      })
    ).status,
    422,
  );
  workbook.getWorksheet('Invoices')!.getCell('J2').value = { formula: '1+1', result: 2 };
  const formula = Buffer.from(await workbook.xlsx.writeBuffer());
  await assert.rejects(() => parseExcel(formula), /Formula/);
});

test('bulk upload accepts 20 files and rejects a 21st file', async () => {
  const data = await templateBuffer(true);
  const files = Array.from({ length: 20 }, (_, i) => ({ name: `invoice-${i}.xlsx`, data }));
  const allowed = await uploadFiles(files);
  assert.equal(allowed.status, 201, await allowed.clone().text());
  assert.equal((await allowed.json()).files.length, 20);
  const rejected = await uploadFiles([...files, { name: 'overflow.xlsx', data }]);
  assert.equal(rejected.status, 400);
});

test('native Sales Accrual groups invoice rows, preserves source amounts and retains provenance', async () => {
  const { salesTemplateBuffer } = await import('../src/utils/parsers/sales-accrual.js');
  const Excel = (await import('exceljs')).default;
  const workbook = new Excel.Workbook();
  await workbook.xlsx.load((await salesTemplateBuffer(true)) as never);
  const sheet = workbook.worksheets[0];
  sheet.addRow(sheet.getRow(5).values);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const [c] = await parseExcel(buffer);
  assert.equal(c.items.length, 2);
  assert.equal(c.total, 400000);
  assert.equal(c.tax, 39640);
  assert.deepEqual(c.sourceRows, [5, 6]);
  assert.equal(c.sourceCenter, 'MPA');
  assert.equal(c.businessStatus, 'CLOSED');
  assert.notEqual(c.items[0].id, c.items[1].id);
  assert.deepEqual(candidateErrors(c), []);
  const original = [...c.items].map((i) => i.id).sort();
  sheet.getRow(5).values = sheet.getRow(6).values;
  assert.deepEqual(
    (await parseExcel(Buffer.from(await workbook.xlsx.writeBuffer())))[0].items
      .map((i) => i.id)
      .sort(),
    original,
  );
  sheet.getCell('N5').value = 100;
  const [redemption] = await parseExcel(Buffer.from(await workbook.xlsx.writeBuffer()));
  assert.ok(candidateErrors(redemption).some((e) => e.includes('redemption')));
});

test('Excel source preview is authenticated and deletion blocks a later submit', async () => {
  const { salesTemplateBuffer } = await import('../src/utils/parsers/sales-accrual.js');
  const uploaded = await uploadFiles([
    { name: 'sales-accrual.xlsx', data: await salesTemplateBuffer(true) },
  ]);
  const batch = await uploaded.json();
  assert.equal(uploaded.status, 201);
  const url = `/imports/${batch.id}/files/${batch.files[0].id}/preview`;
  assert.equal((await request(url)).status, 401);
  assert.ok([401, 403].includes((await request(url, 'viewer')).status));
  const preview = await request(url, 'finance');
  assert.equal(preview.status, 200);
  const source = await preview.json();
  assert.equal(source.sheets[0].rows.find((r: any) => r.number === 4).cells[2], 'Invoice No');
  assert.ok(
    [401, 403].includes(
      (await request(`/imports/${batch.id}`, 'viewer', 'DELETE', { version: batch.version }))
        .status,
    ),
  );
  assert.equal(
    (await request(`/imports/${batch.id}`, 'finance', 'DELETE', { version: batch.version + 1 }))
      .status,
    409,
  );
  assert.equal(
    (await request(`/imports/${batch.id}`, 'finance', 'DELETE', { version: batch.version })).status,
    200,
  );
  const history = await (await request('/imports', 'finance')).json();
  assert.ok(!history.some((b: any) => b.id === batch.id));
  assert.equal(
    (
      await request(`/imports/${batch.id}/submit`, 'finance', 'POST', {
        version: batch.version + 1,
        rowIds: [batch.rows[0].id],
        accountingReviewed: true,
      })
    ).status,
    409,
  );
});

test('Excel package requires audited exact-value service breakdown before submit; submitted history cannot be deleted', async () => {
  const { salesTemplateBuffer } = await import('../src/utils/parsers/sales-accrual.js');
  const Excel = (await import('exceljs')).default;
  const workbook = new Excel.Workbook();
  await workbook.xlsx.load((await salesTemplateBuffer(true)) as never);
  const sheet = workbook.worksheets[0];
  sheet.getCell('A5').value = 'Package';
  sheet.getCell('C5').value = 'PACKAGE-DEMO-001';
  sheet.getCell('S5').value = 'PACKAGE-RECEIPT-001';
  sheet.getCell('I5').value = 'Custom Package Contoh';
  const uploaded = await uploadFiles([
    { name: 'package.xlsx', data: Buffer.from(await workbook.xlsx.writeBuffer()) },
  ]);
  let batch = await uploaded.json();
  assert.ok(batch.rows[0].errors.some((e: string) => e.includes('Detail paket belum lengkap')));
  assert.equal(
    (
      await request(`/imports/${batch.id}/submit`, 'finance', 'POST', {
        version: batch.version,
        rowIds: [batch.rows[0].id],
        accountingReviewed: true,
      })
    ).status,
    422,
  );
  const url = `/imports/${batch.id}/rows/${batch.rows[0].id}/package`,
    parent = batch.rows[0].candidate.packageParents[0];
  const items = [
    {
      name: 'Collagen Dew Facial',
      quantity: 1,
      unitPrice: 450450,
      discountPercent: 70,
      tax: 14865,
    },
    { name: 'Massage', quantity: 1, unitPrice: 180180, discountPercent: 75, tax: 4955 },
  ];
  assert.equal(
    (
      await request(url, 'finance', 'PATCH', {
        version: batch.version,
        parentLineId: parent.id,
        items: [{ ...items[0], tax: 14866 }, items[1]],
      })
    ).status,
    422,
  );
  const save = await request(url, 'finance', 'PATCH', {
    version: batch.version,
    parentLineId: parent.id,
    items,
  });
  assert.equal(save.status, 200, await save.clone().text());
  const oldVersion = batch.version;
  batch = await save.json();
  assert.equal(batch.rows[0].errors.length, 0);
  assert.equal(batch.rows[0].candidate.items.length, 2);
  assert.deepEqual(
    batch.rows[0].candidate.items.map((i: any) => i.discountPercent),
    [70, 75],
  );
  assert.deepEqual(
    batch.rows[0].candidate.items.map((i: any) => i.unitPrice * i.quantity - i.discount + i.tax),
    [150000, 50000],
  );
  assert.equal(batch.rows[0].candidate.total, 200000);
  assert.equal(batch.rows[0].candidate.packageParents[0].name, 'Custom Package Contoh');
  assert.equal(
    (
      await request(url, 'finance', 'PATCH', {
        version: oldVersion,
        parentLineId: parent.id,
        items,
      })
    ).status,
    409,
  );
  const sent = await request(`/imports/${batch.id}/submit`, 'finance', 'POST', {
    version: batch.version,
    rowIds: [batch.rows[0].id],
    accountingReviewed: true,
  });
  assert.equal(sent.status, 200);
  const submitted = await sent.json();
  assert.equal(
    (await request(`/imports/${batch.id}`, 'finance', 'DELETE', { version: submitted.version }))
      .status,
    409,
  );
  assert.equal(
    (
      await request(url, 'finance', 'PATCH', {
        version: submitted.version,
        parentLineId: parent.id,
        items,
      })
    ).status,
    409,
  );
});

test('Sales Accrual totals formulas do not hide invoices; data formulas only hold their own invoice', async () => {
  const { salesTemplateBuffer } = await import('../src/utils/parsers/sales-accrual.js');
  const Excel = (await import('exceljs')).default;
  const w = new Excel.Workbook();
  await w.xlsx.load((await salesTemplateBuffer(true)) as never);
  const s = w.worksheets[0],
    sample = s.getRow(5).values;
  for (let n = 5; n <= 9; n++) {
    s.getRow(n).values = sample;
    s.getCell(`C${n}`).value = ['I1', 'I2', 'I2', 'I3', 'I4'][n - 5];
    s.getCell(`S${n}`).value = ['R1', 'R2', 'R2', 'R3', 'R4'][n - 5];
    s.getCell(`I${n}`).value = `Layanan ${n}`;
  }
  s.getCell('A10').value = 'Total: ';
  s.getCell('M10').value = { formula: 'SUM(M5:M9)', result: 1000000 };
  let rows = await parseExcel(Buffer.from(await w.xlsx.writeBuffer()));
  assert.equal(rows.length, 4);
  assert.deepEqual(
    rows.map((r) => r.sourceRows),
    [[5], [6, 7], [8], [9]],
  );
  assert.equal(rows[1].items.length, 2);
  assert.equal(rows[1].sourceEntries?.length, 2);
  assert.ok(rows.every((r) => r.errors.length === 0));
  assert.equal(
    rows.reduce((n, r) => n + r.total, 0),
    1000000,
  );
  s.getCell('AF5').value = { formula: '1+1', result: 180180 };
  rows = await parseExcel(Buffer.from(await w.xlsx.writeBuffer()));
  assert.equal(rows.length, 4);
  assert.ok(rows[0].errors.some((e) => e.includes('Formula pada baris data')));
  assert.ok(rows.slice(1).every((r) => r.errors.length === 0));
  s.getCell('AF5').value = 180180;
  s.getCell('C5').value = { text: 'I1', hyperlink: 'https://example.invalid/invoice' };
  rows = await parseExcel(Buffer.from(await w.xlsx.writeBuffer()));
  assert.equal(rows.length, 4);
  assert.equal(rows[0].sourceInvoiceNumber, 'I1');
  assert.equal(rows[0].errors.length, 0);
});

test('source and history pagination are bounded; Accounting inspection persists independently from validation', async () => {
  const { salesTemplateBuffer } = await import('../src/utils/parsers/sales-accrual.js');
  const Excel = (await import('exceljs')).default;
  const w = new Excel.Workbook();
  await w.xlsx.load((await salesTemplateBuffer(true)) as never);
  const s = w.worksheets[0],
    sample = s.getRow(5).values;
  for (let n = 5; n < 65; n++) {
    s.getRow(n).values = sample;
    s.getCell(`C${n}`).value = `PAGED-${n}`;
    s.getCell(`S${n}`).value = `PAGED-R-${n}`;
  }
  const response = await uploadFiles([
    { name: 'paged.xlsx', data: Buffer.from(await w.xlsx.writeBuffer()) },
  ]);
  let batch = await response.json();
  assert.equal(batch.rows.length, 60);
  const endpoint = `/imports/${batch.id}/files/${batch.files[0].id}/preview`;
  const p1 = await (await request(endpoint, 'finance')).json(),
    p2 = await (await request(endpoint + '?page=2', 'finance')).json();
  assert.equal(p1.sheets[0].totalRows, 60);
  assert.equal(p1.sheets[0].rows.filter((r: any) => r.number > 4).length, 25);
  assert.equal(p2.sheets[0].rows.filter((r: any) => r.number > 4)[0].number, 30);
  const only = await (await request(endpoint + `?rowId=${batch.rows[0].id}`, 'finance')).json();
  assert.equal(only.sheets[0].totalRows, 1);
  const history = await (await request('/imports?page=1&pageSize=2', 'finance')).json();
  assert.equal(history.items.length, 2);
  assert.ok(history.total > 2);
  const row = batch.rows[0];
  assert.equal(row.candidate.accountingReviewedAt, undefined);
  const mark = await request(`/imports/${batch.id}/rows/${row.id}/reviewed`, 'finance', 'PATCH', {
    version: batch.version,
  });
  assert.equal(mark.status, 200);
  batch = await mark.json();
  assert.ok(batch.rows[0].candidate.accountingReviewedAt);
  const changed = await request(`/imports/${batch.id}/rows/${row.id}`, 'finance', 'PATCH', {
    version: batch.version,
    businessStatus: 'OPEN',
  });
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).rows[0].candidate.accountingReviewedAt, undefined);
});

test('percentage discounts retain source percentages, exact amounts, and duplicate identity', async () => {
  const { percentageDiscountAmount } = await import('../src/utils/discount.js');
  assert.equal(percentageDiscountAmount(100000, 30), 30000);
  assert.equal(percentageDiscountAmount(450450, 70), 315315);
  assert.equal(percentageDiscountAmount(180180, 75), 135135);
  assert.equal(percentageDiscountAmount(100000, 12.5), 12500);
  assert.equal(percentageDiscountAmount(100000, 0), 0);
  assert.equal(percentageDiscountAmount(100000, 100), 100000);
  assert.ok(Number.isNaN(percentageDiscountAmount(101, 30)));
  assert.ok(Number.isNaN(percentageDiscountAmount(100000, 101)));
  const { candidateHash } = await import('../src/utils/import-validation.js');
  const [legacy] = await parseExcel(await templateBuffer(true));
  const withPercent = {
    ...legacy,
    items: legacy.items.map((i) => ({
      ...i,
      discountPercent: (i.discount / (i.unitPrice * i.quantity)) * 100,
    })),
  };
  assert.equal(candidateHash(legacy), candidateHash(withPercent));
  const { salesTemplateBuffer } = await import('../src/utils/parsers/sales-accrual.js');
  const Excel = (await import('exceljs')).default;
  const w = new Excel.Workbook();
  await w.xlsx.load((await salesTemplateBuffer(true)) as never);
  const s = w.worksheets[0];
  s.getCell('AF5').value = 200000;
  s.getCell('X5').value = '30%';
  s.getCell('K5').value = 140000;
  s.getCell('L5').value = 0;
  s.getCell('M5').value = 140000;
  s.getCell('O5').value = 140000;
  let [c] = await parseExcel(Buffer.from(await w.xlsx.writeBuffer()));
  assert.equal(c.items[0].discountPercent, 30);
  assert.equal(c.items[0].discount, 60000);
  assert.deepEqual(candidateErrors(c), []);
  s.getCell('X5').value = 0.3;
  s.getCell('X5').numFmt = '0%';
  [c] = await parseExcel(Buffer.from(await w.xlsx.writeBuffer()));
  assert.equal(c.items[0].discountPercent, 30);
  assert.equal(c.total, 140000);
  assert.deepEqual(candidateErrors(c), []);
});

test('draft file removal is versioned, preserves other files, and cannot submit or edit removed rows', async () => {
  const data = await templateBuffer(true);
  const response = await uploadFiles([
    { name: 'keep.xlsx', data },
    { name: 'remove.xlsx', data },
  ]);
  let batch = await response.json();
  const target = batch.files.find((f: any) => f.name === 'remove.xlsx'),
    removed = batch.rows.find((r: any) => r.fileId === target.id);
  const count = (await db.select().from(invoices)).length,
    jobsBefore = (await db.select().from(jobs)).length;
  assert.equal(
    (
      await request(`/imports/${batch.id}/files/${target.id}`, 'finance', 'DELETE', {
        version: batch.version + 1,
      })
    ).status,
    409,
  );
  const deleted = await request(`/imports/${batch.id}/files/${target.id}`, 'finance', 'DELETE', {
    version: batch.version,
  });
  assert.equal(deleted.status, 200, await deleted.clone().text());
  const result = await deleted.json();
  assert.equal(result.deleted, false);
  batch = result.batch;
  assert.equal(batch.files.length, 1);
  assert.equal(batch.files[0].name, 'keep.xlsx');
  assert.equal(batch.rows.length, 1);
  assert.equal((await db.select().from(invoices)).length, count);
  assert.equal((await db.select().from(jobs)).length, jobsBefore);
  assert.equal(
    (
      await request(`/imports/${batch.id}/rows/${removed.id}`, 'finance', 'PATCH', {
        version: batch.version,
        businessStatus: 'CLOSED',
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request(`/imports/${batch.id}/rows/${removed.id}/reviewed`, 'finance', 'PATCH', {
        version: batch.version,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request(`/imports/${batch.id}/submit`, 'finance', 'POST', {
        version: batch.version,
        rowIds: [removed.id],
        accountingReviewed: true,
      })
    ).status,
    400,
  );
  const last = await request(
    `/imports/${batch.id}/files/${batch.files[0].id}`,
    'finance',
    'DELETE',
    { version: batch.version },
  );
  assert.equal(last.status, 200);
  assert.equal((await last.json()).deleted, true);
  const history = await (await request('/imports', 'finance')).json();
  assert.ok(!history.some((b: any) => b.id === batch.id));
  assert.equal((await db.select().from(jobs)).length, jobsBefore);
  // Submitted batches remain immutable through the per-file route as well.
  assert.equal(
    (
      await request(
        `/imports/${importBatch.id}/files/${importBatch.files[0].id}`,
        'finance',
        'DELETE',
        { version: importBatch.version },
      )
    ).status,
    409,
  );
});

test('draft item corrections preserve source, audit changes, and reject unsafe edits', async () => {
  const uuid = randomUUID();
  const number = `EDIT-${uuid.slice(0, 11)}`;
  const data = Buffer.from(
    receiptPdf()
      .toString('latin1')
      .replaceAll('11111111-1111-4111-8111-111111111111', uuid)
      .replaceAll('TEST-RECEIPT-001', number),
    'latin1',
  );
  const response = await uploadFiles([{ name: 'correctable.pdf', data }]);
  assert.equal(response.status, 201);
  let batch = await response.json();
  const row = batch.rows[0],
    original = row.candidate.items[0];
  const endpoint = `/imports/${batch.id}/rows/${row.id}/items/${encodeURIComponent(original.id)}`;
  const count = (await db.select().from(invoices)).length,
    jobCount = (await db.select().from(jobs)).length;
  batch = await (
    await request(`/imports/${batch.id}/rows/${row.id}/reviewed`, 'finance', 'PATCH', {
      version: batch.version,
    })
  ).json();
  const stamp = batch.rows[0].candidate.accountingReviewedAt;
  assert.ok(stamp);
  const fields = {
    name: original.name,
    quantity: original.quantity,
    unitPrice: original.unitPrice,
    tax: original.tax,
    reason: 'Harga diperiksa dari sumber asli',
  };
  assert.equal(
    (await request(endpoint, 'viewer', 'PATCH', { version: batch.version, ...fields })).status,
    403,
  );
  assert.equal(
    (
      await request(endpoint, 'finance', 'PATCH', {
        version: batch.version,
        ...fields,
        unitPrice: 500450,
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await request(endpoint, 'finance', 'PATCH', {
        version: batch.version,
        ...fields,
        discountPercent: 66.6999671,
      })
    ).status,
    422,
  );
  assert.equal(
    (await request(endpoint, 'finance', 'PATCH', { version: batch.version, ...fields, total: 0 }))
      .status,
    400,
  );
  const oldVersion = batch.version;
  const corrected = await request(endpoint, 'finance', 'PATCH', {
    version: batch.version,
    ...fields,
    unitPrice: 500450,
    discountPercent: 70,
  });
  assert.equal(corrected.status, 200, await corrected.clone().text());
  batch = await corrected.json();
  assert.equal(batch.version, oldVersion + 1);
  assert.equal(batch.rows[0].candidate.accountingReviewedAt, undefined);
  assert.equal(batch.rows[0].candidate.subtotal, 180180);
  assert.equal(batch.rows[0].candidate.tax, 19820);
  assert.equal(batch.rows[0].candidate.total, 200000);
  assert.ok(batch.rows[0].errors.some((e: string) => e.includes('Jumlah item')));
  assert.equal(
    (
      await request(`/imports/${batch.id}/submit`, 'finance', 'POST', {
        version: batch.version,
        rowIds: [row.id],
        accountingReviewed: true,
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await request(endpoint, 'finance', 'PATCH', {
        version: oldVersion,
        ...fields,
        discountPercent: 70,
      })
    ).status,
    409,
  );
  assert.equal((await db.select().from(invoices)).length, count);
  assert.equal((await db.select().from(jobs)).length, jobCount);
  const fixed = await request(endpoint, 'finance', 'PATCH', {
    version: batch.version,
    ...fields,
    discountPercent: 70,
  });
  assert.equal(fixed.status, 200);
  batch = await fixed.json();
  assert.deepEqual(batch.rows[0].candidate.items[0], original);
  assert.deepEqual(batch.rows[0].errors, []);
  const { auditLogs } = await import('../src/db/schema/index.js');
  const events = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.action, 'import.item.correct'));
  const details = events.find((e) => e.entityId === batch.id)!.details as any;
  assert.equal(details.reason, fields.reason);
  assert.equal(details.before.unitPrice, 450450);
  assert.equal(details.after.unitPrice, 500450);
  assert.equal(details.previousReviewedAt, stamp);
  assert.deepEqual(
    Buffer.from(
      await (
        await request(`/imports/${batch.id}/files/${batch.files[0].id}`, 'finance')
      ).arrayBuffer(),
    ),
    data,
  );
  const submit = await request(`/imports/${batch.id}/submit`, 'finance', 'POST', {
    version: batch.version,
    rowIds: [row.id],
    accountingReviewed: true,
  });
  assert.equal(submit.status, 200, await submit.clone().text());
  batch = await submit.json();
  assert.equal(
    (await request(endpoint, 'finance', 'PATCH', { version: batch.version, ...fields })).status,
    409,
  );
});

test('percentage item edits round discount and tax, audit the rates and retain source validation', async () => {
  let batch = await (
    await uploadFiles([{ name: 'percentage-edit.pdf', data: receiptPdf() }])
  ).json();
  const row = batch.rows[0],
    original = row.candidate.items[0];
  const endpoint = `/imports/${batch.id}/rows/${row.id}/items/${encodeURIComponent(original.id)}`;
  batch = await (
    await request(`/imports/${batch.id}/rows/${row.id}/reviewed`, 'finance', 'PATCH', {
      version: batch.version,
    })
  ).json();
  const reviewedAt = batch.rows[0].candidate.accountingReviewedAt;
  const fields = {
    name: original.name,
    quantity: 1,
    unitPrice: 8392321,
    discountPercent: 5,
    taxPercent: 11,
    reason: 'Koreksi persen diskon dan pajak sesuai sumber',
  };
  for (const invalid of [
    { taxPercent: 101 },
    { discountPercent: -1 },
    { tax: 123 },
    { discountPercent: 5.1234567 },
    { taxPercent: 11.1234567 },
  ]) {
    const response = await request(endpoint, 'finance', 'PATCH', {
      version: batch.version,
      ...fields,
      ...invalid,
    });
    assert.ok([400, 422].includes(response.status));
  }
  const response = await request(endpoint, 'finance', 'PATCH', {
    version: batch.version,
    ...fields,
  });
  assert.equal(response.status, 200, await response.clone().text());
  const saved = await response.json(),
    candidate = saved.rows[0].candidate,
    item = candidate.items[0];
  assert.equal(saved.version, batch.version + 1);
  assert.equal(item.discount, 419616);
  assert.equal(item.discountPercent, 5);
  assert.equal(item.discountRoundingAdjustment, 0);
  assert.equal(item.tax, 876998);
  assert.equal(item.taxPercent, 11);
  assert.equal(item.taxRoundingAdjustment, 0);
  assert.equal(candidate.accountingReviewedAt, undefined);
  for (const key of ['subtotal', 'tax', 'total', 'payments', 'packageParents'])
    assert.deepEqual(candidate[key], row.candidate[key]);
  assert.ok(saved.rows[0].errors.some((error: string) => error.includes('Jumlah item')));
  assert.ok(saved.rows[0].errors.some((error: string) => error.includes('Jumlah pajak')));
  assert.ok(!saved.rows[0].errors.some((error: string) => error.includes('Persentase')));
  const submit = await request(`/imports/${batch.id}/submit`, 'finance', 'POST', {
    version: saved.version,
    rowIds: [row.id],
    accountingReviewed: true,
  });
  assert.equal(submit.status, 422);
  const { auditLogs } = await import('../src/db/schema/index.js');
  const audit = (await db.select().from(auditLogs).where(eq(auditLogs.entityId, batch.id))).find(
    (event) => event.action === 'import.item.correct',
  )!.details as any;
  assert.equal(audit.after.discountPercent, 5);
  assert.equal(audit.after.taxPercent, 11);
  assert.equal(audit.previousReviewedAt, reviewedAt);
  assert.equal(audit.reason, fields.reason);
});

test('name-only Excel correction preserves exact nominal discount when its percentage repeats', async () => {
  const Excel = (await import('exceljs')).default;
  const w = new Excel.Workbook();
  await w.xlsx.load((await templateBuffer(true)) as never);
  const uuid = randomUUID(),
    inv = w.getWorksheet('Invoices')!,
    items = w.getWorksheet('Items')!,
    payments = w.getWorksheet('Payments')!;
  inv.getCell('A2').value = uuid;
  inv.getCell('B2').value = `NOMINAL-${uuid}`;
  inv.getCell('H2').value = 195045;
  inv.getCell('J2').value = 214865;
  inv.getCell('L2').value = 14865;
  items.getCell('A2').value = uuid;
  items.getCell('A3').value = uuid;
  items.getCell('G2').value = 300450;
  payments.getCell('A2').value = uuid;
  let batch = await (
    await uploadFiles([{ name: 'nominal.xlsx', data: Buffer.from(await w.xlsx.writeBuffer()) }])
  ).json();
  const row = batch.rows[0],
    item = row.candidate.items[0];
  assert.deepEqual(row.errors, []);
  assert.equal(item.discountPercent, undefined);
  const saved = await request(
    `/imports/${batch.id}/rows/${row.id}/items/${encodeURIComponent(item.id)}`,
    'finance',
    'PATCH',
    {
      version: batch.version,
      name: 'Nama layanan diperbaiki',
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      tax: item.tax,
      reason: 'Nama disesuaikan dengan invoice sumber',
    },
  );
  assert.equal(saved.status, 200, await saved.clone().text());
  batch = await saved.json();
  assert.equal(batch.rows[0].candidate.items[0].discount, 300450);
  assert.equal(batch.rows[0].candidate.items[0].discountPercent, undefined);
  assert.deepEqual(batch.rows[0].errors, []);
});

test(
  'OCR drafts require review; failed legacy previews can be re-read without changing their source',
  { timeout: 120000 },
  async () => {
    const { importRows, auditLogs } = await import('../src/db/schema/index.js');
    const { emptyCandidate } = await import('../src/utils/import-validation.js');
    const data = ocrReceiptPdf();
    const uploaded = await uploadFiles([{ name: 'raster-receipt.pdf', data }]);
    assert.equal(uploaded.status, 201, await uploaded.clone().text());
    let batch = await uploaded.json();
    assert.equal(batch.files[0].error, null);
    assert.ok(batch.rows[0].errors.some((e: string) => e.includes('OCR')));
    assert.equal(batch.rows[0].candidate.total, 12000000);
    const invoiceCount = (await db.select().from(invoices)).length,
      jobCount = (await db.select().from(jobs)).length;
    const fileId = batch.files[0].id,
      oldRowId = batch.rows[0].id;
    // Recreate a previously failed parser snapshot while retaining its immutable uploaded PDF.
    const failed = emptyCandidate('PDF');
    failed.errors.push('Font lama tidak terbaca.');
    await db.update(importRows).set({ candidate: failed }).where(eq(importRows.id, oldRowId));
    await db
      .update(importFiles)
      .set({ error: 'Font lama tidak terbaca.' })
      .where(eq(importFiles.id, fileId));
    const endpoint = `/imports/${batch.id}/files/${fileId}/reparse`;
    assert.equal(
      (await request(endpoint, 'viewer', 'POST', { version: batch.version })).status,
      403,
    );
    assert.equal(
      (await request(endpoint, 'finance', 'POST', { version: batch.version + 1 })).status,
      409,
    );
    const reread = await request(endpoint, 'finance', 'POST', { version: batch.version });
    assert.equal(reread.status, 200, await reread.clone().text());
    batch = await reread.json();
    assert.equal(batch.rows.length, 1);
    assert.notEqual(batch.rows[0].id, oldRowId);
    assert.equal(batch.files[0].error, null);
    assert.equal(batch.rows[0].candidate.tax, 1189189);
    assert.equal(
      (await db.select().from(importRows).where(eq(importRows.id, oldRowId)))[0].status,
      'DELETED',
    );
    assert.equal(
      (await request(endpoint, 'finance', 'POST', { version: batch.version })).status,
      409,
    );
    assert.deepEqual(
      Buffer.from(
        await (await request(`/imports/${batch.id}/files/${fileId}`, 'finance')).arrayBuffer(),
      ),
      data,
    );
    assert.equal((await db.select().from(invoices)).length, invoiceCount);
    assert.equal((await db.select().from(jobs)).length, jobCount);
    const events = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'import.file.reparse'));
    assert.ok(events.some((e) => e.entityId === batch.id));
    const row = batch.rows[0],
      item = row.candidate.items[0];
    assert.equal(
      (
        await request(`/imports/${batch.id}/submit`, 'finance', 'POST', {
          version: batch.version,
          rowIds: [row.id],
          accountingReviewed: true,
        })
      ).status,
      422,
    );
    const patch = await request(
      `/imports/${batch.id}/rows/${row.id}/items/${encodeURIComponent(item.id)}`,
      'finance',
      'PATCH',
      {
        version: batch.version,
        name: 'Glow Skin Booster corrected',
        quantity: 4,
        unitPrice: 1801801.75,
        tax: item.tax,
        reason: 'Match item name to the source document',
      },
    );
    assert.equal(patch.status, 200, await patch.clone().text());
    batch = await patch.json();
    assert.equal(batch.rows[0].candidate.items[0].discount, item.discount);
    assert.equal(batch.rows[0].candidate.items[0].unitPrice, 1801801.75);
    assert.ok(batch.rows[0].errors.some((e: string) => e.includes('OCR')));
    const status = await request(`/imports/${batch.id}/rows/${row.id}`, 'finance', 'PATCH', {
      version: batch.version,
      businessStatus: 'CLOSED',
    });
    assert.equal(status.status, 200);
    batch = await status.json();
    const reviewed = await request(
      `/imports/${batch.id}/rows/${row.id}/reviewed`,
      'finance',
      'PATCH',
      { version: batch.version },
    );
    assert.equal(reviewed.status, 200);
    batch = await reviewed.json();
    assert.deepEqual(batch.rows[0].errors, []);
    const submit = await request(`/imports/${batch.id}/submit`, 'finance', 'POST', {
      version: batch.version,
      rowIds: [row.id],
      accountingReviewed: true,
    });
    assert.equal(submit.status, 200, await submit.clone().text());
    batch = await submit.json();
    assert.equal(
      (await request(endpoint, 'finance', 'POST', { version: batch.version })).status,
      409,
    );
  },
);

test('manual package accepts tax percent, reconciles small rounding and audits exact financial values', async () => {
  const { salesTemplateBuffer, salesHeaders } =
    await import('../src/utils/parsers/sales-accrual.js');
  const Excel = (await import('exceljs')).default;
  const w = new Excel.Workbook();
  await w.xlsx.load((await salesTemplateBuffer(true)) as never);
  const s = w.worksheets[0],
    code = 'PERCENT-PACKAGE-' + randomUUID();
  const values: Record<string, string | number> = {
    'Item Type': 'Package',
    'Invoice No': code,
    'Receipt No': code,
    'Item Name': 'Custom Package Sample',
    Price: 7432432,
    'Sales (Exc. Tax)': 7432432,
    Tax: 817568,
    'Sales(Inc. Tax)': 8250000,
    Collected: 8250000,
  };
  for (const [header, value] of Object.entries(values))
    s.getRow(5).getCell(salesHeaders.indexOf(header) + 1).value = value;
  const uploaded = await uploadFiles([
    { name: 'percent-package.xlsx', data: Buffer.from(await w.xlsx.writeBuffer()) },
  ]);
  assert.equal(uploaded.status, 201);
  let batch = await uploaded.json();
  const row = batch.rows[0],
    parent = row.candidate.packageParents[0];
  const endpoint = `/imports/${batch.id}/rows/${row.id}/package`;
  const input = {
    name: 'Sample facial',
    quantity: 5,
    unitPrice: 2702703,
    discountPercent: 45,
    taxPercent: 11,
  };
  assert.equal(
    (
      await request(endpoint, 'finance', 'PATCH', {
        version: batch.version,
        parentLineId: parent.id,
        items: [{ ...input, unitPrice: 2382321 }],
      })
    ).status,
    422,
  );
  const saved = await request(endpoint, 'finance', 'PATCH', {
    version: batch.version,
    parentLineId: parent.id,
    items: [input],
  });
  assert.equal(saved.status, 200, await saved.clone().text());
  batch = await saved.json();
  const line = batch.rows[0].candidate.items[0];
  assert.equal(line.discountPercent, 45);
  assert.equal(line.taxPercent, 11);
  assert.equal(line.quantity, 5);
  assert.equal(line.discount, 6081083);
  assert.equal(line.tax, 817568);
  assert.equal(line.unitPrice * line.quantity - line.discount + line.tax, 8250000);
  assert.deepEqual(batch.rows[0].errors, []);
  const { auditLogs } = await import('../src/db/schema/index.js');
  const logs = await db.select().from(auditLogs).where(eq(auditLogs.entityId, batch.id));
  const event = logs.find((e) => e.action === 'import.package.review')!.details as any;
  assert.equal(event.rounding, true);
  assert.equal(event.inputItems[0].taxPercent, 11);
  assert.equal(event.calculatedItems[0].discountRoundingAdjustment, 1);
});

test('adding a missing item preserves source and existing lines, invalidates review, and is versioned and audited', async () => {
  const { importRows, auditLogs } = await import('../src/db/schema/index.js');
  const uuid = randomUUID(),
    number = 'ADD-' + uuid.slice(0, 12);
  const data = Buffer.from(
    receiptPdf()
      .toString('latin1')
      .replaceAll('11111111-1111-4111-8111-111111111111', uuid)
      .replaceAll('TEST-RECEIPT-001', number),
    'latin1',
  );
  let batch = await (await uploadFiles([{ name: 'missing-item.pdf', data }])).json();
  const row = batch.rows[0],
    original = row.candidate,
    first = original.items[0];
  const stamp = new Date().toISOString();
  await db
    .update(importRows)
    .set({
      candidate: {
        ...original,
        items: [first],
        accountingReviewedAt: stamp,
        errors: ['Ada baris item PDF yang belum terbaca lengkap.'],
      },
    })
    .where(eq(importRows.id, row.id));
  const invoiceCount = (await db.select().from(invoices)).length,
    jobCount = (await db.select().from(jobs)).length;
  const endpoint = `/imports/${batch.id}/rows/${row.id}/items`;
  const input = {
    version: batch.version,
    name: 'Missed massage service',
    kind: 'service',
    quantity: 1,
    unitPrice: 180180,
    discountPercent: 75,
    taxPercent: 11,
    reason: 'Service was missing from PDF extraction',
  };
  assert.equal((await request(endpoint, 'viewer', 'POST', input)).status, 403);
  assert.equal(
    (await request(endpoint, 'finance', 'POST', { ...input, version: input.version + 1 })).status,
    409,
  );
  assert.equal(
    (await request(endpoint, 'finance', 'POST', { ...input, discountPercent: 75.1234567 })).status,
    422,
  );
  assert.equal((await request(endpoint, 'finance', 'POST', { ...input, total: 123 })).status, 400);
  assert.equal(
    (await request(`/imports/${batch.id}/rows/missing/items`, 'finance', 'POST', input)).status,
    404,
  );
  const saved = await request(endpoint, 'finance', 'POST', input);
  assert.equal(saved.status, 201, await saved.clone().text());
  batch = await saved.json();
  const candidate = batch.rows[0].candidate,
    added = candidate.items[1];
  assert.equal(batch.version, input.version + 1);
  assert.equal(candidate.items.length, 2);
  assert.deepEqual(candidate.items[0], first);
  assert.equal(added.name, input.name);
  assert.equal(added.tax, 4955);
  assert.equal(added.discount, 135135);
  assert.match(added.id, /:detail:manual:/);
  assert.equal(candidate.accountingReviewedAt, undefined);
  assert.deepEqual(batch.rows[0].errors, []);
  for (const field of [
    'sourceId',
    'number',
    'date',
    'customer',
    'customerId',
    'subtotal',
    'tax',
    'total',
    'totalPaid',
    'outstanding',
    'payments',
    'packageParents',
    'benefits',
  ])
    assert.deepEqual(candidate[field], original[field], field);
  assert.equal((await db.select().from(invoices)).length, invoiceCount);
  assert.equal((await db.select().from(jobs)).length, jobCount);
  assert.equal((await request(endpoint, 'finance', 'POST', input)).status, 409);
  const events = await db.select().from(auditLogs).where(eq(auditLogs.action, 'import.item.add'));
  const event = events.find((e) => e.entityId === batch.id)!.details as any;
  assert.equal(event.reason, input.reason);
  assert.equal(event.previousReviewedAt, stamp);
  assert.deepEqual(event.resolvedParserErrors, ['Ada baris item PDF yang belum terbaca lengkap.']);
  assert.equal(event.item.id, added.id);
  assert.equal(event.sourceTotals.total, 200000);
  assert.deepEqual(
    Buffer.from(
      await (
        await request(`/imports/${batch.id}/files/${batch.files[0].id}`, 'finance')
      ).arrayBuffer(),
    ),
    data,
  );
  // A further positive item may be saved as a held draft, while its source mismatch blocks submit.
  const extra = await request(endpoint, 'finance', 'POST', {
    ...input,
    version: batch.version,
    name: 'Additional source item',
    quantity: 1,
    unitPrice: 2382321,
    discountPercent: 45,
  });
  assert.equal(extra.status, 201);
  batch = await extra.json();
  assert.ok(batch.rows[0].errors.some((e: string) => e.includes('Jumlah item')));
  assert.equal(
    (
      await request(`/imports/${batch.id}/submit`, 'finance', 'POST', {
        version: batch.version,
        rowIds: [row.id],
        accountingReviewed: true,
      })
    ).status,
    422,
  );
  await db.update(importRows).set({ candidate }).where(eq(importRows.id, row.id));
  const submitted = await request(`/imports/${batch.id}/submit`, 'finance', 'POST', {
    version: batch.version,
    rowIds: [row.id],
    accountingReviewed: true,
  });
  assert.equal(submitted.status, 200, await submitted.clone().text());
  batch = await submitted.json();
  assert.equal(
    (await request(endpoint, 'finance', 'POST', { ...input, version: batch.version })).status,
    409,
  );
});

test('draft item deletion undoes an incorrect addition, preserves the source and audits the removed line', async () => {
  const { auditLogs } = await import('../src/db/schema/index.js');
  const uuid = randomUUID(),
    number = 'DEL-' + uuid.slice(0, 12);
  const data = Buffer.from(
    receiptPdf()
      .toString('latin1')
      .replaceAll('11111111-1111-4111-8111-111111111111', uuid)
      .replaceAll('TEST-RECEIPT-001', number),
    'latin1',
  );
  let batch = await (await uploadFiles([{ name: 'delete-item.pdf', data }])).json();
  const row = batch.rows[0],
    original = row.candidate;
  const invoiceCount = (await db.select().from(invoices)).length,
    jobCount = (await db.select().from(jobs)).length;
  const added = await request(`/imports/${batch.id}/rows/${row.id}/items`, 'finance', 'POST', {
    version: batch.version,
    name: 'Incorrect additional service',
    kind: 'service',
    quantity: 1,
    unitPrice: 100000,
    discountPercent: 0,
    taxPercent: 11,
    reason: 'Test addition that must be removed',
  });
  assert.equal(added.status, 201);
  batch = await added.json();
  const item = batch.rows[0].candidate.items.at(-1);
  const reviewed = await request(
    `/imports/${batch.id}/rows/${row.id}/reviewed`,
    'finance',
    'PATCH',
    { version: batch.version },
  );
  assert.equal(reviewed.status, 200);
  batch = await reviewed.json();
  const stamp = batch.rows[0].candidate.accountingReviewedAt,
    version = batch.version;
  const endpoint = `/imports/${batch.id}/rows/${row.id}/items/${encodeURIComponent(item.id)}`;
  assert.equal((await request(endpoint, 'viewer', 'DELETE', { version })).status, 403);
  assert.equal(
    (await request(endpoint, 'finance', 'DELETE', { version: version - 1 })).status,
    409,
  );
  assert.equal((await request(endpoint, 'finance', 'DELETE', { version, total: 0 })).status, 400);
  assert.equal(
    (
      await request(
        `/imports/${batch.id}/rows/missing/items/${encodeURIComponent(item.id)}`,
        'finance',
        'DELETE',
        { version },
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(`/imports/${batch.id}/rows/${row.id}/items/unknown`, 'finance', 'DELETE', {
        version,
      })
    ).status,
    404,
  );
  const deleted = await request(endpoint, 'finance', 'DELETE', { version });
  assert.equal(deleted.status, 200, await deleted.clone().text());
  batch = await deleted.json();
  assert.equal(batch.version, version + 1);
  assert.deepEqual(batch.rows[0].candidate.items, original.items);
  assert.equal(batch.rows[0].candidate.accountingReviewedAt, undefined);
  assert.deepEqual(batch.rows[0].errors, []);
  for (const field of [
    'sourceId',
    'number',
    'date',
    'customer',
    'customerId',
    'subtotal',
    'discount',
    'tax',
    'total',
    'totalPaid',
    'outstanding',
    'payments',
    'packageParents',
    'benefits',
  ])
    assert.deepEqual(batch.rows[0].candidate[field], original[field], field);
  assert.equal((await db.select().from(invoices)).length, invoiceCount);
  assert.equal((await db.select().from(jobs)).length, jobCount);
  assert.equal((await request(endpoint, 'finance', 'DELETE', { version })).status, 409);
  assert.equal(
    (await request(endpoint, 'finance', 'DELETE', { version: batch.version })).status,
    404,
  );
  const logs = await db.select().from(auditLogs).where(eq(auditLogs.action, 'import.item.delete'));
  const event = logs.find((e) => e.entityId === batch.id)!.details as any;
  assert.deepEqual(event.item, item);
  assert.equal(event.previousReviewedAt, stamp);
  assert.equal(event.sourceTotals.total, 200000);
  assert.deepEqual(
    Buffer.from(
      await (
        await request(`/imports/${batch.id}/files/${batch.files[0].id}`, 'finance')
      ).arrayBuffer(),
    ),
    data,
  );
  const submitted = await request(`/imports/${batch.id}/submit`, 'finance', 'POST', {
    version: batch.version,
    rowIds: [row.id],
    accountingReviewed: true,
  });
  assert.equal(submitted.status, 200, await submitted.clone().text());
  batch = await submitted.json();
  assert.equal(
    (
      await request(
        `/imports/${batch.id}/rows/${row.id}/items/${encodeURIComponent(original.items[0].id)}`,
        'finance',
        'DELETE',
        { version: batch.version },
      )
    ).status,
    409,
  );
});

test('source items including the last line may be removed from a draft but source totals still block submit', async () => {
  const uuid = randomUUID(),
    number = 'DEL-' + uuid.slice(0, 12);
  const data = Buffer.from(
    receiptPdf()
      .toString('latin1')
      .replaceAll('11111111-1111-4111-8111-111111111111', uuid)
      .replaceAll('TEST-RECEIPT-001', number),
    'latin1',
  );
  let batch = await (await uploadFiles([{ name: 'remove-all-items.pdf', data }])).json();
  const row = batch.rows[0];
  for (const item of row.candidate.items) {
    const response = await request(
      `/imports/${batch.id}/rows/${row.id}/items/${encodeURIComponent(item.id)}`,
      'finance',
      'DELETE',
      { version: batch.version },
    );
    assert.equal(response.status, 200);
    batch = await response.json();
  }
  assert.equal(batch.rows[0].candidate.items.length, 0);
  assert.equal(batch.rows[0].candidate.total, 200000);
  assert.equal(batch.rows[0].candidate.tax, 19820);
  assert.ok(batch.rows[0].errors.some((e: string) => e.includes('Detail item')));
  assert.equal(
    (
      await request(`/imports/${batch.id}/submit`, 'finance', 'POST', {
        version: batch.version,
        rowIds: [row.id],
        accountingReviewed: true,
      })
    ).status,
    422,
  );
});

// Run after HTTP/file cleanup hooks, including when an earlier teardown failed.
afterDatabase(async () => {
  try {
    await closeDb();
  } finally {
    await closeTestDatabases();
  }
});
