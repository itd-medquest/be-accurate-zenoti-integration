import type { RequestHandler } from 'express';
import { validated } from '../middlewares/validate.js';
import { listInvoices, resolveMapping } from '../services/invoices.service.js';
import { enqueue, invoiceDetail } from '../services/sync.service.js';
import { invoiceListSchema } from '../validations/invoices.validation.js';

export const list: RequestHandler = async (_req, res) => {
  const input = validated(res, invoiceListSchema, 'query');
  res.json(await listInvoices(input, { page: input.page, pageSize: input.pageSize }));
};
export const detail: RequestHandler = async (req, res) => {
  res.json(await invoiceDetail(String(req.params.id)));
};
export const sync: RequestHandler = async (req, res) => {
  res.status(202).json(await enqueue(String(req.params.id), req.actor.id));
};
export const resolve: RequestHandler = async (req, res) => {
  res.json(await resolveMapping(String(req.params.id), req.actor.id));
};
