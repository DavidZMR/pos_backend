import { AppError, badRequest, unauthorized } from '../../common/http/errors.js';
import { Business } from '../businesses/business.model.js';
import { User } from '../users/user.model.js';
import type { ChangePasswordInput, LoginInput } from './auth.schemas.js';
import { hashPassword, verifyPassword } from './password.js';
import { signToken } from './token.js';

export async function login({ username, password }: LoginInput) {
  const user = await User.findOne({ username }).select('+passwordHash');
  const valid = await verifyPassword(password, user?.passwordHash);
  if (!user || !valid) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos');
  }
  if (!user.active) throw new AppError(403, 'USER_INACTIVE', 'Tu usuario está desactivado');

  const business = user.businessId ? await Business.findById(user.businessId) : null;
  if (user.businessId && !business?.active) {
    throw new AppError(403, 'BUSINESS_INACTIVE', 'El negocio está desactivado');
  }

  user.lastLoginAt = new Date();
  await user.save();

  const token = signToken({
    id: user.id,
    role: user.role,
    businessId: user.businessId ? String(user.businessId) : null,
  });
  return { token, user, business };
}

export async function getProfile(userId: string) {
  const user = await User.findById(userId);
  if (!user) throw unauthorized();
  const business = user.businessId ? await Business.findById(user.businessId) : null;
  return { user, business };
}

export async function changePassword(userId: string, input: ChangePasswordInput) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) throw unauthorized();
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw badRequest('La contraseña actual no es correcta');
  }
  user.passwordHash = await hashPassword(input.newPassword);
  await user.save();
}
