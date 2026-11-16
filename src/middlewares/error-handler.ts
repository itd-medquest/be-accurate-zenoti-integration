import type { ErrorRequestHandler } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { HttpError } from '../utils/http-error.js';

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof multer.MulterError)
    return res
      .status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
      .json({
        error:
          'Batas upload: 20 file, maksimal 5 MB per file dan total 25 MB. Periksa file yang dipilih.',
      });
  if (error instanceof ZodError)
    return res
      .status(400)
      .json({ error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
  if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
  console.error(
    JSON.stringify({
      event: 'api.error',
      message: error instanceof Error ? error.message : 'unknown',
    }),
  );
  res.status(500).json({ error: 'Terjadi kesalahan pada server. Silakan coba kembali.' });
};
