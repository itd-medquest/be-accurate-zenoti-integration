import type { Invoice } from '../db/schema/index.js';
import * as repository from '../repositories/accurate.repository.js';
import { HttpError } from '../utils/http-error.js';
import type { AccurateInvoiceResult } from '../types/accurate.types.js';
import { connectedAccurate } from './accurate-connection.service.js';

export async function deliverInvoice(
  invoice: Invoice,
  delivery: NonNullable<Awaited<ReturnType<typeof repository.delivery>>>,
) {
  if (invoice.version !== delivery.sourceVersion)
    throw new HttpError(
      422,
      'Versi invoice berubah dari payload pengiriman. Periksa sebelum melanjutkan.',
    );
  const { client, profile } = await connectedAccurate(true, invoice.branchId);
  if (profile.id !== delivery.databaseId)
    throw new HttpError(
      422,
      'Database API Token berbeda dari tujuan invoice. Pengiriman dihentikan.',
    );
  const verify = (result: AccurateInvoiceResult) => {
    const isoDate = result.date.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/);
    const date = isoDate ? `${isoDate[3]}/${isoDate[2]}/${isoDate[1]}` : result.date;
    if (
      result.number !== delivery.payload.number ||
      result.customerNo !== delivery.payload.customerNo ||
      result.branchId !== delivery.targetBranchId ||
      result.total !== delivery.expectedTotal ||
      result.currencyCode !== 'IDR' ||
      date !== delivery.payload.transDate
    )
      throw new HttpError(
        422,
        `Faktur Accurate ditemukan tetapi nomor, tanggal, customer, cabang, mata uang, atau total tidak cocok. Periksa Accurate; faktur tidak dikirim ulang.`,
      );
    return result;
  };
  const existing = await client.findInvoice(profile, delivery.payload.number);
  if (existing) {
    if (!delivery.attemptedAt)
      throw new HttpError(
        422,
        'Nomor faktur sudah digunakan di Accurate sebelum pengiriman ini. Periksa duplikat; data Accurate tidak ditimpa.',
      );
    return verify(existing);
  }
  if (delivery.attemptedAt)
    throw new HttpError(
      422,
      'Request sebelumnya pernah dikirim, tetapi faktur belum ditemukan. Periksa Accurate sebelum pengiriman ulang untuk mencegah duplikasi.',
    );
  const [claimed] = await repository.claimDelivery(invoice.id);
  if (!claimed)
    throw new HttpError(422, 'Pengiriman invoice sudah pernah dimulai. Periksa hasil di Accurate.');
  return verify(await client.saveInvoice(profile, delivery.payload));
}
