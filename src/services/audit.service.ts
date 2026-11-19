import { randomUUID } from 'node:crypto';
import { countAll, create, listPage } from '../repositories/audit-logs.repository.js';
import type { AuditPageQuery } from '../validations/audit.validation.js';

export async function listAuditPage(query: AuditPageQuery) {
  const total = await countAll();
  const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
  const items = await listPage(page, query.pageSize);
  return { items, total, page, pageSize: query.pageSize };
}
export async function audit(
  actorId: string | null,
  action: string,
  entityId?: string,
  details?: unknown,
) {
  await create({ id: randomUUID(), actorId, action, entityId, details });
}
