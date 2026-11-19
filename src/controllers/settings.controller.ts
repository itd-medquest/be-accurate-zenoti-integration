import type { RequestHandler } from 'express';
import { validated } from '../middlewares/validate.js';
import * as branches from '../services/branches.service.js';
import * as settings from '../services/settings.service.js';
import { companyScopeQuery } from '../validations/companies.validation.js';
import {
  branchMappingSchema,
  connectionSchema,
  providerParamsSchema,
} from '../validations/settings.validation.js';

export const list: RequestHandler = async (_req, res) => {
  res.json(await settings.getSettings(validated(res, companyScopeQuery, 'query').branchId));
};
export const configure: RequestHandler = async (req, res) => {
  res.json(
    await settings.configureConnection(
      validated(res, providerParamsSchema, 'params').provider,
      validated(res, connectionSchema),
      req.actor.id,
      validated(res, companyScopeQuery, 'query').branchId,
    ),
  );
};
export const test: RequestHandler = async (req, res) => {
  res.json(
    await settings.testConnection(
      validated(res, providerParamsSchema, 'params').provider,
      req.actor.id,
      validated(res, companyScopeQuery, 'query').branchId,
    ),
  );
};
export const listBranches: RequestHandler = async (_req, res) => {
  res.json(await branches.listBranches());
};
export const updateBranch: RequestHandler = async (req, res) => {
  res.json(
    await branches.updateBranch(
      String(req.params.id),
      validated(res, branchMappingSchema),
      req.actor.id,
    ),
  );
};
