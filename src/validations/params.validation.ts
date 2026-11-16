import { z } from 'zod';

export const idParamsSchema = z.object({ id: z.string().min(1) });
export const rowParamsSchema = idParamsSchema.extend({ rowId: z.string().min(1) });
export const fileParamsSchema = idParamsSchema.extend({ fileId: z.string().min(1) });
export const itemParamsSchema = rowParamsSchema.extend({ itemId: z.string().min(1) });
