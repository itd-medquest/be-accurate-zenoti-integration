import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { verification } from '../db/schema/index.js';
import type { ResetState } from '../validations/password-reset.validation.js';
import type { DbExecutor } from './unit-of-work.repository.js';

export async function lockSlot(id: string, context: DbExecutor) {
  // A deterministic slot serializes concurrent requests, even before the first OTP exists.
  await context
    .insert(verification)
    .values({ id, identifier: id, value: '{}', expiresAt: new Date(0) })
    .onDuplicateKeyUpdate({ set: { id: sql`${verification.id}` } });
  const [row] = await context
    .select()
    .from(verification)
    .where(eq(verification.id, id))
    .for('update');
  if (!row) throw new Error('Verification slot unavailable.');
  return row;
}

export function find(id: string, context: DbExecutor = db) {
  return context.query.verification.findFirst({ where: eq(verification.id, id) });
}

export function save(id: string, state: ResetState, expiresAt: Date, context: DbExecutor) {
  return context
    .update(verification)
    .set({ value: JSON.stringify(state), expiresAt, updatedAt: new Date() })
    .where(eq(verification.id, id));
}
