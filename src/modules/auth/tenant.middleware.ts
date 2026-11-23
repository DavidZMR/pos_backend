import type { Request, RequestHandler } from 'express';
import { badRequest, forbidden, notFound } from '../../common/http/errors.js';
import { objectIdSchema } from '../../common/validation.js';
import { Business } from '../businesses/business.model.js';
import { requireUser } from './auth.middleware.js';

export const BUSINESS_HEADER = 'x-business-id';

interface TenantOptions {
  /** Si es true y el superadmin no envía x-business-id, responde 400. */
  required?: boolean;
}

/**
 * Fija `req.businessId`:
 * - admin / employee → siempre su propio negocio (ignora el encabezado).
 * - superadmin → el negocio del encabezado `x-business-id` (debe existir).
 */
export function resolveTenant({ required = true }: TenantOptions = {}): RequestHandler {
  return async (req, _res, next) => {
    const user = requireUser(req);

    if (user.role !== 'superadmin') {
      if (!user.businessId) throw forbidden('Tu usuario no tiene un negocio asignado');
      req.businessId = user.businessId;
      next();
      return;
    }

    const raw = req.header(BUSINESS_HEADER);
    if (!raw) {
      if (required) throw badRequest(`Selecciona un negocio (encabezado ${BUSINESS_HEADER})`);
      next();
      return;
    }

    const parsed = objectIdSchema.safeParse(raw);
    if (!parsed.success) throw badRequest(`${BUSINESS_HEADER} inválido`);
    if (!(await Business.exists({ _id: parsed.data }))) throw notFound('Negocio no encontrado');

    req.businessId = parsed.data;
    next();
  };
}

export function requireBusinessId(req: Request): string {
  if (!req.businessId) throw badRequest(`Selecciona un negocio (encabezado ${BUSINESS_HEADER})`);
  return req.businessId;
}
