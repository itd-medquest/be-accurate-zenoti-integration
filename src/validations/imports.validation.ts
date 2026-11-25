import { z } from 'zod';
import { validUnitPrice } from '../utils/discount.js';
const nominal = z.number().int().min(0).max(2147483647);

export const templateQuerySchema = z.object({ example: z.string().optional() });
export const uploadBodySchema = z.object({ branchId: z.string().min(1).max(100) });
export const listQuerySchema = z.preprocess(
  (value) => {
    if (value && typeof value === 'object' && !('page' in value)) return {};
    return value;
  },
  z.object({
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(50).default(10),
  }),
);
export const previewQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  sheet: z.string().max(100).optional(),
  rowId: z.string().max(100).optional(),
});
export type PreviewQuery = z.output<typeof previewQuerySchema>;
export const reparseBodySchema = z
  .object({ version: z.number().int().positive(), resetReview: z.boolean().optional() })
  .strict();

export const reviewBodySchema = z.object({
  version: z.number().int().positive(),
  businessStatus: z.enum(['OPEN', 'CLOSED']),
});

export const submitBodySchema = z.object({
  version: z.number().int().positive(),
  rowIds: z.array(z.string()).min(1).max(500),
  accountingReviewed: z.literal(true),
});

export const removeBodySchema = z.object({ version: z.number().int().positive() });

export const packageReviewBodySchema = z.object({
  version: z.number().int().positive(),
  parentLineId: z.string().min(1),
  items: z
    .array(
      z
        .object({
          name: z.string().trim().min(1).max(200),
          quantity: z.number().int().min(1).max(10000),
          unitPrice: z
            .number()
            .min(0)
            .max(2147483647)
            .refine(validUnitPrice, 'Harga unit maksimal 6 desimal.'),
          discountPercent: z.number().min(0).max(100).optional(),
          discountAmount: nominal.optional(),
          tax: nominal.optional(),
          taxPercent: z.number().min(0).max(100).optional(),
        })
        .refine(
          (item) => (item.discountAmount === undefined) !== (item.discountPercent === undefined),
          'Pilih diskon persen atau nominal.',
        )
        .refine(
          (item) => (item.tax === undefined) !== (item.taxPercent === undefined),
          'Isi pajak persen atau nominal, pilih satu.',
        ),
    )
    .min(1)
    .max(100),
});

export const reviewedBodySchema = z
  .object({
    version: z.number().int().positive(),
    exceptionReason: z.string().trim().min(10).max(1000).optional(),
  })
  .strict();

export const removeFileBodySchema = z.object({ version: z.number().int().positive() });

export const addItemBodySchema = z
  .object({
    accurateMasterId: z.string().regex(/^\d+$/).max(30).optional(),
    version: z.number().int().positive(),
    name: z.string().trim().min(1).max(200),
    kind: z.enum(['service', 'product']),
    quantity: z.number().int().min(1).max(10000),
    unitPrice: z
      .number()
      .min(0)
      .max(2147483647)
      .refine(validUnitPrice, 'Harga unit maksimal 6 desimal.'),
    discountPercent: z.number().min(0).max(100).optional(),
    discountAmount: nominal.optional(),
    taxPercent: z.number().min(0).max(100),
    reason: z.string().trim().min(5).max(500),
  })
  .strict()
  .refine(
    (item) => (item.discountAmount === undefined) !== (item.discountPercent === undefined),
    'Pilih diskon persen atau nominal.',
  );

export const removeItemBodySchema = z.object({ version: z.number().int().positive() }).strict();

export const correctItemBodySchema = z
  .object({
    version: z.number().int().positive(),
    name: z.string().trim().min(1).max(200),
    quantity: z.number().positive().max(10000),
    unitPrice: z
      .number()
      .min(0)
      .max(2147483647)
      .refine(validUnitPrice, 'Harga unit maksimal 6 desimal.'),
    discountPercent: z.number().min(0).max(100).optional(),
    discountAmount: nominal.optional(),
    tax: nominal.optional(),
    taxPercent: z.number().min(0).max(100).optional(),
    reason: z.string().trim().min(5).max(500),
  })
  .strict()
  .refine(
    (item) => item.discountAmount === undefined || item.discountPercent === undefined,
    'Pilih diskon persen atau nominal.',
  )
  .refine(
    (item) => item.tax === undefined || item.taxPercent === undefined,
    'Isi pajak persen atau nominal, pilih satu.',
  );
