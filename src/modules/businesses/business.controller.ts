import type { RequestHandler } from 'express';
import { sendCreated, sendOk } from '../../common/http/response.js';
import { idParamsSchema } from '../../common/validation.js';
import { requireBusinessId } from '../auth/tenant.middleware.js';
import {
  createBusinessSchema,
  listBusinessesQuerySchema,
  updateBusinessSchema,
  updateCurrentBusinessSchema,
} from './business.schemas.js';
import * as service from './business.service.js';

export const list: RequestHandler = async (req, res) => {
  const { items, meta } = await service.listBusinesses(listBusinessesQuerySchema.parse(req.query));
  sendOk(res, items, { meta: { ...meta } });
};

export const getById: RequestHandler = async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  sendOk(res, await service.getBusiness(id));
};

export const create: RequestHandler = async (req, res) => {
  const business = await service.createBusiness(createBusinessSchema.parse(req.body));
  sendCreated(res, business, 'Negocio creado');
};

export const update: RequestHandler = async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  const business = await service.updateBusiness(id, updateBusinessSchema.parse(req.body));
  sendOk(res, business, { message: 'Negocio actualizado' });
};

export const deactivate: RequestHandler = async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  sendOk(res, await service.deactivateBusiness(id), { message: 'Negocio desactivado' });
};

export const getCurrent: RequestHandler = async (req, res) => {
  sendOk(res, await service.getBusiness(requireBusinessId(req)));
};

export const updateCurrent: RequestHandler = async (req, res) => {
  const input = updateCurrentBusinessSchema.parse(req.body);
  const business = await service.updateBusiness(requireBusinessId(req), input);
  sendOk(res, business, { message: 'Datos del negocio actualizados' });
};
