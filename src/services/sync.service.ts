import { randomUUID } from 'node:crypto';
import { type Invoice } from '../db/schema/index.js';
import * as auditLogsRepository from '../repositories/audit-logs.repository.js';
import * as branchesRepository from '../repositories/branches.repository.js';
import * as integrationConfigsRepository from '../repositories/integration-configs.repository.js';
import * as invoiceSyncsRepository from '../repositories/invoice-syncs.repository.js';
import * as invoicesRepository from '../repositories/invoices.repository.js';
import * as jobsRepository from '../repositories/jobs.repository.js';
import * as syncAttemptsRepository from '../repositories/sync-attempts.repository.js';
import type { DbTransaction } from '../repositories/unit-of-work.repository.js';
import { withTransaction } from '../repositories/unit-of-work.repository.js';
import { HttpError } from '../utils/http-error.js';
import { audit } from './audit.service.js';
import { accurate, AmbiguousWrite, zenoti } from './integrations/simulated.adapters.js';
import * as accurateRepository from '../repositories/accurate.repository.js';
import { deliverInvoice } from './accurate-delivery.service.js';
import { chargeableItems, isFullRedemption, isLocalOnlyInvoice } from '../utils/redemption.js';
export async function enqueue(invoiceId: string, actorId: string) {
  return withTransaction((tx) => enqueueWithTransaction(tx, invoiceId, actorId));
}
export async function enqueueWithTransaction(
  tx: DbTransaction,
  invoiceId: string,
  actorId: string,
) {
  const [invoice] = await invoicesRepository.lockById(invoiceId, tx);
  if (!invoice) throw new HttpError(404, 'Invoice tidak ditemukan.');
  if (invoice.syncStatus.startsWith('LOCAL_ONLY') || isLocalOnlyInvoice(invoice))
    throw new HttpError(
      409,
      `Invoice ${isFullRedemption(invoice) ? 'full redeem' : 'Consultation gratis'} hanya disimpan di intgrte dan tidak dapat dikirim ke Accurate.`,
    );
  if (invoice.syncStatus === 'PROCESSING')
    throw new HttpError(409, 'Invoice masih dalam antrean atau sedang diproses.');
  if (invoice.syncStatus === 'SYNCED')
    throw new HttpError(409, 'Versi invoice ini sudah tersinkron.');
  const branch = await branchesRepository.findById(invoice.branchId, tx);
  if (!branch?.active) throw new HttpError(409, 'Cabang belum aktif atau mapping belum tersedia.');
  const connection = await integrationConfigsRepository.findById('accurate', tx);
  if (!connection?.enabled) throw new HttpError(409, 'Koneksi Accurate sedang dinonaktifkan.');
  const id = randomUUID();
  await jobsRepository.create({ id, invoiceId, actorId }, tx);
  await invoicesRepository.updateById(
    { syncStatus: 'PROCESSING', error: null, updatedAt: new Date() },
    invoiceId,
    tx,
  );
  await auditLogsRepository.create(
    { id: randomUUID(), actorId, action: 'invoice.enqueue', entityId: invoiceId },
    tx,
  );
  return { id, status: 'QUEUED' };
}
export function validateInvoice(invoice: Invoice, requireLegacyMapping = true) {
  if (invoice.syncStatus.startsWith('LOCAL_ONLY') || isLocalOnlyInvoice(invoice))
    throw new HttpError(
      422,
      `Invoice ${isFullRedemption(invoice) ? 'full redeem' : 'Consultation gratis'} tidak boleh diproses oleh worker Accurate.`,
    );
  if (invoice.exception === 'REFUND' || invoice.businessStatus === 'VOIDED')
    throw new HttpError(
      422,
      'Refund/void membutuhkan pemeriksaan Finance dan dokumen koreksi terpisah. Tidak dikirim otomatis.',
    );
  if (requireLegacyMapping && chargeableItems(invoice.items).some((i) => !i.mapped))
    throw new HttpError(400, 'Mapping item belum lengkap. Lengkapi mapping sebelum retry.');
  const itemTotal = chargeableItems(invoice.items).reduce(
    (n, i) => n + i.quantity * i.unitPrice - i.discount + i.tax,
    0,
  );
  if (
    itemTotal !== invoice.total ||
    invoice.outstanding < 0 ||
    invoice.payments.reduce((n, p) => n + p.amount, 0) + invoice.outstanding !== invoice.total
  )
    throw new HttpError(422, 'Total item, pembayaran, dan outstanding tidak konsisten.');
  if (new Set(invoice.payments.map((p) => p.id)).size !== invoice.payments.length)
    throw new HttpError(422, 'Identitas pembayaran duplikat.');
}
export async function processOne() {
  const job = await withTransaction(async (tx) => {
    const [row] = await jobsRepository.lockNextAvailable(tx);
    if (!row) return;
    await jobsRepository.updateById(
      { status: 'RUNNING', lockedAt: new Date(), attempts: row.attempts + 1 },
      row.id,
      tx,
    );
    return row;
  });
  if (!job) return false;
  try {
    const invoice = await invoicesRepository.findById(job.invoiceId);
    if (!invoice) throw new Error('Invoice tidak ditemukan.');
    const delivery = await accurateRepository.delivery(invoice.id);
    validateInvoice(invoice, !delivery);
    const branch = await branchesRepository.findById(invoice.branchId);
    if (!branch?.active) throw new HttpError(422, 'Cabang tidak aktif.');
    const connection = await integrationConfigsRepository.findById('accurate');
    if (!connection?.enabled) throw new HttpError(400, 'Koneksi Accurate dinonaktifkan.');
    // Jobs without a persisted live payload remain simulations even after the mode changes.
    if (delivery) {
      const target = await deliverInvoice(invoice, delivery);
      await withTransaction(async (tx) => {
        await accurateRepository.updateDelivery(
          invoice.id,
          { status: 'SUCCEEDED', targetId: target.id, targetNumber: target.number },
          tx,
        );
        await invoiceSyncsRepository.upsertTarget(
          {
            id: randomUUID(),
            invoiceId: invoice.id,
            databaseId: delivery.databaseId,
            targetId: target.id,
            targetNumber: target.number,
            targetStatus: target.approvalStatus,
            version: invoice.version,
            paymentIds: [],
          },
          {
            targetId: target.id,
            targetNumber: target.number,
            targetStatus: target.approvalStatus,
            version: invoice.version,
            paymentIds: [],
            syncedAt: new Date(),
          },
          tx,
        );
        await invoicesRepository.updateById(
          { syncStatus: 'SYNCED', error: null, updatedAt: new Date() },
          invoice.id,
          tx,
        );
        await jobsRepository.updateById({ status: 'DONE', finishedAt: new Date() }, job.id, tx);
        await syncAttemptsRepository.create(
          {
            id: randomUUID(),
            invoiceId: invoice.id,
            actorId: job.actorId,
            status: 'SYNCED',
            message:
              'Faktur Penjualan tersimpan di Accurate dan total hasilnya telah diverifikasi. Penerimaan Penjualan belum dikirim.',
            response: {
              targetId: target.id,
              targetNumber: target.number,
              status: target.approvalStatus,
              simulation: false,
              total: target.total,
            },
          },
          tx,
        );
      });
      return true;
    }
    // Lookup selalu mendahului write, termasuk saat hasil request sebelumnya ambigu.
    const found = await accurate.find(invoice.sourceId, branch.accurateDatabaseId);
    if (found && (found.total !== invoice.total || found.branchId !== branch.accurateBranchId))
      throw new HttpError(
        422,
        'Referensi target ditemukan tetapi nominal/cabang berbeda. Perlu pemeriksaan Finance.',
      );
    const draft =
      found && found.version === invoice.version
        ? found
        : await accurate.saveDraft(invoice, branch);
    await withTransaction(async (tx) => {
      await invoiceSyncsRepository.upsertTarget(
        {
          id: randomUUID(),
          invoiceId: invoice.id,
          databaseId: branch.accurateDatabaseId,
          targetId: draft.id,
          targetNumber: draft.number,
          targetStatus: 'DRAFT',
          version: invoice.version,
          paymentIds: draft.paymentIds,
        },
        {
          targetId: draft.id,
          targetNumber: draft.number,
          targetStatus: 'DRAFT',
          version: invoice.version,
          paymentIds: draft.paymentIds,
          syncedAt: new Date(),
        },
        tx,
      );
      await invoicesRepository.updateById(
        { syncStatus: 'SYNCED', error: null, updatedAt: new Date() },
        invoice.id,
        tx,
      );
      await jobsRepository.updateById({ status: 'DONE', finishedAt: new Date() }, job.id, tx);
      await syncAttemptsRepository.create(
        {
          id: randomUUID(),
          invoiceId: invoice.id,
          actorId: job.actorId,
          status: 'SYNCED',
          message: found
            ? 'Referensi ditemukan. Draft yang sama digunakan tanpa duplikasi.'
            : 'Invoice dan alokasi pembayaran tersimpan sebagai draft simulasi.',
          response: {
            targetId: draft.id,
            targetNumber: draft.number,
            status: 'DRAFT',
            simulation: true,
            paymentIds: draft.paymentIds,
          },
        },
        tx,
      );
    });
  } catch (error) {
    const review =
      error instanceof AmbiguousWrite || (error instanceof HttpError && error.status === 422);
    const status = review ? 'NEEDS_REVIEW' : 'FAILED';
    const message = error instanceof Error ? error.message : 'Sinkronisasi gagal.';
    await withTransaction(async (tx) => {
      await invoicesRepository.updateById(
        { syncStatus: status, error: message, updatedAt: new Date() },
        job.invoiceId,
        tx,
      );
      await jobsRepository.updateById(
        { status: 'FAILED', error: message, finishedAt: new Date() },
        job.id,
        tx,
      );
      if (await accurateRepository.delivery(job.invoiceId, tx))
        await accurateRepository.updateDelivery(job.invoiceId, { status }, tx);
      await syncAttemptsRepository.create(
        {
          id: randomUUID(),
          invoiceId: job.invoiceId,
          actorId: job.actorId,
          status,
          message,
        },
        tx,
      );
    });
  }
  return true;
}
export async function recoverStaleJobs() {
  // Lease kedaluwarsa tidak langsung menulis ulang: operator harus memicu lookup/retry.
  await withTransaction(async (tx) => {
    const stale = await jobsRepository.lockStale(tx);
    for (const job of stale) {
      const message =
        'Worker terhenti atau lease kedaluwarsa. Periksa referensi target sebelum retry.';
      await jobsRepository.updateById(
        { status: 'FAILED', error: message, finishedAt: new Date() },
        job.id,
        tx,
      );
      await invoicesRepository.updateById(
        { syncStatus: 'NEEDS_REVIEW', error: message },
        job.invoiceId,
        tx,
      );
      if (await accurateRepository.delivery(job.invoiceId, tx))
        await accurateRepository.updateDelivery(job.invoiceId, { status: 'NEEDS_REVIEW' }, tx);
      await syncAttemptsRepository.create(
        { id: randomUUID(), invoiceId: job.invoiceId, status: 'NEEDS_REVIEW', message },
        tx,
      );
    }
  });
}
export async function fetchInvoices(actorId: string) {
  const connection = await integrationConfigsRepository.findById('zenoti');
  if (!connection?.enabled) throw new HttpError(409, 'Koneksi Zenoti dinonaktifkan.');
  const active = await branchesRepository.listActive();
  const pilot = active.find((b) => b.id === 'branch-jakarta');
  if (!pilot) throw new HttpError(409, 'Cabang pilot Jakarta belum aktif.');
  const rows = await zenoti.fetch(pilot.id);
  // Simulasi fixture stabil: fetch ulang tidak menimpa perbaikan mapping atau mengulang invoice.
  const inserted = await invoicesRepository.insertMissingIds(rows);
  await audit(actorId, 'zenoti.fetch', pilot.id, {
    fetched: rows.length,
    inserted: inserted.length,
    simulation: true,
  });
  return { fetched: rows.length, inserted: inserted.length };
}
export async function invoiceDetail(id: string) {
  const invoice = await invoicesRepository.findById(id);
  if (!invoice) throw new HttpError(404, 'Invoice tidak ditemukan.');
  return {
    ...invoice,
    delivery: await accurateRepository.delivery(id),
    history: await syncAttemptsRepository.listForInvoice(id),
    targets: await invoiceSyncsRepository.listForInvoice(id),
  };
}
