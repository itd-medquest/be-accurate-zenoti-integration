import { datetime } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

/** All persisted instants use UTC with millisecond precision, including dates before 1970. */
export const time = (name: string) => datetime(name, { mode: 'date', fsp: 3 });
export const currentTime = sql`CURRENT_TIMESTAMP(3)`;
