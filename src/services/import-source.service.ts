import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { storageRoot } from '../config/storage.js';
import * as files from '../repositories/import-files.repository.js';
import * as rowsRepository from '../repositories/import-rows.repository.js';
import { HttpError } from '../utils/http-error.js';
import { inspectZip } from '../utils/parsers/excel.js';
import { salesTemplateBuffer } from '../utils/parsers/sales-accrual.js';
import type { PreviewQuery } from '../validations/imports.validation.js';
import { audit } from './audit.service.js';

export const template = (example: boolean) => salesTemplateBuffer(example);
export async function download(batchId: string, fileId: string, actorId: string) {
  const file = await files.findById(fileId);
  if (!file || file.batchId !== batchId) throw new HttpError(404, 'File tidak ditemukan.');
  if (!/^[a-f0-9-]{36}$/.test(file.storedName))
    throw new HttpError(404, 'Referensi file tidak valid.');
  await audit(actorId, 'import.file.download', file.id);
  return { path: join(storageRoot, file.storedName), name: file.name };
}
export async function preview(batchId: string, fileId: string, query: PreviewQuery) {
  const file = await files.findById(fileId);
  if (!file || file.batchId !== batchId || !/^[a-f0-9-]{36}$/.test(file.storedName))
    throw new HttpError(404, 'File tidak ditemukan.');
  if (file.format !== 'XLSX') throw new HttpError(400, 'Preview tabel hanya untuk XLSX.');
  const buffer = await readFile(join(storageRoot, file.storedName));
  inspectZip(buffer);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  if (workbook.worksheets.length > 4) throw new HttpError(422, 'Maksimal 4 sheet.');
  const selectedSheet = query.sheet || workbook.worksheets[0]?.name;
  let selectedRows: number[] | undefined;
  if (query.rowId) {
    const row = await rowsRepository.findById(query.rowId);
    if (!row || row.fileId !== file.id || row.batchId !== file.batchId)
      throw new HttpError(404, 'Invoice sumber tidak ditemukan.');
    if (row.candidate.sourceSheet === selectedSheet) selectedRows = row.candidate.sourceRows;
  }
  const sheets = workbook.worksheets.map((s) => {
    if (s.rowCount > 2004 || s.columnCount > 100)
      throw new HttpError(422, 'Ukuran sheet melebihi batas preview.');
    const numbers: number[] = [];
    s.eachRow((_r, n) => {
      if (n > 4 && (!selectedRows || s.name !== selectedSheet || selectedRows.includes(n)))
        numbers.push(n);
    });
    const page = Math.min(query.page, Math.max(1, Math.ceil(numbers.length / 25)));
    const rows: { number: number; cells: string[] }[] = [];
    if (s.name === selectedSheet) {
      const visible = new Set([
        ...Array.from({ length: 4 }, (_, i) => i + 1),
        ...numbers.slice((page - 1) * 25, page * 25),
      ]);
      s.eachRow((r, n) => {
        if (visible.has(n))
          rows.push({
            number: n,
            cells: Array.from({ length: s.columnCount }, (_, i) =>
              r.getCell(i + 1).text.slice(0, 2000),
            ),
          });
      });
    }
    return { name: s.name, rows, totalRows: numbers.length };
  });
  return { sheets };
}
