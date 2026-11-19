import * as connections from '../repositories/integration-configs.repository.js';
import { encrypt } from '../utils/encryption.js';
import { HttpError } from '../utils/http-error.js';
import type { ConnectionInput } from '../validations/settings.validation.js';
import { audit } from './audit.service.js';
import { withTransaction } from '../repositories/unit-of-work.repository.js';
import * as branches from '../repositories/branches.repository.js';
import { companyConnectionId } from '../utils/company-connection.js';
import {
  accurateConnection,
  connectedAccurate,
  prepareAccurateCredentials,
  publicAccurateConnection,
} from './accurate-connection.service.js';

export async function getSettings(branchId?: string) {
  const rows = await connections.list();
  const scoped = await accurateConnection(undefined, branchId);
  return {
    mode: scoped.mode,
    targetStatus: 'SALES_INVOICE',
    accurate: await publicAccurateConnection(branchId),
    queue: 'MySQL',
    timezone: 'Asia/Jakarta',
    connections: rows
      .filter((c) => c.id === 'zenoti')
      .map((c) => ({
        id: c.id,
        enabled: c.enabled,
        hasSecret: !!c.encryptedSecret,
        updatedAt: c.updatedAt,
      }))
      .concat([
        {
          id: 'accurate',
          enabled: scoped.enabled,
          hasSecret: !!rows.find((row) => row.id === scoped.id)?.encryptedSecret,
          updatedAt: rows.find((row) => row.id === scoped.id)?.updatedAt ?? new Date(0),
        },
      ]),
  };
}
export async function configureConnection(
  id: string,
  input: ConnectionInput,
  actorId: string,
  branchId?: string,
) {
  const targetId = id === 'accurate' && branchId ? companyConnectionId(branchId) : id;
  await withTransaction(async (tx) => {
    if (branchId) {
      const [branch] = await branches.lockById(branchId, tx);
      if (!branch?.active) throw new HttpError(404, 'Perusahaan aktif tidak ditemukan.');
    }
    await connections.lockById(targetId, tx);
    const encryptedSecret =
      id === 'accurate' && input.accurate
        ? await prepareAccurateCredentials(input.accurate, branchId, tx)
        : input.secret
          ? encrypt(input.secret)
          : undefined;
    await connections.configure(
      { id: targetId, enabled: input.enabled, encryptedSecret },
      {
        enabled: input.enabled,
        ...(encryptedSecret ? { encryptedSecret } : {}),
        updatedAt: new Date(),
      },
      tx,
    );
  });
  await audit(actorId, 'integration.configure', targetId, {
    ...(branchId ? { branchId } : {}),
    enabled: input.enabled,
    secretChanged:
      !!input.secret || !!input.accurate?.apiToken || !!input.accurate?.signatureSecret,
  });
  return { ok: true };
}
export async function testConnection(id: string, actorId: string, branchId?: string) {
  const current = id === 'accurate' ? await accurateConnection(undefined, branchId) : undefined;
  const connection = await connections.findById(current?.id ?? id);
  if (!connection?.enabled) throw new HttpError(409, 'Koneksi sedang dinonaktifkan.');
  await audit(actorId, 'integration.test', current?.id ?? id, branchId ? { branchId } : undefined);
  if (id === 'accurate' && current?.credentials?.apiToken) {
    const { profile } = await connectedAccurate(false, branchId);
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
