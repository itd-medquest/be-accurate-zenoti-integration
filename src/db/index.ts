import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/node-postgres';
import { drizzle as liteDrizzle } from 'drizzle-orm/pglite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Pool } from 'pg';
import { config } from '../config/env.js';
import * as schema from './schema/index.js';
const embedded = config.DATABASE_URL.startsWith('pglite:');
const embeddedPath = embedded ? config.DATABASE_URL.slice(7) : '';
if (embeddedPath && embeddedPath !== 'memory://')
  mkdirSync(dirname(resolve(embeddedPath)), { recursive: true });
export const pool = embedded ? undefined : new Pool({ connectionString: config.DATABASE_URL });
export const lite = embedded ? new PGlite(embeddedPath || undefined) : undefined;
export const db = (lite ? liteDrizzle(lite, { schema }) : drizzle(pool!, { schema })) as ReturnType<
  typeof drizzle<typeof schema>
>;
export async function closeDb() {
  if (lite) await lite.close();
  if (pool) await pool.end();
}
