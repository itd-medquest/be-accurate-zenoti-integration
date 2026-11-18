import { json, mysqlTable, text, uniqueIndex, int, varchar } from 'drizzle-orm/mysql-core';
import { branches } from './branches.schema.js';
import { invoices } from './invoices.schema.js';
import { time, currentTime } from './columns.js';
import type { AccuratePayload } from '../../types/accurate.types.js';

// Separate live destinations preserve the destination of existing simulation invoices.
export const accurateDestinations = mysqlTable('accurate_destinations', {
  branchId: varchar('branch_id', { length: 100 })
    .primaryKey()
    .references(() => branches.id),
  databaseId: varchar('database_id', { length: 255 }).notNull(),
  databaseName: varchar('database_name', { length: 255 }).notNull(),
  targetBranchId: varchar('target_branch_id', { length: 255 }).notNull(),
  targetBranchName: varchar('target_branch_name', { length: 255 }).notNull(),
  updatedAt: time('updated_at').notNull().default(currentTime),
});
export const accurateMappings = mysqlTable(
  'accurate_mappings',
  {
    id: varchar('id', { length: 100 }).primaryKey(),
    branchId: varchar('branch_id', { length: 100 })
      .notNull()
      .references(() => branches.id),
    databaseId: varchar('database_id', { length: 255 }).notNull(),
    kind: varchar('kind', { length: 64 }).notNull(),
    sourceKey: varchar('source_key', { length: 64 }).notNull(),
    targetId: varchar('target_id', { length: 255 }).notNull(),
    targetCode: varchar('target_code', { length: 255 }).notNull(),
    targetName: varchar('target_name', { length: 255 }).notNull(),
    unitName: varchar('unit_name', { length: 255 }).notNull().default(''),
    itemType: varchar('item_type', { length: 255 }).notNull().default(''),
    updatedAt: time('updated_at').notNull().default(currentTime),
  },
  (t) => [
    uniqueIndex('accurate_mapping_source_unique').on(t.branchId, t.databaseId, t.kind, t.sourceKey),
  ],
);
export const accurateDeliveries = mysqlTable(
  'accurate_deliveries',
  {
    invoiceId: varchar('invoice_id', { length: 100 })
      .primaryKey()
      .references(() => invoices.id),
    branchId: varchar('branch_id', { length: 100 })
      .notNull()
      .references(() => branches.id),
    databaseId: varchar('database_id', { length: 255 }).notNull(),
    targetBranchId: varchar('target_branch_id', { length: 255 }).notNull(),
    sourceVersion: int('source_version').notNull(),
    requestedNumber: varchar('requested_number', { length: 255 }).notNull(),
    payload: json('payload').$type<AccuratePayload>().notNull(),
    expectedTotal: int('expected_total').notNull(),
    status: varchar('status', { length: 255 }).notNull().default('PENDING'),
    attemptedAt: time('attempted_at'),
    targetId: varchar('target_id', { length: 255 }),
    targetNumber: varchar('target_number', { length: 255 }),
    createdAt: time('created_at').notNull().default(currentTime),
    updatedAt: time('updated_at').notNull().default(currentTime),
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
