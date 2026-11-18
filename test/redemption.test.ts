import { after as afterDatabase } from 'node:test';
import { createTestDatabase, closeTestDatabases } from './helpers/mysql-database.js';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { redemptionPages } from './helpers/redemption-fixture.js';
import { parsePdfPages } from '../src/utils/parsers/pdf.js';
import { candidateErrors, candidateHash } from '../src/utils/import-validation.js';
import { buildAccuratePayload, liveInvoiceErrors } from '../src/utils/accurate-payload.js';
import {
  chargeableItems,
  isFullRedemption,
  isFreeConsultation,
  isLocalOnlyInvoice,
} from '../src/utils/redemption.js';
import type { ImportCandidate } from '../src/types/import.types.js';

Object.assign(process.env, {
  DATABASE_URL: await createTestDatabase(),
  RUN_WORKER: 'false',
  BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
  ENCRYPTION_KEY: randomBytes(32).toString('hex'),
});
const { db, closeDb } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrate.js');
const schema = await import('../src/db/schema/index.js');
const { submitImport, getImport, reviewErrors } = await import('../src/services/import.service.js');
const { enqueue, validateInvoice } = await import('../src/services/sync.service.js');
const { encrypt } = await import('../src/utils/encryption.js');
const { eq } = await import('drizzle-orm');
before(async () => {
  await migrate();
  await db.insert(schema.branches).values({
    id: 'redeem-branch',
    name: 'Test',
    centerId: 'Test',
    accurateDatabaseId: 'test',
    accurateBranchId: 'test',
  });
  await db
    .insert(schema.user)
    .values({ id: 'finance', name: 'Finance', email: 'redeem@example.test', role: 'finance' });
  // Deliberately disabled, with no credentials or destination: local save must still work.
  await db.insert(schema.integrationConfigs).values({ id: 'accurate', enabled: false });
});
after(closeDb);
const candidate = (full: boolean, number?: string) => {
  const [c] = parsePdfPages(redemptionPages(full, number));
  c.businessStatus = 'CLOSED';
  c.accountingReviewedAt = new Date().toISOString();
  return c;
};
async function batchFixture(candidates: ImportCandidate[]) {
  const batchId = randomUUID(),
    fileId = randomUUID();
  await db
    .insert(schema.importBatches)
    .values({ id: batchId, branchId: 'redeem-branch', uploaderId: 'finance' });
  await db.insert(schema.importFiles).values({
    id: fileId,
    batchId,
    name: 'test.pdf',
    storedName: randomUUID(),
    hash: 'test',
    size: 1,
    format: 'PDF',
  });
  const ids = candidates.map(() => randomUUID());
  await db
    .insert(schema.importRows)
    .values(
      candidates.map((c, i) => ({ id: ids[i], batchId, fileId, position: i + 1, candidate: c })),
    );
  return { batchId, ids };
}
test('native and OCR-token layouts distinguish usage tables and preserve free non-redeem lines', () => {
  for (const ocr of [false, true])
    for (const full of [false, true]) {
      const pages = redemptionPages(full);
      if (ocr)
        Object.assign(pages[0], {
          extraction: 'ocr',
          confidence: 90,
          benefitTableDetected: true,
          benefitTableComplete: false,
        });
      const [c] = parsePdfPages(pages);
      assert.deepEqual(candidateErrors(c), []);
      assert.equal(c.packageParents, undefined);
      assert.equal(c.benefits.length, 0);
      assert.equal(isFullRedemption(c), full);
      assert.equal(
        c.items.some((item) => /Custom Package/.test(item.name)),
        false,
      );
      if (!full) {
        assert.equal(chargeableItems(c.items).length, 1);
        assert.equal(c.items[0].unitPrice, 0);
        assert.equal(c.items[0].redeemed, undefined);
        assert.deepEqual(
          c.items.map((item) => item.discount),
          [0, 765766, 0],
        );
        assert.deepEqual(
          c.items.map((item) => item.tax),
          [0, 14865, 0],
        );
      }
    }
});
test('wrapped redemption notes attach to the previous item, without absorbing the following service', () => {
  const pages = redemptionPages(true);
  pages[0].tokens.find((t) => t.y === 565)!.text = 'Custom Package-Test-';
  pages[0].tokens.push({ x: 45, y: 558, text: 'Redeemed' });
  const [c] = parsePdfPages(pages);
  assert.deepEqual(candidateErrors(c), []);
  assert.equal(c.items.filter((i) => i.redeemed).length, 3);
});
test('zero totals without markers and ambiguous annotations never become full redeem', () => {
  const pages = redemptionPages(true);
  pages[0].tokens = pages[0].tokens.filter((t) => !t.text.endsWith('Redeemed'));
  const [c] = parsePdfPages(pages);
  assert.equal(isFullRedemption(c), false);
  assert.ok(candidateErrors(c).length);
  pages[0].tokens.push({ x: 45, y: 590, text: 'Custom Package-Test- Redeemed' });
  assert.ok(parsePdfPages(pages)[0].errors.some((e) => e.includes('Redeemed')));
});
test('mixed invoice excludes Consultation and redeem, while other free services remain in the payload', () => {
  const c = candidate(false);
  c.items.push({ ...c.items[0], id: 'other-free', name: 'Free Facial' });
  c.accurateSelection = {
    databaseId: '999',
    targetBranchId: '300',
    customer: { id: '10', code: 'CUSTOMER', name: 'Test' },
    items: Object.fromEntries(
      chargeableItems(c.items).map((item, i) => [
        item.id,
        { id: String(i), code: `ITEM-${i}`, name: item.name, unitName: 'Jasa' },
      ]),
    ),
  };
  const payload = buildAccuratePayload(c, { databaseId: '999', targetBranchId: '300' });
  assert.equal(payload['detailItem[0].unitPrice'], '150000');
  assert.equal(payload['detailItem[1].unitPrice'], '0');
  assert.equal(payload['detailItem[2].itemNo'], undefined);
  assert.equal(payload.taxable, 'false');
  assert.equal(payload.description.includes('Cauter'), false);
  assert.equal(payload.description.includes('Consultation'), false);
  const changed = structuredClone(c);
  delete changed.items[2].redeemed;
  assert.notEqual(candidateHash(c), candidateHash(changed));
  assert.ok(candidateErrors(changed).length);
  c.items[2].tax = 1;
  assert.ok(candidateErrors(c).some((error) => error.includes('Item redeem')));
});

test('Consultation name matching tolerates case and whitespace; unexpected amounts are blocked without rewriting source', () => {
  const c = candidate(false);
  c.items[0].name = '  CONSULTATION  ';
  assert.equal(isFreeConsultation(c.items[0]), true);
  assert.equal(chargeableItems(c.items).length, 1);
  c.items[0].unitPrice = 100;
  assert.ok(candidateErrors(c).some((error) => error.includes('Consultation harus')));
  assert.equal(c.items[0].unitPrice, 100);
  assert.equal(
    isFreeConsultation({ ...c.items[0], name: 'Consultation Product', unitPrice: 0 }),
    false,
  );
});

test('Consultation-only and redeem plus Consultation invoices save locally without empty payloads or retry jobs', async () => {
  for (const withRedeem of [false, true]) {
    const c = candidate(false, `CONSULTATION-ONLY-${withRedeem}`);
    c.items = withRedeem ? [c.items[0], c.items[2]] : [c.items[0]];
    c.subtotal = c.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    c.discount = c.tax = c.total = c.totalPaid = c.outstanding = 0;
    c.payments = [];
    assert.deepEqual(candidateErrors(c), []);
    assert.equal(isLocalOnlyInvoice(c), true);
    assert.equal(isFullRedemption(c), withRedeem);
    assert.throws(
      () => buildAccuratePayload(c, { databaseId: 'test', targetBranchId: 'test' }),
      /tidak dikirim/,
    );
    const fixture = await batchFixture([c]);
    const result = await submitImport(fixture.batchId, 1, fixture.ids, 'finance');
    assert.equal(result.rows[0].syncStatus, withRedeem ? 'LOCAL_ONLY' : 'LOCAL_ONLY_CONSULTATION');
    assert.equal(result.rows[0].delivery, null);
    assert.equal(result.mode, 'local');
    await assert.rejects(enqueue(result.rows[0].invoiceId!, 'finance'), /tidak dapat dikirim/);
  }
  assert.equal((await db.select().from(schema.jobs)).length, 0);
});
test('full redeem requires review, rejects Accurate payload, saves locally with no jobs and cannot retry or promote', async () => {
  const c = candidate(true);
  assert.deepEqual(liveInvoiceErrors(c), []);
  assert.ok(reviewErrors({ ...c, accountingReviewedAt: undefined }).length);
  assert.throws(
    () => buildAccuratePayload(c, { databaseId: '999', targetBranchId: '300' }),
    /full redeem/,
  );
  const { batchId, ids } = await batchFixture([c]);
  const result = await submitImport(batchId, 1, ids, 'finance');
  assert.equal(result.mode, 'local');
  assert.equal(result.rows[0].syncStatus, 'LOCAL_ONLY');
  assert.equal(result.rows[0].delivery, null);
  assert.equal(result.rows[0].status, 'SAVED');
  assert.equal((await db.select().from(schema.jobs)).length, 0);
  assert.equal((await db.select().from(schema.accurateDeliveries)).length, 0);
  assert.equal((await db.select().from(schema.simulatedDrafts)).length, 0);
  const stored = await db.query.invoices.findFirst({
    where: eq(schema.invoices.id, result.rows[0].invoiceId!),
  });
  assert.ok(stored);
  assert.equal(stored.items.filter((i) => i.redeemed).length, 3);
  await assert.rejects(enqueue(stored.id, 'finance'), /full redeem/);
  assert.throws(() => validateInvoice(stored), /full redeem/);
  await db
    .update(schema.integrationConfigs)
    .set({
      encryptedSecret: encrypt(
        JSON.stringify({
          version: 1,
          apiToken: 'test',
          signatureSecret: 'test',
          mode: 'live',
          taxPolicy: 'gross-no-tax',
        }),
      ),
    })
    .where(eq(schema.integrationConfigs.id, 'accurate'));
  const duplicate = await batchFixture([c]);
  assert.equal((await getImport(duplicate.batchId)).rows[0].status, 'DUPLICATE');
  await submitImport(duplicate.batchId, 1, duplicate.ids, 'finance');
  assert.equal(
    (await db.select().from(schema.invoices)).filter((invoice) => invoice.sourceId === c.sourceId)
      .length,
    1,
  );
  assert.equal((await db.select().from(schema.jobs)).length, 0);
  assert.equal(
    (await db.select().from(schema.auditLogs)).filter(
      (log) => log.action === 'import.full_redemption.save' && log.entityId === stored.id,
    ).length,
    1,
  );
  await submitImport(batchId, result.version, ids, 'finance');
});

// Run after HTTP/file cleanup hooks, including when an earlier teardown failed.
afterDatabase(async () => {
  try {
    await closeDb();
  } finally {
    await closeTestDatabases();
  }
});
