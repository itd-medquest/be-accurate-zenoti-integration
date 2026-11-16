import { index, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import type { ImportCandidate } from '../../types/import.types.js';
import { user } from './auth.schema.js';
import { branches } from './branches.schema.js';
import { time } from './columns.js';
import { invoices } from './invoices.schema.js';
export const importBatches = pgTable('import_batches', {
  id: text('id').primaryKey(),
  branchId: text('branch_id')
    .notNull()
    .references(() => branches.id),
  uploaderId: text('uploader_id')
    .notNull()
    .references(() => user.id),
  status: text('status').notNull().default('PREVIEW'),
  version: integer('version').notNull().default(1),
  submittedBy: text('submitted_by'),
  submittedAt: time('submitted_at'),
  createdAt: time('created_at').notNull().defaultNow(),
});

export const importFiles = pgTable('import_files', {
  id: text('id').primaryKey(),
  batchId: text('batch_id')
    .notNull()
    .references(() => importBatches.id),
  name: text('name').notNull(),
  storedName: text('stored_name').notNull(),
  hash: text('hash').notNull(),
  size: integer('size').notNull(),
  format: text('format').notNull(),
  error: text('error'),
  createdAt: time('created_at').notNull().defaultNow(),
});

export const importRows = pgTable(
  'import_rows',
  {
    id: text('id').primaryKey(),
    batchId: text('batch_id')
      .notNull()
      .references(() => importBatches.id),
    fileId: text('file_id')
      .notNull()
      .references(() => importFiles.id),
    position: integer('position').notNull(),
    candidate: jsonb('candidate').$type<ImportCandidate>().notNull(),
    status: text('status').notNull().default('REVIEW'),
    invoiceId: text('invoice_id').references(() => invoices.id),
    duplicateInvoiceId: text('duplicate_invoice_id'),
    createdAt: time('created_at').notNull().defaultNow(),
  },
  (t) => [index('import_rows_batch_idx').on(t.batchId)],
);
