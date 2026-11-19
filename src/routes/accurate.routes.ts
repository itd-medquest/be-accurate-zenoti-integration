import { Router } from 'express';
import * as controller from '../controllers/accurate.controller.js';
import { admin, operate } from '../middlewares/authorize.js';
import { validate } from '../middlewares/validate.js';
import { companyScopeQuery } from '../validations/companies.validation.js';
import {
  destinationInput,
  destinationParams,
  mappingInput,
  mappingParams,
  masterQuery,
  customerPrepareQuery,
  customerCreateInput,
} from '../validations/accurate.validation.js';
export const accurateRouter = Router();
accurateRouter.get('/status', validate({ query: companyScopeQuery }), controller.status);
accurateRouter.get('/masters', operate, validate({ query: masterQuery }), controller.masters);
accurateRouter.get('/delivered-invoices', operate, controller.delivered);
accurateRouter.get(
  '/imports/:batchId/rows/:rowId/customer/prepare',
  operate,
  validate({ params: mappingParams, query: customerPrepareQuery }),
  controller.prepareCustomer,
);
accurateRouter.post(
  '/imports/:batchId/rows/:rowId/customer',
  operate,
  validate({ params: mappingParams, body: customerCreateInput }),
  controller.createCustomer,
);
accurateRouter.put(
  '/destinations/:branchId',
  admin,
  validate({ params: destinationParams, body: destinationInput }),
  controller.destination,
);
accurateRouter.put(
  '/imports/:batchId/rows/:rowId/mapping',
  operate,
  validate({ params: mappingParams, body: mappingInput }),
  controller.mapping,
);
