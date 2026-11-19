import type { RequestHandler } from 'express';
import { validated } from '../middlewares/validate.js';
import * as service from '../services/accurate-mapping.service.js';
import * as customers from '../services/accurate-customer.service.js';
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
export const status: RequestHandler = async (_req, res) => {
  res.json(await service.accurateStatus(validated(res, companyScopeQuery, 'query').branchId));
};
export const masters: RequestHandler = async (_req, res) => {
  res.json(await service.searchMasters(validated(res, masterQuery, 'query')));
};
export const destination: RequestHandler = async (req, res) => {
  res.json(
    await service.saveDestination(
      validated(res, destinationParams, 'params').branchId,
      validated(res, destinationInput).targetBranchId,
      req.actor.id,
    ),
  );
};
export const mapping: RequestHandler = async (req, res) => {
  const params = validated(res, mappingParams, 'params');
  res.json(
    await service.saveRowMapping(
      params.batchId,
      params.rowId,
      validated(res, mappingInput),
      req.actor.id,
    ),
  );
};
export const delivered: RequestHandler = async (_req, res) => {
  res.json(await service.deliveredInvoices());
};
export const prepareCustomer: RequestHandler = async (req, res) => {
  const { batchId, rowId } = validated(res, mappingParams, 'params');
  res.json(
    await customers.prepareCustomer(
      batchId,
      rowId,
      validated(res, customerPrepareQuery, 'query').version,
    ),
  );
};
export const createCustomer: RequestHandler = async (req, res) => {
  const { batchId, rowId } = validated(res, mappingParams, 'params');
  res.json(
    await customers.createCustomer(
      batchId,
      rowId,
      validated(res, customerCreateInput),
      req.actor.id,
    ),
  );
};
