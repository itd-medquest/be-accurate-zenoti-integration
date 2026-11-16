import type { RequestHandler } from 'express';
import { config } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';

export const verifyOrigin: RequestHandler = (req, _res, next) => {
  if (
    ['POST', 'PATCH', 'DELETE', 'PUT'].includes(req.method) &&
    !req.path.startsWith('/api/auth') &&
    req.headers.origin !== config.FRONTEND_URL
  )
    return next(new HttpError(403, 'Origin request tidak diizinkan.'));
  next();
};
