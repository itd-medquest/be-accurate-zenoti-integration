import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
process.env.DATABASE_URL = 'pglite:memory://';
process.env.BETTER_AUTH_SECRET = randomBytes(32).toString('hex');
const { db, closeDb } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrate.js');
const { branches } = await import('../src/db/schema/index.js');
const { sql, eq } = await import('drizzle-orm');
test('company rename preserves destination identities and custom names', async () => {
  try {
    await migrate();
    await db
      .insert(branches)
      .values({
        id: 'branch-jakarta',
        name: 'Jakarta · Cabang Utama',
        centerId: 'original-center',
        accurateDatabaseId: 'original-db',
        accurateBranchId: 'original-target',
      });
    const migration = await readFile(
      new URL('../src/db/migrations/0004_company_destination_name.sql', import.meta.url),
      'utf8',
    );
    await db.execute(sql.raw(migration));
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
    await db.execute(sql.raw(migration));
    assert.equal((await db.query.branches.findFirst())?.name, 'Custom Company');
  } finally {
    await closeDb();
  }
});
