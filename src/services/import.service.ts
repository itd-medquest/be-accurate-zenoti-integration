import { createHash, randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import * as auditLogsRepository from '../repositories/audit-logs.repository.js';
import * as branchesRepository from '../repositories/branches.repository.js';
import * as importBatchesRepository from '../repositories/import-batches.repository.js';
import * as importFilesRepository from '../repositories/import-files.repository.js';
import * as importRowsRepository from '../repositories/import-rows.repository.js';
import * as invoicesRepository from '../repositories/invoices.repository.js';
import { withTransaction, type DbTransaction } from '../repositories/unit-of-work.repository.js';
import {
  calculateItemCorrection,
  calculateNewItem,
  calculatePackage,
} from '../utils/package-calculation.js';

import { config } from '../config/env.js';
import { storageRoot } from '../config/storage.js';
import type { importFiles } from '../db/schema/index.js';
import type { ImportCandidate } from '../types/import.types.js';
import { HttpError } from '../utils/http-error.js';
import { candidateErrors, candidateHash, emptyCandidate } from '../utils/import-validation.js';
import { parseExcel } from '../utils/parsers/excel.js';
import { parsePdf } from '../utils/parsers/pdf.js';
import { enqueueWithTransaction } from './sync.service.js';
import * as accurateRepository from '../repositories/accurate.repository.js';
import { accurateConnection } from './accurate-connection.service.js';
import {
  buildAccuratePayload,
  liveInvoiceErrors,
  type AccurateDestination,
} from '../utils/accurate-payload.js';
import { applySavedMappings } from '../utils/accurate-mapping.js';
import { isFullRedemption, isLocalOnlyInvoice } from '../utils/redemption.js';
async function freezeAccurateDelivery(
  c: ImportCandidate,
  destination: AccurateDestination,
  invoiceId: string,
  branchId: string,
  sourceVersion: number,
  tx: DbTransaction,
) {
  const requestedNumber = c.sourceInvoiceNumber || c.number;
  if (await accurateRepository.deliveryByNumber(destination.databaseId, requestedNumber, tx))
    throw new HttpError(
      409,
      `Nomor faktur ${requestedNumber} sudah memiliki pengiriman aktual. Periksa riwayat; jangan mengirim receipt lain sebagai faktur baru.`,
    );
  const [delivery] = await accurateRepository.createDelivery(
    {
      invoiceId,
      branchId,
      databaseId: destination.databaseId,
      targetBranchId: destination.targetBranchId,
      sourceVersion,
      requestedNumber,
      expectedTotal: c.total,
      payload: buildAccuratePayload(c, destination),
    },
    tx,
  );
  if (!delivery)
    throw new HttpError(
      409,
      'Nomor faktur sudah memiliki pengiriman aktual. Muat ulang riwayat sebelum melanjutkan.',
    );
}
export function reviewErrors(c: ImportCandidate) {
  const errors = candidateErrors(c);
  if (isLocalOnlyInvoice(c)) {
    if (!c.accountingReviewedAt)
      errors.push('Konfirmasikan pemeriksaan invoice yang disimpan lokal sebelum menyimpan.');
    if (!['OPEN', 'CLOSED'].includes(c.businessStatus))
      errors.push('Pilih Status Invoices Open atau Closed setelah memeriksa sumber.');
  }
  if (c.extractionMethod === 'ocr' && !c.accountingReviewedAt)
    errors.push('Hasil OCR harus diperiksa dan dikonfirmasi Accounting sebelum submit.');
  for (const parent of c.packageParents ?? [])
    if (c.items.some((i) => i.id === parent.id))
      errors.push(
        `Detail paket belum lengkap: ${parent.name}. Isi layanan penyusun paket sebelum submit.`,
      );
  if (c.businessStatus === 'VOIDED')
    errors.push('Void memerlukan dokumen koreksi dan review khusus.');
  if (c.packageName && config.IMPORT_PACKAGE_TAX_POLICY !== 'proportional')
    errors.push('Aturan alokasi pajak paket belum disetujui.');
  return errors;
}
export async function createImport(
  branchId: string,
  actorId: string,
  files: Express.Multer.File[],
) {
  let committed = false;
  try {
    const branch = await branchesRepository.findById(branchId);
    if (!branch?.active) throw new HttpError(400, 'Pilih cabang aktif untuk batch upload.');
    if (!files.length) throw new HttpError(400, 'Pilih file PDF atau XLSX.');
    if (files.reduce((n, f) => n + f.size, 0) > 25 * 1024 * 1024)
      throw new HttpError(413, 'Maksimal total 25 MB per batch.');
    const batchId = randomUUID();
    const records: { file: typeof importFiles.$inferInsert; rows: ImportCandidate[] }[] = [];
    const accurateDestination = await accurateRepository.destination(branchId);
    const savedMappings = accurateDestination
      ? await accurateRepository.mappings(branchId, accurateDestination.databaseId)
      : [];
    let count = 0;
    for (const file of files) {
      const buffer = await readFile(file.path);
      const signature = buffer.subarray(0, 5).toString();
      const format =
        signature === '%PDF-'
          ? 'PDF'
          : buffer[0] === 0x50 && buffer[1] === 0x4b
            ? 'XLSX'
            : 'UNKNOWN';
      const metadata = {
        id: randomUUID(),
        batchId,
        name: file.originalname.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 160),
        storedName: file.filename,
        hash: createHash('sha256').update(buffer).digest('hex'),
        size: file.size,
        format,
        error: null as string | null,
      };
      let rows: ImportCandidate[] = [];
      try {
        if (
          (format === 'PDF' && !/\.pdf$/i.test(file.originalname)) ||
          (format === 'XLSX' && !/\.xlsx$/i.test(file.originalname))
        )
          throw new Error('Ekstensi dan isi file tidak cocok.');
        if (format === 'PDF') rows = await parsePdf(file.path);
        else if (format === 'XLSX') rows = await parseExcel(buffer);
        else throw new Error('File harus PDF teks Zenoti atau XLSX sesuai template.');
        if (!rows.length) throw new Error('File tidak memiliki invoice.');
      } catch (e) {
        metadata.error = e instanceof Error ? e.message : 'File tidak dapat diproses.';
        const c = emptyCandidate(format === 'XLSX' ? 'XLSX' : 'PDF');
        c.errors.push(metadata.error);
        rows = [c];
      }
      count += rows.length;
      if (count > 500) throw new HttpError(413, 'Maksimal 500 invoice dalam satu batch.');
      records.push({ file: metadata, rows });
    }
    const centers = new Set(
      records.flatMap((r) => r.rows.map((c) => c.sourceCenter).filter(Boolean)),
    );
    if (centers.size > 1)
      for (const record of records)
        for (const c of record.rows)
          c.errors.push('Batch memuat beberapa Center Code. Pisahkan upload per cabang.');
    await withTransaction(async (tx) => {
      await importBatchesRepository.create({ id: batchId, branchId, uploaderId: actorId }, tx);
      const seen = new Set<string>();
      for (const record of records) {
        await importFilesRepository.create(record.file, tx);
        for (let index = 0; index < record.rows.length; index++) {
          const c = record.rows[index];
          if (accurateDestination) applySavedMappings(c, accurateDestination, savedMappings);
          if (c.sourceCenter && c.sourceCenter !== branch.centerId)
            c.warnings.push(
              `Center Code sumber ${c.sourceCenter} diarahkan ke cabang pilihan ${branch.name}. Periksa pemetaan cabang sebelum submit.`,
            );
          const key = c.sourceId;
          if (key && seen.has(key))
            c.errors.push(
              'Invoice ID yang sama muncul beberapa kali pada batch ini. Sisakan satu salinan.',
            );
          if (key) seen.add(key);
          const existing = c.sourceId
            ? await invoicesRepository.findBySource(c.sourceId, c.number, branchId, tx)
            : undefined;
          let status = 'REVIEW';
          if (existing)
            status = existing.sourceHash === candidateHash(c) ? 'DUPLICATE' : 'CONFLICT';
          await importRowsRepository.create(
            {
              id: randomUUID(),
              batchId,
              fileId: record.file.id,
              position: index + 1,
              candidate: c,
              status,
              duplicateInvoiceId: existing?.id,
            },
            tx,
          );
        }
      }
      await auditLogsRepository.create(
        {
          id: randomUUID(),
          actorId,
          action: 'import.upload',
          entityId: batchId,
          details: { files: files.length, invoices: count, branchId },
        },
        tx,
      );
    });
    committed = true;
    return getImport(batchId);
  } finally {
    if (!committed) await Promise.allSettled(files.map((f) => unlink(f.path)));
  }
}
export async function reparseImportFile(
  batchId: string,
  fileId: string,
  version: number,
  actorId: string,
) {
  const snapshot = await importBatchesRepository.findById(batchId);
  const file = await importFilesRepository.findInBatch(fileId, batchId);
  if (!snapshot || !file) throw new HttpError(404, 'File tidak ditemukan.');
  if (snapshot.status !== 'PREVIEW' || snapshot.version !== version)
    throw new HttpError(409, 'Draft berubah atau sudah disubmit. Muat ulang.');
  if (file.format !== 'PDF' || !file.error || !/^[a-f0-9-]{36}$/.test(file.storedName))
    throw new HttpError(409, 'Baca ulang hanya tersedia untuk PDF draft yang gagal dibaca.');
  const path = join(storageRoot, file.storedName);
  const buffer = await readFile(path);
  if (createHash('sha256').update(buffer).digest('hex') !== file.hash)
    throw new HttpError(409, 'Dokumen sumber berubah. Upload ulang file asli.');
  // OCR runs outside the transaction; the version is checked again before replacing the failed preview.
  const candidates = await parsePdf(path).catch((error) => {
    throw new HttpError(422, error instanceof Error ? error.message : 'PDF belum dapat dibaca.');
  });
  if (!candidates.length) throw new HttpError(422, 'Tidak ada receipt yang terbaca.');
  await withTransaction(async (tx) => {
    const [batch] = await importBatchesRepository.lockById(batchId, tx);
    if (!batch || batch.status !== 'PREVIEW' || batch.version !== version)
      throw new HttpError(409, 'Draft berubah selama pembacaan. Muat ulang.');
    const active = await importRowsRepository.listActive(batchId, tx);
    const previous = active.filter((r) => r.fileId === fileId);
    if (!previous.length || previous.some((r) => r.invoiceId || r.candidate.accountingReviewedAt))
      throw new HttpError(
        409,
        'Preview sudah diperiksa atau dihapus. Upload ulang bila diperlukan.',
      );
    const others = active.filter((r) => r.fileId !== fileId);
    if (others.length + candidates.length > 500)
      throw new HttpError(413, 'Maksimal 500 invoice per batch.');
    const seen = new Set(others.map((r) => r.candidate.sourceId).filter(Boolean));
    for (const row of previous)
      await importRowsRepository.updateById({ status: 'DELETED' }, row.id, tx);
    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index];
      if (seen.has(candidate.sourceId))
        candidate.errors.push(
          'Invoice ID yang sama muncul beberapa kali pada batch ini. Sisakan satu salinan.',
        );
      if (candidate.sourceId) seen.add(candidate.sourceId);
      await importRowsRepository.create(
        {
          id: randomUUID(),
          batchId,
          fileId,
          position: index + 1,
          candidate,
          status: 'REVIEW',
        },
        tx,
      );
    }
    await importFilesRepository.updateById({ error: null }, fileId, tx);
    await importBatchesRepository.updateById({ version: version + 1 }, batchId, tx);
    await auditLogsRepository.create(
      {
        id: randomUUID(),
        actorId,
        action: 'import.file.reparse',
        entityId: batchId,
        details: {
          fileId,
          previousRows: previous.map((r) => r.id),
          invoices: candidates.length,
          sourceHash: file.hash,
        },
      },
      tx,
    );
  });
  return getImport(batchId);
}
export async function listImports(page?: number, pageSize = 10) {
  const query = importBatchesRepository.listVisible(page, pageSize);
  const items = await query;
  if (!page) return items;
  const [result] = await importBatchesRepository.countVisible();
  return { items, total: result.total };
}
export async function getImport(id: string) {
  const batch = await importBatchesRepository.findById(id);
  if (!batch) throw new HttpError(404, 'Batch upload tidak ditemukan.');
  const storedFiles = await importFilesRepository.listPreview(id);
  const rows = await importRowsRepository.listPreview(id);
  const activeFiles = new Set(rows.map((row) => row.fileId));
  const files = storedFiles.filter((file) => activeFiles.has(file.id));
  const preview = [];
  const connection = await accurateConnection();
  const destination =
    connection.mode === 'live' ? await accurateRepository.destination(batch.branchId) : undefined;
  for (const row of rows) {
    let status = row.status,
      duplicateInvoiceId = row.duplicateInvoiceId;
    const existing = row.candidate.sourceId
      ? await invoicesRepository.findBySource(
          row.candidate.sourceId,
          row.candidate.number,
          batch.branchId,
        )
      : undefined;
    if (!row.invoiceId && existing) {
      status = existing.sourceHash === candidateHash(row.candidate) ? 'DUPLICATE' : 'CONFLICT';
      if (
        status === 'DUPLICATE' &&
        !isLocalOnlyInvoice(row.candidate) &&
        connection.mode === 'live' &&
        !(await accurateRepository.delivery(existing.id))
      )
        status = 'REVIEW';
      duplicateInvoiceId = existing.id;
    }
    preview.push({
      ...row,
      status,
      duplicateInvoiceId,
      errors: [
        ...reviewErrors(row.candidate),
        ...(connection.mode === 'live' && !row.invoiceId
          ? liveInvoiceErrors(row.candidate, destination)
          : []),
      ],
      syncStatus: row.invoiceId ? existing?.syncStatus : null,
      syncError: row.invoiceId ? existing?.error : null,
      delivery: row.invoiceId
        ? await accurateRepository.delivery(row.invoiceId).then((delivery) =>
            delivery
              ? {
                  status: delivery.status,
                  targetId: delivery.targetId,
                  targetNumber: delivery.targetNumber,
                }
              : null,
          )
        : null,
    });
  }
  const mode =
    batch.status === 'SUBMITTED'
      ? preview.some((row) => row.delivery)
        ? 'live'
        : preview.some((row) => row.invoiceId) &&
            preview.filter((row) => row.invoiceId).every((row) => isLocalOnlyInvoice(row.candidate))
          ? 'local'
          : 'simulation'
      : connection.mode;
  return { ...batch, files, rows: preview, mode, accurateDestination: destination };
}
export async function reviewRow(
  batchId: string,
  rowId: string,
  version: number,
  businessStatus: 'OPEN' | 'CLOSED',
  actorId: string,
) {
  await withTransaction(async (tx) => {
    const [batch] = await importBatchesRepository.lockById(batchId, tx);
    if (!batch) throw new HttpError(404, 'Batch tidak ditemukan.');
    if (batch.status !== 'PREVIEW')
      throw new HttpError(409, 'Batch yang sudah disubmit tidak dapat diedit.');
    if (batch.version !== version)
      throw new HttpError(409, 'Preview berubah. Muat ulang sebelum menyimpan.');
    const row = await importRowsRepository.findInBatch(rowId, batchId, tx);
    if (!row || row.status === 'DELETED')
      throw new HttpError(404, 'Baris invoice tidak ditemukan.');
    await importRowsRepository.updateById(
      { candidate: { ...row.candidate, businessStatus, accountingReviewedAt: undefined } },
      row.id,
      tx,
    );
    await importBatchesRepository.updateById({ version: batch.version + 1 }, batchId, tx);
    await auditLogsRepository.create(
      {
        id: randomUUID(),
        actorId,
        action: 'import.review',
        entityId: batchId,
        details: { rowId, businessStatus },
      },
      tx,
    );
  });
  return getImport(batchId);
}
export async function submitImport(
  batchId: string,
  version: number,
  ids: string[],
  actorId: string,
) {
  await withTransaction(async (tx) => {
    const [batch] = await importBatchesRepository.lockById(batchId, tx);
    if (!batch) throw new HttpError(404, 'Batch tidak ditemukan.');
    if (batch.status === 'SUBMITTED') return;
    if (batch.status !== 'PREVIEW') throw new HttpError(409, 'Batch telah dihapus dari riwayat.');
    if (batch.version !== version)
      throw new HttpError(409, 'Preview berubah. Muat ulang dan periksa kembali sebelum submit.');
    const [branch] = await branchesRepository.lockById(batch.branchId, tx);
    if (!branch?.active) throw new HttpError(409, 'Cabang tidak aktif.');
    const connection = await accurateConnection(tx);
    const destination =
      connection.mode === 'live'
        ? await accurateRepository.destination(batch.branchId, tx)
        : undefined;
    const rows = await importRowsRepository.listActive(batchId, tx);
    const selected = rows.filter((row) => ids.includes(row.id));
    if (selected.length !== new Set(ids).size)
      throw new HttpError(400, 'Pilihan invoice tidak sesuai batch.');
    let savedLocally = 0;
    let queued = 0,
      skipped = 0;
    for (const row of selected) {
      const c = row.candidate;
      const errors = [
        ...reviewErrors(c),
        ...(connection.mode === 'live' ? liveInvoiceErrors(c, destination) : []),
      ];
      if (errors.length) throw new HttpError(422, `${c.number || 'Invoice'}: ${errors.join(' ')}`);
      const hash = candidateHash(c);
      const existing = await invoicesRepository.findBySource(
        c.sourceId,
        c.number,
        batch.branchId,
        tx,
      );
      if (existing) {
        if (existing.sourceHash !== hash)
          throw new HttpError(
            409,
            `Invoice ${c.number} sudah ada dengan data berbeda. Periksa konflik; tidak dibuat ulang.`,
          );
        if (
          connection.mode === 'live' &&
          !isLocalOnlyInvoice(c) &&
          destination &&
          !(await accurateRepository.delivery(existing.id, tx))
        ) {
          const [locked] = await invoicesRepository.lockById(existing.id, tx);
          if (!locked || locked.syncStatus === 'PROCESSING')
            throw new HttpError(
              409,
              'Tunggu antrean simulasi lama selesai sebelum mengirim aktual.',
            );
          await freezeAccurateDelivery(
            c,
            destination,
            locked.id,
            batch.branchId,
            locked.version,
            tx,
          );
          await invoicesRepository.updateById(
            { syncStatus: 'PENDING', error: null, updatedAt: new Date() },
            locked.id,
            tx,
          );
          await enqueueWithTransaction(tx, locked.id, actorId);
          await importRowsRepository.updateById(
            { status: 'QUEUED', invoiceId: locked.id },
            row.id,
            tx,
          );
          await auditLogsRepository.create(
            {
              id: randomUUID(),
              actorId,
              action: 'accurate.simulation.promote',
              entityId: locked.id,
              details: { batchId, number: c.sourceInvoiceNumber || c.number },
            },
            tx,
          );
          queued++;
          continue;
        }
        await importRowsRepository.updateById(
          { status: 'DUPLICATE', invoiceId: existing.id, duplicateInvoiceId: existing.id },
          row.id,
          tx,
        );
        skipped++;
        continue;
      }
      const id = randomUUID();
      await invoicesRepository.create(
        {
          id,
          sourceId: c.sourceId,
          number:
            connection.mode === 'live' || isLocalOnlyInvoice(c)
              ? c.sourceInvoiceNumber || c.number
              : c.number,
          branchId: batch.branchId,
          customer: c.customer,
          customerId: c.customerId,
          date: new Date(`${c.date}T00:00:00+07:00`),
          dueDate: c.dueDate ? new Date(`${c.dueDate}T00:00:00+07:00`) : null,
          businessStatus: c.businessStatus,
          paymentStatus: c.outstanding === 0 ? 'PAID' : c.totalPaid > 0 ? 'PARTIAL' : 'UNPAID',
          syncStatus: isLocalOnlyInvoice(c)
            ? isFullRedemption(c)
              ? 'LOCAL_ONLY'
              : 'LOCAL_ONLY_CONSULTATION'
            : 'PENDING',
          total: c.total,
          outstanding: c.outstanding,
          discount: c.discount,
          tax: c.tax,
          items: c.items,
          payments: c.payments,
          sourceHash: hash,
        },
        tx,
      );
      if (isLocalOnlyInvoice(c)) {
        await importRowsRepository.updateById({ status: 'SAVED', invoiceId: id }, row.id, tx);
        await auditLogsRepository.create(
          {
            id: randomUUID(),
            actorId,
            action: isFullRedemption(c)
              ? 'import.full_redemption.save'
              : 'import.free_consultation.save',
            entityId: id,
            details: {
              batchId,
              sourceId: c.sourceId,
              sourceHash: hash,
              number: c.sourceInvoiceNumber || c.number,
              total: c.total,
              itemIds: c.items.map((item) => item.id),
            },
          },
          tx,
        );
        savedLocally++;
        continue;
      }
      if (connection.mode === 'live' && destination) {
        await freezeAccurateDelivery(c, destination, id, batch.branchId, 1, tx);
      }
      await enqueueWithTransaction(tx, id, actorId);
      await importRowsRepository.updateById({ status: 'QUEUED', invoiceId: id }, row.id, tx);
      queued++;
    }
    await importBatchesRepository.updateById(
      {
        status: 'SUBMITTED',
        version: batch.version + 1,
        submittedBy: actorId,
        submittedAt: new Date(),
      },
      batchId,
      tx,
    );
    await auditLogsRepository.create(
      {
        id: randomUUID(),
        actorId,
        action: 'import.submit',
        entityId: batchId,
        details: {
          queued,
          savedLocally,
          skipped,
          selected: ids.length,
          simulation: queued > 0 && connection.mode === 'simulation',
        },
      },
      tx,
    );
  });
  return getImport(batchId);
}

export async function deleteImport(batchId: string, version: number, actorId: string) {
  await withTransaction(async (tx) => {
    const [batch] = await importBatchesRepository.lockById(batchId, tx);
    if (!batch) throw new HttpError(404, 'Batch tidak ditemukan.');
    if (batch.version !== version)
      throw new HttpError(409, 'Riwayat berubah. Muat ulang sebelum menghapus.');
    if (batch.status !== 'PREVIEW')
      throw new HttpError(409, 'Hanya batch Preview yang dapat dihapus sebelum submit.');
    await importBatchesRepository.updateById(
      { status: 'DELETED', version: batch.version + 1 },
      batchId,
      tx,
    );
    await auditLogsRepository.create(
      {
        id: randomUUID(),
        actorId,
        action: 'import.history.delete',
        entityId: batchId,
        details: { previousStatus: batch.status, transactionsRetained: true },
      },
      tx,
    );
  });
  return { ok: true };
}

export async function reviewPackage(
  batchId: string,
  rowId: string,
  version: number,
  parentLineId: string,
  inputItems: {
    name: string;
    quantity: number;
    unitPrice: number;
    discountPercent: number;
    tax?: number;
    taxPercent?: number;
  }[],
  actorId: string,
) {
  await withTransaction(async (tx) => {
    const [batch] = await importBatchesRepository.lockById(batchId, tx);
    if (!batch) throw new HttpError(404, 'Batch tidak ditemukan.');
    if (batch.status !== 'PREVIEW' || batch.version !== version)
      throw new HttpError(409, 'Preview berubah atau sudah disubmit. Muat ulang.');
    const row = await importRowsRepository.findInBatch(rowId, batchId, tx);
    const parent = row?.candidate.packageParents?.find((p) => p.id === parentLineId);
    if (!row || row.status === 'DELETED' || !parent)
      throw new HttpError(404, 'Paket sumber tidak ditemukan.');
    const calculation = calculatePackage(
      inputItems,
      parent.quantity * parent.unitPrice - parent.discount,
      parent.tax,
    );
    if (!calculation)
      throw new HttpError(
        422,
        'Isi qty, harga unit, diskon, dan pajak yang valid (persen maksimal 6 desimal).',
      );
    const items = calculation.items;
    const net = items.reduce((n, i) => n + i.quantity * i.unitPrice - i.discount, 0),
      tax = items.reduce((n, i) => n + i.tax, 0);
    if (
      !calculation.matches ||
      net !== parent.quantity * parent.unitPrice - parent.discount ||
      tax !== parent.tax
    )
      throw new HttpError(
        422,
        'Jumlah net dan pajak layanan harus sama persis dengan paket sumber.',
      );
    const prefix = parent.id + ':detail:';
    const candidate = {
      ...row.candidate,
      accountingReviewedAt: undefined,
      items: [
        ...row.candidate.items.filter((i) => i.id !== parent.id && !i.id.startsWith(prefix)),
        ...items.map((i, index) => ({
          ...i,
          id: prefix + (index + 1),
          kind: 'service' as const,
          mapped: true,
        })),
      ].sort((a, b) => a.id.localeCompare(b.id)),
    };
    candidate.discount = candidate.items.reduce((n, i) => n + i.discount, 0);
    if (
      calculation.adjusted &&
      !candidate.warnings.includes(
        'Rincian paket menggunakan pembulatan rupiah dan rekonsiliasi kecil ke nilai sumber; periksa alokasi diskon dan pajak.',
      )
    )
      candidate.warnings.push(
        'Rincian paket menggunakan pembulatan rupiah dan rekonsiliasi kecil ke nilai sumber; periksa alokasi diskon dan pajak.',
      );
    const errors = candidateErrors(candidate);
    // Other source exceptions remain visible; this operation only replaces the selected parent.
    if (errors.some((e) => /Nominal|kuantitas|Jumlah item|Jumlah pajak/.test(e)))
      throw new HttpError(422, errors.join(' '));
    await importRowsRepository.updateById({ candidate }, rowId, tx);
    await importBatchesRepository.updateById({ version: batch.version + 1 }, batchId, tx);
    await auditLogsRepository.create(
      {
        id: randomUUID(),
        actorId,
        action: 'import.package.review',
        entityId: batchId,
        details: {
          rowId,
          parentLineId,
          items: items.length,
          net,
          tax,
          total: net + tax,
          inputItems,
          calculatedItems: items,
          rounding: calculation.adjusted,
        },
      },
      tx,
    );
  });
  return getImport(batchId);
}

export async function addImportItem(
  batchId: string,
  rowId: string,
  version: number,
  input: {
    name: string;
    kind: 'service' | 'product';
    quantity: number;
    unitPrice: number;
    discountPercent: number;
    taxPercent: number;
    reason: string;
  },
  actorId: string,
) {
  const calculation = calculateNewItem({
    name: input.name,
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    discountPercent: input.discountPercent,
    taxPercent: input.taxPercent,
  });
  if (!calculation)
    throw new HttpError(
      422,
      'Qty, harga unit, diskon, atau pajak tidak valid. Persen dan harga unit maksimal 6 desimal; nilai baris maksimal 2.147.483.647.',
    );
  await withTransaction(async (tx) => {
    const [batch] = await importBatchesRepository.lockById(batchId, tx);
    if (!batch) throw new HttpError(404, 'Batch tidak ditemukan.');
    if (batch.status !== 'PREVIEW' || batch.version !== version)
      throw new HttpError(
        409,
        'Draft berubah atau sudah disubmit. Muat ulang sebelum menambah item.',
      );
    const row = await importRowsRepository.findInBatch(rowId, batchId, tx);
    if (!row || row.status === 'DELETED') throw new HttpError(404, 'Invoice tidak ditemukan.');
    if (row.invoiceId)
      throw new HttpError(409, 'Invoice yang sudah disubmit tidak dapat ditambah item.');
    if (row.candidate.items.length >= 500)
      throw new HttpError(422, 'Maksimal 500 item per invoice.');
    const decomposedParents = (row.candidate.packageParents ?? []).filter(
      (p) => !row.candidate.items.some((i) => i.id === p.id),
    );
    const prefix =
      decomposedParents.length === 1
        ? decomposedParents[0].id + ':detail:manual:'
        : (row.candidate.sourceId || row.id) + ':manual:';
    const item = {
      ...calculation.items[0],
      id: prefix + randomUUID(),
      kind: input.kind,
      mapped: true,
    };
    const candidate = {
      ...row.candidate,
      items: [...row.candidate.items, item],
      accountingReviewedAt: undefined,
    };
    candidate.discount = candidate.items.reduce((n, i) => n + i.discount, 0);
    if (calculation.adjusted)
      candidate.warnings = [
        ...candidate.warnings,
        'Item manual menggunakan pembulatan diskon/pajak ke rupiah; cocokkan dengan dokumen sumber.',
      ];
    const missingItemErrors = new Set([
      'Ada baris item PDF yang belum terbaca lengkap.',
      'Jumlah harga item PDF tidak sama dengan subtotal sebelum diskon sumber.',
    ]);
    const resolvedParserErrors = candidate.errors.filter((error) => missingItemErrors.has(error));
    const remainingErrors = candidate.errors.filter((error) => !missingItemErrors.has(error));
    if (
      resolvedParserErrors.length &&
      candidateErrors({ ...candidate, errors: remainingErrors }).length === 0
    ) {
      candidate.errors = remainingErrors;
      candidate.warnings = [
        ...candidate.warnings,
        'Kekurangan baris hasil pembacaan telah dilengkapi manual dan total cocok dengan sumber. Periksa rincian sebelum submit.',
      ];
    } else resolvedParserErrors.length = 0;
    await importRowsRepository.updateById({ candidate }, rowId, tx);
    await importBatchesRepository.updateById({ version: version + 1 }, batchId, tx);
    await auditLogsRepository.create(
      {
        id: randomUUID(),
        actorId,
        action: 'import.item.add',
        entityId: batchId,
        details: {
          rowId,
          item,
          reason: input.reason,
          resolvedParserErrors,
          previousReviewedAt: row.candidate.accountingReviewedAt ?? null,
          sourceTotals: {
            subtotal: candidate.subtotal,
            tax: candidate.tax,
            total: candidate.total,
          },
        },
      },
      tx,
    );
  });
  return getImport(batchId);
}

export async function deleteImportItem(
  batchId: string,
  rowId: string,
  itemId: string,
  version: number,
  actorId: string,
) {
  await withTransaction(async (tx) => {
    const [batch] = await importBatchesRepository.lockById(batchId, tx);
    if (!batch) throw new HttpError(404, 'Batch tidak ditemukan.');
    if (batch.status !== 'PREVIEW' || batch.version !== version)
      throw new HttpError(
        409,
        'Draft berubah atau sudah disubmit. Muat ulang sebelum menghapus item.',
      );
    const row = await importRowsRepository.findInBatch(rowId, batchId, tx);
    if (!row || row.status === 'DELETED') throw new HttpError(404, 'Invoice tidak ditemukan.');
    if (row.invoiceId) throw new HttpError(409, 'Invoice yang sudah disubmit tidak dapat diubah.');
    const index = row.candidate.items.findIndex((item) => item.id === itemId);
    if (index < 0) throw new HttpError(404, 'Item invoice tidak ditemukan.');
    const removed = row.candidate.items[index];
    const candidate = {
      ...row.candidate,
      items: row.candidate.items.filter((item) => item.id !== itemId),
      accountingReviewedAt: undefined,
    };
    candidate.discount = candidate.items.reduce((n, item) => n + item.discount, 0);
    await importRowsRepository.updateById({ candidate }, rowId, tx);
    await importBatchesRepository.updateById({ version: version + 1 }, batchId, tx);
    await auditLogsRepository.create(
      {
        id: randomUUID(),
        actorId,
        action: 'import.item.delete',
        entityId: batchId,
        details: {
          rowId,
          item: removed,
          position: index + 1,
          previousReviewedAt: row.candidate.accountingReviewedAt ?? null,
          sourceTotals: {
            subtotal: candidate.subtotal,
            tax: candidate.tax,
            total: candidate.total,
          },
        },
      },
      tx,
    );
  });
  return getImport(batchId);
}

export async function correctImportItem(
  batchId: string,
  rowId: string,
  itemId: string,
  version: number,
  input: {
    name: string;
    quantity: number;
    unitPrice: number;
    discountPercent?: number;
    tax?: number;
    taxPercent?: number;
    reason: string;
  },
  actorId: string,
) {
  await withTransaction(async (tx) => {
    const [batch] = await importBatchesRepository.lockById(batchId, tx);
    if (!batch) throw new HttpError(404, 'Batch tidak ditemukan.');
    if (batch.status !== 'PREVIEW' || batch.version !== version)
      throw new HttpError(
        409,
        'Draft berubah atau sudah disubmit. Muat ulang sebelum menyimpan koreksi.',
      );
    const row = await importRowsRepository.findInBatch(rowId, batchId, tx);
    if (!row || row.status === 'DELETED') throw new HttpError(404, 'Invoice tidak ditemukan.');
    const original = row.candidate.items.find((item) => item.id === itemId);
    if (!original) throw new HttpError(404, 'Item invoice tidak ditemukan.');
    const base = input.quantity * input.unitPrice;
    if (!Number.isSafeInteger(base) || base < 0 || base > 2147483647)
      throw new HttpError(
        422,
        'Qty dikali harga harus menghasilkan rupiah bulat, maksimal 2.147.483.647.',
      );
    if (
      input.discountPercent === undefined &&
      (input.quantity !== original.quantity || input.unitPrice !== original.unitPrice)
    )
      throw new HttpError(422, 'Isi diskon persen secara eksplisit ketika qty atau harga diubah.');
    const calculation = calculateItemCorrection(original, input);
    if (!calculation)
      throw new HttpError(
        422,
        'Periksa diskon dan pajak (0–100%, maksimal 6 desimal). Saat nilai setelah diskon berubah, isi pajak persen. Nilai final item maksimal 2.147.483.647.',
      );
    const updated = {
      ...original,
      name: input.name,
      ...calculation,
    };
    const candidate = {
      ...row.candidate,
      items: row.candidate.items.map((item) => (item.id === itemId ? updated : item)),
      accountingReviewedAt: undefined,
    };
    candidate.discount = candidate.items.reduce((n, item) => n + item.discount, 0);
    // Source totals, provenance, parser exceptions, IDs and payments remain immutable.
    // Financial mismatches are returned as validation errors and cannot be submitted.
    await importRowsRepository.updateById({ candidate }, rowId, tx);
    await importBatchesRepository.updateById({ version: batch.version + 1 }, batchId, tx);
    await auditLogsRepository.create(
      {
        id: randomUUID(),
        actorId,
        action: 'import.item.correct',
        entityId: batchId,
        details: {
          rowId,
          itemId,
          reason: input.reason,
          before: original,
          after: updated,
          previousReviewedAt: row.candidate.accountingReviewedAt ?? null,
          sourceTotals: {
            subtotal: candidate.subtotal,
            tax: candidate.tax,
            total: candidate.total,
          },
        },
      },
      tx,
    );
  });
  return getImport(batchId);
}

export async function markImportRowReviewed(
  batchId: string,
  rowId: string,
  version: number,
  actorId: string,
) {
  await withTransaction(async (tx) => {
    const [batch] = await importBatchesRepository.lockById(batchId, tx);
    if (!batch || batch.status !== 'PREVIEW' || batch.version !== version)
      throw new HttpError(409, 'Preview berubah atau tidak dapat diperiksa. Muat ulang.');
    const row = await importRowsRepository.findInBatch(rowId, batchId, tx);
    if (!row || row.status === 'DELETED') throw new HttpError(404, 'Invoice tidak ditemukan.');
    await importRowsRepository.updateById(
      { candidate: { ...row.candidate, accountingReviewedAt: new Date().toISOString() } },
      rowId,
      tx,
    );
    await importBatchesRepository.updateById({ version: batch.version + 1 }, batchId, tx);
    await auditLogsRepository.create(
      {
        id: randomUUID(),
        actorId,
        action: 'import.row.reviewed',
        entityId: batchId,
        details: { rowId, hasValidationErrors: reviewErrors(row.candidate).length > 0 },
      },
      tx,
    );
  });
  return getImport(batchId);
}

export async function deleteImportFile(
  batchId: string,
  fileId: string,
  version: number,
  actorId: string,
) {
  let empty = false;
  await withTransaction(async (tx) => {
    const [batch] = await importBatchesRepository.lockById(batchId, tx);
    if (!batch) throw new HttpError(404, 'Batch tidak ditemukan.');
    if (batch.status !== 'PREVIEW')
      throw new HttpError(409, 'File hanya dapat dihapus dari draft sebelum submit.');
    if (batch.version !== version)
      throw new HttpError(409, 'Draft berubah. Muat ulang sebelum menghapus file.');
    const file = await importFilesRepository.findInBatch(fileId, batchId, tx);
    const rows = await importRowsRepository.listActiveForFile(batchId, fileId, tx);
    if (!file || !rows.length) throw new HttpError(404, 'File tidak ditemukan pada draft ini.');
    await importRowsRepository.updateByFile({ status: 'DELETED' }, batchId, fileId, tx);
    const [remaining] = await importRowsRepository.countActive(batchId, tx);
    empty = remaining.count === 0;
    await importBatchesRepository.updateById(
      { status: empty ? 'DELETED' : 'PREVIEW', version: batch.version + 1 },
      batchId,
      tx,
    );
    await auditLogsRepository.create(
      {
        id: randomUUID(),
        actorId,
        action: 'import.file.delete',
        entityId: batchId,
        details: { fileId, name: file.name, invoices: rows.length, sourceRetained: true },
      },
      tx,
    );
  });
  return empty
    ? { deleted: true as const }
    : { deleted: false as const, batch: await getImport(batchId) };
}
