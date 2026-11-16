import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import type { z } from 'zod';
import { config } from '../config/env.js';
import * as accounts from '../repositories/account.repository.js';
import * as audit from '../repositories/audit-logs.repository.js';
import * as resets from '../repositories/password-reset.repository.js';
import * as sessions from '../repositories/session.repository.js';
import * as users from '../repositories/user.repository.js';
import { withTransaction, type DbExecutor } from '../repositories/unit-of-work.repository.js';
import { HttpError } from '../utils/http-error.js';
import { completeResetSchema, resetStateSchema, type ResetState, verifyResetSchema } from '../validations/password-reset.validation.js';
import { queuePasswordResetEmail } from './password-reset-email.service.js';

const LIFETIME = 5 * 60_000;
const COOLDOWN = 60_000;
const INVALID = 'Kode tidak valid atau sudah kedaluwarsa. Minta kode baru jika diperlukan.';
const INVALID_GRANT = 'Sesi pemulihan tidak valid atau sudah kedaluwarsa. Minta kode baru.';
const genericResponse = {
  message: 'Jika email terdaftar dan aktif, kode OTP akan dikirim. Periksa inbox dan folder spam.',
  retryAfter: 60,
};
function digest(value: string) {
  return createHmac('sha256', config.BETTER_AUTH_SECRET).update(value).digest('hex');
}
function slot(email: string) { return `intgrte-password-reset:${digest(`email:${email}`)}`; }
function matches(left: string, right: string) {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === 32 && b.length === 32 && timingSafeEqual(a, b);
}
function read(value: string): ResetState | undefined {
  try {
    const result = resetStateSchema.safeParse(JSON.parse(value));
    return result.success ? result.data : undefined;
  } catch { return undefined; }
}
async function currentCredential(state: ResetState, context: DbExecutor) {
  if (!state.userId) return undefined;
  const user = await users.findById(state.userId, context);
  const account = await accounts.findCredential(state.userId, context);
  return user?.active && account?.password &&
    matches(state.credentialFingerprint, digest(`credential:${account.password}`)) ? account : undefined;
}

export async function requestReset(email: string) {
  if (!config.RESEND_API_KEY.trim())
    throw new HttpError(503, 'Layanan email pemulihan belum dikonfigurasi. Hubungi administrator.');
  const id = slot(email);
  const otp = randomInt(0, 1_000_000).toString().padStart(6, '0');
  const nonce = randomBytes(24).toString('hex');
  const recipient = await withTransaction(async (context) => {
    const row = await resets.lockSlot(id, context);
    const previous = read(row.value);
    const now = Date.now();
    if (previous && now - previous.requestedAt < COOLDOWN) return undefined;
    const user = await users.findByEmail(email, context);
    const account = user?.active ? await accounts.findCredential(user.id, context) : undefined;
    const eligible = user?.active && !!account?.password;
    await resets.save(id, {
      version: 1, phase: 'otp', requestedAt: now, nonce,
      secretHash: digest(`otp:${nonce}:${otp}`), attempts: 0,
      userId: eligible ? user.id : null,
      credentialFingerprint: account?.password ? digest(`credential:${account.password}`) : '',
    }, new Date(now + LIFETIME), context);
    return eligible ? email : undefined;
  });
  if (recipient) queuePasswordResetEmail(recipient, otp, nonce);
  return genericResponse;
}

export async function verifyReset(input: z.infer<typeof verifyResetSchema>) {
  const id = slot(input.email);
  const result = await withTransaction(async (context) => {
    const row = await resets.lockSlot(id, context);
    const state = read(row.value);
    if (!state || state.phase !== 'otp' || row.expiresAt.getTime() <= Date.now() || state.attempts >= 5)
      return undefined;
    if (!matches(state.secretHash, digest(`otp:${state.nonce}:${input.otp}`)) || !await currentCredential(state, context)) {
      await resets.save(id, { ...state, attempts: state.attempts + 1 }, row.expiresAt, context);
      return undefined;
    }
    const resetToken = randomBytes(32).toString('hex');
    await resets.save(id, { ...state, phase: 'verified', secretHash: digest(`grant:${resetToken}`) }, new Date(Date.now() + LIFETIME), context);
    return { resetToken, expiresIn: LIFETIME / 1000 };
  });
  // Throw outside the transaction so failed attempt counters are committed.
  if (!result) throw new HttpError(400, INVALID);
  return result;
}

export async function completeReset(input: z.infer<typeof completeResetSchema>) {
  const id = slot(input.email);
  const grantHash = digest(`grant:${input.resetToken}`);
  const preliminary = await resets.find(id);
  const preliminaryState = preliminary && read(preliminary.value);
  if (!preliminaryState || preliminaryState.phase !== 'verified' ||
      !matches(preliminaryState.secretHash, grantHash) || preliminary.expiresAt.getTime() <= Date.now())
    throw new HttpError(400, INVALID_GRANT);
  // Reject unauthenticated grants before the deliberately expensive password hash.
  const password = await hashPassword(input.newPassword);
  await withTransaction(async (context) => {
    const row = await resets.lockSlot(id, context);
    const state = read(row.value);
    if (!state?.userId || state.phase !== 'verified' || row.expiresAt.getTime() <= Date.now() || !matches(state.secretHash, grantHash))
      throw new HttpError(400, INVALID_GRANT);
    await users.lockByIds([state.userId], context);
    const account = await currentCredential(state, context);
    if (!account?.password) throw new HttpError(400, INVALID_GRANT);
    const changed = await accounts.replacePassword(account.id, account.password, password, context);
    if (!changed.length) throw new HttpError(400, INVALID_GRANT);
    await sessions.deleteForUser(state.userId, context);
    await audit.create({ id: randomUUID(), actorId: state.userId, entityId: state.userId,
      action: 'password.reset', details: { channel: 'email-otp' } }, context);
    await resets.save(id, { ...state, phase: 'consumed', secretHash: '' }, new Date(0), context);
  });
  return { message: 'Password berhasil diperbarui. Silakan masuk dengan password baru.' };
}
