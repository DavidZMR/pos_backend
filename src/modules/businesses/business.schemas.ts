import { z } from 'zod';
import { booleanQuery, paginationQuerySchema } from '../../common/utils/pagination.js';
import { optionalText } from '../../common/validation.js';

const timezoneSchema = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('es-MX', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Zona horaria inválida');

/** RFC: 3 letras (persona moral) o 4 (física) + fecha AAMMDD + homoclave de 3. Vacío = sin RFC. */
const RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}$/i;
const taxIdSchema = optionalText(20).refine(
  (value) => !value || RFC.test(value),
  'RFC inválido (12 o 13 caracteres, p. ej. ABC010101XY1)',
);

const businessFields = {
  name: z
    .string()
    .trim()
    .min(2, 'El nombre debe tener al menos 2 caracteres')
    .max(120, 'Máximo 120 caracteres'),
  legalName: optionalText(160),
  taxId: taxIdSchema,
  phone: optionalText(30),
  address: optionalText(250),
  timezone: timezoneSchema.optional(),
  ticket: z
    .object({
      header: z.string().max(500, 'Máximo 500 caracteres').optional(),
      footer: z.string().max(500, 'Máximo 500 caracteres').optional(),
    })
    .optional(),
  settings: z
    .object({
      allowNegativeStock: z.boolean().optional(),
    })
    .optional(),
};

export const createBusinessSchema = z.object(businessFields);

/** Lo que el superadmin puede cambiar de cualquier negocio. */
export const updateBusinessSchema = z
  .object({ ...businessFields, active: z.boolean() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'No hay cambios');

/** Lo que el admin puede cambiar de su propio negocio (no puede desactivarlo). */
export const updateCurrentBusinessSchema = z
  .object(businessFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'No hay cambios');

export const listBusinessesQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  active: booleanQuery.optional(),
});

export type CreateBusinessInput = z.infer<typeof createBusinessSchema>;
export type UpdateBusinessInput = z.infer<typeof updateBusinessSchema>;
export type UpdateCurrentBusinessInput = z.infer<typeof updateCurrentBusinessSchema>;
export type ListBusinessesQuery = z.infer<typeof listBusinessesQuerySchema>;
