import { fromNodeHeaders } from 'better-auth/node';
import type { RequestHandler } from 'express';
import { auth } from '../config/auth.js';
import { authenticatedActor } from '../services/auth.service.js';

export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    req.actor = await authenticatedActor(session?.user.id);
    next();
  } catch (error) {
    next(error);
  }
};
