import { Router } from 'express';
import * as users from '../controllers/users.controller.js';
import { validate } from '../middlewares/validate.js';
import { idParamsSchema } from '../validations/params.validation.js';
import { createUserSchema, updateUserSchema } from '../validations/users.validation.js';

export const usersRouter = Router();
usersRouter.get('/', users.list);
usersRouter.delete('/:id', validate({ params: idParamsSchema }), users.remove);
usersRouter.post('/', validate({ body: createUserSchema }), users.create);
usersRouter.patch(
  '/:id',
  validate({ params: idParamsSchema, body: updateUserSchema }),
  users.update,
);
