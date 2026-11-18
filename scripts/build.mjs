import { cpSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(projectRoot, 'dist');
if (dirname(output) !== resolve(projectRoot) || basename(output) !== 'dist') {
  throw new Error('Build output must stay inside this backend project.');
}
// Remove only generated output so renamed source files cannot leave stale modules behind.
rmSync(output, { recursive: true, force: true });
const result = spawnSync(process.execPath, [join(projectRoot, 'node_modules/typescript/bin/tsc')], {
  cwd: projectRoot,
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const { validateMigrationFiles } = await import(
  pathToFileURL(join(output, 'db/migration-files.js')).href
);
validateMigrationFiles(join(projectRoot, 'src/db/migrations'));
validateMigrationFiles(join(projectRoot, 'src/db/migrations/mysql'));
cpSync(join(projectRoot, 'src/db/migrations'), join(output, 'db/migrations'), { recursive: true });
