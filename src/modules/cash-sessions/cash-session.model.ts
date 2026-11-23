import { type HydratedDocument, type InferSchemaType, model, Schema } from 'mongoose';
import { jsonOptions } from '../../db/schema-options.js';

export const PAYMENT_METHODS = ['cash', 'card', 'transfer', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const integer = { validator: Number.isSafeInteger, message: '{PATH} debe ser un entero' };

/** Entradas/salidas manuales de efectivo durante el turno (cambio, pago a proveedor, retiro…). */
const cashMovementSchema = new Schema(
  {
    type: { type: String, enum: ['in', 'out'], required: true },
    amountCents: { type: Number, required: true, min: 1, validate: integer },
    reason: { type: String, required: true, maxlength: 200 },
    userName: { type: String, required: true },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const methodTotalsSchema = new Schema(
  {
    cash: { type: Number, default: 0 },
    card: { type: Number, default: 0 },
    transfer: { type: Number, default: 0 },
    other: { type: Number, default: 0 },
  },
  { _id: false },
);

/**
 * Turno de caja de un cajero: se abre con un fondo, acumula ventas y movimientos de efectivo,
 * y se cierra con el corte (efectivo contado vs esperado). El resumen se congela al cerrar.
 */
const cashSessionSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    folio: { type: Number, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String, required: true },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    openedAt: { type: Date, required: true },
    openingFloatCents: { type: Number, required: true, min: 0, validate: integer },
    movements: { type: [cashMovementSchema], default: [] },
    notes: { type: String, default: '', maxlength: 500 },
    // ---- Corte (al cerrar) ----
    closedAt: { type: Date, default: null },
    closedByName: { type: String, default: '' },
    countedCashCents: { type: Number, default: null },
    expectedCashCents: { type: Number, default: null },
    differenceCents: { type: Number, default: null },
    salesCount: { type: Number, default: 0 },
    salesTotalCents: { type: Number, default: 0 },
    cancelledCount: { type: Number, default: 0 },
    byMethod: { type: methodTotalsSchema, default: () => ({}) },
  },
  { timestamps: true, toJSON: jsonOptions },
);

cashSessionSchema.index({ businessId: 1, folio: 1 }, { unique: true });
cashSessionSchema.index({ businessId: 1, openedAt: -1 });
// Un solo turno abierto por cajero y negocio.
cashSessionSchema.index(
  { businessId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { status: 'open' } },
);

export type CashSessionData = InferSchemaType<typeof cashSessionSchema>;
export type CashSessionDocument = HydratedDocument<CashSessionData>;

export const CashSession = model('CashSession', cashSessionSchema);
