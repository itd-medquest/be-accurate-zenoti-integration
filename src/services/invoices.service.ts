import { randomUUID } from 'node:crypto';
import { create as createAudit } from '../repositories/audit-logs.repository.js';
import * as invoicesRepository from '../repositories/invoices.repository.js';
import * as accurateRepository from '../repositories/accurate.repository.js';
import { withTransaction } from '../repositories/unit-of-work.repository.js';
import { HttpError } from '../utils/http-error.js';
import type { InvoiceFilters, InvoicePaging } from '../validations/invoices.validation.js';

export async function listInvoices(filters: InvoiceFilters, paging: InvoicePaging) {
  const asOf = new Date();
  const rows = await invoicesRepository.listPage(filters, paging, asOf);
  const [count] = await invoicesRepository.countScoped(filters, asOf);
  return { rows, total: count.total, ...paging };
}
export async function resolveMapping(id: string, actorId: string) {
  await withTransaction(async (tx) => {
    const [invoice] = await invoicesRepository.lockById(id, tx);
    if (!invoice) throw new HttpError(404, 'Invoice tidak ditemukan.');
    if (invoice.syncStatus.startsWith('LOCAL_ONLY'))
      throw new HttpError(
        409,
        'Invoice yang hanya disimpan lokal tidak memerlukan mapping Accurate.',
      );
    if (await accurateRepository.delivery(id, tx))
      throw new HttpError(
        409,
        'Payload faktur aktual telah dibekukan. Perbaikan mapping simulasi tidak berlaku untuk pengiriman ini.',
      );
    if (invoice.syncStatus === 'PROCESSING')
      throw new HttpError(409, 'Tunggu proses sinkronisasi selesai.');
    if (!invoice.items.some((i) => !i.mapped))
      throw new HttpError(409, 'Tidak ada mapping yang perlu diperbaiki.');
    await invoicesRepository.updateById(
      {
        items: invoice.items.map((i) => ({ ...i, mapped: true })),
        exception: null,
        error: null,
        syncStatus: 'PENDING',
        version: invoice.version + 1,
      },
      id,
      tx,
    );
    await createAudit(
      { id: randomUUID(), actorId, action: 'simulation.mapping.resolve', entityId: id },
      tx,
    );
  });
  return { ok: true };
}
