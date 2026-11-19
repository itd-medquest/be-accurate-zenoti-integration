import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';
import { branches } from '../db/schema/branches.schema.js';

export const companyCreateSchema = createInsertSchema(branches)
  .pick({ name: true })
  .extend({
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .transform((value) => value.replace(/\s+/g, ' ')),
  })
  .strict();
export const companyParamsSchema = z.object({ id: z.string().min(1).max(100) });
export const companyDeleteSchema = z
  .object({ confirmationName: z.string().trim().min(1).max(100) })
  .strict();
export const companyScopeQuery = z.object({ branchId: z.string().min(1).max(100).optional() });
