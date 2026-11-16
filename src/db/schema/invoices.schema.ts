import { index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import type { InvoiceItem, InvoicePayment } from '../../types/invoice.types.js';
import { branches } from './branches.schema.js';
import { time } from './columns.js';
export const invoices = pgTable(
  'invoices',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id').notNull(),
    number: text('number').notNull(),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    customer: text('customer').notNull(),
    customerId: text('customer_id').notNull(),
    date: time('date').notNull(),
    dueDate: time('due_date'),
    businessStatus: text('business_status').notNull(),
    paymentStatus: text('payment_status').notNull(),
    syncStatus: text('sync_status').notNull().default('PENDING'),
    total: integer('total').notNull(),
    outstanding: integer('outstanding').notNull(),
    discount: integer('discount').notNull().default(0),
    tax: integer('tax').notNull().default(0),
    items: jsonb('items').$type<InvoiceItem[]>().notNull(),
    payments: jsonb('payments').$type<InvoicePayment[]>().notNull(),
    exception: text('exception'),
    error: text('error'),
    version: integer('version').notNull().default(1),
    sourceHash: text('source_hash'),
    createdAt: time('created_at').notNull().defaultNow(),
    updatedAt: time('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('invoice_source_branch_unique').on(t.sourceId, t.branchId),
    index('invoice_date_status_idx').on(t.date, t.syncStatus),
  ],
);
