import { randomUUID } from 'node:crypto';
import { loginTransferSchema } from '../validations/user-transfer.validation.js';
import * as users from '../repositories/user.repository.js';
import * as transfer from '../repositories/login-transfer.repository.js';
import * as audit from '../repositories/audit-logs.repository.js';
import { withTransaction } from '../repositories/unit-of-work.repository.js';

/** Import only login identities and existing password hashes into a fresh MySQL target. */
export async function importLoginUsers(input: unknown) {
  const data = loginTransferSchema.parse(input);
  return withTransaction(async (context) => {
    await users.lockForBootstrap(context);
    if (!(await transfer.isEmptyTarget(context)))
      throw new Error(
        'Import akun hanya untuk database tujuan baru dan kosong. Tidak ada data ditimpa.',
      );
    await transfer.insertLoginUsers(data, context);
    await audit.create(
      {
        id: randomUUID(),
        action: 'user.migrate',
        details: {
          users: data.users.length,
          accounts: data.accounts.length,
          source: 'legacy-postgresql',
        },
      },
      context,
    );
    return { users: data.users.length, accounts: data.accounts.length };
  });
}
