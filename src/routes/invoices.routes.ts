import { Router } from 'express';
import * as invoices from '../controllers/invoices.controller.js';
import { admin, operate } from '../middlewares/authorize.js';
import { validate } from '../middlewares/validate.js';
import { invoiceListSchema } from '../validations/invoices.validation.js';
import { idParamsSchema } from '../validations/params.validation.js';

export const invoicesRouter = Router();
invoicesRouter.get('/', validate({ query: invoiceListSchema }), invoices.list);
invoicesRouter.get('/:id', validate({ params: idParamsSchema }), invoices.detail);
invoicesRouter.post('/:id/sync', validate({ params: idParamsSchema }), operate, invoices.sync);
invoicesRouter.post(
  '/:id/resolve-mapping',
  validate({ params: idParamsSchema }),
  admin,
  invoices.resolve,
);
