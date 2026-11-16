import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import * as reset from '../controllers/password-reset.controller.js';
import { validate } from '../middlewares/validate.js';
import { completeResetSchema, requestResetSchema, verifyResetSchema } from '../validations/password-reset.validation.js';

const limiter = (limit: number) => rateLimit({
  windowMs: 15 * 60_000, limit, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Terlalu banyak percobaan. Coba kembali dalam 15 menit.' },
});
export const passwordResetRouter = Router();
passwordResetRouter.post('/request', limiter(5), validate({ body: requestResetSchema }), reset.request);
passwordResetRouter.post('/verify', limiter(15), validate({ body: verifyResetSchema }), reset.verify);
passwordResetRouter.post('/complete', limiter(10), validate({ body: completeResetSchema }), reset.complete);
