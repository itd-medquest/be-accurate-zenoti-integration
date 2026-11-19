import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createTestDatabase, closeTestDatabases } from './helpers/mysql-database.js';

process.env.DATABASE_URL = await createTestDatabase();
process.env.BETTER_AUTH_SECRET = randomBytes(32).toString('hex');
process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
process.env.RUN_WORKER = 'false';
const { db, closeDb } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrate.js');
const { auditLogs } = await import('../src/db/schema/index.js');
const { listAuditPage } = await import('../src/services/audit.service.js');
const { listRecent } = await import('../src/repositories/audit-logs.repository.js');
const { auditPageQuerySchema } = await import('../src/validations/audit.validation.js');

before(async () => {
  await migrate();
});
after(async () => {
  await closeDb();
  await closeTestDatabases();
});

test('an empty audit history returns a valid first page', async () => {
  assert.deepEqual(await listAuditPage({ page: 99, pageSize: 25 }), {
    items: [],
    total: 0,
    page: 1,
    pageSize: 25,
  });
});

test('audit pagination reaches records beyond 100 with stable ordering for equal timestamps', async () => {
  await db.insert(auditLogs).values(
    Array.from({ length: 103 }, (_, index) => ({
      id: `audit-${String(index).padStart(3, '0')}`,
      action: 'pagination.fixture',
      createdAt: new Date('2026-11-19T00:00:00Z'),
    })),
  );
  const ids: string[] = [];
  for (let page = 1; page <= 5; page++) {
    const result = await listAuditPage({ page, pageSize: 25 });
    assert.equal(result.total, 103);
    assert.equal(result.page, page);
    assert.equal(result.items.length, page === 5 ? 3 : 25);
    ids.push(...result.items.map((item) => item.id));
  }
  assert.equal(new Set(ids).size, 103);
  assert.equal(ids[0], 'audit-102');
  assert.equal(ids.at(-1), 'audit-000');
  const last = await listAuditPage({ page: 999, pageSize: 10 });
  assert.equal(last.page, 11);
  assert.equal(last.items.length, 3);
  assert.equal((await listRecent()).length, 100);
});

test('audit paging validates limits and rejects malformed parameters', () => {
  assert.deepEqual(auditPageQuerySchema.parse({}), { page: 1, pageSize: 25 });
  assert.deepEqual(auditPageQuerySchema.parse({ page: '2', pageSize: '50' }), {
    page: 2,
    pageSize: 50,
  });
  for (const input of [
    { page: 0 },
    { page: -1 },
    { page: 1.5 },
    { page: 'bad' },
    { page: 1_000_001 },
    { pageSize: 0 },
    { pageSize: 101 },
    { pageSize: ['10', '25'] },
  ]) {
    assert.equal(auditPageQuerySchema.safeParse(input).success, false);
  }
});
