import { z } from 'zod';
import { createUserSchema } from './users.validation.js';

export const bootstrapAdminSchema = createUserSchema
  .pick({ name: true, email: true, password: true })
  .extend({
    name: z.string().trim().min(2).max(100),
    email: z.string().trim().toLowerCase().pipe(z.email()),
  })
  .strict();

export type BootstrapAdminInput = z.input<typeof bootstrapAdminSchema>;
