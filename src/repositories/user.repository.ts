import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { user } from '../db/schema/index.js';
import type { DbExecutor, DbTransaction } from './unit-of-work.repository.js';

/** Serialize first-admin bootstrap with other user writes, including another bootstrap. */
export function lockForBootstrap(context: DbTransaction) {
  return context.execute(sql`LOCK TABLE ${user} IN EXCLUSIVE MODE`);
}
export function findAny(context: DbExecutor = db) {
  return context.query.user.findFirst();
}

export function findById(id: string, context: DbExecutor = db) {
  return context.query.user.findFirst({ where: eq(user.id, id) });
}
export function findByEmail(email: string, context: DbExecutor = db) {
  return context.query.user.findFirst({ where: eq(user.email, email) });
}
/** Stable ordering prevents opposing admin actions from acquiring locks in reverse order. */
export function lockByIds(ids: string[], context: DbExecutor = db) {
  return context
    .select()
    .from(user)
    .where(inArray(user.id, ids))
    .orderBy(user.id)
    .for('update');
}
export function deleteById(id: string, context: DbExecutor = db) {
  // Existing foreign keys cascade credential accounts and sessions, never invoice history.
  return context.delete(user).where(eq(user.id, id));
}
export function create(data: typeof user.$inferInsert, context: DbExecutor = db) {
  return context.insert(user).values(data);
}
export function updateById(
  changes: Partial<typeof user.$inferInsert>,
  id: string,
  context: DbExecutor = db,
) {
  return context.update(user).set(changes).where(eq(user.id, id)).returning();
}
export function listPublic(context: DbExecutor = db) {
  return context
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      active: user.active,
      createdAt: user.createdAt,
    })
    .from(user)
    .orderBy(user.name);
}
