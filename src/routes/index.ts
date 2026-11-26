import { Router } from 'express';
import * as dashboard from '../controllers/dashboard.controller.js';
import * as settings from '../controllers/settings.controller.js';
import * as system from '../controllers/system.controller.js';
import { admin, operate } from '../middlewares/authorize.js';
import { validate } from '../middlewares/validate.js';
import { invoiceFiltersSchema } from '../validations/invoices.validation.js';
import { idParamsSchema } from '../validations/params.validation.js';
import { branchMappingSchema } from '../validations/settings.validation.js';
import { importsRouter } from './imports.routes.js';
import { invoicesRouter } from './invoices.routes.js';
import { settingsRouter } from './settings.routes.js';
import { usersRouter } from './users.routes.js';
import { accurateRouter } from './accurate.routes.js';
import { receiptsRouter } from './receipts.routes.js';
import { auditPageQuerySchema } from '../validations/audit.validation.js';
import * as companies from '../controllers/companies.controller.js';
import {
  companyCreateSchema,
  companyDeleteSchema,
  companyParamsSchema,
  companyRenameSchema,
} from '../validations/companies.validation.js';

export const apiRouter = Router();
apiRouter.get('/me', system.me);
apiRouter.get('/branches', settings.listBranches);
apiRouter.get('/companies', admin, companies.list);
apiRouter.post('/companies', admin, validate({ body: companyCreateSchema }), companies.create);
apiRouter.patch(
  '/companies/:id',
  admin,
  validate({ params: companyParamsSchema, body: companyRenameSchema }),
  companies.rename,
);
apiRouter.delete(
  '/companies/:id',
  admin,
  validate({ params: companyParamsSchema, body: companyDeleteSchema }),
  companies.remove,
);
apiRouter.patch(
  '/branches/:id',
  admin,
  validate({ params: idParamsSchema, body: branchMappingSchema }),
  settings.updateBranch,
);
apiRouter.get('/dashboard', validate({ query: invoiceFiltersSchema }), dashboard.overview);
apiRouter.post('/integrations/fetch', operate, system.fetch);
apiRouter.get('/audit', admin, system.audit);
apiRouter.get(
  '/audit/overview',
  admin,
  validate({ query: auditPageQuerySchema }),
  system.auditOverview,
);
apiRouter.get('/jobs', operate, system.jobs);
apiRouter.use('/invoices', invoicesRouter);
apiRouter.use('/imports', operate, importsRouter);
apiRouter.use('/users', admin, usersRouter);
apiRouter.use('/settings', admin, settingsRouter);
apiRouter.use('/accurate', accurateRouter);
apiRouter.use('/receipts', receiptsRouter);
