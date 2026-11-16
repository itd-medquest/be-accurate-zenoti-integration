import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { simulatedDrafts } from '../db/schema/index.js';
import type { DbExecutor } from './unit-of-work.repository.js';

export function findByReference(reference: string, databaseId: string, context: DbExecutor = db) {
  return context.query.simulatedDrafts.findFirst({
    where: and(
      eq(simulatedDrafts.reference, reference),
      eq(simulatedDrafts.databaseId, databaseId),
    ),
  });
}

export function upsert(
  data: typeof simulatedDrafts.$inferInsert,
  changes: Partial<typeof simulatedDrafts.$inferInsert>,
  context: DbExecutor = db,
) {
  return context
    .insert(simulatedDrafts)
    .values(data)
    .onConflictDoUpdate({
      target: [simulatedDrafts.reference, simulatedDrafts.databaseId],
      set: changes,
    })
    .returning();
}
