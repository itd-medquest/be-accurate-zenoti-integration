import * as connections from '../repositories/integration-configs.repository.js';
import { encrypt } from '../utils/encryption.js';
import { HttpError } from '../utils/http-error.js';
import type { ConnectionInput } from '../validations/settings.validation.js';
import { audit } from './audit.service.js';
import {
  accurateConnection,
  connectedAccurate,
  prepareAccurateCredentials,
  publicAccurateConnection,
} from './accurate-connection.service.js';

export async function getSettings() {
  const rows = await connections.list();
  return {
    mode: (await accurateConnection()).mode,
    targetStatus: 'SALES_INVOICE',
    accurate: await publicAccurateConnection(),
    queue: 'PostgreSQL',
    timezone: 'Asia/Jakarta',
    connections: rows.map((c) => ({
      id: c.id,
      enabled: c.enabled,
      hasSecret: !!c.encryptedSecret,
      updatedAt: c.updatedAt,
    })),
  };
}
export async function configureConnection(id: string, input: ConnectionInput, actorId: string) {
  const encryptedSecret =
    id === 'accurate' && input.accurate
      ? await prepareAccurateCredentials(input.accurate)
      : input.secret
        ? encrypt(input.secret)
        : undefined;
  await connections.configure(
    { id, enabled: input.enabled, encryptedSecret },
    {
      enabled: input.enabled,
      ...(encryptedSecret ? { encryptedSecret } : {}),
      updatedAt: new Date(),
    },
  );
  await audit(actorId, 'integration.configure', id, {
    enabled: input.enabled,
    secretChanged:
      !!input.secret || !!input.accurate?.apiToken || !!input.accurate?.signatureSecret,
  });
  return { ok: true };
}
export async function testConnection(id: string, actorId: string) {
  const connection = await connections.findById(id);
  if (!connection?.enabled) throw new HttpError(409, 'Koneksi sedang dinonaktifkan.');
  await audit(actorId, 'integration.test', id);
  if (id === 'accurate' && (await accurateConnection()).credentials?.apiToken) {
    const { profile } = await connectedAccurate();
    return {
      ok: true,
      simulation: false,
      database: profile,
      message: `Terhubung ke ${profile.name} (${profile.id}). Pengujian hanya membaca data.`,
    };
  }
  return {
    ok: true,
    simulation: true,
    message: 'Adapter simulasi aktif. Ini bukan verifikasi koneksi API asli.',
  };
}
