import * as receipts from '../repositories/receipts.repository.js';
import * as users from '../repositories/user.repository.js';
import * as audits from '../repositories/audit-logs.repository.js';
import type { DbExecutor } from '../repositories/unit-of-work.repository.js';
import type { accurateReceipts } from '../db/schema/receipts.schema.js';
import { HttpError } from '../utils/http-error.js';
import { receiptSourceGroups } from '../utils/receipt-amounts.js';
import { pendingReceiptNumber, sourceReceiptNumber } from '../utils/receipt-number.js';
import type { ReceiptSourceGroup } from '../types/receipt.types.js';
export type Receipt = typeof accurateReceipts.$inferSelect;
export type Source = Awaited<ReturnType<typeof receipts.sources>>[number];
export const publicDraft = ({
  payload: _payload,
  verification: _verification,
  ...row
}: Receipt) => ({
  ...row,
  number: row.number === pendingReceiptNumber(row.id) ? '' : row.number,
});
export async function lockActor(id: string, roles: string[], context: DbExecutor) {
  const [actor] = await users.lockByIds([id], context);
  if (!actor?.active || !roles.includes(actor.role))
    throw new HttpError(403, 'Akses pengguna berubah. Muat ulang halaman.');
}
export function sourceGroups(source: Source) {
  if (source.sourceVersion !== source.deliveredVersion)
    throw new HttpError(
      409,
      'Versi invoice berbeda dari faktur terverifikasi. Periksa faktur terlebih dahulu.',
    );
  try {
    return receiptSourceGroups(source.payments);
  } catch (cause) {
    throw new HttpError(
      422,
      cause instanceof Error ? cause.message : 'Pembayaran sumber tidak valid.',
    );
  }
}
export async function draftSource(row: Receipt, context?: DbExecutor) {
  const source = (await receipts.sources(context)).find(
    (value) => value.invoiceId === row.invoiceId,
  );
  const group = source && sourceGroups(source).find((value) => value.key === row.sourceKey);
  if (
    !source ||
    !group ||
    group.fingerprint !== row.sourceFingerprint ||
    source.databaseId !== row.databaseId ||
    source.targetBranchId !== row.targetBranchId
  )
    throw new HttpError(
      409,
      'Pembayaran sumber atau tujuan berubah. Draft ditahan untuk pemeriksaan.',
    );
  return { source, group };
}
export function singleReceiptGroups(source: Source) {
  const groups = sourceGroups(source);
  if (groups.length > 1)
    throw new HttpError(
      422,
      'Faktur memiliki beberapa pembayaran terpisah. Penerimaan ini perlu ditangani manual di Accurate.',
    );
  return groups;
}
export async function receiptNumber(
  source: Source,
  group: ReceiptSourceGroup,
  context?: DbExecutor,
) {
  const candidates = await receipts.sourceCandidates(source.invoiceId, context);
  try {
    return sourceReceiptNumber(
      group.payments,
      candidates.map((row) => row.candidate).filter((row) => row.sourceId === source.sourceId),
    );
  } catch (cause) {
    throw new HttpError(422, cause instanceof Error ? cause.message : 'Nomor receipt tidak valid.');
  }
}

export async function manualReceiptNumber(row: Receipt, context?: DbExecutor) {
  if (row.number === pendingReceiptNumber(row.id)) return null;
  const records = await audits.findByActionAndEntity('receipt.number.manual', row.id, context);
  return records.some(
    ({ details }) =>
      typeof details === 'object' &&
      details !== null &&
      'number' in details &&
      details.number === row.number &&
      'sourceFingerprint' in details &&
      details.sourceFingerprint === row.sourceFingerprint,
  )
    ? row.number
    : null;
}
