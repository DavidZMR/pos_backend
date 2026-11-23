import type { Request, RequestHandler } from 'express';
import { forbidden, unauthorized } from '../../common/http/errors.js';
import type { AuthUser } from '../../types/express.js';
import { type Role, User } from '../users/user.model.js';
import { verifyToken } from './token.js';

/**
 * Verifica el Bearer token y carga el usuario desde la BD en cada petición,
 * de modo que desactivar un usuario corta su acceso de inmediato.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();

  const payload = verifyToken(header.slice('Bearer '.length).trim());
  const user = await User.findById(payload.sub)
    .select('name username role businessId active')
    .lean();
  if (!user?.active) throw unauthorized('Sesión inválida o usuario desactivado');

  req.user = {
    id: String(user._id),
    name: user.name,
    username: user.username,
    role: user.role,
    businessId: user.businessId ? String(user.businessId) : null,
  };
  next();
};

/** Restringe la ruta a los roles indicados (usar después de `authenticate`). */
export function authorize(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!roles.includes(requireUser(req).role)) throw forbidden();
    next();
  };
}

export function requireUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
