import { migrate as pgMigrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate as liteMigrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { closeDb, db, lite } from './index.js';
import { validateMigrationFiles } from './migration-files.js';
export async function migrate(
  migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url)),
) {
  validateMigrationFiles(migrationsFolder);
  if (lite) await liteMigrate(drizzle(lite), { migrationsFolder });
  else await pgMigrate(db, { migrationsFolder });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await migrate();
  console.log('Migrasi selesai.');
  await closeDb();
}
