import { int, json, mysqlTable, text, uniqueIndex, index, varchar } from 'drizzle-orm/mysql-core';
import type { InvoicePayment } from '../../types/invoice.types.js';
import type { AccurateReceiptPayload, ReceiptVerification } from '../../types/receipt.types.js';
import { branches } from './branches.schema.js';
import { invoices } from './invoices.schema.js';
import { time, currentTime } from './columns.js';

export const receiptAccountMappings = mysqlTable(
  'receipt_account_mappings',
  {
    id: varchar('id', { length: 100 }).primaryKey(),
    branchId: varchar('branch_id', { length: 100 })
      .notNull()
      .references(() => branches.id),
    databaseId: varchar('database_id', { length: 255 }).notNull(),
    bank: varchar('bank', { length: 64 }).notNull(),
    method: varchar('method', { length: 64 }).notNull(),
    accountId: varchar('account_id', { length: 255 }).notNull(),
    accountNo: varchar('account_no', { length: 255 }).notNull(),
    accountName: varchar('account_name', { length: 255 }).notNull(),
    feeAccountId: varchar('fee_account_id', { length: 255 }),
    feeAccountNo: varchar('fee_account_no', { length: 255 }),
    feeAccountName: varchar('fee_account_name', { length: 255 }),
    version: int('version').notNull().default(1),
    updatedAt: time('updated_at').notNull().default(currentTime),
  },
  (table) => [
    uniqueIndex('receipt_account_mapping_unique').on(
      table.branchId,
      table.databaseId,
      table.bank,
      table.method,
    ),
  ],
);

export const accurateReceipts = mysqlTable(
  'accurate_receipts',
  {
    id: varchar('id', { length: 100 }).primaryKey(),
    invoiceId: varchar('invoice_id', { length: 100 })
      .notNull()
      .references(() => invoices.id),
    branchId: varchar('branch_id', { length: 100 })
      .notNull()
      .references(() => branches.id),
    databaseId: varchar('database_id', { length: 255 }).notNull(),
    targetBranchId: varchar('target_branch_id', { length: 255 }).notNull(),
    sourceKey: varchar('source_key', { length: 64 }).notNull(),
    sourceFingerprint: varchar('source_fingerprint', { length: 255 }).notNull(),
    sourcePayments: json('source_payments').$type<InvoicePayment[]>().notNull(),
    sourceMethod: varchar('source_method', { length: 255 }).notNull(),
    grossAmount: int('gross_amount').notNull(),
    number: varchar('number', { length: 255 }).notNull(),
    mappingId: varchar('mapping_id', { length: 100 }).references(() => receiptAccountMappings.id),
    mappingVersion: int('mapping_version'),
    bank: varchar('bank', { length: 255 }),
    method: varchar('method', { length: 255 }),
    bankAccountNo: varchar('bank_account_no', { length: 255 }),
    bankAccountName: varchar('bank_account_name', { length: 255 }),
    feeAccountNo: varchar('fee_account_no', { length: 255 }),
    feeAccountName: varchar('fee_account_name', { length: 255 }),
    rateBps: int('rate_bps').notNull().default(0),
    feeAmount: int('fee_amount').notNull().default(0),
    netAmount: int('net_amount').notNull().default(0),
    paymentDate: varchar('payment_date', { length: 255 }).notNull().default(''),
    paymentReference: varchar('payment_reference', { length: 255 }).notNull().default(''),
    notes: varchar('notes', { length: 4000 }).notNull().default(''),
    version: int('version').notNull().default(1),
    status: varchar('status', { length: 255 }).notNull().default('DRAFT'),
    reviewedAt: time('reviewed_at'),
    queuedAt: time('queued_at'),
    attemptedAt: time('attempted_at'),
    completedAt: time('completed_at'),
    payload: json('payload').$type<AccurateReceiptPayload>(),
    verification: json('verification').$type<ReceiptVerification>(),
    targetId: varchar('target_id', { length: 255 }),
    targetNumber: varchar('target_number', { length: 255 }),
    error: text('error'),
    actorId: varchar('actor_id', { length: 100 }),
    createdAt: time('created_at').notNull().default(currentTime),
    updatedAt: time('updated_at').notNull().default(currentTime),
  },
  (table) => [
    uniqueIndex('receipt_source_unique').on(table.invoiceId, table.sourceKey),
    uniqueIndex('receipt_number_unique').on(table.databaseId, table.number),
    uniqueIndex('receipt_target_unique').on(table.databaseId, table.targetId),
    index('receipt_queue_idx').on(table.status, table.queuedAt),
  ],
);
