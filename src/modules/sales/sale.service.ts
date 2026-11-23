import { type QueryFilter, Types } from 'mongoose';
import { AppError, badRequest, conflict, notFound } from '../../common/http/errors.js';
import { dayRange } from '../../common/utils/dates.js';
import { includedTaxCents, lineTotalCents } from '../../common/utils/money.js';
import { pageMeta, skipFor } from '../../common/utils/pagination.js';
import { unitScale } from '../../common/utils/qty.js';
import { withTransaction } from '../../db/transaction.js';
import type { AuthUser } from '../../types/express.js';
import { Business } from '../businesses/business.model.js';
import { findOpenSession } from '../cash-sessions/cash-session.service.js';
import { formatFolio, nextSequence } from '../counters/counter.model.js';
import { applyStockChange } from '../inventory/movement.model.js';
import { Product, type ProductDocument } from '../products/product.model.js';
import { Sale, type SaleData } from './sale.model.js';
import type { CreateSaleInput, ListSalesQuery } from './sale.schemas.js';

const isManager = (actor: AuthUser) => actor.role === 'admin' || actor.role === 'superadmin';

async function getBusiness(businessId: string) {
  const business = await Business.findById(businessId);
  if (!business) throw notFound('Negocio no encontrado');
  return business;
}

export async function createSale(businessId: string, actor: AuthUser, input: CreateSaleInput) {
  const business = await getBusiness(businessId);
  const cashSession = await findOpenSession(businessId, actor.id);
  if (!cashSession) {
    throw new AppError(409, 'CASH_SESSION_REQUIRED', 'Abre la caja antes de vender');
  }

  return withTransaction(async (session) => {
    // 1) Calcular todo sin escribir: precios del servidor, costos, IVA y existencias.
    const products = new Map<string, ProductDocument>();
    const pendingStock = new Map<string, number>();
    const lines = [];
    for (const [index, line] of input.items.entries()) {
      let product = products.get(line.productId);
      if (!product) {
        product =
          (await Product.findOne({ _id: line.productId, businessId }).session(session)) ??
          undefined;
        if (!product) throw badRequest(`Renglón ${index + 1}: el producto no existe`);
        if (!product.active) throw badRequest(`"${product.name}" ya no está a la venta`);
        products.set(line.productId, product);
      }
      const sold = (pendingStock.get(line.productId) ?? 0) + line.qtyBase;
      pendingStock.set(line.productId, sold);
      if (!business.settings?.allowNegativeStock && product.stock - sold < 0) {
        throw new AppError(
          409,
          'INSUFFICIENT_STOCK',
          `No hay existencia suficiente de "${product.name}"`,
          { productId: product.id, available: product.stock },
        );
      }

      const scale = unitScale(product.unit);
      const lineTotal = lineTotalCents(product.salePriceCents, line.qtyBase, scale);
      lines.push({
        productId: product._id,
        code: product.code,
        name: product.name,
        categoryId: product.categoryId,
        unit: product.unit,
        qtyBase: line.qtyBase,
        unitPriceCents: product.salePriceCents,
        unitCostCents: product.costCents,
        lineTotalCents: lineTotal,
        lineCostCents: lineTotalCents(product.costCents, line.qtyBase, scale),
        taxRateBp: product.taxRateBp,
        taxCents: includedTaxCents(lineTotal, product.taxRateBp),
        weighed: line.weighed ?? false,
      });
    }

    const totalCents = lines.reduce((sum, l) => sum + l.lineTotalCents, 0);
    if (totalCents !== input.expectedTotalCents) {
      throw new AppError(
        409,
        'PRICE_CHANGED',
        'Los precios cambiaron; revisa el total antes de cobrar',
        { totalCents },
      );
    }

    const paid = input.payments.reduce((sum, p) => sum + p.amountCents, 0);
    if (paid !== totalCents) {
      throw badRequest('La suma de las formas de pago no coincide con el total', {
        fieldErrors: { payments: ['Debe sumar el total'] },
      });
    }
    const cashAmount = input.payments.find((p) => p.method === 'cash')?.amountCents ?? 0;
    const cashReceived = input.cashReceivedCents ?? cashAmount;
    if (cashReceived < cashAmount) {
      throw badRequest('El efectivo recibido es menor al monto en efectivo', {
        fieldErrors: { cashReceivedCents: ['Insuficiente'] },
      });
    }

    // 2) Escribir: folio, existencias (kárdex) y la venta.
    const folio = await nextSequence(businessId, 'sale', session);
    const saleId = new Types.ObjectId();
    const refFolio = formatFolio('sale', folio);
    for (const line of lines) {
      const product = products.get(String(line.productId));
      if (!product) continue;
      await applyStockChange({
        product,
        qtyDelta: -line.qtyBase,
        type: 'sale',
        unitCostCents: line.unitCostCents,
        actor,
        session,
        refId: saleId.toString(),
        refFolio,
      });
    }

    const [sale] = await Sale.create(
      [
        {
          _id: saleId,
          businessId,
          folio,
          cashSessionId: cashSession._id,
          cashierId: actor.id,
          cashierName: actor.name,
          items: lines,
          totalCents,
          taxCents: lines.reduce((sum, l) => sum + l.taxCents, 0),
          costCents: lines.reduce((sum, l) => sum + l.lineCostCents, 0),
          payments: input.payments.filter((p) => p.amountCents > 0),
          cashReceivedCents: cashAmount > 0 ? cashReceived : 0,
          changeCents: cashAmount > 0 ? cashReceived - cashAmount : 0,
        },
      ],
      { session },
    );
    return sale;
  });
}

/** Cancela una venta (solo admin/superadmin): regresa la mercancía al inventario. */
export async function cancelSale(businessId: string, actor: AuthUser, id: string, reason: string) {
  return withTransaction(async (session) => {
    const sale = await Sale.findOne({ _id: id, businessId }).session(session);
    if (!sale) throw notFound('Venta no encontrada');
    if (sale.status === 'cancelled') throw conflict('La venta ya estaba cancelada');
    const refFolio = formatFolio('sale', sale.folio);

    for (const item of sale.items) {
      const product = await Product.findOne({ _id: item.productId, businessId }).session(session);
      if (!product) continue;
      await applyStockChange({
        product,
        qtyDelta: item.qtyBase,
        type: 'sale_cancel',
        unitCostCents: item.unitCostCents,
        actor,
        session,
        note: reason,
        refId: sale.id,
        refFolio,
      });
    }

    sale.status = 'cancelled';
    sale.cancelledAt = new Date();
    sale.cancelledByName = actor.name;
    sale.cancelReason = reason;
    await sale.save({ session });
    return sale;
  });
}

export async function getSale(businessId: string, actor: AuthUser, id: string) {
  const sale = await Sale.findOne({
    _id: id,
    businessId,
    ...(!isManager(actor) && { cashierId: new Types.ObjectId(actor.id) }),
  });
  if (!sale) throw notFound('Venta no encontrada');
  return sale;
}

export async function listSales(businessId: string, actor: AuthUser, query: ListSalesQuery) {
  const business = await getBusiness(businessId);
  const filter: QueryFilter<SaleData> = { businessId };
  // El empleado solo ve sus propias ventas.
  if (!isManager(actor)) filter.cashierId = actor.id;
  else if (query.cashierId) filter.cashierId = query.cashierId;
  if (query.status) filter.status = query.status;
  if (query.method) filter['payments.method'] = query.method;
  if (query.cashSessionId) filter.cashSessionId = query.cashSessionId;
  const range = dayRange(business.timezone, query.from, query.to);
  if (range) filter.createdAt = range;
  if (query.search) {
    const digits = query.search.replace(/^[vV]-?/, '');
    if (/^\d+$/.test(digits)) filter.folio = Number(digits);
  }

  const [items, total] = await Promise.all([
    Sale.find(filter).sort({ createdAt: -1, folio: -1 }).skip(skipFor(query)).limit(query.limit),
    Sale.countDocuments(filter),
  ]);
  return { items, meta: pageMeta(total, query) };
}
