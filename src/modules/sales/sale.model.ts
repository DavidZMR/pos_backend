import { type HydratedDocument, type InferSchemaType, model, Schema } from 'mongoose';
import { UNIT_CODES } from '../../common/utils/qty.js';
import { jsonOptions } from '../../db/schema-options.js';
import { PAYMENT_METHODS } from '../cash-sessions/cash-session.model.js';

const integer = { validator: Number.isSafeInteger, message: '{PATH} debe ser un entero' };

/**
 * Renglón vendido con SNAPSHOT de precio, costo e IVA del momento: los reportes de ganancia
 * de fechas pasadas no cambian aunque después cambie el precio del producto.
 */
const saleItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    code: { type: String, required: true },
    name: { type: String, required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    unit: { type: String, enum: UNIT_CODES, required: true },
    qtyBase: { type: Number, required: true, min: 1, validate: integer },
    unitPriceCents: { type: Number, required: true, validate: integer },
    unitCostCents: { type: Number, required: true, validate: integer },
    lineTotalCents: { type: Number, required: true, validate: integer },
    lineCostCents: { type: Number, required: true, validate: integer },
    taxRateBp: { type: Number, required: true },
    taxCents: { type: Number, required: true, validate: integer },
    /** Cantidad tomada de báscula (vs tecleada). */
    weighed: { type: Boolean, default: false },
  },
  { _id: false },
);

const paymentSchema = new Schema(
  {
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    amountCents: { type: Number, required: true, min: 0, validate: integer },
  },
  { _id: false },
);

const saleSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    folio: { type: Number, required: true },
    cashSessionId: { type: Schema.Types.ObjectId, ref: 'CashSession', required: true },
    cashierId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    cashierName: { type: String, required: true },
    items: {
      type: [saleItemSchema],
      validate: { validator: (v: unknown[]) => v.length > 0, message: 'Sin productos' },
    },
    totalCents: { type: Number, required: true, validate: integer },
    taxCents: { type: Number, required: true, validate: integer },
    costCents: { type: Number, required: true, validate: integer },
    /** Forma de pago (informativa). La suma es igual al total. */
    payments: { type: [paymentSchema], required: true },
    cashReceivedCents: { type: Number, default: 0, validate: integer },
    changeCents: { type: Number, default: 0, validate: integer },
    status: { type: String, enum: ['completed', 'cancelled'], default: 'completed' },
    cancelledAt: { type: Date, default: null },
    cancelledByName: { type: String, default: '' },
    cancelReason: { type: String, default: '' },
  },
  { timestamps: true, toJSON: jsonOptions },
);

saleSchema.index({ businessId: 1, folio: 1 }, { unique: true });
saleSchema.index({ businessId: 1, createdAt: -1 });
saleSchema.index({ businessId: 1, cashSessionId: 1 });
saleSchema.index({ businessId: 1, cashierId: 1, createdAt: -1 });
// Reportes del superadmin sobre todos los negocios (sin businessId en el filtro).
saleSchema.index({ status: 1, createdAt: -1 });

export type SaleData = InferSchemaType<typeof saleSchema>;
export type SaleDocument = HydratedDocument<SaleData>;

export const Sale = model('Sale', saleSchema);
