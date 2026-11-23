import { z } from 'zod';
import { booleanQuery, paginationQuerySchema } from '../../common/utils/pagination.js';
import { UNIT_CODES } from '../../common/utils/qty.js';
import { objectIdSchema } from '../../common/validation.js';
import { TAX_RATES_BP } from './product.model.js';

/** Máximo $10,000,000.00 por unidad: evita errores de captura absurdos. */
export const centsSchema = z
  .number({ error: 'Debe ser un número' })
  .int('Debe ser un entero en centavos')
  .min(0, 'No puede ser negativo')
  .max(1_000_000_000, 'Monto demasiado grande');

/** Cantidad en unidad base (pz, g, ml). */
export const qtyBaseSchema = z
  .number({ error: 'Debe ser un número' })
  .int('Debe ser un entero en unidad base')
  .min(0, 'No puede ser negativa')
  .max(1_000_000_000, 'Cantidad demasiado grande');

const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, 'Escribe un código')
  .max(20, 'Máximo 20 caracteres')
  .regex(/^[A-Z0-9._-]+$/, 'Solo letras, números, punto o guion');

/** "" borra el código de barras. */
const barcodeSchema = z
  .string()
  .trim()
  .max(64, 'Máximo 64 caracteres')
  .regex(/^[0-9A-Za-z-]*$/, 'Solo números, letras o guion');

const taxRateSchema = z.union(
  [z.literal(TAX_RATES_BP[0]), z.literal(TAX_RATES_BP[1]), z.literal(TAX_RATES_BP[2])],
  { error: 'Tasa de IVA inválida (0, 800 o 1600)' },
);

const productFields = {
  code: codeSchema,
  barcode: barcodeSchema.optional(),
  name: z.string().trim().min(2, 'Mínimo 2 caracteres').max(120, 'Máximo 120 caracteres'),
  categoryId: objectIdSchema.nullable().optional(),
  unit: z.enum(UNIT_CODES, { error: 'Unidad inválida' }),
  salePriceCents: centsSchema,
  costCents: centsSchema,
  taxRateBp: taxRateSchema,
  minStock: qtyBaseSchema,
};

export const createProductSchema = z.object({
  ...productFields,
  costCents: centsSchema.default(0),
  taxRateBp: taxRateSchema.default(1600),
  minStock: qtyBaseSchema.default(0),
  /** Existencia inicial (se registra en el kárdex como "inicial"). */
  initialStock: qtyBaseSchema.default(0),
});

export const updateProductSchema = z
  .object({ ...productFields, active: z.boolean() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'No hay cambios');

export const PRODUCT_SORTS = ['name', 'code', 'stock', 'salePriceCents', 'updatedAt'] as const;

export const listProductsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  categoryId: objectIdSchema.optional(),
  active: booleanQuery.optional(),
  /** low = en o bajo el mínimo (con mínimo definido); out = sin existencia (≤ 0). */
  stock: z.enum(['low', 'out']).optional(),
  sort: z.enum(PRODUCT_SORTS).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

export const lookupQuerySchema = z.object({
  code: z.string().trim().min(1, 'Escribe un código').max(64),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
