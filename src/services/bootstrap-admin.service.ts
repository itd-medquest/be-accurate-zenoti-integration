import { hashPassword } from 'better-auth/crypto';
import { randomUUID } from 'node:crypto';
import * as accounts from '../repositories/account.repository.js';
import * as auditLogs from '../repositories/audit-logs.repository.js';
import { withTransaction } from '../repositories/unit-of-work.repository.js';
import * as users from '../repositories/user.repository.js';
import {
  bootstrapAdminSchema,
  type BootstrapAdminInput,
} from '../validations/bootstrap-admin.validation.js';

/** CLI-only bootstrap; never creates demo data or resets an existing credential. */
export async function bootstrapAdmin(input: BootstrapAdminInput) {
  const result = bootstrapAdminSchema.safeParse(input);
  if (!result.success)
    throw new Error('Isi nama (2–100 karakter), email valid, dan password (12–128 karakter).');
  const { name, email, password } = result.data;
  const passwordHash = await hashPassword(password);
  return withTransaction(async (tx) => {
    await users.lockForBootstrap(tx);
    const existing = await users.findByEmail(email, tx);
    if (existing) {
      const credential = await accounts.findCredential(existing.id, tx);
      if (existing.active && existing.role === 'super_admin' && credential?.password)
        return { created: false };
      throw new Error(
        'Email sudah terdaftar tetapi bukan super admin aktif dengan password. Tidak ada perubahan.',
      );
    }
    if (await users.findAny(tx))
      throw new Error(
        'Bootstrap hanya untuk database tanpa pengguna. Kelola akun melalui super admin yang sudah ada.',
      );
    const id = randomUUID();
    await users.create({ id, name, email, role: 'super_admin', active: true }, tx);
    await accounts.create(
      { id: randomUUID(), userId: id, accountId: id, providerId: 'credential', password: passwordHash },
      tx,
    );
    await auditLogs.create(
      {
        id: randomUUID(),
        actorId: id,
        action: 'user.bootstrap',
        entityId: id,
        details: { role: 'super_admin' },
      },
      tx,
    );
    return { created: true };
  });
}
