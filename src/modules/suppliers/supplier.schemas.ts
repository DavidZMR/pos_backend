import { z } from 'zod';
import { booleanQuery, paginationQuerySchema } from '../../common/utils/pagination.js';
import { optionalText } from '../../common/validation.js';

const supplierFields = {
  name: z.string().trim().min(2, 'Mínimo 2 caracteres').max(120, 'Máximo 120 caracteres'),
  contactName: optionalText(120),
  phone: optionalText(30),
  email: z
    .union([z.literal(''), z.string().trim().toLowerCase().pipe(z.email('Correo inválido'))])
    .optional(),
  notes: optionalText(500),
};

export const createSupplierSchema = z.object(supplierFields);

export const updateSupplierSchema = z
  .object({ ...supplierFields, active: z.boolean() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'No hay cambios');

export const listSuppliersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  active: booleanQuery.optional(),
});

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>;
