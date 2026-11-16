import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

process.env.DATABASE_URL = 'pglite:memory://';
process.env.BETTER_AUTH_SECRET = randomBytes(32).toString('hex');
process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
process.env.RUN_WORKER = 'false';
process.env.INTEGRATION_MODE = 'simulation';
process.env.RESEND_API_KEY = randomBytes(24).toString('hex');
process.env.RESEND_FROM = 'intgrte <onboarding@resend.dev>';
process.env.FRONTEND_URL = 'http://localhost:3000';
const { app } = await import('../src/app.js');
const { db, closeDb } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrate.js');
const { account, user, session, verification, auditLogs } = await import('../src/db/schema/index.js');
const { requestReset, verifyReset, completeReset } = await import('../src/services/password-reset.service.js');
const { drainPasswordResetEmails } = await import('../src/services/password-reset-email.service.js');
const { resetStateSchema } = await import('../src/validations/password-reset.validation.js');
const { config } = await import('../src/config/env.js');
const { hashPassword, verifyPassword } = await import('better-auth/crypto');
const { eq } = await import('drizzle-orm');
const initialPassword = randomBytes(24).toString('hex');
const initialHash = await hashPassword(initialPassword);
const mail = new Map<string, string[]>();
let failDelivery = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url === 'https://api.resend.com/emails') {
    if (failDelivery) return new Response('{}', { status: 503 });
    const payload = JSON.parse(String(init?.body));
    const otp = String(payload.text).match(/\b\d{6}\b/)?.[0];
    assert.ok(!!otp, 'Mock email must contain an OTP');
    assert.equal(payload.from, 'intgrte <onboarding@resend.dev>');
    const recipient: string = payload.to[0];
    mail.set(recipient, [...(mail.get(recipient) ?? []), otp!]);
    return Response.json({ id: randomUUID() });
  }
  if (!url.startsWith('http://127.0.0.1:')) throw new Error('Unexpected external request in test');
  return realFetch(input, init);
};
let server: Server;
let base: string;
before(async () => {
  await migrate();
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  base = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  await drainPasswordResetEmails();
  globalThis.fetch = realFetch;
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeDb();
});
async function fixture(active = true) {
  const id = randomUUID();
  const email = `${id}@example.test`;
  await db.insert(user).values({ id, email, name: 'Recovery fixture', active });
  await db.insert(account).values({ id: randomUUID(), accountId: id, providerId: 'credential', userId: id, password: initialHash });
  return { id, email };
}
async function latestCode(email: string) {
  await drainPasswordResetEmails();
  const codes = mail.get(email);
  assert.ok(!!codes?.length, 'Expected mocked delivery');
  return codes![codes!.length - 1];
}
async function record(userId: string) {
  const rows = await db.select().from(verification);
  const row = rows.find((row) => resetStateSchema.safeParse(JSON.parse(row.value)).data?.userId === userId);
  if (!row) throw new Error('Missing challenge');
  return { ...row, state: resetStateSchema.parse(JSON.parse(row.value)) };
}
async function allowResend(userId: string) {
  const row = await record(userId);
  await db.update(verification).set({ value: JSON.stringify({ ...row.state, requestedAt: Date.now() - 61_000 }) }).where(eq(verification.id, row.id));
}
async function grant(email: string) {
  await requestReset(email);
  return verifyReset({ email, otp: await latestCode(email) });
}
async function http(path: string, body: unknown, origin = 'http://localhost:3000') {
  return fetch(`${base}/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
}

test('HTTP recovery updates the credential, revokes existing sessions and audits without secrets', async () => {
  const target = await fixture();
  const login = await http('/auth/sign-in/email', { email: target.email, password: initialPassword });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().map((entry) => entry.split(';')[0]).join('; ');
  const requested = await http('/password-reset/request', { email: ` ${target.email.toUpperCase()} ` });
  assert.equal(requested.status, 200);
  const code = await latestCode(target.email);
  const row = await record(target.id);
  assert.ok(!row.value.includes(code), 'OTP must be hashed at rest');
  const verified = await http('/password-reset/verify', { email: target.email, otp: code });
  assert.equal(verified.status, 200);
  const { resetToken } = await verified.json();
  assert.ok(!(await record(target.id)).value.includes(resetToken), 'Grant must be hashed at rest');
  const newPassword = randomBytes(24).toString('hex');
  const completed = await http('/password-reset/complete', { email: target.email, resetToken, newPassword });
  assert.equal(completed.status, 200);
  const credential = await db.query.account.findFirst({ where: eq(account.userId, target.id) });
  assert.ok(await verifyPassword({ hash: credential!.password!, password: newPassword }));
  assert.ok(!await verifyPassword({ hash: credential!.password!, password: initialPassword }));
  assert.equal((await db.select().from(session).where(eq(session.userId, target.id))).length, 0);
  assert.equal((await fetch(`${base}/api/dashboard`, { headers: { Cookie: cookie } })).status, 401);
  assert.equal((await http('/auth/sign-in/email', { email: target.email, password: newPassword })).status, 200);
  const events = await db.select().from(auditLogs).where(eq(auditLogs.actorId, target.id));
  assert.equal(events.filter((event) => event.action === 'password.reset').length, 1);
  assert.ok(!JSON.stringify(events).includes(resetToken) && !JSON.stringify(events).includes(newPassword));
  await assert.rejects(completeReset({ email: target.email, resetToken, newPassword }), /tidak valid/);
});

test('unknown and inactive accounts receive the same response without sending email or creating users', async () => {
  const active = await fixture();
  const inactive = await fixture(false);
  const unknown = `${randomUUID()}@example.test`;
  const result = await requestReset(active.email);
  assert.deepEqual(await requestReset(inactive.email), result);
  assert.deepEqual(await requestReset(unknown), result);
  await drainPasswordResetEmails();
  assert.equal(mail.has(inactive.email), false);
  assert.equal(mail.has(unknown), false);
  assert.equal(await db.query.user.findFirst({ where: eq(user.email, unknown) }), undefined);
});

test('concurrent requests and resend cooldown send one OTP; resend invalidates the previous grant', async () => {
  const target = await fixture();
  await Promise.all([requestReset(target.email), requestReset(target.email), requestReset(target.email)]);
  const firstCode = await latestCode(target.email);
  assert.equal(mail.get(target.email)?.length, 1);
  const first = await verifyReset({ email: target.email, otp: firstCode });
  await requestReset(target.email);
  await drainPasswordResetEmails();
  assert.equal(mail.get(target.email)?.length, 1);
  await allowResend(target.id);
  await requestReset(target.email);
  await latestCode(target.email);
  assert.equal(mail.get(target.email)?.length, 2);
  await assert.rejects(completeReset({ email: target.email, resetToken: first.resetToken, newPassword: initialPassword }), /tidak valid/);
});

test('five wrong attempts persist and lock the OTP, including the correct code afterwards', async () => {
  const target = await fixture();
  await requestReset(target.email);
  const otp = await latestCode(target.email);
  const wrong = otp === '000000' ? '000001' : '000000';
  for (let index = 0; index < 5; index++) await assert.rejects(verifyReset({ email: target.email, otp: wrong }), /tidak valid/);
  assert.equal((await record(target.id)).state.attempts, 5);
  await assert.rejects(verifyReset({ email: target.email, otp }), /tidak valid/);
});

test('expired OTP, wrong email, consumed OTP and expired grant are rejected', async () => {
  const target = await fixture();
  await requestReset(target.email);
  const otp = await latestCode(target.email);
  await assert.rejects(verifyReset({ email: `${randomUUID()}@example.test`, otp }), /tidak valid/);
  const row = await record(target.id);
  await db.update(verification).set({ expiresAt: new Date(0) }).where(eq(verification.id, row.id));
  await assert.rejects(verifyReset({ email: target.email, otp }), /tidak valid/);
  await allowResend(target.id);
  const { resetToken } = await grant(target.email);
  await assert.rejects(verifyReset({ email: target.email, otp: await latestCode(target.email) }), /tidak valid/);
  await db.update(verification).set({ expiresAt: new Date(0) }).where(eq(verification.id, row.id));
  await assert.rejects(completeReset({ email: target.email, resetToken, newPassword: initialPassword }), /tidak valid/);
});

test('disabled users and credentials changed after OTP issuance cannot recover with the stale grant', async () => {
  for (const change of ['disable', 'password'] as const) {
    const target = await fixture();
    const { resetToken } = await grant(target.email);
    if (change === 'disable') await db.update(user).set({ active: false }).where(eq(user.id, target.id));
    else await db.update(account).set({ password: await hashPassword(randomBytes(24).toString('hex')) }).where(eq(account.userId, target.id));
    await assert.rejects(completeReset({ email: target.email, resetToken, newPassword: initialPassword }), /tidak valid/);
    assert.equal((await record(target.id)).state.phase, 'verified');
  }
});

test('concurrent completion consumes the grant and writes exactly one audit event', async () => {
  const target = await fixture();
  const { resetToken } = await grant(target.email);
  const results = await Promise.allSettled([1, 2].map(() => completeReset({ email: target.email, resetToken, newPassword: randomBytes(24).toString('hex') })));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal((await record(target.id)).state.phase, 'consumed');
  assert.equal((await db.select().from(auditLogs).where(eq(auditLogs.actorId, target.id))).length, 1);
});

test('public endpoints validate inputs, protect origins and report missing global email configuration', async () => {
  assert.equal((await http('/password-reset/request', { email: 'invalid' })).status, 400);
  assert.equal((await http('/password-reset/verify', { email: 'unknown@example.test', otp: 'abc' })).status, 400);
  assert.equal((await http('/password-reset/complete', { email: 'unknown@example.test', resetToken: randomBytes(32).toString('hex'), newPassword: 'short' })).status, 400);
  assert.equal((await http('/password-reset/request', { email: 'unknown@example.test' }, 'https://foreign.test')).status, 403);
  const previous = config.RESEND_API_KEY;
  config.RESEND_API_KEY = '';
  try { await assert.rejects(requestReset('unknown@example.test'), /belum dikonfigurasi/); }
  finally { config.RESEND_API_KEY = previous; }
});

test('provider failure does not leak account existence, recipient or OTP in the response or logs', async () => {
  const target = await fixture();
  const events: unknown[][] = [];
  const previous = console.error;
  console.error = (...args: unknown[]) => { events.push(args); };
  failDelivery = true;
  try {
    const known = await requestReset(target.email);
    const unknown = await requestReset(`${randomUUID()}@example.test`);
    await drainPasswordResetEmails();
    assert.deepEqual(known, unknown);
    assert.equal(mail.has(target.email), false);
    assert.ok(!JSON.stringify(events).includes(target.email));
    assert.equal(events.length, 1);
  } finally { failDelivery = false; console.error = previous; }
});

test('per-IP request throttling returns a clear error', async () => {
  const statuses: number[] = [];
  for (let index = 0; index < 6; index++) statuses.push((await http('/password-reset/request', { email: `${randomUUID()}@example.test` })).status);
  assert.ok(statuses.includes(429));
});
