import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readLoginUsers } from '../repositories/legacy-users.repository.js';
import { encrypt } from '../utils/encryption.js';

/** CLI only. PostgreSQL is read in a read-only transaction; stop PGlite API first. */
export async function exportUsers(sourceUrl: string, destination: string) {
  let close: () => Promise<void>;
  let snapshot: Awaited<ReturnType<typeof readLoginUsers>>;
  if (sourceUrl.startsWith('pglite:')) {
    if (!existsSync(join(sourceUrl.slice(7), 'PG_VERSION')))
      throw new Error(
        'Sumber PGlite yang sudah ada tidak ditemukan. Tidak ada database baru dibuat.',
      );
    const { PGlite } = await import('@electric-sql/pglite');
    const source = new PGlite(sourceUrl.slice(7));
    close = () => source.close();
    try {
      snapshot = await source.transaction(async (tx) => {
        await tx.exec('SET TRANSACTION READ ONLY');
        return readLoginUsers(tx);
      });
    } finally {
      await close();
    }
  } else if (/^postgres(ql)?:\/\//.test(sourceUrl)) {
    const { Client } = await import('pg');
    const source = new Client({ connectionString: sourceUrl });
    await source.connect();
    try {
      await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      snapshot = await readLoginUsers(source);
      await source.query('COMMIT');
    } finally {
      await source.end();
    }
  } else throw new Error('SOURCE_DATABASE_URL harus PostgreSQL atau PGlite.');
  const output = resolve(destination);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    JSON.stringify({
      version: 1,
      encrypted: encrypt(JSON.stringify(snapshot), process.env.USER_TRANSFER_KEY || undefined),
    }),
    { flag: 'wx', mode: 0o600 },
  );
  return { users: snapshot.users.length, accounts: snapshot.accounts.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await exportUsers(
      process.env.SOURCE_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
      process.argv[2] ?? 'data/mysql-login-users.encrypted.json',
    );
    console.log(
      `Export terenkripsi selesai: ${result.users} pengguna, ${result.accounts} akun password. Tidak ada transaksi atau sesi disalin.`,
    );
  } catch {
    console.error(
      'Export akun gagal. Periksa sumber, ENCRYPTION_KEY, file tujuan yang belum ada, dan pastikan backend PGlite sudah dihentikan.',
    );
    process.exitCode = 1;
  }
}
