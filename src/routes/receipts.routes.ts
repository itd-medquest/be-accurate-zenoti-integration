import { Router } from 'express';
import * as receipts from '../controllers/receipts.controller.js';
import { admin, operate } from '../middlewares/authorize.js';
import { validate } from '../middlewares/validate.js';
import {
  receiptReferenceQuery,
  receiptFilters,
  receiptAccountQuery,
  receiptMappingInput,
  receiptPrepareInput,
  receiptIdParams,
  receiptDraftInput,
  receiptSubmitInput,
  receiptCheckInput,
  receiptReopenInput,
} from '../validations/receipts.validation.js';

export const receiptsRouter = Router();
receiptsRouter.get(
  '/reference',
  operate,
  validate({ query: receiptReferenceQuery }),
  receipts.reference,
);
receiptsRouter.get('/', operate, validate({ query: receiptFilters }), receipts.overview);
receiptsRouter.get('/configuration', operate, receipts.configuration);
receiptsRouter.get(
  '/accounts',
  operate,
  validate({ query: receiptAccountQuery }),
  receipts.accounts,
);
receiptsRouter.put(
  '/mappings',
  admin,
  validate({ body: receiptMappingInput }),
  receipts.saveMapping,
);
receiptsRouter.post('/drafts', operate, validate({ body: receiptPrepareInput }), receipts.prepare);
receiptsRouter.get('/:id', operate, validate({ params: receiptIdParams }), receipts.detail);
receiptsRouter.post(
  '/:id/check',
  operate,
  validate({ params: receiptIdParams, body: receiptCheckInput }),
  receipts.check,
);
receiptsRouter.post(
  '/:id/reopen',
  operate,
  validate({ params: receiptIdParams, body: receiptReopenInput }),
  receipts.reopen,
);
receiptsRouter.post(
  '/:id/submit',
  operate,
  validate({ params: receiptIdParams, body: receiptSubmitInput }),
  receipts.submit,
);
receiptsRouter.put(
  '/:id',
  operate,
  validate({ params: receiptIdParams, body: receiptDraftInput }),
  receipts.saveDraft,
);
