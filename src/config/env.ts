import 'dotenv/config';
import { z } from 'zod';
export const config = z
  .object({
    PORT: z.coerce.number().default(4000),
    FRONTEND_URL: z.url().default('http://localhost:3000'),
    BETTER_AUTH_URL: z.url().default('http://localhost:4000'),
    BETTER_AUTH_SECRET: z.string().min(32),
    DATABASE_URL: z.string().min(1),
    INTEGRATION_MODE: z.enum(['simulation', 'live']).default('simulation'),
    RUN_WORKER: z.string().default('true'),
    IMPORT_PACKAGE_TAX_POLICY: z.enum(['blocked', 'proportional']).default('blocked'),
    ENCRYPTION_KEY: z.string().optional(),
    RESEND_API_KEY: z.string().default(''),
    RESEND_FROM: z.string().min(1).default('intgrte <onboarding@resend.dev>'),
    NODE_ENV: z.string().default('development'),
  })
  .parse(process.env);
if (config.NODE_ENV === 'production' && config.DATABASE_URL.startsWith('pglite:'))
  throw new Error('PGlite hanya untuk demo lokal. Gunakan PostgreSQL untuk produksi.');
// Live delivery is enabled explicitly through the encrypted Accurate connection settings.
// Each submission records its destination and payload before entering the worker queue.
