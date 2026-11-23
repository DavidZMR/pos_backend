import { type HydratedDocument, type InferSchemaType, model, Schema } from 'mongoose';
import { UNIT_CODES } from '../../common/utils/qty.js';
import { jsonOptions } from '../../db/schema-options.js';

const integer = { validator: Number.isSafeInteger, message: '{PATH} debe ser un entero' };

/** Renglón de una entrada: snapshot del producto y de sus precios al momento de la compra. */
const purchaseItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    code: { type: String, required: true },
    name: { type: String, required: true },
    unit: { type: String, enum: UNIT_CODES, required: true },
    qtyBase: { type: Number, required: true, min: 1, validate: integer },
    /** Costo por unidad de venta pagado en esta compra. */
    unitCostCents: { type: Number, required: true, min: 0, validate: integer },
    lineTotalCents: { type: Number, required: true, validate: integer },
    previousCostCents: { type: Number, required: true },
    previousSalePriceCents: { type: Number, required: true },
    /** Nuevo precio de venta fijado en la entrada (null = no se cambió). */
    newSalePriceCents: { type: Number, default: null },
  },
  { _id: false },
);

export const PURCHASE_STATUSES = ['active', 'cancelled'] as const;

const purchaseSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    folio: { type: Number, required: true },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', default: null },
    supplierName: { type: String, default: '' },
    invoiceNumber: { type: String, default: '', maxlength: 40 },
    notes: { type: String, default: '', maxlength: 500 },
    purchasedAt: { type: Date, required: true },
    items: {
      type: [purchaseItemSchema],
      validate: { validator: (v: unknown[]) => v.length > 0, message: 'Sin productos' },
    },
    totalCents: { type: Number, required: true, validate: integer },
    status: { type: String, enum: PURCHASE_STATUSES, default: 'active' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, required: true },
    cancelledAt: { type: Date, default: null },
    cancelledByName: { type: String, default: '' },
    cancelReason: { type: String, default: '' },
  },
  { timestamps: true, toJSON: jsonOptions },
);

purchaseSchema.index({ businessId: 1, folio: 1 }, { unique: true });
purchaseSchema.index({ businessId: 1, purchasedAt: -1 });
purchaseSchema.index({ businessId: 1, supplierId: 1, purchasedAt: -1 });

export type PurchaseData = InferSchemaType<typeof purchaseSchema>;
export type PurchaseDocument = HydratedDocument<PurchaseData>;

export const Purchase = model('Purchase', purchaseSchema);
