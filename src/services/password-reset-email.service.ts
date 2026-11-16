import { config } from '../config/env.js';

const pending = new Set<Promise<void>>();

/** Delivery runs after commit. HTTP timing and responses never reveal account existence. */
export function queuePasswordResetEmail(email: string, otp: string, nonce: string) {
  const delivery = send(email, otp, nonce).catch(() => {
    // Provider payloads can contain recipient addresses; never log them or the OTP.
    console.error(JSON.stringify({ event: 'password-reset.email.delivery-failed' }));
  });
  pending.add(delivery);
  void delivery.finally(() => pending.delete(delivery));
}

async function send(email: string, otp: string, nonce: string) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `password-reset-${nonce}`,
    },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      from: config.RESEND_FROM,
      to: [email],
      subject: 'Kode pemulihan password intgrte',
      text: `Kode OTP intgrte Anda: ${otp}. Berlaku 5 menit dan hanya dapat digunakan sekali. Jangan bagikan kode ini. Jika Anda tidak meminta pemulihan password, abaikan email ini.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;color:#242137"><h1 style="font-size:24px">Pulihkan password intgrte</h1><p>Gunakan kode berikut untuk melanjutkan:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px;color:#5944d6">${otp}</p><p>Berlaku 5 menit dan hanya dapat digunakan sekali. Jangan bagikan kode ini.</p><p>Jika Anda tidak meminta pemulihan password, abaikan email ini.</p></div>`,
    }),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error('Email delivery failed.');
}

export async function drainPasswordResetEmails() {
  await Promise.all([...pending]);
}
