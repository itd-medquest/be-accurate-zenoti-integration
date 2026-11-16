import { z } from 'zod';

export const invoiceFiltersSchema = z.object({
  branch: z.string().optional(),
  status: z
    .enum([
      'PENDING',
      'PROCESSING',
      'SYNCED',
      'FAILED',
      'NEEDS_REVIEW',
      'LOCAL_ONLY',
      'LOCAL_ONLY_CONSULTATION',
    ])
    .optional(),
  search: z.string().max(100).optional(),
  days: z.coerce.number().int().min(1).max(366).default(30),
});
export const invoicePagingSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});
export const invoiceListSchema = invoiceFiltersSchema.extend(invoicePagingSchema.shape);
export type InvoiceFilters = z.output<typeof invoiceFiltersSchema>;
export type InvoicePaging = z.output<typeof invoicePagingSchema>;
