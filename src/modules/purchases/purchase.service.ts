import { type QueryFilter, Types } from 'mongoose';
import { AppError, badRequest, conflict, notFound } from '../../common/http/errors.js';
import { calendarDateInZone, dayRange, startOfDayInZone } from '../../common/utils/dates.js';
import { lineTotalCents, weightedAverageCostCents } from '../../common/utils/money.js';
import { pageMeta, skipFor } from '../../common/utils/pagination.js';
import { unitScale } from '../../common/utils/qty.js';
import { escapeRegex } from '../../common/utils/text.js';
import { withTransaction } from '../../db/transaction.js';
import type { AuthUser } from '../../types/express.js';
import { Business } from '../businesses/business.model.js';
import { formatFolio, nextSequence } from '../counters/counter.model.js';
import { applyStockChange } from '../inventory/movement.model.js';
import { Product, type ProductDocument } from '../products/product.model.js';
import { recordPriceChange } from '../products/product.service.js';
import { Supplier } from '../suppliers/supplier.model.js';
import { Purchase, type PurchaseData } from './purchase.model.js';
import type { CreatePurchaseInput, ListPurchasesQuery } from './purchase.schemas.js';

type Actor = Pick<AuthUser, 'id' | 'name'>;

async function getBusiness(businessId: string) {
  const business = await Business.findById(businessId);
  if (!business) throw notFound('Negocio no encontrado');
  return business;
}

/** Hoy (o sin fecha) = ahora; otro día = 12:00 de ese día en la zona del negocio. */
function resolvePurchaseDate(purchaseDate: string | undefined, timeZone: string): Date {
  const now = new Date();
  if (!purchaseDate || purchaseDate === calendarDateInZone(now, timeZone)) return now;
  const noon = new Date(startOfDayInZone(purchaseDate, timeZone).getTime() + 12 * 3_600_000);
  if (noon > now) {
    throw badRequest('La fecha de compra no puede ser futura', {
      fieldErrors: { purchaseDate: ['No puede ser una fecha futura'] },
    });
  }
  return noon;
}

export async function createPurchase(businessId: string, actor: Actor, input: CreatePurchaseInput) {
  const business = await getBusiness(businessId);
  const purchasedAt = resolvePurchaseDate(input.purchaseDate, business.timezone);

  let supplierName = '';
  if (input.supplierId) {
    const supplier = await Supplier.findOne({ _id: input.supplierId, businessId });
    if (!supplier) {
      throw badRequest('El proveedor no existe en este negocio', {
        fieldErrors: { supplierId: ['Proveedor inválido'] },
      });
    }
    supplierName = supplier.name;
  }

  return withTransaction(async (session) => {
    const folio = await nextSequence(businessId, 'purchase', session);
    const ref = { id: new Types.ObjectId().toString(), folio: formatFolio('purchase', folio) };
    const products = new Map<string, ProductDocument>();
    const items = [];

    for (const [index, line] of input.items.entries()) {
      let product = products.get(line.productId);
      if (!product) {
        product =
          (await Product.findOne({ _id: line.productId, businessId }).session(session)) ??
          undefined;
        if (!product)
          throw badRequest(`Renglón ${index + 1}: el producto no existe en este negocio`);
        if (!product.active)
          throw badRequest(`Renglón ${index + 1}: "${product.name}" está desactivado`);
        products.set(line.productId, product);
      }

      const previous = { salePriceCents: product.salePriceCents, costCents: product.costCents };
      product.costCents = weightedAverageCostCents(
        product.stock,
        product.costCents,
        line.qtyBase,
        line.unitCostCents,
      );
      if (line.newSalePriceCents !== undefined) product.salePriceCents = line.newSalePriceCents;

      await applyStockChange({
        product,
        qtyDelta: line.qtyBase,
        type: 'purchase',
        unitCostCents: line.unitCostCents,
        actor,
        session,
        refId: ref.id,
        refFolio: ref.folio,
      });
      await recordPriceChange(product, previous, 'purchase', actor, session, ref);

      items.push({
        productId: product._id,
        code: product.code,
        name: product.name,
        unit: product.unit,
        qtyBase: line.qtyBase,
        unitCostCents: line.unitCostCents,
        lineTotalCents: lineTotalCents(line.unitCostCents, line.qtyBase, unitScale(product.unit)),
        previousCostCents: previous.costCents,
        previousSalePriceCents: previous.salePriceCents,
        newSalePriceCents:
          line.newSalePriceCents !== undefined && line.newSalePriceCents !== previous.salePriceCents
            ? line.newSalePriceCents
            : null,
      });
    }

    const [purchase] = await Purchase.create(
      [
        {
          _id: ref.id,
          businessId,
          folio,
          supplierId: input.supplierId ?? null,
          supplierName,
          invoiceNumber: input.invoiceNumber ?? '',
          notes: input.notes ?? '',
          purchasedAt,
          items,
          totalCents: items.reduce((sum, item) => sum + item.lineTotalCents, 0),
          createdBy: actor.id,
          createdByName: actor.name,
        },
      ],
      { session },
    );
    return purchase;
  });
}

/**
 * Cancela una entrada: revierte existencias con movimientos "purchase_cancel".
 * El costo promedio y los precios NO se revierten (ya pudieron usarse en ventas).
 */
export async function cancelPurchase(businessId: string, actor: Actor, id: string, reason: string) {
  const business = await getBusiness(businessId);
  return withTransaction(async (session) => {
    const purchase = await Purchase.findOne({ _id: id, businessId }).session(session);
    if (!purchase) throw notFound('Entrada no encontrada');
    if (purchase.status === 'cancelled') throw conflict('La entrada ya estaba cancelada');
    const refFolio = formatFolio('purchase', purchase.folio);

    for (const item of purchase.items) {
      const product = await Product.findOne({ _id: item.productId, businessId }).session(session);
      if (!product) continue;
      if (!business.settings?.allowNegativeStock && product.stock - item.qtyBase < 0) {
        throw new AppError(
          409,
          'INSUFFICIENT_STOCK',
          `No se puede cancelar: "${product.name}" quedaría con existencia negativa (ya se vendió parte de la mercancía).`,
        );
      }
      await applyStockChange({
        product,
        qtyDelta: -item.qtyBase,
        type: 'purchase_cancel',
        unitCostCents: item.unitCostCents,
        actor,
        session,
        note: reason,
        refId: purchase.id,
        refFolio,
      });
    }

    purchase.status = 'cancelled';
    purchase.cancelledAt = new Date();
    purchase.cancelledByName = actor.name;
    purchase.cancelReason = reason;
    await purchase.save({ session });
    return purchase;
  });
}

export async function listPurchases(businessId: string, query: ListPurchasesQuery) {
  const business = await getBusiness(businessId);
  const filter: QueryFilter<PurchaseData> = { businessId };
  const range = dayRange(business.timezone, query.from, query.to);
  if (range) filter.purchasedAt = range;
  if (query.supplierId) filter.supplierId = query.supplierId;
  if (query.status) filter.status = query.status;
  if (query.search) {
    const digits = query.search.replace(/^[eE]-?/, '');
    filter.$or = [
      ...(/^\d+$/.test(digits) ? [{ folio: Number(digits) }] : []),
      { invoiceNumber: new RegExp(escapeRegex(query.search), 'i') },
    ];
  }

  const [items, total] = await Promise.all([
    Purchase.find(filter)
      .sort({ purchasedAt: -1, folio: -1 })
      .skip(skipFor(query))
      .limit(query.limit),
    Purchase.countDocuments(filter),
  ]);
  return { items, meta: pageMeta(total, query) };
}

export async function getPurchase(businessId: string, id: string) {
  const purchase = await Purchase.findOne({ _id: id, businessId });
  if (!purchase) throw notFound('Entrada no encontrada');
  return purchase;
}
