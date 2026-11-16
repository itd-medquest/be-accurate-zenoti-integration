import type { RequestHandler } from 'express';
import { validated } from '../middlewares/validate.js';
import { getDashboard } from '../services/dashboard.service.js';
import { invoiceFiltersSchema } from '../validations/invoices.validation.js';

export const overview: RequestHandler = async (_req, res) => {
  res.json(await getDashboard(validated(res, invoiceFiltersSchema, 'query')));
};
