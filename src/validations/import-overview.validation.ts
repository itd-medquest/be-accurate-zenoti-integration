import { z } from 'zod';

export const importOverviewQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(10),
    search: z.string().trim().max(100).default(''),
    branch: z.string().max(100).optional(),
    days: z.coerce.number().int().min(1).max(3660).optional(),
    dateFrom: z.iso.date().optional(),
    dateTo: z.iso.date().optional(),
    status: z.enum(['sent', 'draft', 'failed', 'redeem', 'processing']).optional(),
  })
  .refine(({ dateFrom, dateTo }) => !dateFrom || !dateTo || dateFrom <= dateTo, {
    path: ['dateTo'],
    message: 'Tanggal akhir harus sama atau setelah tanggal awal.',
  });

export type ImportOverviewQuery = z.output<typeof importOverviewQuerySchema>;
