import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { importLoginUsers } from '../services/user-transfer.service.js';
import { loginTransferEnvelope } from '../validations/user-transfer.validation.js';
import { decrypt } from '../utils/encryption.js';
import { closeDb } from './index.js';

export async function importUsers(file: string) {
  const envelope = loginTransferEnvelope.parse(JSON.parse(await readFile(file, 'utf8')));
  return importLoginUsers(
    JSON.parse(decrypt(envelope.encrypted, process.env.USER_TRANSFER_KEY || undefined)),
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await importUsers(process.argv[2] ?? 'data/mysql-login-users.encrypted.json');
    console.log(
      `Import selesai: ${result.users} pengguna, ${result.accounts} akun password. Pengguna perlu login ulang.`,
    );
  } catch {
    console.error(
      'Import akun gagal. Pastikan database tujuan kosong, migration selesai, serta file dan kunci transfer benar. Tidak ada akun ditimpa.',
    );
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
