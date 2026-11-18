import { migrate as mysqlMigrate } from 'drizzle-orm/mysql2/migrator';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from '../config/env.js';
import { validateMigrationFiles } from './migration-files.js';
import { assertMysqlServer } from './mysql-server.js';

export async function migrate(
  folder = fileURLToPath(new URL('./migrations/mysql', import.meta.url)),
) {
  validateMigrationFiles(folder);
  // A dedicated connection keeps the advisory migration lock and DDL on one session.
  const connection = await mysql.createConnection({
    uri: config.DATABASE_URL,
    timezone: 'Z',
    ...(config.DATABASE_SSL === 'true' ? { ssl: { rejectUnauthorized: true } } : {}),
  });
  try {
    await assertMysqlServer(connection);
    await connection.query("SET time_zone = '+00:00'");
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT GET_LOCK(CONCAT(LEFT(DATABASE(), 35), ":intgrte:migrations"), 60) AS acquired',
    );
    if (rows[0]?.acquired !== 1)
      throw new Error('Migration lain masih berjalan. Coba lagi setelah selesai.');
    await mysqlMigrate(drizzle(connection), { migrationsFolder: folder });
  } finally {
    await connection
      .query('SELECT RELEASE_LOCK(CONCAT(LEFT(DATABASE(), 35), ":intgrte:migrations"))')
      .catch(() => {});
    await connection.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await migrate();
    console.log('Migration MySQL selesai.');
  } catch (error) {
    const actionable =
      error instanceof Error &&
      /^(File migration |Database aplikasi memerlukan |Migration lain masih )/.test(error.message);
    console.error(
      actionable
        ? error.message
        : 'Migration MySQL gagal. Periksa koneksi dan integritas SQL; jangan reset database.',
    );
    process.exitCode = 1;
  }
}
