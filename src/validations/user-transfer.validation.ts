import { z } from 'zod';

const id = z.string().min(1).max(100);
const instant = z.coerce.date();
export const loginTransferSchema = z
  .object({
    users: z
      .array(
        z
          .object({
            id,
            name: z.string().min(1),
            email: z.email().max(320),
            emailVerified: z.boolean(),
            image: z.string().nullable(),
            role: z.enum(['super_admin', 'finance', 'viewer']),
            active: z.boolean(),
            createdAt: instant,
            updatedAt: instant,
          })
          .strict(),
      )
      .min(1),
    accounts: z.array(
      z
        .object({
          id,
          accountId: z.string().min(1).max(255),
          providerId: z.literal('credential'),
          userId: id,
          password: z.string().min(1).max(255).nullable(),
          createdAt: instant,
          updatedAt: instant,
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine(({ users, accounts }, context) => {
    const ids = new Set(users.map((row) => row.id));
    if (
      ids.size !== users.length ||
      new Set(users.map((row) => row.email.toLowerCase())).size !== users.length
    )
      context.addIssue({ code: 'custom', message: 'Identitas pengguna duplikat.' });
    if (
      new Set(accounts.map((row) => row.id)).size !== accounts.length ||
      new Set(accounts.map((row) => row.userId)).size !== accounts.length ||
      accounts.some((row) => !ids.has(row.userId))
    )
      context.addIssue({ code: 'custom', message: 'Identitas akun password tidak konsisten.' });
    if (
      !users.some(
        (user) =>
          user.active &&
          user.role === 'super_admin' &&
          accounts.some((account) => account.userId === user.id && account.password),
      )
    )
      context.addIssue({
        code: 'custom',
        message: 'Diperlukan super admin aktif dengan password.',
      });
  });
export const loginTransferEnvelope = z
  .object({ version: z.literal(1), encrypted: z.string().min(1) })
  .strict();
export type LoginTransfer = z.infer<typeof loginTransferSchema>;
