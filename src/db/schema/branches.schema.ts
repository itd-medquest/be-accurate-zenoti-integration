import { boolean, pgTable, text } from 'drizzle-orm/pg-core';
export const branches = pgTable('branches', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  centerId: text('center_id').notNull().unique(),
  accurateDatabaseId: text('accurate_database_id').notNull(),
  accurateBranchId: text('accurate_branch_id').notNull(),
  active: boolean('active').notNull().default(true),
});
