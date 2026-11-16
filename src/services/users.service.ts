import { hashPassword } from 'better-auth/crypto';
import { randomUUID } from 'node:crypto';
import { create as createAccount } from '../repositories/account.repository.js';
import { create as createAudit } from '../repositories/audit-logs.repository.js';
import { hasUploadsByUser } from '../repositories/import-batches.repository.js';
import { deleteForUser } from '../repositories/session.repository.js';
import { withTransaction, type DbTransaction } from '../repositories/unit-of-work.repository.js';
import * as users from '../repositories/user.repository.js';
import { HttpError } from '../utils/http-error.js';
import type {
  CreateUserInput,
  PublicUser,
  UpdateUserInput,
} from '../validations/users.validation.js';

export async function listUsers(): Promise<PublicUser[]> {
  return users.listPublic();
}
export async function createUser(input: CreateUserInput, actorId: string) {
  const password = await hashPassword(input.password);
  const id = randomUUID();
  await withTransaction(async (tx) => {
    if (await users.findByEmail(input.email.toLowerCase(), tx))
      throw new HttpError(409, 'Email sudah terdaftar.');
    await users.create(
      { id, name: input.name, email: input.email.toLowerCase(), role: input.role },
      tx,
    );
    await createAccount(
      { id: randomUUID(), userId: id, accountId: id, providerId: 'credential', password },
      tx,
    );
    await createAudit(
      {
        id: randomUUID(),
        actorId,
        action: 'user.create',
        entityId: id,
        details: { role: input.role },
      },
      tx,
    );
  });
  return { id };
}
export async function updateUser(id: string, input: UpdateUserInput, actorId: string) {
  if (id === actorId)
    throw new HttpError(409, 'Role dan status akun sendiri tidak dapat diubah di sini.');
  await withTransaction(async (tx) => {
    await lockManagedUser(id, actorId, tx);
    const [updated] = await users.updateById({ ...input, updatedAt: new Date() }, id, tx);
    if (!updated) throw new HttpError(404, 'Pengguna tidak ditemukan.');
    await deleteForUser(id, tx);
    await createAudit(
      { id: randomUUID(), actorId, action: 'user.update', entityId: id, details: input },
      tx,
    );
  });
  return { ok: true };
}

async function lockManagedUser(id: string, actorId: string, tx: DbTransaction) {
  const locked = await users.lockByIds([actorId, id], tx);
  const actor = locked.find((value) => value.id === actorId);
  if (!actor?.active || actor.role !== 'super_admin')
    throw new HttpError(403, 'Akses pengelolaan pengguna sudah berubah. Muat ulang halaman.');
  const target = locked.find((value) => value.id === id);
  if (!target) throw new HttpError(404, 'Pengguna tidak ditemukan.');
  // The acting active admin remains locked and cannot be removed/demoted concurrently.
  return target;
}

export async function deleteUser(id: string, actorId: string) {
  if (id === actorId) throw new HttpError(409, 'Akun sendiri tidak dapat dihapus.');
  await withTransaction(async (tx) => {
    const target = await lockManagedUser(id, actorId, tx);
    if (await hasUploadsByUser(id, tx))
      throw new HttpError(
        409,
        'Pengguna memiliki riwayat upload dan tidak dapat dihapus. Nonaktifkan akun melalui Edit pengguna agar riwayat tetap tersimpan.',
      );
    await users.deleteById(id, tx);
    await createAudit(
      {
        id: randomUUID(), actorId, action: 'user.delete', entityId: id,
        details: { role: target.role, active: target.active },
      },
      tx,
    );
  });
  return { ok: true };
}
