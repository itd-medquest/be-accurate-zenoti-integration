import { z } from 'zod';
import * as connections from '../repositories/integration-configs.repository.js';
import type { DbExecutor } from '../repositories/unit-of-work.repository.js';
import { decrypt, encrypt } from '../utils/encryption.js';
import { HttpError } from '../utils/http-error.js';
import type { ConnectionInput } from '../validations/settings.validation.js';
import { AccurateClient } from './integrations/accurate-client.js';

const credentialSchema = z.object({
  version: z.literal(1),
  apiToken: z.string(),
  signatureSecret: z.string(),
  mode: z.enum(['simulation', 'live']),
  taxPolicy: z.literal('gross-no-tax'),
});
export async function accurateConnection(context?: DbExecutor) {
  const row = await connections.findById('accurate', context);
  let credentials: z.infer<typeof credentialSchema> | undefined;
  if (row?.encryptedSecret) {
    const raw = decrypt(row.encryptedSecret);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      value = null;
    }
    credentials = credentialSchema.safeParse(value).data;
  }
  return { enabled: row?.enabled ?? false, mode: credentials?.mode ?? 'simulation', credentials };
}
export async function publicAccurateConnection() {
  const current = await accurateConnection();
  return {
    mode: current.mode,
    taxPolicy: 'gross-no-tax' as const,
    hasApiToken: !!current.credentials?.apiToken,
    hasSignatureSecret: !!current.credentials?.signatureSecret,
  };
}
export async function prepareAccurateCredentials(input: NonNullable<ConnectionInput['accurate']>) {
  const previous = (await accurateConnection()).credentials;
  const next = {
    version: 1 as const,
    mode: input.mode,
    taxPolicy: 'gross-no-tax' as const,
    apiToken: input.apiToken ?? previous?.apiToken ?? '',
    signatureSecret: input.signatureSecret ?? previous?.signatureSecret ?? '',
  };
  if (next.mode === 'live' && (!next.apiToken || !next.signatureSecret))
    throw new HttpError(422, 'Isi API Token dan Signature Secret sebelum menggunakan mode aktual.');
  return encrypt(JSON.stringify(next));
}
export async function connectedAccurate(requireLive = false) {
  const current = await accurateConnection();
  if (!current.enabled) throw new HttpError(409, 'Koneksi Accurate dinonaktifkan.');
  if (!current.credentials?.apiToken || !current.credentials.signatureSecret)
    throw new HttpError(422, 'Isi API Token dan Signature Secret Accurate di Settings.');
  if (requireLive && current.mode !== 'live')
    throw new HttpError(422, 'Pengiriman aktual dihentikan karena mode Accurate telah berubah.');
  const client = new AccurateClient(current.credentials);
  return { client, profile: await client.profile() };
}
