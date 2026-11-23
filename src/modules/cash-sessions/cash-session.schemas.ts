import { z } from 'zod';
import { paginationQuerySchema } from '../../common/utils/pagination.js';
import { objectIdSchema, optionalText } from '../../common/validation.js';
import { centsSchema } from '../products/product.schemas.js';
import { calendarDateSchema } from '../purchases/purchase.schemas.js';

export const openCashSessionSchema = z.object({
  openingFloatCents: centsSchema,
  notes: optionalText(500),
});

export const cashMovementSchema = z.object({
  type: z.enum(['in', 'out'], { error: 'Tipo inválido' }),
  amountCents: centsSchema.refine((v) => v > 0, 'El monto debe ser mayor a cero'),
  reason: z.string().trim().min(3, 'Escribe el motivo').max(200, 'Máximo 200 caracteres'),
});

export const closeCashSessionSchema = z.object({
  countedCashCents: centsSchema,
  notes: optionalText(500),
});

export const listCashSessionsQuerySchema = paginationQuerySchema.extend({
  from: calendarDateSchema.optional(),
  to: calendarDateSchema.optional(),
  status: z.enum(['open', 'closed']).optional(),
  userId: objectIdSchema.optional(),
});

export type OpenCashSessionInput = z.infer<typeof openCashSessionSchema>;
export type CashMovementInput = z.infer<typeof cashMovementSchema>;
export type CloseCashSessionInput = z.infer<typeof closeCashSessionSchema>;
export type ListCashSessionsQuery = z.infer<typeof listCashSessionsQuerySchema>;
