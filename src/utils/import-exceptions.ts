import { createHash } from 'node:crypto';
import type { ImportCandidate } from '../types/import.types.js';

// Only recoverable package extraction exceptions may be acknowledged. Financial,
// identity, duplicate, mapping and authorization errors never enter this list.
export function packageExtractionErrors(candidate: ImportCandidate) {
  if (candidate.sourceFormat !== 'PDF') return [];
  return candidate.errors.filter(
    (error) =>
      error === 'Manfaat paket tidak dapat dipasangkan secara pasti ke item utama.' ||
      error ===
        'Rincian tabel Benefit belum terbaca lengkap. Lengkapi semua layanan sesuai dokumen sumber.' ||
      /^Jumlah manfaat paket setelah diskon \(Rp[\d.]+\) tidak sama dengan subtotal tagihan \(Rp[\d.]+\)\. Periksa rincian paket pada dokumen sumber\.$/.test(
        error,
      ),
  );
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}

export function exceptionFingerprint(candidate: ImportCandidate) {
  const { reviewException: _review, accountingReviewedAt: _reviewed, ...snapshot } = candidate;
  return createHash('sha256')
    .update(JSON.stringify(canonical(snapshot)))
    .digest('hex');
}

export function hasCurrentReviewException(candidate: ImportCandidate) {
  const review = candidate.reviewException;
  const errors = packageExtractionErrors(candidate);
  return (
    !!review &&
    !!candidate.accountingReviewedAt &&
    review.reason.trim().length >= 10 &&
    review.reason.length <= 1000 &&
    !!review.actorId &&
    Number.isFinite(Date.parse(review.reviewedAt)) &&
    errors.length > 0 &&
    review.errors.length === errors.length &&
    review.errors.every((error, index) => error === errors[index]) &&
    review.fingerprint === exceptionFingerprint(candidate)
  );
}

export function hasUnresolvedPackageParent(candidate: ImportCandidate) {
  const parents = candidate.packageParents ?? [];
  return (
    !parents.length ||
    parents.some((parent) => {
      const children = candidate.items.filter((item) => item.id.startsWith(parent.id + ':detail:'));
      return (
        candidate.items.some((item) => item.id === parent.id) ||
        !children.length ||
        children.reduce((sum, item) => sum + item.quantity * item.unitPrice - item.discount, 0) !==
          parent.quantity * parent.unitPrice - parent.discount ||
        children.reduce((sum, item) => sum + item.tax, 0) !== parent.tax
      );
    })
  );
}
