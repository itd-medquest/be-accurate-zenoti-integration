import { randomUUID } from 'node:crypto';
import { create } from '../repositories/audit-logs.repository.js';
export async function audit(
  actorId: string | null,
  action: string,
  entityId?: string,
  details?: unknown,
) {
  await create({ id: randomUUID(), actorId, action, entityId, details });
}
