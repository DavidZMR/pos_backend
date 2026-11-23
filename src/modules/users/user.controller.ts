import type { RequestHandler } from 'express';
import { sendCreated, sendOk } from '../../common/http/response.js';
import { idParamsSchema } from '../../common/validation.js';
import { requireUser } from '../auth/auth.middleware.js';
import { createUserSchema, listUsersQuerySchema, updateUserSchema } from './user.schemas.js';
import * as service from './user.service.js';

export const list: RequestHandler = async (req, res) => {
  const query = listUsersQuerySchema.parse(req.query);
  const { items, meta } = await service.listUsers(requireUser(req), query);
  sendOk(res, items, { meta: { ...meta } });
};

export const getById: RequestHandler = async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  sendOk(res, await service.getUser(requireUser(req), id));
};

export const create: RequestHandler = async (req, res) => {
  const user = await service.createUser(requireUser(req), createUserSchema.parse(req.body));
  sendCreated(res, user, 'Usuario creado');
};

export const update: RequestHandler = async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  const user = await service.updateUser(requireUser(req), id, updateUserSchema.parse(req.body));
  sendOk(res, user, { message: 'Usuario actualizado' });
};

export const deactivate: RequestHandler = async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  sendOk(res, await service.deactivateUser(requireUser(req), id), {
    message: 'Usuario desactivado',
  });
};
