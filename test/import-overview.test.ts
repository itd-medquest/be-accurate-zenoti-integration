import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

process.env.DATABASE_URL = 'pglite:memory://';
process.env.BETTER_AUTH_SECRET = randomBytes(32).toString('hex');
process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
process.env.RUN_WORKER = 'false';
const { db, closeDb } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrate.js');
const { branches, user, importBatches, importFiles, importRows, invoices, accurateDeliveries } =
  await import('../src/db/schema/index.js');
const { getImportOverview } = await import('../src/services/import-overview.service.js');
const { importOverviewQuerySchema } =
  await import('../src/validations/import-overview.validation.js');
const { emptyCandidate } = await import('../src/utils/import-validation.js');

before(async () => {
  await migrate();
  await db.insert(branches).values(
    ['overview', 'other'].map((id) => ({
      id,
      name: id,
      centerId: id,
      accurateDatabaseId: 'test',
      accurateBranchId: '300',
    })),
  );
  await db.insert(user).values({
    id: 'overview-user',
    name: 'Test',
    email: 'overview@example.test',
    role: 'super_admin',
  });
});
after(closeDb);

async function batch(status = 'SUBMITTED', branchId = 'overview', createdAt = new Date()) {
  const id = randomUUID();
  const fileId = randomUUID();
  await db
    .insert(importBatches)
    .values({ id, branchId, status, uploaderId: 'overview-user', createdAt });
  await db.insert(importFiles).values({
    id: fileId,
    batchId: id,
    name: 'customer-document.pdf',
    storedName: fileId,
    hash: 'test',
    size: 100,
    format: 'PDF',
  });
  return { id, fileId, branchId };
}

test('overview classifies actual delivery, draft, failed, local redemption and processing without counting simulations as sent', async () => {
  const source = await batch();
  for (const [index, state] of [
    'SYNCED',
    'FAILED',
    'PENDING',
    'LOCAL_ONLY',
    'LOCAL_ONLY_CONSULTATION',
    'SYNCED',
    'NEEDS_REVIEW',
    'PROCESSING',
  ].entries()) {
    const id = randomUUID();
    const candidate = {
      ...emptyCandidate('PDF'),
      sourceId: id,
      number: `OVERVIEW-${index}`,
      customer: 'Finance Customer',
    };
    await db.insert(invoices).values({
      id,
      sourceId: id,
      number: candidate.number,
      customer: candidate.customer,
      customerId: 'customer',
      branchId: source.branchId,
      date: new Date(),
      businessStatus: 'CLOSED',
      paymentStatus: 'PAID',
      syncStatus: state,
      total: 100,
      outstanding: 0,
      items: [],
      payments: [],
    });
    await db.insert(importRows).values({
      id: randomUUID(),
      batchId: source.id,
      fileId: source.fileId,
      position: index,
      candidate,
      status: 'QUEUED',
      invoiceId: id,
    });
    if ([0, 1, 2, 6, 7].includes(index))
      await db.insert(accurateDeliveries).values({
        invoiceId: id,
        branchId: source.branchId,
        databaseId: 'test',
        targetBranchId: '300',
        sourceVersion: 1,
        requestedNumber: candidate.number,
        payload: {},
        expectedTotal: 100,
        status: index === 0 ? 'SUCCEEDED' : 'PENDING',
        targetId: index === 0 ? 'target' : null,
        targetNumber: index === 0 ? candidate.number : null,
      });
    if (index === 0) {
      const duplicate = await batch();
      await db.insert(importRows).values({
        id: randomUUID(),
        batchId: duplicate.id,
        fileId: duplicate.fileId,
        position: 1,
        candidate,
        status: 'DUPLICATE',
        invoiceId: id,
        duplicateInvoiceId: id,
      });
    }
  }
  const draft = await batch('PREVIEW');
  await db.insert(importRows).values({
    id: randomUUID(),
    batchId: draft.id,
    fileId: draft.fileId,
    position: 1,
    candidate: { ...emptyCandidate('PDF'), sourceId: 'draft', number: 'DRAFT-%_literal' },
    status: 'REVIEW',
  });
  await db.insert(importRows).values({
    id: randomUUID(),
    batchId: draft.id,
    fileId: draft.fileId,
    position: 2,
    candidate: emptyCandidate('PDF'),
    status: 'DELETED',
  });
  const deleted = await batch('DELETED');
  await db.insert(importRows).values({
    id: randomUUID(),
    batchId: deleted.id,
    fileId: deleted.fileId,
    position: 1,
    candidate: emptyCandidate('PDF'),
    status: 'REVIEW',
  });
  const result = await getImportOverview(importOverviewQuerySchema.parse({}));
  assert.deepEqual(result.summary, { sent: 1, draft: 1, failed: 2, redeem: 1, processing: 2 });
  assert.equal(result.total, 3);
  assert.equal(result.items.find((entry) => entry.id === source.id)?.invoiceCount, 8);
  assert.equal(result.items.find((entry) => entry.id === source.id)?.counts.simulation, 1);
  assert.equal(result.items.find((entry) => entry.id === source.id)?.counts.local, 1);
  assert.equal(result.items.find((entry) => entry.id === draft.id)?.invoiceCount, 1);
});

test('overview filters full data before pagination and escapes literal search characters', async () => {
  const result = await getImportOverview(
    importOverviewQuerySchema.parse({ status: 'draft', search: '%_literal', pageSize: 1 }),
  );
  assert.equal(result.total, 1);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0].references, ['DRAFT-%_literal']);
  const customer = await getImportOverview(
    importOverviewQuerySchema.parse({ search: 'Finance Customer', status: 'processing' }),
  );
  assert.equal(customer.total, 1);
  assert.equal(customer.summary.sent, 1);
  const filename = await getImportOverview(
    importOverviewQuerySchema.parse({ search: 'customer-document.pdf' }),
  );
  assert.equal(filename.total, 3);
  const second = await getImportOverview(importOverviewQuerySchema.parse({ page: 2, pageSize: 2 }));
  assert.equal(second.total, 3);
  assert.equal(second.items.length, 1);
  const empty = await getImportOverview(importOverviewQuerySchema.parse({ search: 'missing' }));
  assert.equal(empty.total, 0);
  assert.equal(empty.items.length, 0);
  assert.equal(empty.summary.draft, 0);
});

test('company and upload period filters exclude unrelated or old batches', async () => {
  const old = await batch('PREVIEW', 'other', new Date('2000-01-01T00:00:00Z'));
  await db.insert(importRows).values({
    id: randomUUID(),
    batchId: old.id,
    fileId: old.fileId,
    position: 1,
    candidate: emptyCandidate('PDF'),
    status: 'REVIEW',
  });
  assert.equal(
    (await getImportOverview(importOverviewQuerySchema.parse({ branch: 'other' }))).total,
    1,
  );
  assert.equal(
    (await getImportOverview(importOverviewQuerySchema.parse({ branch: 'other', days: 30 }))).total,
    0,
  );
  assert.equal(
    (await getImportOverview(importOverviewQuerySchema.parse({ branch: 'overview' }))).total,
    3,
  );
  for (const invalid of [
    { status: 'SYNCED' },
    { page: 0 },
    { pageSize: 1000 },
    { search: 'x'.repeat(101) },
    { days: -1 },
  ])
    assert.equal(importOverviewQuerySchema.safeParse(invalid).success, false);
});

test('calendar dates include complete WIB days and reject invalid or reversed ranges', async () => {
  const expected: string[] = [];
  for (const [index, timestamp] of [
    '2026-10-01T16:59:59.999Z',
    '2026-10-01T17:00:00.000Z',
    '2026-10-03T16:59:59.999Z',
    '2026-10-03T17:00:00.000Z',
  ].entries()) {
    const entry = await batch('PREVIEW', 'other', new Date(timestamp));
    await db.insert(importRows).values({
      id: randomUUID(),
      batchId: entry.id,
      fileId: entry.fileId,
      position: 1,
      candidate: { ...emptyCandidate('PDF'), number: 'CALENDAR-BOUNDARY' },
      status: 'REVIEW',
    });
    if (index === 1 || index === 2) expected.push(entry.id);
  }
  const result = await getImportOverview(
    importOverviewQuerySchema.parse({
      search: 'CALENDAR-BOUNDARY',
      dateFrom: '2026-10-02',
      dateTo: '2026-10-03',
      days: 1,
    }),
  );
  assert.deepEqual(result.items.map((entry) => entry.id).sort(), expected.sort());
  assert.equal(result.summary.draft, 2);
  const oneDay = await getImportOverview(
    importOverviewQuerySchema.parse({
      search: 'CALENDAR-BOUNDARY',
      dateFrom: '2026-10-02',
      dateTo: '2026-10-02',
    }),
  );
  assert.equal(oneDay.total, 1);
  for (const invalid of [
    { dateFrom: '2026-02-29' },
    { dateTo: '2026-04-31' },
    { dateFrom: '02/10/2026' },
    { dateFrom: '2026-10-03', dateTo: '2026-10-02' },
  ])
    assert.equal(importOverviewQuerySchema.safeParse(invalid).success, false);
  assert.equal(importOverviewQuerySchema.safeParse({ dateFrom: '2024-02-29' }).success, true);
});
