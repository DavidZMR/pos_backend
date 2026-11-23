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

const businessFields = {
  name: z.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres').max(120),
  legalName: optionalText(160),
  taxId: optionalText(20),
  phone: optionalText(30),
  address: optionalText(250),
  timezone: timezoneSchema.optional(),
  ticket: z
    .object({
      header: z.string().max(500).optional(),
      footer: z.string().max(500).optional(),
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
