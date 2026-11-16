import { toNodeHandler } from 'better-auth/node';
import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { auth } from './config/auth.js';
import { config } from './config/env.js';
import { health } from './controllers/system.controller.js';
import { authenticate } from './middlewares/authenticate.js';
import { errorHandler } from './middlewares/error-handler.js';
import { verifyOrigin } from './middlewares/origin.js';
import { apiRouter } from './routes/index.js';
import { passwordResetRouter } from './routes/password-reset.routes.js';

export const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: config.FRONTEND_URL, credentials: true }));
app.use('/api', rateLimit({ windowMs: 60000, limit: 240 }));
app.use(verifyOrigin);
// Better Auth must receive the unparsed body.
app.all('/api/auth/*splat', toNodeHandler(auth));
app.use(express.json({ limit: '128kb' }));
app.get('/api/health', health);
app.use('/api/password-reset', passwordResetRouter);
app.use('/api', authenticate, apiRouter);
app.use(errorHandler);
