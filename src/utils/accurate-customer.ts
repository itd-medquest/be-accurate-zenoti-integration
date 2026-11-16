import { HttpError } from './http-error.js';

export const normalizeCustomerName = (value: string) =>
  value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('id');

export function nextMpaCustomerNumber(rows: Record<string, unknown>[]) {
  let maximum: bigint | undefined;
  for (const row of rows) {
    const match = /^MPA-([0-9]+)$/i.exec(String(row.customerNo ?? row.no ?? ''));
    if (!match) continue;
    const number = BigInt(match[1]);
    if (maximum === undefined || number > maximum) maximum = number;
  }
  if (maximum === undefined)
    throw new HttpError(
      422,
      'Nomor pelanggan MPA terakhir tidak ditemukan. Periksa penomoran dan hak akses di Accurate.',
    );
  const next = `MPA-${maximum + 1n}`;
  if (next.length > 100)
    throw new HttpError(422, 'Nomor pelanggan MPA melampaui batas yang didukung.');
  return next;
}
