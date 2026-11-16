import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';
import { branches } from '../db/schema/branches.schema.js';
import { integrationConfigs } from '../db/schema/integration.schema.js';

export const providerParamsSchema = z.object({ provider: z.enum(['zenoti', 'accurate']) });
export const connectionSchema = createInsertSchema(integrationConfigs)
  .pick({ enabled: true })
  .extend({
    enabled: z.boolean(),
    secret: z.string().min(1).max(2000).optional(),
    accurate: z
      .object({
        mode: z.enum(['simulation', 'live']),
        apiToken: z.string().trim().min(1).max(8000).optional(),
        signatureSecret: z.string().trim().min(1).max(2000).optional(),
      })
      .optional(),
  });
export const branchMappingSchema = createInsertSchema(branches)
  .pick({
    name: true,
    accurateDatabaseId: true,
    accurateBranchId: true,
  })
  .extend({
    name: z.string().min(1).max(100),
    accurateDatabaseId: z.string().min(1).max(100),
    accurateBranchId: z.string().min(1).max(100),
  });
export type ConnectionInput = z.output<typeof connectionSchema>;
export type BranchMappingInput = z.output<typeof branchMappingSchema>;
