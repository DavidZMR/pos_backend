import { z } from 'zod';
import { paginationQuerySchema } from '../../common/utils/pagination.js';
import { calendarDateSchema, objectIdSchema } from '../../common/validation.js';
import { PAYMENT_METHODS } from '../cash-sessions/cash-session.model.js';
import { centsSchema } from '../products/product.schemas.js';

export const createSaleSchema = z
  .object({
    items: z
      .array(
        z.object({
          productId: objectIdSchema,
          qtyBase: z
            .number({ error: 'Cantidad inválida' })
            .int('La cantidad debe ser entera en unidad base')
            .min(1, 'La cantidad debe ser mayor a cero')
            .max(1_000_000_000, 'Cantidad demasiado grande'),
          weighed: z.boolean().optional(),
        }),
      )
      .min(1, 'La venta no tiene productos')
      .max(300, 'Máximo 300 renglones por venta'),
    /** Forma de pago (informativa). La suma debe ser igual al total. */
    payments: z
      .array(z.object({ method: z.enum(PAYMENT_METHODS), amountCents: centsSchema }))
      .min(1, 'Indica la forma de pago')
      .max(4),
    /** Efectivo entregado por el cliente (para calcular el cambio). */
    cashReceivedCents: centsSchema.optional(),
    /**
     * Total que vio el cajero. Si los precios cambiaron mientras tanto, la venta se rechaza
     * con 409 PRICE_CHANGED para no cobrar algo distinto a lo mostrado.
     */
    expectedTotalCents: centsSchema,
  })
  .refine((v) => new Set(v.payments.map((p) => p.method)).size === v.payments.length, {
    message: 'Forma de pago repetida',
    path: ['payments'],
  });

export const cancelSaleSchema = z.object({
  reason: z.string().trim().min(3, 'Escribe el motivo').max(200, 'Máximo 200 caracteres'),
});

export const listSalesQuerySchema = paginationQuerySchema.extend({
  from: calendarDateSchema.optional(),
  to: calendarDateSchema.optional(),
  status: z.enum(['completed', 'cancelled']).optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  cashierId: objectIdSchema.optional(),
  cashSessionId: objectIdSchema.optional(),
  /** Folio: "V-000012" o "12". */
  search: z.string().trim().max(20).optional(),
});

export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type ListSalesQuery = z.infer<typeof listSalesQuerySchema>;
