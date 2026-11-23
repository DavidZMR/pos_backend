import { z } from 'zod';
import { booleanQuery, paginationQuerySchema } from '../../common/utils/pagination.js';

const nameSchema = z.string().trim().min(2, 'Mínimo 2 caracteres').max(60, 'Máximo 60 caracteres');

export const createCategorySchema = z.object({ name: nameSchema });

export const updateCategorySchema = z
  .object({ name: nameSchema, active: z.boolean() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'No hay cambios');

export const listCategoriesQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  active: booleanQuery.optional(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type ListCategoriesQuery = z.infer<typeof listCategoriesQuerySchema>;
