import { int, json, mysqlTable, text, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { time, currentTime } from './columns.js';
import { invoices } from './invoices.schema.js';
export const invoiceSyncs = mysqlTable(
  'invoice_syncs',
  {
    id: varchar('id', { length: 100 }).primaryKey(),
    invoiceId: varchar('invoice_id', { length: 100 })
      .notNull()
      .references(() => invoices.id),
    databaseId: varchar('database_id', { length: 255 }).notNull(),
    targetId: varchar('target_id', { length: 255 }).notNull(),
    targetNumber: varchar('target_number', { length: 255 }).notNull(),
    targetStatus: varchar('target_status', { length: 255 }).notNull().default('DRAFT'),
    version: int('version').notNull(),
    paymentIds: json('payment_ids')
      .$type<string[]>()
      .notNull()
      .$defaultFn(() => []),
    syncedAt: time('synced_at').notNull().default(currentTime),
  },
  (t) => [uniqueIndex('invoice_destination_unique').on(t.invoiceId, t.databaseId)],
);

export const jobs = mysqlTable('jobs', {
  id: varchar('id', { length: 100 }).primaryKey(),
  invoiceId: varchar('invoice_id', { length: 100 })
    .notNull()
    .references(() => invoices.id),
  status: varchar('status', { length: 255 }).notNull().default('QUEUED'),
  actorId: varchar('actor_id', { length: 100 }),
  attempts: int('attempts').notNull().default(0),
  availableAt: time('available_at').notNull().default(currentTime),
  lockedAt: time('locked_at'),
  error: text('error'),
  createdAt: time('created_at').notNull().default(currentTime),
  finishedAt: time('finished_at'),
});

export const syncAttempts = mysqlTable('sync_attempts', {
  id: varchar('id', { length: 100 }).primaryKey(),
  invoiceId: varchar('invoice_id', { length: 100 })
    .notNull()
    .references(() => invoices.id),
  actorId: varchar('actor_id', { length: 100 }),
  status: varchar('status', { length: 255 }).notNull(),
  message: text('message').notNull(),
  response: json('response'),
  createdAt: time('created_at').notNull().default(currentTime),
});

export const simulatedDrafts = mysqlTable(
  'simulated_drafts',
  {
    id: varchar('id', { length: 100 }).primaryKey(),
    reference: varchar('reference', { length: 255 }).notNull(),
    databaseId: varchar('database_id', { length: 255 }).notNull(),
    branchId: varchar('branch_id', { length: 100 }).notNull(),
    number: varchar('number', { length: 255 }).notNull(),
    total: int('total').notNull(),
    version: int('version').notNull(),
    paymentIds: json('payment_ids').$type<string[]>().notNull(),
  },
  (t) => [uniqueIndex('draft_reference_database_unique').on(t.reference, t.databaseId)],
);
