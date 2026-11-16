import { Router } from 'express';
import * as controller from '../controllers/accurate.controller.js';
import { admin, operate } from '../middlewares/authorize.js';
import { validate } from '../middlewares/validate.js';
import {
  destinationInput,
  destinationParams,
  mappingInput,
  mappingParams,
  masterQuery,
} from '../validations/accurate.validation.js';
export const accurateRouter = Router();
accurateRouter.get('/status', controller.status);
accurateRouter.get('/masters', operate, validate({ query: masterQuery }), controller.masters);
accurateRouter.get('/delivered-invoices', operate, controller.delivered);
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
