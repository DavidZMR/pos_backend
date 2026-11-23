import { type QueryFilter, Types } from 'mongoose';
import { AppError, badRequest, notFound } from '../../common/http/errors.js';
import { dayRange } from '../../common/utils/dates.js';
import { pageMeta, skipFor } from '../../common/utils/pagination.js';
import { withTransaction } from '../../db/transaction.js';
import type { AuthUser } from '../../types/express.js';
import { Business } from '../businesses/business.model.js';
import { Product } from '../products/product.model.js';
import type { CreateAdjustmentInput, ListMovementsQuery } from './inventory.schemas.js';
import { applyStockChange, InventoryMovement, type MovementData } from './movement.model.js';

type Actor = Pick<AuthUser, 'id' | 'name'>;

async function getBusiness(businessId: string) {
  const business = await Business.findById(businessId);
  if (!business) throw notFound('Negocio no encontrado');
  return business;
}

/** Ajuste manual de existencia (merma, conteo físico u otro) con su renglón de kárdex. */
export async function createAdjustment(
  businessId: string,
  actor: Actor,
  input: CreateAdjustmentInput,
) {
  const business = await getBusiness(businessId);

  return withTransaction(async (session) => {
    const product = await Product.findOne({ _id: input.productId, businessId }).session(session);
    if (!product) throw notFound('Producto no encontrado');

    const delta =
      input.mode === 'set'
        ? input.qtyBase - product.stock
        : input.mode === 'add'
          ? input.qtyBase
          : -input.qtyBase;
    if (delta === 0) {
      throw badRequest('La existencia contada es igual a la registrada; no hay nada que ajustar', {
        fieldErrors: { qtyBase: ['Igual a la existencia actual'] },
      });
    }
    if (!business.settings?.allowNegativeStock && product.stock + delta < 0) {
      throw new AppError(409, 'INSUFFICIENT_STOCK', 'La existencia no puede quedar negativa', {
        fieldErrors: { qtyBase: ['Mayor que la existencia disponible'] },
      });
    }

    const movement = await applyStockChange({
      product,
      qtyDelta: delta,
      type: 'adjustment',
      reason: input.reason,
      note: input.note ?? '',
      actor,
      session,
    });
    return { movement, product };
  });
}

export async function listMovements(businessId: string, query: ListMovementsQuery) {
  const business = await getBusiness(businessId);
  const filter: QueryFilter<MovementData> = { businessId };
  if (query.productId) filter.productId = query.productId;
  if (query.type) filter.type = query.type;
  const range = dayRange(business.timezone, query.from, query.to);
  if (range) filter.createdAt = range;

  const [items, total] = await Promise.all([
    InventoryMovement.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skipFor(query))
      .limit(query.limit),
    InventoryMovement.countDocuments(filter),
  ]);
  return { items, meta: pageMeta(total, query) };
}

export interface InventorySummary {
  products: number;
  /** Σ existencia × costo promedio (solo existencias positivas), en centavos. */
  inventoryValueCents: number;
  lowStock: number;
  outOfStock: number;
  negativeStock: number;
}

/** Resumen de almacén de los productos activos. */
export async function getSummary(businessId: string): Promise<InventorySummary> {
  const scale = { $cond: [{ $eq: ['$unit', 'pz'] }, 1, 1000] };
  const [summary] = await Product.aggregate<InventorySummary>([
    { $match: { businessId: new Types.ObjectId(businessId), active: true } },
    {
      $group: {
        _id: null,
        products: { $sum: 1 },
        inventoryValueCents: {
          $sum: {
            $round: [
              { $divide: [{ $multiply: [{ $max: ['$stock', 0] }, '$costCents'] }, scale] },
              0,
            ],
          },
        },
        lowStock: {
          $sum: {
            $cond: [{ $and: [{ $gt: ['$minStock', 0] }, { $lte: ['$stock', '$minStock'] }] }, 1, 0],
          },
        },
        outOfStock: { $sum: { $cond: [{ $lte: ['$stock', 0] }, 1, 0] } },
        negativeStock: { $sum: { $cond: [{ $lt: ['$stock', 0] }, 1, 0] } },
      },
    },
    { $project: { _id: 0 } },
  ]);
  return (
    summary ?? { products: 0, inventoryValueCents: 0, lowStock: 0, outOfStock: 0, negativeStock: 0 }
  );
}
