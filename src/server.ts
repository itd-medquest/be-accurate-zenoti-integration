import { createServer, type RequestListener } from 'node:http';
import { config } from './config/env.js';
let handler: RequestListener | undefined;
let closeDatabase: (() => Promise<void>) | undefined;
let stopWorker: (() => Promise<void>) | undefined;
let drainEmails: (() => Promise<void>) | undefined;
let stopping = false;
const server = createServer((req, res) => {
  if (handler) return handler(req, res);
  res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '2' });
  res.end(
    JSON.stringify({ error: 'Backend sedang menyiapkan database. Coba kembali sebentar lagi.' }),
  );
});
async function stop() {
  if (stopping) return;
  stopping = true;
  handler = undefined;
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  await stopWorker?.();
  await closed;
  await drainEmails?.();
  await closeDatabase?.();
  process.exit(0);
}
try {
  // Reserve the API port before importing modules that open the embedded database.
  // A second API process must fail before it can access the same PGlite files.
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.PORT, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const { closeDb } = await import('./db/index.js');
  closeDatabase = closeDb;
  // The local single-process demo migrates through its own connection. Opening a
  // second PGlite process for migrations while dev/watch is running is unsafe.
  // PostgreSQL deployments keep the explicit migration step.
  if (config.DATABASE_URL.startsWith('pglite:')) {
    const { migrate } = await import('./db/migrate.js');
    await migrate();
  }
  const { checkDatabase } = await import('./repositories/system.repository.js');
  await checkDatabase();
  const { app } = await import('./app.js');
  const { drainPasswordResetEmails } = await import('./services/password-reset-email.service.js');
  drainEmails = drainPasswordResetEmails;
  if (config.RUN_WORKER === 'true') {
    const { startWorker } = await import('./services/worker.service.js');
    stopWorker = startWorker();
  }
  handler = app;
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  console.log(`IMP API ready: ${config.BETTER_AUTH_URL} | Mode Accurate dikelola di Settings`);
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  console.error(
    JSON.stringify({
      event: 'server.start.failed',
      message:
        code === 'EADDRINUSE'
          ? `Port ${config.PORT} sudah digunakan. Jalankan hanya satu backend untuk database demo.`
          : error instanceof Error
            ? error.message
            : 'Backend gagal dimulai.',
    }),
  );
  if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeDatabase?.().catch(() => {});
  process.exit(1);
}
