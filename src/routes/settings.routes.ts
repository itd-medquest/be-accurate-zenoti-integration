import { Router } from 'express';
import * as settings from '../controllers/settings.controller.js';
import { validate } from '../middlewares/validate.js';
import { connectionSchema, providerParamsSchema } from '../validations/settings.validation.js';
import { companyScopeQuery } from '../validations/companies.validation.js';

export const settingsRouter = Router();
settingsRouter.get('/', validate({ query: companyScopeQuery }), settings.list);
settingsRouter.patch(
  '/:provider',
  validate({ params: providerParamsSchema, body: connectionSchema, query: companyScopeQuery }),
  settings.configure,
);
settingsRouter.post(
  '/:provider/test',
  validate({ params: providerParamsSchema, query: companyScopeQuery }),
  settings.test,
);
