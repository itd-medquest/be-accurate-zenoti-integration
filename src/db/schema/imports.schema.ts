import { index, int, json, mysqlTable, text, varchar } from 'drizzle-orm/mysql-core';
import type { ImportCandidate } from '../../types/import.types.js';
import { user } from './auth.schema.js';
import { branches } from './branches.schema.js';
import { time, currentTime } from './columns.js';
import { invoices } from './invoices.schema.js';
export const importBatches = mysqlTable('import_batches', {
  id: varchar('id', { length: 100 }).primaryKey(),
  branchId: varchar('branch_id', { length: 100 })
    .notNull()
    .references(() => branches.id),
  uploaderId: varchar('uploader_id', { length: 100 })
    .notNull()
    .references(() => user.id),
  status: varchar('status', { length: 255 }).notNull().default('PREVIEW'),
  version: int('version').notNull().default(1),
  submittedBy: varchar('submitted_by', { length: 255 }),
  submittedAt: time('submitted_at'),
  createdAt: time('created_at').notNull().default(currentTime),
});

export const importFiles = mysqlTable('import_files', {
  id: varchar('id', { length: 100 }).primaryKey(),
  batchId: varchar('batch_id', { length: 100 })
    .notNull()
    .references(() => importBatches.id),
  name: text('name').notNull(),
  storedName: varchar('stored_name', { length: 255 }).notNull(),
  hash: varchar('hash', { length: 255 }).notNull(),
  size: int('size').notNull(),
  format: varchar('format', { length: 255 }).notNull(),
  error: text('error'),
  createdAt: time('created_at').notNull().default(currentTime),
});

export const importRows = mysqlTable(
  'import_rows',
  {
    id: varchar('id', { length: 100 }).primaryKey(),
    batchId: varchar('batch_id', { length: 100 })
      .notNull()
      .references(() => importBatches.id),
    fileId: varchar('file_id', { length: 100 })
      .notNull()
      .references(() => importFiles.id),
    position: int('position').notNull(),
    candidate: json('candidate').$type<ImportCandidate>().notNull(),
    status: varchar('status', { length: 255 }).notNull().default('REVIEW'),
    invoiceId: varchar('invoice_id', { length: 100 }).references(() => invoices.id),
    duplicateInvoiceId: varchar('duplicate_invoice_id', { length: 100 }),
    createdAt: time('created_at').notNull().default(currentTime),
  },
  (t) => [index('import_rows_batch_idx').on(t.batchId)],
);
