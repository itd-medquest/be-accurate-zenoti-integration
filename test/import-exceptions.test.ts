import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyCandidate, candidateErrors } from '../src/utils/import-validation.js';
import {
  exceptionFingerprint,
  hasCurrentReviewException,
  packageExtractionErrors,
} from '../src/utils/import-exceptions.js';
import { exceptionReview } from '../src/services/import.service.js';
const parserError =
  'Rincian tabel Benefit belum terbaca lengkap. Lengkapi semua layanan sesuai dokumen sumber.';
function candidate() {
  const c = emptyCandidate('PDF');
  Object.assign(c, {
    sourceId: 'source-special',
    number: 'SPECIAL-001',
    sourceInvoiceNumber: 'SPECIAL-001',
    customer: 'Test customer',
    customerId: 'CUST-1',
    date: '2026-11-24',
    businessStatus: 'CLOSED',
    subtotal: 1000,
    tax: 110,
    total: 1110,
    totalPaid: 1110,
    outstanding: 0,
    errors: [parserError],
  });
  const parent = {
    id: 'parent',
    name: 'Trial source package',
    kind: 'service' as const,
    quantity: 1,
    unitPrice: 1000,
    discount: 0,
    tax: 110,
    mapped: true,
  };
  c.packageParents = [parent];
  c.items = [{ ...parent, id: 'parent:detail:manual:1', name: 'Verified treatment' }];
  c.payments = [{ id: 'payment-1', method: 'qris', amount: 1110, paidAt: '2026-11-24' }];
  return c;
}
function approve(c: ReturnType<typeof candidate>) {
  c.accountingReviewedAt = '2026-11-24T03:00:00Z';
  c.reviewException = {
    reason: 'All treatment details verified against the original source',
    actorId: 'finance-user',
    reviewedAt: c.accountingReviewedAt,
    fingerprint: exceptionFingerprint(c),
    errors: packageExtractionErrors(c),
  };
  return c;
}
test('only a complete package with exact financials can receive an exception', () => {
  const c = candidate();
  assert.equal(exceptionReview(c).allowed, true);
  c.items = [c.packageParents![0]];
  assert.equal(exceptionReview(c).allowed, false);
  c.items = [{ ...c.packageParents![0], id: 'other-item' }];
  assert.equal(exceptionReview(c).allowed, false);
  c.items = [{ ...c.packageParents![0], id: 'parent:detail:1', tax: 111 }];
  assert.equal(exceptionReview(c).allowed, false);
});
test('acknowledgements are canonical across JSON key ordering and bound to the full reviewed draft', () => {
  const c = approve(candidate());
  assert.equal(hasCurrentReviewException(c), true);
  assert.deepEqual(candidateErrors(c), []);
  const reverse = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(reverse)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([key, entry]) => [key, reverse(entry)]),
          )
        : value;
  assert.equal(
    exceptionFingerprint(c),
    exceptionFingerprint(JSON.parse(JSON.stringify(reverse(c)))),
  );
  c.items[0].name += ' changed';
  assert.equal(hasCurrentReviewException(c), false);
  assert.ok(candidateErrors(c).includes(parserError));
});
test('a note never suppresses identity, financial or arbitrary source exceptions', () => {
  const c = candidate();
  c.errors.push('Invoice ID duplikat.');
  approve(c);
  assert.deepEqual(candidateErrors(c), ['Invoice ID duplikat.']);
  c.items[0].tax++;
  approve(c);
  assert.ok(candidateErrors(c).some((error) => error.includes('Jumlah pajak')));
  c.sourceId = '';
  approve(c);
  assert.ok(candidateErrors(c).some((error) => error.includes('Identitas invoice')));
});
