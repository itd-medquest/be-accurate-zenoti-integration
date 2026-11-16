import type { RequestHandler } from 'express';
import { validated } from '../middlewares/validate.js';
import { getImportOverview } from '../services/import-overview.service.js';
import { importOverviewQuerySchema } from '../validations/import-overview.validation.js';

export const overview: RequestHandler = async (_req, res) => {
  res.json(await getImportOverview(validated(res, importOverviewQuerySchema, 'query')));
};
