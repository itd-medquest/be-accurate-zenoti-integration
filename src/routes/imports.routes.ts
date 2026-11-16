import { Router } from 'express';
import * as imports from '../controllers/imports.controller.js';
import { overview } from '../controllers/import-overview.controller.js';
import { importOverviewQuerySchema } from '../validations/import-overview.validation.js';
import { reserveImportSlot, uploadInvoiceFiles } from '../middlewares/upload.js';
import { validate } from '../middlewares/validate.js';
import {
  addItemBodySchema,
  correctItemBodySchema,
  listQuerySchema,
  packageReviewBodySchema,
  previewQuerySchema,
  removeBodySchema,
  removeFileBodySchema,
  removeItemBodySchema,
  reparseBodySchema,
  reviewBodySchema,
  reviewedBodySchema,
  submitBodySchema,
  templateQuerySchema,
  uploadBodySchema,
} from '../validations/imports.validation.js';
import {
  fileParamsSchema,
  idParamsSchema,
  itemParamsSchema,
  rowParamsSchema,
} from '../validations/params.validation.js';

export const importsRouter = Router();
importsRouter.get('/template', validate({ query: templateQuerySchema }), imports.template);
importsRouter.get('/overview', validate({ query: importOverviewQuerySchema }), overview);
importsRouter.get('/', validate({ query: listQuerySchema }), imports.list);
importsRouter.post('/', uploadInvoiceFiles, validate({ body: uploadBodySchema }), imports.create);
importsRouter.get('/:id', validate({ params: idParamsSchema }), imports.detail);
importsRouter.post(
  '/:id/files/:fileId/reparse',
  validate({ params: fileParamsSchema, body: reparseBodySchema }),
  reserveImportSlot,
  imports.reparse,
);
importsRouter.patch(
  '/:id/rows/:rowId',
  validate({ params: rowParamsSchema, body: reviewBodySchema }),
  imports.review,
);
importsRouter.post(
  '/:id/submit',
  validate({ params: idParamsSchema, body: submitBodySchema }),
  imports.submit,
);
importsRouter.get('/:id/files/:fileId', validate({ params: fileParamsSchema }), imports.download);
importsRouter.get(
  '/:id/files/:fileId/preview',
  validate({ params: fileParamsSchema, query: previewQuerySchema }),
  imports.preview,
);
importsRouter.delete(
  '/:id',
  validate({ params: idParamsSchema, body: removeBodySchema }),
  imports.remove,
);
importsRouter.patch(
  '/:id/rows/:rowId/package',
  validate({ params: rowParamsSchema, body: packageReviewBodySchema }),
  imports.packageReview,
);
importsRouter.patch(
  '/:id/rows/:rowId/reviewed',
  validate({ params: rowParamsSchema, body: reviewedBodySchema }),
  imports.reviewed,
);
importsRouter.delete(
  '/:id/files/:fileId',
  validate({ params: fileParamsSchema, body: removeFileBodySchema }),
  imports.removeFile,
);
importsRouter.post(
  '/:id/rows/:rowId/items',
  validate({ params: rowParamsSchema, body: addItemBodySchema }),
  imports.addItem,
);
importsRouter.delete(
  '/:id/rows/:rowId/items/:itemId',
  validate({ params: itemParamsSchema, body: removeItemBodySchema }),
  imports.removeItem,
);
importsRouter.patch(
  '/:id/rows/:rowId/items/:itemId',
  validate({ params: itemParamsSchema, body: correctItemBodySchema }),
  imports.correctItem,
);
