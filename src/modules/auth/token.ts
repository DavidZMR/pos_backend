import jwt, { type SignOptions } from 'jsonwebtoken';
import { unauthorized } from '../../common/http/errors.js';
import { env } from '../../config/index.js';
import { ROLES, type Role } from '../users/user.model.js';

export interface TokenSubject {
  id: string;
  role: Role;
  businessId: string | null;
}

export interface TokenPayload {
  sub: string;
  role: Role;
  businessId: string | null;
}

export function signToken(subject: TokenSubject): string {
  return jwt.sign({ role: subject.role, businessId: subject.businessId }, env.JWT_SECRET, {
    subject: subject.id,
    expiresIn: env.JWT_EXPIRES_IN as NonNullable<SignOptions['expiresIn']>,
  });
}

export function verifyToken(token: string): TokenPayload {
  let decoded: string | jwt.JwtPayload;
  try {
    decoded = jwt.verify(token, env.JWT_SECRET);
  } catch {
    throw unauthorized('Sesión inválida o expirada');
  }
  if (typeof decoded === 'string' || !decoded.sub || !ROLES.includes(decoded.role)) {
    throw unauthorized('Sesión inválida o expirada');
  }
  return {
    sub: decoded.sub,
    role: decoded.role as Role,
    businessId: typeof decoded.businessId === 'string' ? decoded.businessId : null,
  };
}
