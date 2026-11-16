import { config } from './config/env.js';
if (config.DATABASE_URL.startsWith('pglite:'))
  throw new Error(
    'Worker terpisah memerlukan PostgreSQL. Demo PGlite memakai worker dalam proses API.',
  );
const { startWorker } = await import('./services/worker.service.js');
startWorker();
