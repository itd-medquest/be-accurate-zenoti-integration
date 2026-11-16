import type { Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { storageRoot } from '../config/storage.js';
import { HttpError } from '../utils/http-error.js';

mkdirSync(storageRoot, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: storageRoot,
    filename: (_req, _file, cb) => cb(null, randomUUID()),
  }),
  limits: { files: 20, fileSize: 5 * 1024 * 1024, fields: 1, fieldSize: 200, parts: 22 },
  fileFilter: (_req, file, cb) =>
    /\.(pdf|xlsx)$/i.test(file.originalname)
      ? cb(null, true)
      : cb(new HttpError(400, 'Hanya file PDF atau XLSX yang diterima.')),
}).array('files', 20);

type UploadLease = {
  processing: boolean;
  finished: boolean;
  files: Express.Multer.File[];
  release: () => void;
};
let activeUploads = 0;

export function uploadedFiles(req: Request): Express.Multer.File[] {
  return Array.isArray(req.files) ? req.files : [];
}

export const reserveImportSlot: RequestHandler = (_req, res, next) => {
  if (activeUploads >= 2)
    return next(
      new HttpError(503, 'Sedang memproses dua batch. Coba kembali setelah proses selesai.'),
    );
  activeUploads++;
  let released = false;
  const lease: UploadLease = {
    processing: false,
    finished: false,
    files: [],
    release: () => {
      if (!released) {
        released = true;
        activeUploads--;
      }
    },
  };
  res.locals.uploadLease = lease;
  const abandon = () => {
    if (!lease.processing) void completeImportWork(res, false);
  };
  res.once('close', abandon);
  res.once('finish', abandon);
  next();
};

export const uploadInvoiceFiles: RequestHandler = (req, res, next) => {
  reserveImportSlot(req, res, (error) => {
    if (error) return next(error);
    upload(req, res, (uploadError) => {
      const lease = res.locals.uploadLease as UploadLease;
      lease.files = uploadedFiles(req);
      if (uploadError || lease.finished) {
        void Promise.allSettled(lease.files.map((file) => unlink(file.path))).then(() => {
          lease.release();
          if (uploadError) next(uploadError);
        });
        return;
      }
      next();
    });
  });
};

export function beginImportWork(res: Response) {
  (res.locals.uploadLease as UploadLease).processing = true;
}

export async function completeImportWork(res: Response, committed: boolean) {
  const lease = res.locals.uploadLease as UploadLease | undefined;
  if (!lease || lease.finished) return;
  lease.finished = true;
  if (!committed) await Promise.allSettled(lease.files.map((file) => unlink(file.path)));
  lease.release();
}
