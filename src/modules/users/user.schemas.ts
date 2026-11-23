import { z } from 'zod';
import { booleanQuery, paginationQuerySchema } from '../../common/utils/pagination.js';
import { objectIdSchema } from '../../common/validation.js';
import { passwordSchema } from '../auth/auth.schemas.js';
import { ROLES, USERNAME_PATTERN } from './user.model.js';

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'El usuario debe tener al menos 3 caracteres')
  .max(40, 'El usuario debe tener máximo 40 caracteres')
  .regex(USERNAME_PATTERN, 'Usa solo minúsculas, números, punto, guion o guion bajo');

const nameSchema = z.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres').max(120);

export const createUserSchema = z.object({
  name: nameSchema,
  username: usernameSchema,
  password: passwordSchema,
  role: z.enum(ROLES).default('employee'),
  /** Solo lo usa el superadmin; para un admin siempre es su propio negocio. */
  businessId: objectIdSchema.optional(),
});

export const updateUserSchema = z
  .object({
    name: nameSchema,
    username: usernameSchema,
    password: passwordSchema,
    role: z.enum(ROLES),
    businessId: objectIdSchema,
    active: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'No hay cambios');

export const listUsersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  role: z.enum(ROLES).optional(),
  active: booleanQuery.optional(),
  /** Filtro del superadmin; se ignora para admin. */
  businessId: objectIdSchema.optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
