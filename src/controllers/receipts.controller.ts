import type { RequestHandler } from 'express';
import { validated } from '../middlewares/validate.js';
import * as receipts from '../services/receipts.service.js';
import * as delivery from '../services/receipt-delivery.service.js';
import {
  receiptReferenceQuery,
  receiptFilters,
  receiptAccountQuery,
  receiptMappingInput,
  receiptPrepareInput,
  receiptIdParams,
  receiptDraftInput,
  receiptSubmitInput,
  receiptReopenInput,
} from '../validations/receipts.validation.js';

export const reference: RequestHandler = async (_req, res) => {
  const { number } = validated(res, receiptReferenceQuery, 'query');
  res.json(await receipts.receiptReference(number));
};
export const overview: RequestHandler = async (_req, res) => {
  res.json(await receipts.receiptOverview(validated(res, receiptFilters, 'query')));
};
export const configuration: RequestHandler = async (_req, res) => {
  res.json(await receipts.receiptConfiguration());
};
export const accounts: RequestHandler = async (_req, res) => {
  res.json(await receipts.searchAccounts(validated(res, receiptAccountQuery, 'query')));
};
export const saveMapping: RequestHandler = async (req, res) => {
  res.json(await receipts.saveReceiptMapping(validated(res, receiptMappingInput), req.actor.id));
};
export const prepare: RequestHandler = async (req, res) => {
  const input = validated(res, receiptPrepareInput);
  res.json(await receipts.prepareReceipt(input.invoiceId, input.sourceKey, req.actor.id));
};
export const detail: RequestHandler = async (_req, res) => {
  res.json(await receipts.receiptDetail(validated(res, receiptIdParams, 'params').id));
};
export const saveDraft: RequestHandler = async (req, res) => {
  res.json(
    await receipts.saveReceiptDraft(
      validated(res, receiptIdParams, 'params').id,
      validated(res, receiptDraftInput),
      req.actor.id,
    ),
  );
};
export const submit: RequestHandler = async (req, res) => {
  res.json(
    await delivery.submitReceipt(
      validated(res, receiptIdParams, 'params').id,
      validated(res, receiptSubmitInput).version,
      req.actor.id,
    ),
  );
};
export const check: RequestHandler = async (req, res) => {
  res.json(await delivery.checkReceipt(validated(res, receiptIdParams, 'params').id, req.actor.id));
};
export const reopen: RequestHandler = async (req, res) => {
  res.json(
    await delivery.reopenReceipt(
      validated(res, receiptIdParams, 'params').id,
      validated(res, receiptReopenInput).version,
      req.actor.id,
    ),
  );
};
