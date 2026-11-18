import { index, int, json, mysqlTable, text, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import type { InvoiceItem, InvoicePayment } from '../../types/invoice.types.js';
import { branches } from './branches.schema.js';
import { time, currentTime } from './columns.js';
export const invoices = mysqlTable(
  'invoices',
  {
    id: varchar('id', { length: 100 }).primaryKey(),
    sourceId: varchar('source_id', { length: 255 }).notNull(),
    number: varchar('number', { length: 255 }).notNull(),
    branchId: varchar('branch_id', { length: 100 })
      .notNull()
      .references(() => branches.id),
    customer: text('customer').notNull(),
    customerId: varchar('customer_id', { length: 255 }).notNull(),
    date: time('date').notNull(),
    dueDate: time('due_date'),
    businessStatus: varchar('business_status', { length: 255 }).notNull(),
    paymentStatus: varchar('payment_status', { length: 255 }).notNull(),
    syncStatus: varchar('sync_status', { length: 255 }).notNull().default('PENDING'),
    total: int('total').notNull(),
    outstanding: int('outstanding').notNull(),
    discount: int('discount').notNull().default(0),
    tax: int('tax').notNull().default(0),
    items: json('items').$type<InvoiceItem[]>().notNull(),
    payments: json('payments').$type<InvoicePayment[]>().notNull(),
    exception: varchar('exception', { length: 255 }),
    error: text('error'),
    version: int('version').notNull().default(1),
    sourceHash: varchar('source_hash', { length: 255 }),
    createdAt: time('created_at').notNull().default(currentTime),
    updatedAt: time('updated_at').notNull().default(currentTime),
  },
  (t) => [
    uniqueIndex('invoice_source_branch_unique').on(t.sourceId, t.branchId),
    index('invoice_date_status_idx').on(t.date, t.syncStatus),
  ],
);
