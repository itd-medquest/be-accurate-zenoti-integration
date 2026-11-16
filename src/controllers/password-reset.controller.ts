import type { RequestHandler } from 'express';
import { validated } from '../middlewares/validate.js';
import * as reset from '../services/password-reset.service.js';
import { completeResetSchema, requestResetSchema, verifyResetSchema } from '../validations/password-reset.validation.js';

export const request: RequestHandler = async (_req, res) => {
  res.json(await reset.requestReset(validated(res, requestResetSchema).email));
};
export const verify: RequestHandler = async (_req, res) => {
  res.json(await reset.verifyReset(validated(res, verifyResetSchema)));
};
export const complete: RequestHandler = async (_req, res) => {
  res.json(await reset.completeReset(validated(res, completeResetSchema)));
};
