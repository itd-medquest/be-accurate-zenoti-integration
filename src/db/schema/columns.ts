import { timestamp } from 'drizzle-orm/pg-core';

export const time = (name: string) => timestamp(name, { withTimezone: true });
