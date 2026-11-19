import type { RequestHandler } from 'express';
import { fetchInvoices } from '../services/sync.service.js';
import * as system from '../services/system.service.js';
import { listAuditPage } from '../services/audit.service.js';
import { validated } from '../middlewares/validate.js';
import { auditPageQuerySchema } from '../validations/audit.validation.js';

export const health: RequestHandler = async (_req, res) => {
  res.json(await system.health());
};
export const me: RequestHandler = (req, res) => {
  res.json(req.actor);
};
export const audit: RequestHandler = async (_req, res) => {
  res.json(await system.listAudit());
};
export const auditOverview: RequestHandler = async (_req, res) => {
  res.json(await listAuditPage(validated(res, auditPageQuerySchema, 'query')));
};
export const jobs: RequestHandler = async (_req, res) => {
  res.json(await system.listJobs());
};
export const fetch: RequestHandler = async (req, res) => {
  res.json(await fetchInvoices(req.actor.id));
};
