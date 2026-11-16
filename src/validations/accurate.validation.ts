import { z } from 'zod';
import { createInsertSchema } from 'drizzle-zod';
import { accurateDestinations } from '../db/schema/accurate.schema.js';
export const masterQuery = z.object({
  kind: z.enum(['customer', 'item', 'branch']),
  search: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export const destinationParams = z.object({ branchId: z.string().min(1).max(100) });
export const destinationInput = createInsertSchema(accurateDestinations)
  .pick({ targetBranchId: true })
  .extend({ targetBranchId: z.string().regex(/^\d+$/).max(30) });
export const mappingParams = z.object({ batchId: z.uuid(), rowId: z.uuid() });
export const mappingInput = z
  .object({
    version: z.number().int().positive(),
    kind: z.enum(['customer', 'item']),
    itemId: z.string().max(200).optional(),
    masterId: z.string().regex(/^\d+$/).max(30),
  })
  .refine((input) => input.kind !== 'item' || !!input.itemId, 'Pilih baris item.');
