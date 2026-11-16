import type { RequestHandler } from 'express';
import { validated } from '../middlewares/validate.js';
import * as service from '../services/accurate-mapping.service.js';
import {
  destinationInput,
  destinationParams,
  mappingInput,
  mappingParams,
  masterQuery,
} from '../validations/accurate.validation.js';
export const status: RequestHandler = async (_req, res) => {
  res.json(await service.accurateStatus());
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
