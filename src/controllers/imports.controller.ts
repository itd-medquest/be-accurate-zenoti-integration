import type { RequestHandler } from 'express';
import { beginImportWork, completeImportWork, uploadedFiles } from '../middlewares/upload.js';
import { validated } from '../middlewares/validate.js';
import * as source from '../services/import-source.service.js';
import * as imports from '../services/import.service.js';
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

export const template: RequestHandler = async (req, res) => {
  const input = validated(res, templateQuerySchema, 'query');
  const example = input.example === 'true';
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${example ? 'contoh' : 'template'}-sales-accrual.xlsx"`,
  );
  res
    .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .send(await source.template(example));
};

export const list: RequestHandler = async (req, res) => {
  const query = validated(res, listQuerySchema, 'query');
  res.json(await imports.listImports(query.page, query.pageSize));
};

export const create: RequestHandler = async (req, res) => {
  beginImportWork(res);
  let committed = false;
  try {
    const { branchId } = validated(res, uploadBodySchema);
    const result = await imports.createImport(branchId, req.actor.id, uploadedFiles(req));
    committed = true;
    res.status(201).json(result);
  } finally {
    await completeImportWork(res, committed);
  }
};

export const detail: RequestHandler = async (req, res) => {
  res.json(await imports.getImport(String(req.params.id)));
};

export const reparse: RequestHandler = async (req, res) => {
  beginImportWork(res);
  try {
    const input = validated(res, reparseBodySchema);
    res.json(
      await imports.reparseImportFile(
        String(req.params.id),
        String(req.params.fileId),
        input.version,
        req.actor.id,
        input.resetReview,
      ),
    );
  } finally {
    await completeImportWork(res, true);
  }
};

export const review: RequestHandler = async (req, res) => {
  const body = validated(res, reviewBodySchema);
  res.json(
    await imports.reviewRow(
      String(req.params.id),
      String(req.params.rowId),
      body.version,
      body.businessStatus,
      req.actor.id,
    ),
  );
};

export const submit: RequestHandler = async (req, res) => {
  const body = validated(res, submitBodySchema);
  res.json(
    await imports.submitImport(String(req.params.id), body.version, body.rowIds, req.actor.id),
  );
};

export const download: RequestHandler = async (req, res) => {
  const file = await source.download(
    String(req.params.id),
    String(req.params.fileId),
    req.actor.id,
  );
  res.setHeader('Cache-Control', 'no-store');
  res.download(file.path, file.name);
};

export const preview: RequestHandler = async (req, res) => {
  const query = validated(res, previewQuerySchema, 'query');
  const result = await source.preview(String(req.params.id), String(req.params.fileId), query);
  res.setHeader('Cache-Control', 'no-store');
  res.json(result);
};

export const remove: RequestHandler = async (req, res) => {
  const body = validated(res, removeBodySchema);
  res.json(await imports.deleteImport(String(req.params.id), body.version, req.actor.id));
};

export const packageReview: RequestHandler = async (req, res) => {
  const body = validated(res, packageReviewBodySchema);
  res.json(
    await imports.reviewPackage(
      String(req.params.id),
      String(req.params.rowId),
      body.version,
      body.parentLineId,
      body.items,
      req.actor.id,
    ),
  );
};

export const reviewed: RequestHandler = async (req, res) => {
  const body = validated(res, reviewedBodySchema);
  res.json(
    await imports.markImportRowReviewed(
      String(req.params.id),
      String(req.params.rowId),
      body.version,
      req.actor.id,
      body.exceptionReason,
    ),
  );
};

export const removeFile: RequestHandler = async (req, res) => {
  const body = validated(res, removeFileBodySchema);
  res.json(
    await imports.deleteImportFile(
      String(req.params.id),
      String(req.params.fileId),
      body.version,
      req.actor.id,
    ),
  );
};

export const addItem: RequestHandler = async (req, res) => {
  const body = validated(res, addItemBodySchema);
  res
    .status(201)
    .json(
      await imports.addImportItem(
        String(req.params.id),
        String(req.params.rowId),
        body.version,
        body,
        req.actor.id,
      ),
    );
};

export const removeItem: RequestHandler = async (req, res) => {
  const body = validated(res, removeItemBodySchema);
  res.json(
    await imports.deleteImportItem(
      String(req.params.id),
      String(req.params.rowId),
      String(req.params.itemId),
      body.version,
      req.actor.id,
    ),
  );
};

export const correctItem: RequestHandler = async (req, res) => {
  const body = validated(res, correctItemBodySchema);
  res.json(
    await imports.correctImportItem(
      String(req.params.id),
      String(req.params.rowId),
      String(req.params.itemId),
      body.version,
      body,
      req.actor.id,
    ),
  );
};
