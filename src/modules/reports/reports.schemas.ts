import { z } from 'zod';
import { UNIT_CODES } from '../../common/utils/qty.js';
import { calendarDateSchema, isCalendarDate, objectIdSchema } from '../../common/validation.js';
import { PAYMENT_METHODS } from '../cash-sessions/cash-session.model.js';
import { daysBetween, GRANULARITIES } from './periods.js';

/** Hasta 5 años por consulta (suficiente para comparar años; evita consultas gigantes). */
const MAX_DAYS = 366 * 5;

const rangeFields = {
  from: calendarDateSchema,
  to: calendarDateSchema,
  granularity: z.enum(GRANULARITIES, { error: 'Agrupación inválida' }).optional(),
  categoryId: objectIdSchema.optional(),
  productId: objectIdSchema.optional(),
  cashierId: objectIdSchema.optional(),
  method: z.enum(PAYMENT_METHODS, { error: 'Forma de pago inválida' }).optional(),
};

/** Las reglas de rango solo aplican con ambas fechas válidas (si no, bastan los errores de cada una). */
const bothValid = (q: { from: string; to: string }) =>
  isCalendarDate(String(q.from)) && isCalendarDate(String(q.to));

function withRangeChecks<T extends z.ZodType<{ from: string; to: string }>>(schema: T) {
  return schema
    .refine((q) => !bothValid(q) || q.from <= q.to, {
      message: 'La fecha inicial debe ser anterior a la final',
      path: ['to'],
    })
    .refine((q) => !bothValid(q) || daysBetween(q.from, q.to) <= MAX_DAYS, {
      message: 'El rango no puede pasar de 5 años',
      path: ['from'],
    });
}

export const reportQuerySchema = withRangeChecks(z.object(rangeFields));

export const TOP_SORTS = ['amount', 'profit', 'qty', 'tickets'] as const;

export const topProductsQuerySchema = withRangeChecks(
  z.object({
    ...rangeFields,
    sort: z.enum(TOP_SORTS, { error: 'Orden inválido' }).default('amount'),
    unit: z.enum(UNIT_CODES, { error: 'Unidad inválida' }).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(10),
  }),
).refine((q) => q.sort !== 'qty' || q.unit !== undefined, {
  // Sumar kilos con piezas no tiene sentido: por cantidad se ordena dentro de una unidad.
  message: 'Para ordenar por cantidad elige la unidad (pz, kg o l)',
  path: ['unit'],
});

export const purchasesReportQuerySchema = withRangeChecks(
  z.object({
    from: calendarDateSchema,
    to: calendarDateSchema,
    granularity: z.enum(GRANULARITIES, { error: 'Agrupación inválida' }).optional(),
    supplierId: objectIdSchema.optional(),
    categoryId: objectIdSchema.optional(),
    productId: objectIdSchema.optional(),
  }),
);

export const businessesReportQuerySchema = withRangeChecks(
  z.object({ from: calendarDateSchema, to: calendarDateSchema }),
);

export type ReportQuery = z.infer<typeof reportQuerySchema>;
export type TopProductsQuery = z.infer<typeof topProductsQuerySchema>;
export type PurchasesReportQuery = z.infer<typeof purchasesReportQuerySchema>;
export type BusinessesReportQuery = z.infer<typeof businessesReportQuerySchema>;
