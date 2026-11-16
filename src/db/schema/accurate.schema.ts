import { jsonb, pgTable, text, uniqueIndex, integer } from 'drizzle-orm/pg-core';
import { branches } from './branches.schema.js';
import { invoices } from './invoices.schema.js';
import { time } from './columns.js';
import type { AccuratePayload } from '../../types/accurate.types.js';

// Separate live destinations preserve the destination of existing simulation invoices.
export const accurateDestinations = pgTable('accurate_destinations', {
  branchId: text('branch_id')
    .primaryKey()
    .references(() => branches.id),
  databaseId: text('database_id').notNull(),
  databaseName: text('database_name').notNull(),
  targetBranchId: text('target_branch_id').notNull(),
  targetBranchName: text('target_branch_name').notNull(),
  updatedAt: time('updated_at').notNull().defaultNow(),
});
export const accurateMappings = pgTable(
  'accurate_mappings',
  {
    id: text('id').primaryKey(),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    databaseId: text('database_id').notNull(),
    kind: text('kind').notNull(),
    sourceKey: text('source_key').notNull(),
    targetId: text('target_id').notNull(),
    targetCode: text('target_code').notNull(),
    targetName: text('target_name').notNull(),
    unitName: text('unit_name').notNull().default(''),
    itemType: text('item_type').notNull().default(''),
    updatedAt: time('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('accurate_mapping_source_unique').on(t.branchId, t.databaseId, t.kind, t.sourceKey),
  ],
);
export const accurateDeliveries = pgTable(
  'accurate_deliveries',
  {
    invoiceId: text('invoice_id')
      .primaryKey()
      .references(() => invoices.id),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    databaseId: text('database_id').notNull(),
    targetBranchId: text('target_branch_id').notNull(),
    sourceVersion: integer('source_version').notNull(),
    requestedNumber: text('requested_number').notNull(),
    payload: jsonb('payload').$type<AccuratePayload>().notNull(),
    expectedTotal: integer('expected_total').notNull(),
    status: text('status').notNull().default('PENDING'),
    attemptedAt: time('attempted_at'),
    targetId: text('target_id'),
    targetNumber: text('target_number'),
    createdAt: time('created_at').notNull().defaultNow(),
    updatedAt: time('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('accurate_delivery_number_unique').on(
      t.databaseId,
      t.targetBranchId,
      t.targetNumber,
    ),
    uniqueIndex('accurate_delivery_requested_unique').on(t.databaseId, t.requestedNumber),
  ],
);
