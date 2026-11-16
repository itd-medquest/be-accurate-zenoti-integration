import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const envPath = resolve('.env');
if (!existsSync(envPath)) {
  const password = randomBytes(18).toString('base64url');
  writeFileSync(
    envPath,
    `PORT=4000\nFRONTEND_URL=http://localhost:3000\nBETTER_AUTH_URL=http://localhost:4000\nBETTER_AUTH_SECRET=${randomBytes(32).toString('hex')}\nDATABASE_URL=pglite:./data/demo\nINTEGRATION_MODE=simulation\nRUN_WORKER=true\nIMPORT_PACKAGE_TAX_POLICY=proportional\nENCRYPTION_KEY=${randomBytes(32).toString('hex')}\nSEED_ADMIN_EMAIL=admin@example.test\nSEED_ADMIN_PASSWORD=${password}\n`,
    { flag: 'wx' },
  );
  console.log('Environment demo lokal dibuat.');
} else console.log('Environment yang sudah ada dipertahankan.');
const { migrate } = await import('./migrate.js');
const { seed } = await import('./seed.js');
const { closeDb } = await import('./index.js');
await migrate();
await seed();
await closeDb();
console.log(
  'Jalankan npm run dev dari folder projects/backend. Email admin: SEED_ADMIN_EMAIL; password: SEED_ADMIN_PASSWORD di .env backend.',
);
