import { z } from 'zod';

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const requestResetSchema = z.object({ email }).strict();
export const verifyResetSchema = z.object({ email, otp: z.string().regex(/^\d{6}$/) }).strict();
export const completeResetSchema = z.object({
  email,
  resetToken: z.string().regex(/^[a-f0-9]{64}$/),
  newPassword: z.string().min(12).max(128),
}).strict();

// Versioned private payload; no OTP, email, password, or reset token is stored in plaintext.
export const resetStateSchema = z.object({
  version: z.literal(1),
  phase: z.enum(['otp', 'verified', 'consumed']),
  requestedAt: z.number(),
  nonce: z.string(),
  secretHash: z.string(),
  attempts: z.number().int().nonnegative(),
  userId: z.string().nullable(),
  credentialFingerprint: z.string(),
});
export type ResetState = z.infer<typeof resetStateSchema>;
