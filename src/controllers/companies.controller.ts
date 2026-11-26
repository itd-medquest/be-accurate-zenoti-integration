import type { RequestHandler } from 'express';
import { validated } from '../middlewares/validate.js';
import * as companies from '../services/companies.service.js';
import {
  companyCreateSchema,
  companyDeleteSchema,
  companyParamsSchema,
  companyRenameSchema,
} from '../validations/companies.validation.js';

export const list: RequestHandler = async (_req, res) => {
  res.json(await companies.listCompanies());
};
export const create: RequestHandler = async (req, res) => {
  res
    .status(201)
    .json(await companies.createCompany(validated(res, companyCreateSchema).name, req.actor.id));
};
export const rename: RequestHandler = async (req, res) => {
  const input = validated(res, companyRenameSchema);
  res.json(
    await companies.renameCompany(
      validated(res, companyParamsSchema, 'params').id,
      input.name,
      input.expectedName,
      req.actor.id,
    ),
  );
};
export const remove: RequestHandler = async (req, res) => {
  res.json(
    await companies.deleteCompany(
      validated(res, companyParamsSchema, 'params').id,
      validated(res, companyDeleteSchema).confirmationName,
      req.actor.id,
    ),
  );
};
