import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { user } from '../db/schema/auth.schema.js';

export const rolesSchema = z.enum(['super_admin', 'finance', 'viewer']);
export const publicUserSchema = createSelectSchema(user).pick({
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  createdAt: true,
});
export const createUserSchema = createInsertSchema(user)
  .pick({
    name: true,
    email: true,
    role: true,
  })
  .extend({
    name: z.string().min(2).max(100),
    email: z.email(),
    role: rolesSchema,
    password: z.string().min(12).max(128),
  });
export const updateUserSchema = createInsertSchema(user).pick({ active: true }).extend({
  role: rolesSchema,
  active: z.boolean(),
});
export type CreateUserInput = z.output<typeof createUserSchema>;
export type UpdateUserInput = z.output<typeof updateUserSchema>;
export type PublicUser = z.output<typeof publicUserSchema>;
