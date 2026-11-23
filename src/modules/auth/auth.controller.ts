import type { RequestHandler } from 'express';
import { sendOk } from '../../common/http/response.js';
import { requireUser } from './auth.middleware.js';
import { changePasswordSchema, loginSchema } from './auth.schemas.js';
import * as authService from './auth.service.js';

export const login: RequestHandler = async (req, res) => {
  const result = await authService.login(loginSchema.parse(req.body));
  sendOk(res, result);
};

export const me: RequestHandler = async (req, res) => {
  sendOk(res, await authService.getProfile(requireUser(req).id));
};

export const changePassword: RequestHandler = async (req, res) => {
  await authService.changePassword(requireUser(req).id, changePasswordSchema.parse(req.body));
  sendOk(res, null, { message: 'Contraseña actualizada' });
};
