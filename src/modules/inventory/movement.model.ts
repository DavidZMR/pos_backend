import { type ClientSession, type InferSchemaType, model, Schema } from 'mongoose';
import { UNIT_CODES } from '../../common/utils/qty.js';
import { jsonOptions } from '../../db/schema-options.js';
import type { AuthUser } from '../../types/express.js';
import type { ProductDocument } from '../products/product.model.js';

export const MOVEMENT_TYPES = [
  'initial', // existencia inicial al dar de alta
  'purchase', // entrada de mercancía
  'purchase_cancel', // cancelación de una entrada
  'adjustment', // merma, conteo físico, otro
  'sale',
  'sale_cancel',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const ADJUSTMENT_REASONS = ['merma', 'conteo', 'otro'] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

/** Kárdex: cada cambio de existencia con su antes/después. Nunca se edita ni se borra. */
const movementSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    productCode: { type: String, required: true },
    productName: { type: String, required: true },
    unit: { type: String, enum: UNIT_CODES, required: true },
    type: { type: String, enum: MOVEMENT_TYPES, required: true },
    /** Cantidad con signo en unidad base (+ entra, − sale). */
    qtyBase: { type: Number, required: true },
    stockBefore: { type: Number, required: true },
    stockAfter: { type: Number, required: true },
    /** Costo unitario (por unidad de venta) al momento del movimiento. */
    unitCostCents: { type: Number, required: true, default: 0 },
    reason: { type: String, enum: [...ADJUSTMENT_REASONS, null], default: null },
    note: { type: String, default: '', maxlength: 300 },
    refId: { type: Schema.Types.ObjectId, default: null },
    refFolio: { type: String, default: '' },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: jsonOptions },
);

movementSchema.index({ businessId: 1, productId: 1, createdAt: -1 });
movementSchema.index({ businessId: 1, createdAt: -1 });

export type MovementData = InferSchemaType<typeof movementSchema>;

export const InventoryMovement = model('InventoryMovement', movementSchema);

export interface StockChange {
  product: ProductDocument;
  qtyDelta: number;
  type: MovementType;
  actor: Pick<AuthUser, 'id' | 'name'>;
  session: ClientSession;
  unitCostCents?: number;
  reason?: AdjustmentReason;
  note?: string;
  refId?: string;
  refFolio?: string;
}

/**
 * Único camino para cambiar existencias: actualiza el stock del producto y deja el renglón
 * del kárdex en la misma transacción.
 */
export async function applyStockChange(change: StockChange) {
  const { product, qtyDelta, session } = change;
  const stockBefore = product.stock;
  product.stock = stockBefore + qtyDelta;
  await product.save({ session });

  const [movement] = await InventoryMovement.create(
    [
      {
        businessId: product.businessId,
        productId: product._id,
        productCode: product.code,
        productName: product.name,
        unit: product.unit,
        type: change.type,
        qtyBase: qtyDelta,
        stockBefore,
        stockAfter: product.stock,
        unitCostCents: change.unitCostCents ?? product.costCents,
        reason: change.reason ?? null,
        note: change.note ?? '',
        refId: change.refId ?? null,
        refFolio: change.refFolio ?? '',
        userId: change.actor.id,
        userName: change.actor.name,
      },
    ],
    { session },
  );
  return movement;
}
