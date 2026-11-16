import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sql, eq } from 'drizzle-orm';
import { verifyPassword } from 'better-auth/crypto';

Object.assign(process.env, {
  DATABASE_URL: 'pglite:memory://',
  NODE_ENV: 'test',
  RUN_WORKER: 'false',
  BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
  ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  FRONTEND_URL: 'http://localhost:3000',
  BETTER_AUTH_URL: 'http://localhost:4000',
});
const { db, closeDb } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrate.js');
const { bootstrapAdmin } = await import('../src/services/bootstrap-admin.service.js');
const { user, account, auditLogs } = await import('../src/db/schema/index.js');
const input = {
  name: 'Initial Administrator',
  email: 'bootstrap@example.test',
  password: randomBytes(24).toString('hex'),
};

before(async () => { await migrate(); });
after(closeDb);
beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE users CASCADE`);
  await db.delete(auditLogs);
});

async function assertOnlyBootstrapRows() {
  const tables = await db.execute<{ table_name: string }>(
    sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  );
  for (const { table_name: table } of tables.rows) {
    const result = await db.execute<{ total: string }>(
      sql`SELECT count(*) AS total FROM ${sql.identifier(table)}`,
    );
    assert.equal(Number(result.rows[0]?.total), ['users', 'accounts', 'audit_logs'].includes(table) ? 1 : 0, table);
  }
}

test('committed migrations create an empty application schema and can be rerun', async () => {
  await migrate();
  const tables = await db.execute<{ table_name: string }>(
    sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  );
  assert.ok(tables.rows.length > 10);
  for (const { table_name: table } of tables.rows) {
    const result = await db.execute<{ total: string }>(
      sql`SELECT count(*) AS total FROM ${sql.identifier(table)}`,
    );
    assert.equal(Number(result.rows[0]?.total), 0, table);
  }
});

test('bootstrap creates one normalized active admin with a hashed login and no demo data', async () => {
  assert.deepEqual(await bootstrapAdmin({ ...input, name: ` ${input.name} `, email: ` ${input.email.toUpperCase()} ` }), { created: true });
  const [created] = await db.select().from(user);
  const [credential] = await db.select().from(account);
  assert.equal(created?.role, 'super_admin');
  assert.equal(created?.active, true);
  assert.equal(created?.name, input.name);
  assert.equal(created?.email, input.email);
  assert.equal(credential?.providerId, 'credential');
  assert.equal(credential?.userId, created.id);
  assert.equal(credential?.accountId, created.id);
  assert.ok(credential.password && credential.password !== input.password);
  assert.equal(await verifyPassword({ password: input.password, hash: credential.password }), true);
  const [audit] = await db.select().from(auditLogs);
  assert.equal(audit?.action, 'user.bootstrap');
  assert.equal(audit?.actorId, created.id);
  assert.ok(!JSON.stringify(audit).includes(input.password));
  await assertOnlyBootstrapRows();
});

test('rerunning bootstrap never changes the existing password, name or audit history', async () => {
  await bootstrapAdmin(input);
  const before = await db.select().from(account);
  assert.deepEqual(await bootstrapAdmin({ ...input, name: 'Another Name', password: randomBytes(24).toString('hex') }), { created: false });
  assert.deepEqual(await db.select().from(account), before);
  assert.equal((await db.select().from(user))[0]?.name, input.name);
  await assertOnlyBootstrapRows();
});

test('bootstrap refuses existing non-admin, inactive and credential-less accounts without promotion', async () => {
  for (const target of [
    { role: 'finance', active: true },
    { role: 'super_admin', active: false },
    { role: 'super_admin', active: true },
  ]) {
    await db.delete(user);
    await db.insert(user).values({ id: randomUUID(), name: input.name, email: input.email, ...target });
    const original = await db.select().from(user);
    await assert.rejects(bootstrapAdmin(input), /Email sudah terdaftar/);
    assert.deepEqual(await db.select().from(user), original);
    assert.equal((await db.select().from(account)).length, 0);
    assert.equal((await db.select().from(auditLogs)).length, 0);
  }
});

test('bootstrap refuses a second admin with a different email', async () => {
  await bootstrapAdmin(input);
  await assert.rejects(bootstrapAdmin({ ...input, email: 'second@example.test' }), /tanpa pengguna/);
  await assertOnlyBootstrapRows();
});

test('invalid credentials and unexpected fields fail without changing the database', async () => {
  for (const invalid of [
    { ...input, email: 'invalid' },
    { ...input, password: 'too-short' },
    { ...input, password: 'x'.repeat(129) },
    { ...input, name: ' ' },
    { ...input, role: 'finance' },
  ]) {
    await assert.rejects(bootstrapAdmin(invalid), /email valid/);
  }
  assert.equal((await db.select().from(user)).length, 0);
  assert.equal((await db.select().from(account)).length, 0);
});

test('failed credential insertion rolls back user creation and audit', async () => {
  await db.execute(sql`CREATE FUNCTION reject_bootstrap_account() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test credential failure'; END $$`);
  await db.execute(sql`CREATE TRIGGER reject_bootstrap_account BEFORE INSERT ON accounts FOR EACH ROW EXECUTE FUNCTION reject_bootstrap_account()`);
  try {
    await assert.rejects(bootstrapAdmin(input));
    assert.equal((await db.select().from(user)).length, 0);
    assert.equal((await db.select().from(account)).length, 0);
    assert.equal((await db.select().from(auditLogs)).length, 0);
  } finally {
    await db.execute(sql`DROP TRIGGER reject_bootstrap_account ON accounts`);
    await db.execute(sql`DROP FUNCTION reject_bootstrap_account()`);
  }
});

test('bootstrapped credentials work with the existing Better Auth login', async () => {
  await bootstrapAdmin(input);
  const { auth } = await import('../src/config/auth.js');
  const response = await auth.api.signInEmail({ body: { email: input.email, password: input.password }, asResponse: true });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.user.role, 'super_admin');
  assert.equal(body.user.email, input.email);
  assert.equal((await db.select().from(user).where(eq(user.email, input.email))).length, 1);
});

test('CLI returns a failing exit status after database shutdown without leaking input', () => {
  const invalidPassword = randomBytes(4).toString('hex');
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', fileURLToPath(new URL('../src/db/seed-admin.ts', import.meta.url))],
    {
      env: {
        ...process.env,
        DATABASE_URL: 'pglite:memory://',
        SEED_ADMIN_EMAIL: input.email,
        SEED_ADMIN_PASSWORD: invalidPassword,
      },
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Seed admin gagal/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(invalidPassword));
});
