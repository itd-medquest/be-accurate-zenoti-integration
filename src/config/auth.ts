import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '../db/index.js';
import * as auditLogsRepository from '../repositories/audit-logs.repository.js';
import * as userRepository from '../repositories/user.repository.js';

import { APIError } from 'better-auth/api';
import { randomUUID } from 'node:crypto';
import * as schema from '../db/schema/index.js';
import { config } from './env.js';
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  baseURL: config.BETTER_AUTH_URL,
  secret: config.BETTER_AUTH_SECRET,
  trustedOrigins: [config.FRONTEND_URL],
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
  user: {
    additionalFields: {
      role: { type: 'string', defaultValue: 'viewer', input: false },
      active: { type: 'boolean', defaultValue: true, input: false },
    },
  },
  session: { expiresIn: 60 * 60 * 8, updateAge: 60 * 30 },
  databaseHooks: {
    session: {
      create: {
        before: async (value) => {
          const actor = await userRepository.findById(value.userId);
          if (!actor?.active) throw new APIError('FORBIDDEN', { message: 'Akun dinonaktifkan.' });
        },
        after: async (value) => {
          await auditLogsRepository.create({
            id: randomUUID(),
            actorId: value.userId,
            action: 'session.create',
          });
        },
      },
    },
  },
});
