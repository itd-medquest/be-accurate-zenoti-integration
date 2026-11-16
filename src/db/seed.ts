import { hashPassword } from 'better-auth/crypto';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import * as accountRepository from '../repositories/account.repository.js';
import * as branchesRepository from '../repositories/branches.repository.js';
import * as integrationConfigsRepository from '../repositories/integration-configs.repository.js';
import * as invoicesRepository from '../repositories/invoices.repository.js';
import { withTransaction } from '../repositories/unit-of-work.repository.js';
import * as userRepository from '../repositories/user.repository.js';
import { enqueue, processOne } from '../services/sync.service.js';
import { sampleInvoices } from './fixtures/invoices.js';
import { closeDb } from './index.js';
export async function seed() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password || password.length < 12)
    throw new Error('Isi SEED_ADMIN_EMAIL dan SEED_ADMIN_PASSWORD (minimal 12 karakter).');
  let adminId = '';
  for (const [role, accountEmail, name] of [
    ['super_admin', email, 'Administrator'],
    ['finance', 'finance@example.test', 'Tim Finance'],
    ['viewer', 'viewer@example.test', 'Tim Operasional'],
  ]) {
    const existing = await userRepository.findByEmail(accountEmail);
    const id = existing?.id ?? randomUUID();
    if (role === 'super_admin') adminId = id;
    if (!existing)
      await withTransaction(async (tx) => {
        await userRepository.create({ id, name, email: accountEmail, role }, tx);
        await accountRepository.create(
          {
            id: randomUUID(),
            userId: id,
            accountId: id,
            providerId: 'credential',
            password: await hashPassword(password),
          },
          tx,
        );
      });
  }
  await branchesRepository.seedMissing({
    id: 'branch-jakarta',
    name: 'PT. MMI',
    centerId: 'center-jakarta',
    accurateDatabaseId: 'accurate-demo',
    accurateBranchId: 'JKT',
    active: true,
  });
  await integrationConfigsRepository.seedMissing([
    { id: 'zenoti', enabled: true },
    { id: 'accurate', enabled: true },
  ]);
  const created = await invoicesRepository.seedMissing(sampleInvoices());
  for (const invoice of created.slice(0, 28)) {
    await enqueue(invoice.id, adminId);
    await processOne();
  }
  console.log(
    `Seed selesai: ${created.length} invoice simulasi baru. Akun: ${email}, finance@example.test, viewer@example.test.`,
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await seed();
  await closeDb();
}
