import { z } from 'zod';
import { paginationQuerySchema } from '../../common/utils/pagination.js';
import { calendarDateSchema, objectIdSchema, optionalText } from '../../common/validation.js';
import { qtyBaseSchema } from '../products/product.schemas.js';
import { ADJUSTMENT_REASONS, MOVEMENT_TYPES } from './movement.model.js';

/**
 * remove = merma/salida (resta qtyBase) · add = entrada/sobrante (suma qtyBase)
 * set = conteo físico (la existencia pasa a ser qtyBase)
 */
export const createAdjustmentSchema = z
  .object({
    productId: objectIdSchema,
    mode: z.enum(['remove', 'add', 'set'], { error: 'Tipo de ajuste inválido' }),
    qtyBase: qtyBaseSchema,
    reason: z.enum(ADJUSTMENT_REASONS, { error: 'Motivo inválido' }),
    note: optionalText(300),
  })
  .refine((value) => value.mode === 'set' || value.qtyBase > 0, {
    message: 'La cantidad debe ser mayor a cero',
    path: ['qtyBase'],
  });

export const listMovementsQuerySchema = paginationQuerySchema.extend({
  productId: objectIdSchema.optional(),
  type: z.enum(MOVEMENT_TYPES).optional(),
  from: calendarDateSchema.optional(),
  to: calendarDateSchema.optional(),
});

export type CreateAdjustmentInput = z.infer<typeof createAdjustmentSchema>;
export type ListMovementsQuery = z.infer<typeof listMovementsQuerySchema>;
