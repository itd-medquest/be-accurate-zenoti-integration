import { after as afterDatabase } from 'node:test';
import { createTestDatabase, closeTestDatabases } from './helpers/mysql-database.js';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PGlite } from '@electric-sql/pglite';
import { hashPassword, verifyPassword } from 'better-auth/crypto';

Object.assign(process.env, {
  DATABASE_URL: await createTestDatabase(),
  RUN_WORKER: 'false',
  BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
  ENCRYPTION_KEY: randomBytes(32).toString('hex'),
});
const { db, closeDb } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrate.js');
const schema = await import('../src/db/schema/index.js');
const { importLoginUsers } = await import('../src/services/user-transfer.service.js');
const { exportUsers } = await import('../src/db/export-users.js');
const { importUsers } = await import('../src/db/import-users.js');
const { bootstrapCompany } = await import('../src/services/company-bootstrap.service.js');
const password = randomBytes(24).toString('hex'),
  instant = new Date('2026-01-01T00:00:00.123Z');
const userId = randomUUID(),
  hash = await hashPassword(password);
const transfer = {
  users: [
    {
      id: userId,
      name: 'Admin Migrasi',
      email: 'migration@example.test',
      emailVerified: true,
      image: null,
      role: 'super_admin',
      active: true,
      createdAt: instant,
      updatedAt: instant,
    },
  ],
  accounts: [
    {
      id: randomUUID(),
      userId,
      accountId: userId,
      providerId: 'credential',
      password: hash,
      createdAt: instant,
      updatedAt: instant,
    },
  ],
};
before(async () => {
  await migrate();
});
beforeEach(async () => {
  await db.delete(schema.branches);
  await db.delete(schema.user);
  await db.delete(schema.auditLogs);
});
after(closeDb);

test('encrypted PGlite export and MySQL import preserve login identity, hash and UTC timestamps only', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'intgrte-login-transfer-'));
  const path = join(folder, 'legacy'),
    file = join(folder, 'users.encrypted.json');
  const legacy = new PGlite(path);
  await legacy.exec(`CREATE TABLE users (id text, name text, email text, email_verified boolean, image text,
    role text, active boolean, created_at timestamptz, updated_at timestamptz);
    CREATE TABLE accounts (id text, account_id text, provider_id text, user_id text, password text, created_at timestamptz, updated_at timestamptz);`);
  const account = transfer.accounts[0],
    user = transfer.users[0];
  await legacy.query('INSERT INTO users VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', Object.values(user));
  await legacy.query('INSERT INTO accounts VALUES ($1,$2,$3,$4,$5,$6,$7)', [
    account.id,
    account.accountId,
    account.providerId,
    account.userId,
    hash,
    instant,
    instant,
  ]);
  await legacy.close();
  assert.deepEqual(await exportUsers('pglite:' + path, file), { users: 1, accounts: 1 });
  const encrypted = await readFile(file, 'utf8');
  assert.ok(!encrypted.includes(hash) && !encrypted.includes(user.email));
  await importUsers(file);
  assert.deepEqual((await db.select().from(schema.user))[0], user);
  const [saved] = await db.select().from(schema.account);
  assert.equal(saved.password, hash);
  assert.equal(await verifyPassword({ password, hash: saved.password! }), true);
  assert.equal(saved.accessToken, null);
  for (const table of [
    schema.invoices,
    schema.importBatches,
    schema.jobs,
    schema.accurateReceipts,
    schema.integrationConfigs,
    schema.branches,
    schema.session,
    schema.verification,
  ])
    assert.equal((await db.select().from(table)).length, 0);
  const { auth } = await import('../src/config/auth.js');
  const response = await auth.api.signInEmail({
    body: { email: user.email, password },
    asResponse: true,
  });
  assert.equal(response.status, 200);
});

test('repeated, malformed or elevated imports cannot overwrite existing accounts or add unrelated data', async () => {
  await importLoginUsers(transfer);
  await assert.rejects(importLoginUsers(transfer), /tujuan baru dan kosong/);
  await assert.rejects(importLoginUsers({ ...transfer, invoices: [] }));
  await assert.rejects(
    importLoginUsers({
      ...transfer,
      accounts: [{ ...transfer.accounts[0], userId: randomUUID() }],
    }),
  );
  assert.equal((await db.select().from(schema.user)).length, 1);
  assert.equal((await db.select().from(schema.account))[0].password, hash);
});

test('migration preserves inactive users and roles, and refuses an export with no usable super admin', async () => {
  await assert.rejects(
    importLoginUsers({ ...transfer, users: [{ ...transfer.users[0], active: false }] }),
  );
  const inactive = {
    ...transfer.users[0],
    id: randomUUID(),
    email: 'inactive@example.test',
    role: 'finance',
    active: false,
  };
  await importLoginUsers({ ...transfer, users: [...transfer.users, inactive] });
  assert.deepEqual(
    (await db.select().from(schema.user)).find((user) => user.id === inactive.id),
    inactive,
  );
});

test('optional company setup creates no transactions, preserves existing destinations and supports API identifier bounds', async () => {
  const company = { id: 'b'.repeat(100), name: 'Perusahaan Baru', centerId: 'new-center' };
  assert.deepEqual(await bootstrapCompany(company), { created: true });
  assert.deepEqual(await bootstrapCompany({ ...company, name: 'Unrequested replacement' }), {
    created: false,
  });
  const [saved] = await db.select().from(schema.branches);
  assert.equal(saved.name, company.name);
  assert.equal(saved.accurateDatabaseId, 'unconfigured');
  await assert.rejects(bootstrapCompany({ ...company, centerId: 'different' }));
  assert.equal((await db.select().from(schema.invoices)).length, 0);
});

// Run after HTTP/file cleanup hooks, including when an earlier teardown failed.
afterDatabase(async () => {
  try {
    await closeDb();
  } finally {
    await closeTestDatabases();
  }
});
