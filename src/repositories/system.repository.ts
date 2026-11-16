import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
export async function checkDatabase() {
  await db.execute(sql`select 1`);
}
