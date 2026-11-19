import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import * as receipts from '../repositories/receipts.repository.js';
import * as branches from '../repositories/branches.repository.js';
import * as connections from '../repositories/integration-configs.repository.js';
import * as audits from '../repositories/audit-logs.repository.js';
import { withTransaction, type DbExecutor } from '../repositories/unit-of-work.repository.js';
import { accurateConnection, connectedAccurate } from './accurate-connection.service.js';
import { AccurateReceiptRejected } from './integrations/accurate-client.js';
import {
  draftSource,
  singleReceiptGroups,
  receiptNumber,
  manualReceiptNumber,
  lockActor,
  publicDraft,
  type Receipt,
  type Source,
} from './receipt-context.service.js';
import {
  receiptDate,
  verifyAccurateReceipt,
  type ReceiptInvoice,
  type AccurateReceiptResult,
} from '../utils/accurate-receipt.js';
import { receiptAmounts } from '../utils/receipt-amounts.js';
import { HttpError } from '../utils/http-error.js';
import {
  receiptBanks,
  receiptMethods,
  type AccurateReceiptPayload,
  type ReceiptVerification,
} from '../types/receipt.types.js';

function verifyInvoice(source: Source, target: ReceiptInvoice) {
  if (
    source.exception === 'REFUND' ||
    source.businessStatus === 'VOIDED' ||
    target.id !== source.targetId ||
    target.number !== source.targetNumber ||
    target.branchId !== source.targetBranchId ||
    target.customerNo !== source.invoicePayload.customerNo ||
    target.total !== source.expectedTotal ||
    (target.currencyCode && target.currencyCode !== 'IDR') ||
    target.date !== receiptDate(String(source.invoicePayload.transDate ?? ''))
  )
    throw new HttpError(
      422,
      'Identitas, tanggal, total, atau mata uang faktur Accurate berbeda dari faktur terverifikasi.',
    );
}

export async function receiptBalance(row: Receipt) {
  const { source } = await draftSource(row);
  const { client, profile } = await connectedAccurate(true, row.branchId);
  if (profile.id !== row.databaseId || !source.targetId)
    throw new HttpError(409, 'Database koneksi berbeda dari tujuan faktur.');
  const invoice = await client.receiptInvoice(profile, source.targetId);
  verifyInvoice(source, invoice);
  return { outstanding: invoice.outstanding, checkedAt: new Date().toISOString() };
}

async function preflight(row: Receipt) {
  const { source, group } = await draftSource(row);
  singleReceiptGroups(source);
  // Queued payloads retain the number reviewed before the numbering rule changed.
  const number =
    row.payload?.number ?? (await receiptNumber(source, group)) ?? (await manualReceiptNumber(row));
  if (!number)
    throw new HttpError(422, 'Isi No. Receipt dan simpan draft sebelum mengirim ke Accurate.');
  if (row.number !== number)
    throw new HttpError(
      409,
      'No. Bukti harus sesuai nomor receipt. Simpan ulang draft sebelum mengirim.',
    );
  const { client, profile, connectionId, fingerprint } = await connectedAccurate(
    true,
    row.branchId,
  );
  if (profile.id !== row.databaseId || !source.targetId)
    throw new HttpError(409, 'Database koneksi berbeda dari tujuan faktur.');
  const bank = receiptBanks.find((value) => value === row.bank),
    method = receiptMethods.find((value) => value === row.method);
  const mapping = row.mappingId ? await receipts.mapping(row.mappingId) : undefined;
  if (
    !bank ||
    !method ||
    !mapping ||
    mapping.version !== row.mappingVersion ||
    mapping.databaseId !== row.databaseId ||
    mapping.branchId !== row.branchId ||
    mapping.bank !== bank ||
    mapping.method !== method ||
    mapping.accountNo !== row.bankAccountNo ||
    mapping.feeAccountNo !== row.feeAccountNo
  )
    throw new HttpError(
      409,
      'Mapping akun berubah atau belum lengkap. Simpan dan periksa ulang draft.',
    );
  if (
    ['cash', 'gift_card', 'voucher'].includes(row.sourceMethod) ||
    (row.sourceMethod === 'qris' && method !== 'QRIS') ||
    (row.sourceMethod === 'bank' && method !== 'BANK_TRANSFER') ||
    (row.sourceMethod === 'card' && !['CREDIT_CARD', 'DEBIT_CARD'].includes(method))
  )
    throw new HttpError(422, 'Metode sumber tidak cocok dengan penerimaan bank yang dipilih.');
  const amounts = receiptAmounts(row.grossAmount, bank, method);
  if (
    amounts.fee !== row.feeAmount ||
    amounts.net !== row.netAmount ||
    amounts.rateBps !== row.rateBps ||
    amounts.net <= 0 ||
    !row.paymentReference.trim()
  )
    throw new HttpError(
      409,
      'Perhitungan atau referensi draft belum lengkap. Simpan draft sebelum mengirim.',
    );
  const account = await client.receiptAccount(profile, 'bank', mapping.accountId);
  const fee = amounts.fee
    ? mapping.feeAccountId && (await client.receiptAccount(profile, 'fee', mapping.feeAccountId))
    : null;
  if (
    account.code !== mapping.accountNo ||
    (amounts.fee && (!fee || fee.code !== mapping.feeAccountNo))
  )
    throw new HttpError(409, 'Kode akun Accurate berubah. Periksa mapping di Settings.');
  const invoice = await client.receiptInvoice(profile, source.targetId);
  verifyInvoice(source, invoice);
  if (account.currencyId !== invoice.currencyId || invoice.outstanding < row.grossAmount)
    throw new HttpError(
      422,
      'Mata uang akun berbeda atau pembayaran melebihi sisa tagihan Accurate.',
    );
  if (row.paymentDate < invoice.date)
    throw new HttpError(422, 'Tanggal pembayaran tidak boleh sebelum tanggal faktur.');
  const branchId = Number(row.targetBranchId);
  if (!Number.isSafeInteger(branchId) || branchId <= 0)
    throw new HttpError(422, 'Identitas cabang Accurate tidak valid.');
  const payload: AccurateReceiptPayload = {
    number: row.number,
    bankNo: account.code,
    customerNo: invoice.customerNo,
    branchId,
    currencyCode: 'IDR',
    transDate: `${row.paymentDate.slice(8, 10)}/${row.paymentDate.slice(5, 7)}/${row.paymentDate.slice(0, 4)}`,
    chequeAmount: amounts.net,
    paymentMethod: method,
    // Preserve the description already frozen for a queued/attempted delivery.
    description:
      row.payload?.description ??
      `${source.customer.trim()} - Pembayaran Invoices no ${invoice.number}`,
    detailInvoice: [
      {
        invoiceNo: invoice.number,
        paymentAmount: amounts.gross,
        ...(amounts.fee && fee
          ? {
              detailDiscount: [
                {
                  accountNo: fee.code,
                  amount: amounts.fee,
                  discountNotes: 'Biaya administrasi bank',
                },
              ],
            }
          : {}),
      },
    ],
  };
  const verification: ReceiptVerification = {
    invoiceId: invoice.id,
    customerId: invoice.customerId,
    currencyId: invoice.currencyId,
    bankId: account.id,
    feeAccountId: fee ? fee.id : null,
    outstandingBefore: invoice.outstanding,
    writeRejected: false,
  };
  return { client, profile, payload, verification, connectionId, fingerprint };
}

async function lockOperation(row: Receipt, actorId: string, tx: DbExecutor) {
  await lockActor(actorId, ['super_admin', 'finance'], tx);
  const [branch] = await branches.lockById(row.branchId, tx);
  if (!branch?.active) throw new HttpError(409, 'Perusahaan penerimaan dinonaktifkan.');
  await receipts.lockInvoice(row.invoiceId, tx);
  const [current] = await receipts.lock(row.id, tx);
  if (!current) throw new HttpError(404, 'Penerimaan tidak ditemukan.');
  return current;
}
async function recheck(
  row: Receipt,
  tx: DbExecutor,
  prepared: { connectionId: string; fingerprint: string },
) {
  const snapshot = await accurateConnection(tx, row.branchId);
  await connections.lockById(snapshot.id, tx);
  const connection = await accurateConnection(tx, row.branchId);
  if (connection.id !== prepared.connectionId || connection.fingerprint !== prepared.fingerprint)
    throw new HttpError(
      409,
      'Koneksi Accurate berubah setelah pemeriksaan. Periksa ulang penerimaan.',
    );
  if (!connection.enabled || connection.mode !== 'live')
    throw new HttpError(409, 'Koneksi aktual Accurate dinonaktifkan.');
  await draftSource(row, tx);
  const mapping = row.mappingId && (await receipts.mapping(row.mappingId, tx));
  if (!mapping || mapping.version !== row.mappingVersion)
    throw new HttpError(409, 'Mapping berubah. Periksa ulang draft.');
  if ((await receipts.unresolved(row.invoiceId, row.id, tx)).length)
    throw new HttpError(
      409,
      'Ada penerimaan lain untuk faktur ini yang masih diproses atau perlu direkonsiliasi.',
    );
}
const log = (action: string, row: Receipt, details: Record<string, unknown>, tx: DbExecutor) =>
  audits.create(
    {
      id: randomUUID(),
      actorId: row.actorId,
      action,
      entityId: row.id,
      details,
    },
    tx,
  );

export async function submitReceipt(id: string, version: number, actorId: string) {
  const row = await receipts.find(id);
  if (!row) throw new HttpError(404, 'Penerimaan tidak ditemukan.');
  if (['QUEUED', 'SENDING', 'SUCCEEDED'].includes(row.status)) return publicDraft(row);
  if (row.status !== 'DRAFT' || row.version !== version || row.attemptedAt)
    throw new HttpError(409, 'Draft berubah atau sudah pernah dikirim. Muat ulang halaman.');
  const prepared = await preflight(row);
  return withTransaction(async (tx) => {
    const current = await lockOperation(row, actorId, tx);
    if (['QUEUED', 'SENDING', 'SUCCEEDED'].includes(current.status)) return publicDraft(current);
    if (current.status !== 'DRAFT' || current.version !== version || current.attemptedAt)
      throw new HttpError(409, 'Draft berubah. Muat ulang sebelum mengirim.');
    await recheck(current, tx, prepared);
    const [saved] = await receipts.update(
      id,
      {
        status: 'QUEUED',
        payload: prepared.payload,
        verification: prepared.verification,
        reviewedAt: new Date(),
        queuedAt: new Date(),
        error: null,
        actorId,
        version: current.version + 1,
      },
      tx,
    );
    await log(
      'receipt.enqueue',
      saved,
      {
        gross: saved.grossAmount,
        fee: saved.feeAmount,
        net: saved.netAmount,
        mappingVersion: saved.mappingVersion,
      },
      tx,
    );
    return publicDraft(saved);
  });
}

async function claim() {
  for (const candidate of await receipts.pending()) {
    const claimed = await withTransaction(async (tx) => {
      if (!(await receipts.lockInvoice(candidate.invoiceId, tx, true)).length) return;
      const [row] = await receipts.lock(candidate.id, tx);
      if (
        !row ||
        row.status !== 'QUEUED' ||
        (await receipts.unresolved(row.invoiceId, row.id, tx)).length
      )
        return;
      const [saved] = await receipts.update(
        row.id,
        { status: 'SENDING', version: row.version + 1 },
        tx,
      );
      return saved;
    });
    if (claimed) return claimed;
  }
}
async function complete(row: Receipt, result: AccurateReceiptResult) {
  return withTransaction(async (tx) => {
    await receipts.lockInvoice(row.invoiceId, tx);
    const [current] = await receipts.lock(row.id, tx);
    if (!current || current.status === 'SUCCEEDED') return current && publicDraft(current);
    if (!current.attemptedAt || !current.payload || !current.verification)
      throw new HttpError(409, 'Identitas upaya pengiriman belum tersedia.');
    verifyAccurateReceipt(result, current.payload, current.verification);
    const [saved] = await receipts.update(
      row.id,
      {
        status: 'SUCCEEDED',
        targetId: result.id,
        targetNumber: result.number,
        error: null,
        completedAt: new Date(),
        version: current.version + 1,
      },
      tx,
    );
    await log(
      'receipt.succeeded',
      saved,
      {
        targetId: result.id,
        targetNumber: result.number,
        gross: row.grossAmount,
        fee: row.feeAmount,
        net: row.netAmount,
      },
      tx,
    );
    return publicDraft(saved);
  });
}
async function verifyBalance(row: Receipt, invoice: ReceiptInvoice) {
  const { source } = await draftSource(row);
  verifyInvoice(source, invoice);
  if (
    !row.verification ||
    invoice.customerId !== row.verification.customerId ||
    invoice.currencyId !== row.verification.currencyId ||
    invoice.outstanding > row.verification.outstandingBefore - row.grossAmount
  )
    throw new HttpError(
      422,
      'Penerimaan ditemukan tetapi pengurangan piutang belum terverifikasi. Periksa alokasi di Accurate.',
    );
}
export async function processOneReceipt() {
  const row = await claim();
  if (!row) return false;
  try {
    if (!row.payload || !row.verification || row.attemptedAt || !row.actorId)
      throw new HttpError(409, 'Identitas atau payload antrean tidak lengkap.');
    const prepared = await preflight(row);
    if (!isDeepStrictEqual(prepared.payload, row.payload))
      throw new HttpError(409, 'Payload tidak cocok dengan pemeriksaan Finance.');
    if (await prepared.client.findReceipt(prepared.profile, row.number))
      throw new HttpError(
        422,
        'Nomor penerimaan sudah ada sebelum upaya ini. Data Accurate tidak ditimpa.',
      );
    const actorId = row.actorId;
    const attempted = await withTransaction(async (tx) => {
      const current = await lockOperation(row, actorId, tx);
      if (current.status !== 'SENDING' || current.attemptedAt || current.version !== row.version)
        throw new HttpError(409, 'Pengiriman sudah dimulai atau dihentikan.');
      await recheck(current, tx, prepared);
      const [saved] = await receipts.update(
        row.id,
        { attemptedAt: new Date(), verification: prepared.verification },
        tx,
      );
      await log(
        'receipt.attempt',
        saved,
        { outstandingBefore: prepared.verification.outstandingBefore },
        tx,
      );
      return saved;
    });
    const returnedId = await prepared.client.saveReceipt(prepared.profile, row.payload);
    const result = await prepared.client.findReceipt(prepared.profile, row.number);
    if (!result || (returnedId && returnedId !== result.id))
      throw new HttpError(
        422,
        'Hasil pengiriman belum dapat diverifikasi. Periksa Accurate; jangan kirim ulang.',
      );
    verifyAccurateReceipt(result, row.payload, prepared.verification);
    await verifyBalance(
      attempted,
      await prepared.client.receiptInvoice(prepared.profile, prepared.verification.invoiceId),
    );
    await complete(attempted, result);
  } catch (cause) {
    await withTransaction(async (tx) => {
      await receipts.lockInvoice(row.invoiceId, tx);
      const [current] = await receipts.lock(row.id, tx);
      if (!current || current.status === 'SUCCEEDED') return;
      const message = cause instanceof Error ? cause.message : 'Penerimaan perlu diperiksa.';
      const [saved] = await receipts.update(
        row.id,
        {
          status: 'NEEDS_REVIEW',
          error: message,
          version: current.version + 1,
          ...(cause instanceof AccurateReceiptRejected && current.verification
            ? { verification: { ...current.verification, writeRejected: true } }
            : {}),
        },
        tx,
      );
      await log('receipt.needs_review', saved, { message, attempted: !!saved.attemptedAt }, tx);
    });
  }
  return true;
}

export async function checkReceipt(id: string, actorId: string) {
  const row = await receipts.find(id);
  if (!row) throw new HttpError(404, 'Penerimaan tidak ditemukan.');
  if (row.status === 'SUCCEEDED') return publicDraft(row);
  if (row.status !== 'NEEDS_REVIEW' || !row.attemptedAt || !row.payload || !row.verification)
    throw new HttpError(409, 'Tidak ada hasil pengiriman yang perlu direkonsiliasi.');
  const { client, profile } = await connectedAccurate(true, row.branchId);
  if (profile.id !== row.databaseId)
    throw new HttpError(409, 'Database koneksi berbeda dari penerimaan.');
  const result = await client.findReceipt(profile, row.number);
  if (!result)
    throw new HttpError(
      409,
      'Penerimaan belum ditemukan. Tidak ada pengiriman ulang; periksa Accurate atau coba pemeriksaan hasil lagi.',
    );
  verifyAccurateReceipt(result, row.payload, row.verification);
  await verifyBalance(row, await client.receiptInvoice(profile, row.verification.invoiceId));
  await withTransaction(async (tx) => {
    await lockActor(actorId, ['super_admin', 'finance'], tx);
    await log('receipt.reconcile', { ...row, actorId }, {}, tx);
  });
  return complete(row, result);
}
export async function reopenReceipt(id: string, version: number, actorId: string) {
  const row = await receipts.find(id);
  if (!row) throw new HttpError(404, 'Penerimaan tidak ditemukan.');
  if (row.status !== 'NEEDS_REVIEW' || (row.attemptedAt && !row.verification?.writeRejected))
    throw new HttpError(
      409,
      'Hasil pengiriman belum pasti. Gunakan Periksa hasil, bukan pengiriman ulang.',
    );
  if (row.attemptedAt) {
    const { client, profile } = await connectedAccurate(true, row.branchId);
    if (profile.id !== row.databaseId || (await client.findReceipt(profile, row.number)))
      throw new HttpError(409, 'Tujuan berbeda atau nomor penerimaan sudah ada. Periksa Accurate.');
  }
  return withTransaction(async (tx) => {
    const current = await lockOperation(row, actorId, tx);
    if (
      current.version !== version ||
      current.status !== 'NEEDS_REVIEW' ||
      (current.attemptedAt && !current.verification?.writeRejected)
    )
      throw new HttpError(409, 'Penerimaan berubah. Muat ulang halaman.');
    const [saved] = await receipts.update(
      id,
      {
        status: 'DRAFT',
        payload: null,
        verification: null,
        queuedAt: null,
        reviewedAt: null,
        attemptedAt: null,
        error: null,
        version: current.version + 1,
        actorId,
      },
      tx,
    );
    await log('receipt.reopen', saved, {}, tx);
    return publicDraft(saved);
  });
}
export async function recoverStaleReceipts() {
  for (const row of await receipts.stale())
    await withTransaction(async (tx) => {
      await receipts.lockInvoice(row.invoiceId, tx);
      const [current] = await receipts.lock(row.id, tx);
      if (
        !current ||
        current.status !== 'SENDING' ||
        current.updatedAt.getTime() >= Date.now() - 5 * 60000
      )
        return;
      const [saved] = await receipts.update(
        row.id,
        {
          status: 'NEEDS_REVIEW',
          error: 'Proses terputus. Periksa hasil di Accurate sebelum melanjutkan.',
          version: current.version + 1,
        },
        tx,
      );
      await log('receipt.recover', saved, { attempted: !!saved.attemptedAt }, tx);
    });
}
