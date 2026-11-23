import { type InferSchemaType, model, Schema } from 'mongoose';
import { jsonOptions } from '../../db/schema-options.js';

export const PRICE_SOURCES = ['create', 'manual', 'purchase'] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

/**
 * Bitácora de cambios de precio de venta y costo. Los reportes NO la necesitan para calcular
 * (cada venta/compra guarda su propio snapshot); sirve para auditar y mostrar la evolución.
 */
const priceHistorySchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    salePriceCents: { type: Number, required: true },
    costCents: { type: Number, required: true },
    previousSalePriceCents: { type: Number, default: null },
    previousCostCents: { type: Number, default: null },
    source: { type: String, enum: PRICE_SOURCES, required: true },
    /** Compra que originó el cambio (source = purchase). */
    refId: { type: Schema.Types.ObjectId, default: null },
    refFolio: { type: String, default: '' },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: jsonOptions },
);

priceHistorySchema.index({ businessId: 1, productId: 1, createdAt: -1 });

export type PriceHistoryData = InferSchemaType<typeof priceHistorySchema>;

export const PriceHistory = model('PriceHistory', priceHistorySchema);
