import { after as afterDatabase } from 'node:test';
import { createTestDatabase, closeTestDatabases } from './helpers/mysql-database.js';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { validateMigrationFiles } from '../src/db/migration-files.js';

Object.assign(process.env, {
  DATABASE_URL: await createTestDatabase(),
  NODE_ENV: 'test',
  RUN_WORKER: 'false',
  BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
  ENCRYPTION_KEY: randomBytes(32).toString('hex'),
});
const { db, closeDb } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrate.js');
const { user } = await import('../src/db/schema/index.js');
after(closeDb);
const source = fileURLToPath(new URL('../src/db/migrations/mysql', import.meta.url));

test('damaged SQL is rejected with its filename before migration; repairing it preserves existing records', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'intgrte-migration-integrity-'));
  cpSync(source, folder, { recursive: true });
  const journalPath = join(folder, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));

  await migrate(folder);
  const id = randomUUID();
  await db.insert(user).values({ id, name: 'Preserved user', email: 'preserved@example.test' });
  const file = join(folder, '0001_integrity_probe.sql'),
    correct = Buffer.from('ALTER TABLE accurate_receipts ADD COLUMN verification_probe int;');
  journal.entries.push({
    idx: journal.entries.length,
    version: '5',
    when: journal.entries.at(-1).when + 1,
    tag: '0001_integrity_probe',
    breakpoints: true,
  });
  writeFileSync(journalPath, JSON.stringify(journal));
  writeFileSync(file, Buffer.alloc(64));
  await assert.rejects(migrate(folder), /0001_integrity_probe\.sql mengandung byte NUL/);
  assert.equal((await db.select().from(user).where(eq(user.id, id)))[0].name, 'Preserved user');
  const [before] = await db.execute(
    sql`select column_name from information_schema.columns where table_schema = DATABASE() and table_name = 'accurate_receipts' and column_name = 'verification_probe'`,
  );
  assert.equal(before.length, 0);
  writeFileSync(file, correct, { flush: true });
  await migrate(folder);
  await migrate(folder);
  assert.equal((await db.select().from(user).where(eq(user.id, id)))[0].name, 'Preserved user');
  const [after] = await db.execute(
    sql`select column_name from information_schema.columns where table_schema = DATABASE() and table_name = 'accurate_receipts' and column_name = 'verification_probe'`,
  );
  assert.equal(after.length, 1);
});

test('blank and malformed UTF-8 migrations fail clearly; current source files pass integrity checks', () => {
  validateMigrationFiles(source);
  const folder = mkdtempSync(join(tmpdir(), 'intgrte-migration-bytes-')),
    file = join(folder, 'test.sql');
  writeFileSync(file, ' \n');
  assert.throws(() => validateMigrationFiles(folder), /test.sql kosong/);
  writeFileSync(file, Buffer.from([0xc3, 0x28]));
  assert.throws(() => validateMigrationFiles(folder), /test.sql bukan UTF-8/);
});

// Run after HTTP/file cleanup hooks, including when an earlier teardown failed.
afterDatabase(async () => {
  try {
    await closeDb();
  } finally {
    await closeTestDatabases();
  }
});
