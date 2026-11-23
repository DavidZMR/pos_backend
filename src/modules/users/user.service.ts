import type { QueryFilter } from 'mongoose';
import { badRequest, conflict, forbidden, notFound } from '../../common/http/errors.js';
import { pageMeta, skipFor } from '../../common/utils/pagination.js';
import { containsRegex } from '../../common/utils/text.js';
import type { AuthUser } from '../../types/express.js';
import { hashPassword } from '../auth/password.js';
import { Business } from '../businesses/business.model.js';
import { type Role, User, type UserData, type UserDocument } from './user.model.js';
import type { CreateUserInput, ListUsersQuery, UpdateUserInput } from './user.schemas.js';

/** Qué usuarios puede ver cada rol. */
function visibilityFilter(actor: AuthUser): QueryFilter<UserData> {
  if (actor.role === 'superadmin') return {};
  if (actor.role === 'admin' && actor.businessId) return { businessId: actor.businessId };
  throw forbidden();
}

/** Busca dentro de lo visible: un usuario de otro negocio responde 404 (no se revela que existe). */
async function findVisibleUser(actor: AuthUser, id: string): Promise<UserDocument> {
  const user = await User.findOne({ _id: id, ...visibilityFilter(actor) });
  if (!user) throw notFound('Usuario no encontrado');
  return user;
}

function assertCanManage(actor: AuthUser, target: UserDocument): void {
  if (actor.role === 'superadmin') return;
  if (target.role !== 'employee') throw forbidden('Solo puedes administrar empleados');
}

function assertRoleAllowed(actor: AuthUser, role: Role): void {
  if (actor.role !== 'superadmin' && role !== 'employee') {
    throw forbidden('Un administrador solo puede asignar el rol de empleado');
  }
}

async function assertUsernameAvailable(username: string, exceptId?: string): Promise<void> {
  const taken = await User.exists({ username, ...(exceptId && { _id: { $ne: exceptId } }) });
  if (taken) throw conflict(`El usuario "${username}" ya existe`);
}

/** Negocio que le corresponde al usuario según quién lo crea/edita y su rol. */
async function resolveBusinessId(
  actor: AuthUser,
  role: Role,
  requested: string | undefined,
): Promise<string | null> {
  if (role === 'superadmin') return null;
  if (actor.role !== 'superadmin') return actor.businessId;
  if (!requested) throw badRequest('Indica el negocio del usuario');

  const business = await Business.findById(requested);
  if (!business) throw notFound('Negocio no encontrado');
  if (!business.active) throw badRequest('El negocio está desactivado');
  return business.id;
}

export async function listUsers(actor: AuthUser, query: ListUsersQuery) {
  const filter: QueryFilter<UserData> = { ...visibilityFilter(actor) };
  if (actor.role === 'superadmin' && query.businessId) filter.businessId = query.businessId;
  if (query.role) filter.role = query.role;
  if (query.active !== undefined) filter.active = query.active;
  if (query.search) filter.searchName = containsRegex(query.search);

  const [items, total] = await Promise.all([
    User.find(filter).sort({ name: 1 }).skip(skipFor(query)).limit(query.limit),
    User.countDocuments(filter),
  ]);
  return { items, meta: pageMeta(total, query) };
}

export function getUser(actor: AuthUser, id: string) {
  return findVisibleUser(actor, id);
}

export async function createUser(actor: AuthUser, input: CreateUserInput) {
  assertRoleAllowed(actor, input.role);
  await assertUsernameAvailable(input.username);
  const businessId = await resolveBusinessId(actor, input.role, input.businessId);

  return User.create({
    name: input.name,
    username: input.username,
    passwordHash: await hashPassword(input.password),
    role: input.role,
    businessId,
  });
}

export async function updateUser(actor: AuthUser, id: string, input: UpdateUserInput) {
  const user = await findVisibleUser(actor, id);
  assertCanManage(actor, user);

  const isSelf = user.id === actor.id;
  if (isSelf && input.active === false) throw badRequest('No puedes desactivar tu propio usuario');
  if (isSelf && input.role && input.role !== user.role) {
    throw badRequest('No puedes cambiar tu propio rol');
  }

  const role = input.role ?? user.role;
  assertRoleAllowed(actor, role);

  if (input.username && input.username !== user.username) {
    await assertUsernameAvailable(input.username, user.id);
    user.username = input.username;
  }
  if (input.name) user.name = input.name;
  if (input.active !== undefined) user.active = input.active;
  if (input.password) user.passwordHash = await hashPassword(input.password);

  if (actor.role === 'superadmin' && (input.role || input.businessId)) {
    const current = user.businessId ? String(user.businessId) : undefined;
    user.set('businessId', await resolveBusinessId(actor, role, input.businessId ?? current));
  }
  user.role = role;

  await user.save();
  return user;
}

export function deactivateUser(actor: AuthUser, id: string) {
  return updateUser(actor, id, { active: false });
}
