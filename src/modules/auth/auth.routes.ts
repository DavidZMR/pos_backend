import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { sendError } from '../../common/http/response.js';
import { env } from '../../config/index.js';
import * as controller from './auth.controller.js';
import { authenticate } from './auth.middleware.js';

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  handler: (_req, res) => {
    sendError(res, 429, 'TOO_MANY_ATTEMPTS', 'Demasiados intentos. Espera unos minutos.');
  },
});

export const authRouter = Router();

authRouter.post('/login', loginLimiter, controller.login);
authRouter.get('/me', authenticate, controller.me);
authRouter.post('/change-password', authenticate, controller.changePassword);
