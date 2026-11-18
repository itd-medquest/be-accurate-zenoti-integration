import { after as afterDatabase } from 'node:test';
import { createTestDatabase, closeTestDatabases } from './helpers/mysql-database.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
process.env.DATABASE_URL = await createTestDatabase();
process.env.BETTER_AUTH_SECRET = randomBytes(32).toString('hex');
const { db, closeDb } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrate.js');
const { branches } = await import('../src/db/schema/index.js');
const { sql, eq } = await import('drizzle-orm');
test('company rename preserves destination identities and custom names', async () => {
  try {
    await migrate();
    await db.insert(branches).values({
      id: 'branch-jakarta',
      name: 'PT. MMI',
      centerId: 'original-center',
      accurateDatabaseId: 'original-db',
      accurateBranchId: 'original-target',
    });
    await migrate();
    const row = await db.query.branches.findFirst();
    assert.ok(row);
    assert.equal(row?.name, 'PT. MMI');
    assert.equal(row.centerId, 'original-center');
    assert.equal(row.accurateDatabaseId, 'original-db');
    assert.equal(row.accurateBranchId, 'original-target');
    await db
      .update(branches)
      .set({ name: 'Custom Company' })
      .where(eq(branches.id, 'branch-jakarta'));
    await migrate();
    assert.equal((await db.query.branches.findFirst())?.name, 'Custom Company');
  } finally {
    await closeDb();
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
