import { pathToFileURL } from 'node:url';
import { bootstrapCompany } from '../services/company-bootstrap.service.js';
import { closeDb } from './index.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await bootstrapCompany({
      id: process.env.SETUP_COMPANY_ID ?? 'branch-jakarta',
      name: process.env.SETUP_COMPANY_NAME ?? '',
      centerId: process.env.SETUP_CENTER_ID ?? '',
    });
    console.log(
      result.created
        ? 'Perusahaan ditambahkan. Lengkapi tujuan Accurate di Settings sebelum upload.'
        : 'Perusahaan sudah tersedia; konfigurasi tidak diubah.',
    );
  } catch {
    console.error(
      'Setup perusahaan gagal. Periksa SETUP_COMPANY_ID/NAME dan SETUP_CENTER_ID. Tidak ada data ditimpa.',
    );
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
