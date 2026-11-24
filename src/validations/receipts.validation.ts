import { z } from 'zod';
import { createInsertSchema } from 'drizzle-zod';
import { accurateReceipts, receiptAccountMappings } from '../db/schema/receipts.schema.js';
import { receiptBanks, receiptMethods } from '../types/receipt.types.js';

export const receiptReferenceQuery = z
  .object({
    number: z.string().trim().min(1).max(100),
    branchId: z.string().min(1).max(100).optional(),
  })
  .strict();

const date = z.iso.date();
export const receiptFilters = z
  .object({
    search: z.string().trim().max(100).default(''),
    branch: z.string().max(100).default(''),
    status: z
      .enum([
        '',
        'TO_REVIEW',
        'DRAFT',
        'PROCESSING',
        'QUEUED',
        'SENDING',
        'SUCCEEDED',
        'NEEDS_REVIEW',
      ])
      .default(''),
    from: date.optional(),
    to: date.optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .pipe(z.union([z.literal(10), z.literal(25), z.literal(50)]))
      .default(25),
  })
  .refine(
    (value) => !value.from || !value.to || value.from <= value.to,
    'Rentang tanggal tidak valid.',
  );
export const receiptAccountQuery = z.object({
  branchId: z.string().min(1).max(100).optional(),
  kind: z.enum(['bank', 'fee']),
  search: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export const receiptMappingInput = createInsertSchema(receiptAccountMappings)
  .pick({ branchId: true, bank: true, method: true, accountId: true, feeAccountId: true })
  .extend({
    branchId: z.string().min(1).max(100),
    bank: z.enum(receiptBanks),
    method: z.enum(receiptMethods),
    accountId: z.string().regex(/^\d+$/).max(30),
    feeAccountId: z.string().regex(/^\d+$/).max(30).nullable(),
    version: z.number().int().nonnegative(),
  })
  .strict();
export const receiptPrepareInput = z
  .object({ invoiceId: z.uuid(), sourceKey: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
export const receiptIdParams = z.object({ id: z.uuid() });
export const receiptDraftInput = createInsertSchema(accurateReceipts)
  .pick({ mappingId: true, paymentDate: true, paymentReference: true, notes: true })
  .extend({
    mappingId: z.uuid(),
    mappingVersion: z.number().int().positive(),
    paymentDate: date,
    paymentReference: z.string().trim().min(1).max(100),
    notes: z.string().trim().max(500),
    receiptNumber: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine((value) => !/^0+$/.test(value), 'Nomor receipt tidak boleh 0.')
      .refine(
        (value) => !/[\u0000-\u001f\u007f]/.test(value) && !value.startsWith('INT-PENDING-RC-'),
        'Nomor receipt tidak valid.',
      )
      .optional(),
    version: z.number().int().positive(),
  })
  .strict();
export const receiptSubmitInput = z
  .object({ version: z.number().int().positive(), confirmed: z.literal(true) })
  .strict();
export const receiptCheckInput = z.object({}).strict();
export const receiptReopenInput = z.object({ version: z.number().int().positive() }).strict();
