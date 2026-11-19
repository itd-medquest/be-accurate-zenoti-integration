import { z } from 'zod';

export const auditPageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type AuditPageQuery = z.output<typeof auditPageQuerySchema>;
