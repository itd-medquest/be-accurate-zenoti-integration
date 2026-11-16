import { Router } from 'express';
import * as settings from '../controllers/settings.controller.js';
import { validate } from '../middlewares/validate.js';
import { connectionSchema, providerParamsSchema } from '../validations/settings.validation.js';

export const settingsRouter = Router();
settingsRouter.get('/', settings.list);
settingsRouter.patch(
  '/:provider',
  validate({ params: providerParamsSchema, body: connectionSchema }),
  settings.configure,
);
settingsRouter.post('/:provider/test', validate({ params: providerParamsSchema }), settings.test);
