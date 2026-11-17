import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Reject damaged migration files before the migrator sends any SQL. */
export function validateMigrationFiles(folder: string) {
  for (const name of readdirSync(folder)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const content = readFileSync(join(folder, name));
    if (content.includes(0))
      throw new Error(
        `File migration ${name} mengandung byte NUL dan tidak dapat dijalankan. Pulihkan file SQL dari source yang benar; jangan reset database.`,
      );
    let sql: string;
    try {
      sql = new TextDecoder('utf-8', { fatal: true }).decode(content);
    } catch {
      throw new Error(
        `File migration ${name} bukan UTF-8 yang valid. Pulihkan file SQL sebelum menjalankan backend.`,
      );
    }
    if (!sql.trim())
      throw new Error(
        `File migration ${name} kosong. Pulihkan file SQL sebelum menjalankan backend.`,
      );
  }
}
