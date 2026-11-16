import { integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { time } from './columns.js';
import { invoices } from './invoices.schema.js';
export const invoiceSyncs = pgTable(
  'invoice_syncs',
  {
    id: text('id').primaryKey(),
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => invoices.id),
    databaseId: text('database_id').notNull(),
    targetId: text('target_id').notNull(),
    targetNumber: text('target_number').notNull(),
    targetStatus: text('target_status').notNull().default('DRAFT'),
    version: integer('version').notNull(),
    paymentIds: jsonb('payment_ids').$type<string[]>().notNull().default([]),
    syncedAt: time('synced_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('invoice_destination_unique').on(t.invoiceId, t.databaseId)],
);

export const jobs = pgTable('jobs', {
  id: text('id').primaryKey(),
  invoiceId: text('invoice_id')
    .notNull()
    .references(() => invoices.id),
  status: text('status').notNull().default('QUEUED'),
  actorId: text('actor_id'),
  attempts: integer('attempts').notNull().default(0),
  availableAt: time('available_at').notNull().defaultNow(),
  lockedAt: time('locked_at'),
  error: text('error'),
  createdAt: time('created_at').notNull().defaultNow(),
  finishedAt: time('finished_at'),
});

export const syncAttempts = pgTable('sync_attempts', {
  id: text('id').primaryKey(),
  invoiceId: text('invoice_id')
    .notNull()
    .references(() => invoices.id),
  actorId: text('actor_id'),
  status: text('status').notNull(),
  message: text('message').notNull(),
  response: jsonb('response'),
  createdAt: time('created_at').notNull().defaultNow(),
});

export const simulatedDrafts = pgTable(
  'simulated_drafts',
  {
    id: text('id').primaryKey(),
    reference: text('reference').notNull(),
    databaseId: text('database_id').notNull(),
    branchId: text('branch_id').notNull(),
    number: text('number').notNull(),
    total: integer('total').notNull(),
    version: integer('version').notNull(),
    paymentIds: jsonb('payment_ids').$type<string[]>().notNull(),
  },
  (t) => [uniqueIndex('draft_reference_database_unique').on(t.reference, t.databaseId)],
);
