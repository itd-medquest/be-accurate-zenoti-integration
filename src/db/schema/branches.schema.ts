import { boolean, mysqlTable, text, varchar } from 'drizzle-orm/mysql-core';
export const branches = mysqlTable('branches', {
  id: varchar('id', { length: 100 }).primaryKey(),
  name: text('name').notNull(),
  centerId: varchar('center_id', { length: 255 }).notNull().unique(),
  accurateDatabaseId: varchar('accurate_database_id', { length: 255 }).notNull(),
  accurateBranchId: varchar('accurate_branch_id', { length: 255 }).notNull(),
  active: boolean('active').notNull().default(true),
});
