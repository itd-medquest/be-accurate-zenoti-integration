import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '../config/env.js';
function key(secret = config.ENCRYPTION_KEY) {
  if (!secret || !/^[a-f0-9]{64}$/i.test(secret))
    throw new Error('ENCRYPTION_KEY harus berupa 64 karakter hex.');
  return Buffer.from(secret, 'hex');
}
export function encrypt(value: string, secret = config.ENCRYPTION_KEY) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), data.toString('hex')].join(':');
}
export function decrypt(value: string, secret = config.ENCRYPTION_KEY) {
  const [iv, tag, data] = value.split(':');
  const cipher = createDecipheriv('aes-256-gcm', key(secret), Buffer.from(iv, 'hex'));
  cipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([cipher.update(Buffer.from(data, 'hex')), cipher.final()]).toString('utf8');
}
