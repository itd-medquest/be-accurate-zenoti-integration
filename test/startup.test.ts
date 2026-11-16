import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, access, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
async function run(entry: string, env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', entry], {
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (data) => (output += data));
    child.stderr.on('data', (data) => (output += data));
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Startup guard timed out.'));
    }, 15000);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      resolve({ code, output });
    });
  });
}
function environment(path: string) {
  return {
    ...process.env,
    DATABASE_URL: `pglite:${path}`,
    BETTER_AUTH_SECRET: 'test-startup-secret-12345678901234567890',
    INTEGRATION_MODE: 'simulation',
    NODE_ENV: 'test',
    RUN_WORKER: 'false',
  };
}
test('occupied API port rejects a second backend before any PGlite files are opened', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'imp-startup-')),
    database = join(folder, 'database');
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const result = await run('src/server.ts', { ...environment(database), PORT: String(port) });
    assert.equal(result.code, 1);
    assert.match(result.output, /sudah digunakan/);
    await assert.rejects(access(database));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rmdir(folder);
  }
});
test('standalone embedded worker is rejected before opening the demo database', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'imp-worker-startup-')),
    database = join(folder, 'database');
  try {
    const result = await run('src/worker-entry.ts', environment(database));
    assert.equal(result.code, 1);
    assert.match(result.output, /Worker terpisah memerlukan PostgreSQL/);
    await assert.rejects(access(database));
  } finally {
    await rmdir(folder);
  }
});
