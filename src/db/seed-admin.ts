import { pathToFileURL } from 'node:url';
import { bootstrapAdmin } from '../services/bootstrap-admin.service.js';
import { closeDb } from './index.js';

export async function seedAdmin() {
  const result = await bootstrapAdmin({
    name: process.env.SEED_ADMIN_NAME ?? 'Administrator',
    email: process.env.SEED_ADMIN_EMAIL ?? '',
    password: process.env.SEED_ADMIN_PASSWORD ?? '',
  });
  console.log(
    result.created
      ? 'Super admin pertama berhasil dibuat. Tidak ada data demo yang ditambahkan.'
      : 'Super admin sudah tersedia. Password dan data akun tidak diubah.',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let failed = false;
  try {
    await seedAdmin();
  } catch {
    console.error(
      'Seed admin gagal. Pastikan migrasi selesai, database belum memiliki pengguna lain, dan ' +
        'SEED_ADMIN_NAME/EMAIL/PASSWORD valid (password 12–128 karakter). Tidak ada kredensial yang diubah.',
    );
    failed = true;
  } finally {
    await closeDb();
  }
  // Keep a failing exit status after all database connections have closed.
  if (failed) process.exitCode = 1;
}
