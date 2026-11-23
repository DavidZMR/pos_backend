import { z } from 'zod';
import { paginationQuerySchema } from '../../common/utils/pagination.js';
import { calendarDateSchema, objectIdSchema, optionalText } from '../../common/validation.js';
import { centsSchema } from '../products/product.schemas.js';

const purchaseItemSchema = z.object({
  productId: objectIdSchema,
  qtyBase: z
    .number({ error: 'Cantidad inválida' })
    .int('La cantidad debe ser entera en unidad base')
    .min(1, 'La cantidad debe ser mayor a cero')
    .max(1_000_000_000, 'Cantidad demasiado grande'),
  unitCostCents: centsSchema,
  /** Si se manda, cambia el precio de venta del producto. */
  newSalePriceCents: centsSchema.optional(),
});

export const createPurchaseSchema = z.object({
  supplierId: objectIdSchema.nullable().optional(),
  invoiceNumber: optionalText(40),
  notes: optionalText(500),
  /** Día de la compra (zona del negocio). Hoy u omitido = ahora. No puede ser futuro. */
  purchaseDate: calendarDateSchema.optional(),
  items: z
    .array(purchaseItemSchema)
    .min(1, 'Agrega al menos un producto')
    .max(300, 'Máximo 300 renglones por entrada'),
});

export const cancelPurchaseSchema = z.object({
  reason: z.string().trim().min(3, 'Escribe el motivo').max(200, 'Máximo 200 caracteres'),
});

export const listPurchasesQuerySchema = paginationQuerySchema.extend({
  from: calendarDateSchema.optional(),
  to: calendarDateSchema.optional(),
  supplierId: objectIdSchema.optional(),
  status: z.enum(['active', 'cancelled']).optional(),
  /** Folio (número) o número de factura/nota. */
  search: z.string().trim().max(40).optional(),
});

export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;
export type ListPurchasesQuery = z.infer<typeof listPurchasesQuerySchema>;
