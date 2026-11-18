import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';
import { branches } from '../db/schema/branches.schema.js';

export const companyBootstrapSchema = createInsertSchema(branches)
  .pick({ id: true, name: true, centerId: true })
  .extend({
    id: z.string().trim().min(1).max(100),
    name: z.string().trim().min(2).max(100),
    centerId: z.string().trim().min(1).max(100),
  })
  .strict();
