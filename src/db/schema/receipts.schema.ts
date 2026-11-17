import { integer, jsonb, pgTable, text, uniqueIndex, index } from 'drizzle-orm/pg-core';
import type { InvoicePayment } from '../../types/invoice.types.js';
import type { AccurateReceiptPayload, ReceiptVerification } from '../../types/receipt.types.js';
import { branches } from './branches.schema.js';
import { invoices } from './invoices.schema.js';
import { time } from './columns.js';

export const receiptAccountMappings = pgTable(
  'receipt_account_mappings',
  {
    id: text('id').primaryKey(),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    databaseId: text('database_id').notNull(),
    bank: text('bank').notNull(),
    method: text('method').notNull(),
    accountId: text('account_id').notNull(),
    accountNo: text('account_no').notNull(),
    accountName: text('account_name').notNull(),
    feeAccountId: text('fee_account_id'),
    feeAccountNo: text('fee_account_no'),
    feeAccountName: text('fee_account_name'),
    version: integer('version').notNull().default(1),
    updatedAt: time('updated_at').notNull().defaultNow(),
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

export const accurateReceipts = pgTable(
  'accurate_receipts',
  {
    id: text('id').primaryKey(),
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => invoices.id),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    databaseId: text('database_id').notNull(),
    targetBranchId: text('target_branch_id').notNull(),
    sourceKey: text('source_key').notNull(),
    sourceFingerprint: text('source_fingerprint').notNull(),
    sourcePayments: jsonb('source_payments').$type<InvoicePayment[]>().notNull(),
    sourceMethod: text('source_method').notNull(),
    grossAmount: integer('gross_amount').notNull(),
    number: text('number').notNull(),
    mappingId: text('mapping_id').references(() => receiptAccountMappings.id),
    mappingVersion: integer('mapping_version'),
    bank: text('bank'),
    method: text('method'),
    bankAccountNo: text('bank_account_no'),
    bankAccountName: text('bank_account_name'),
    feeAccountNo: text('fee_account_no'),
    feeAccountName: text('fee_account_name'),
    rateBps: integer('rate_bps').notNull().default(0),
    feeAmount: integer('fee_amount').notNull().default(0),
    netAmount: integer('net_amount').notNull().default(0),
    paymentDate: text('payment_date').notNull().default(''),
    paymentReference: text('payment_reference').notNull().default(''),
    notes: text('notes').notNull().default(''),
    version: integer('version').notNull().default(1),
    status: text('status').notNull().default('DRAFT'),
    reviewedAt: time('reviewed_at'),
    queuedAt: time('queued_at'),
    attemptedAt: time('attempted_at'),
    completedAt: time('completed_at'),
    payload: jsonb('payload').$type<AccurateReceiptPayload>(),
    verification: jsonb('verification').$type<ReceiptVerification>(),
    targetId: text('target_id'),
    targetNumber: text('target_number'),
    error: text('error'),
    actorId: text('actor_id'),
    createdAt: time('created_at').notNull().defaultNow(),
    updatedAt: time('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('receipt_source_unique').on(table.invoiceId, table.sourceKey),
    uniqueIndex('receipt_number_unique').on(table.databaseId, table.number),
    uniqueIndex('receipt_target_unique').on(table.databaseId, table.targetId),
    index('receipt_queue_idx').on(table.status, table.queuedAt),
  ],
);
