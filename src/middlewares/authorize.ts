import type { RequestHandler } from 'express';
import { HttpError } from '../utils/http-error.js';

export const permit =
  (...allowed: string[]): RequestHandler =>
  (req, _res, next) =>
    allowed.includes(req.actor.role)
      ? next()
      : next(new HttpError(403, 'Role Anda tidak memiliki izin untuk tindakan ini.'));
export const admin = permit('super_admin');
export const operate = permit('super_admin', 'finance');
