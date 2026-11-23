import type { Types } from 'mongoose';
import { createApp } from '../app.js';
import { hashPassword } from '../modules/auth/password.js';
import { signToken } from '../modules/auth/token.js';
import { Business } from '../modules/businesses/business.model.js';
import { type Role, User, type UserDocument } from '../modules/users/user.model.js';

export const TEST_PASSWORD = 'Password123';

let sequence = 0;
const next = () => ++sequence;

export const testApp = () => createApp({ corsOrigins: [], requestLogging: false });

export function createBusiness(overrides: Record<string, unknown> = {}) {
  return Business.create({ name: `Negocio ${next()}`, ...overrides });
}

interface UserOverrides {
  role?: Role;
  businessId?: Types.ObjectId | string | null;
  username?: string;
  name?: string;
  password?: string;
  active?: boolean;
}

export async function createUser(overrides: UserOverrides = {}): Promise<UserDocument> {
  const n = next();
  const { password = TEST_PASSWORD, role = 'employee', ...rest } = overrides;
  return User.create({
    name: `Usuario ${n}`,
    username: `user${n}`,
    role,
    passwordHash: await hashPassword(password),
    ...rest,
  });
}

export function tokenFor(user: UserDocument): string {
  return signToken({
    id: user.id,
    role: user.role,
    businessId: user.businessId ? String(user.businessId) : null,
  });
}

export const bearer = (user: UserDocument) => ({ Authorization: `Bearer ${tokenFor(user)}` });

/** Escenario típico: superadmin + dos negocios, cada uno con su admin y su empleado. */
export async function seedTwoBusinesses() {
  const superadmin = await createUser({ role: 'superadmin' });
  const businessA = await createBusiness({ name: 'Mariscos El Faro' });
  const businessB = await createBusiness({ name: 'Abarrotes La Esquina' });
  const [adminA, employeeA, adminB, employeeB] = await Promise.all([
    createUser({ role: 'admin', businessId: businessA._id }),
    createUser({ role: 'employee', businessId: businessA._id }),
    createUser({ role: 'admin', businessId: businessB._id }),
    createUser({ role: 'employee', businessId: businessB._id }),
  ]);
  return { superadmin, businessA, businessB, adminA, employeeA, adminB, employeeB };
}
