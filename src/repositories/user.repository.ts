import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { user, applicationLocks } from '../db/schema/index.js';
import type { DbExecutor } from './unit-of-work.repository.js';

/** Serialize first-admin bootstrap with other user writes, including another bootstrap. */
export async function lockForBootstrap(context: DbExecutor) {
  const rows = await context
    .select()
    .from(applicationLocks)
    .where(eq(applicationLocks.name, 'users'))
    .for('update');
  if (!rows.length) throw new Error('Jalankan migration untuk menyiapkan penguncian akun.');
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
  return context.select().from(user).where(inArray(user.id, ids)).orderBy(user.id).for('update');
}
export function deleteById(id: string, context: DbExecutor = db) {
  // Existing foreign keys cascade credential accounts and sessions, never invoice history.
  return context.delete(user).where(eq(user.id, id));
}
export async function create(data: typeof user.$inferInsert, context: DbExecutor = db) {
  if (context !== db) await lockForBootstrap(context);
  return context.insert(user).values(data);
}
export async function updateById(
  changes: Partial<typeof user.$inferInsert>,
  id: string,
  context: DbExecutor = db,
) {
  await context.update(user).set(changes).where(eq(user.id, id));
  return context.select().from(user).where(eq(user.id, id));
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
