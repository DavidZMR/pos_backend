/**
 * Simulador del historial de un negocio (solo desarrollo/pruebas). Función pura: recibe el
 * catálogo y devuelve los documentos (ventas, compras, kárdex, precios, turnos) listos para
 * insertar. Usa las mismas fórmulas que la app (money.ts) y lleva el kárdex consistente:
 * cada movimiento guarda la existencia antes/después y nunca queda negativa.
 */
import type { Types } from 'mongoose';
import { addDays, calendarDateInZone, startOfDayInZone } from '../../common/utils/dates.js';
import {
  includedTaxCents,
  lineTotalCents,
  weightedAverageCostCents,
} from '../../common/utils/money.js';
import { type Unit, unitScale } from '../../common/utils/qty.js';
import { formatFolio } from '../../modules/counters/counter.model.js';
import { demandFactor, monthsBetween, weekday } from './calendar.js';
import type { DemandProfile, SupplierKey } from './catalog.js';
import { objectIdAt, type Rng } from './random.js';

export type Doc = Record<string, unknown>;

export interface Person {
  id: Types.ObjectId;
  name: string;
}

export interface SimProduct {
  id: Types.ObjectId;
  code: string;
  name: string;
  unit: Unit;
  categoryId: Types.ObjectId | null;
  taxRateBp: number;
  priceCents: number;
  costCents: number;
  stock: number;
  /** Costo de referencia al inicio; la inflación mensual lo mueve en cada compra. */
  baseCostCents: number;
  profile: DemandProfile;
}

export interface Shift {
  /** Minutos desde medianoche (hora local del negocio). */
  open: number;
  close: number;
}

export interface SimInput {
  businessId: Types.ObjectId;
  timezone: string;
  /** Primer día simulado (YYYY-MM-DD, zona del negocio). */
  startDate: string;
  /** Se simula hasta 10 minutos antes de este instante. */
  now: Date;
  products: SimProduct[];
  cashiers: Person[];
  admin: Person;
  suppliers: Partial<Record<SupplierKey, Person>>;
  ticketsPerDay: number;
  shifts: Shift[];
  rng: Rng;
  /** Último folio ya usado por tipo (los nuevos continúan desde aquí). */
  folios: { sale: number; purchase: number; session: number };
}

export interface SimOutput {
  sales: Doc[];
  movements: Doc[];
  purchases: Doc[];
  priceHistory: Doc[];
  sessions: Doc[];
  products: SimProduct[];
  folios: SimInput['folios'];
}

const ITEMS_PER_TICKET = [1, 2, 3, 4, 5] as const;
const ITEMS_WEIGHT = [30, 35, 20, 10, 5];
const AVG_ITEMS = 2.25;
/** Hora del día → peso (la comida, 13–15 h, es la hora fuerte). */
const HOUR_WEIGHT: Record<number, number> = {
  8: 2,
  9: 3,
  10: 5,
  11: 7,
  12: 10,
  13: 14,
  14: 15,
  15: 12,
  16: 9,
  17: 7,
  18: 6,
  19: 5,
  20: 3,
};
const METHODS = [
  { method: 'cash', weight: 58 },
  { method: 'card', weight: 32 },
  { method: 'transfer', weight: 8 },
  { method: 'other', weight: 2 },
] as const;
const CANCEL_REASONS = [
  'El cliente cambió de opinión',
  'Se cobró dos veces',
  'Producto equivocado',
  'Devolución del cliente',
];
const MINUTE = 60_000;

export function simulateHistory(input: SimInput): SimOutput {
  const { rng, businessId, timezone, products, admin } = input;
  const out: Omit<SimOutput, 'products' | 'folios'> = {
    sales: [],
    movements: [],
    purchases: [],
    priceHistory: [],
    sessions: [],
  };
  const folios = { ...input.folios };
  const today = calendarDateInZone(input.now, timezone);
  const cutoff = input.now.getTime() - 10 * MINUTE;

  const totalWeight = products.reduce((sum, p) => sum + p.profile.weight, 0);
  /** Demanda diaria promedio de cada producto en unidad base (para decidir cuándo reponer). */
  const dailyDemand = new Map(
    products.map((p) => [
      p,
      (p.profile.weight / totalWeight) *
        input.ticketsPerDay *
        AVG_ITEMS *
        ((p.profile.qtyMin + p.profile.qtyMax) / 2),
    ]),
  );

  // Cambios manuales de precio programados (fecha → producto y precio nuevo).
  const priceChanges = new Map<string, { product: SimProduct; priceCents: number }[]>();
  for (const product of products) {
    for (const change of product.profile.priceChanges ?? []) {
      const date = addDays(today, -Math.round(change.monthsAgo * 30.44));
      if (date <= input.startDate) continue;
      priceChanges.set(date, [
        ...(priceChanges.get(date) ?? []),
        { product, priceCents: change.priceCents },
      ]);
    }
  }

  const move = (
    product: SimProduct,
    type: string,
    qty: number,
    at: Date,
    actor: Person,
    extra: {
      reason?: string;
      note?: string;
      refId?: Types.ObjectId;
      refFolio?: string;
      unitCostCents?: number;
    } = {},
  ) => {
    const before = product.stock;
    product.stock += qty;
    if (product.stock < 0) throw new Error(`Existencia negativa simulada en ${product.code}`);
    out.movements.push({
      _id: objectIdAt(at, rng),
      businessId,
      productId: product.id,
      productCode: product.code,
      productName: product.name,
      unit: product.unit,
      type,
      qtyBase: qty,
      stockBefore: before,
      stockAfter: product.stock,
      unitCostCents: extra.unitCostCents ?? product.costCents,
      reason: extra.reason ?? null,
      note: extra.note ?? '',
      refId: extra.refId ?? null,
      refFolio: extra.refFolio ?? '',
      userId: actor.id,
      userName: actor.name,
      createdAt: at,
      __v: 0,
    });
  };

  const recordPrice = (
    product: SimProduct,
    previous: { price: number; cost: number },
    source: 'manual' | 'purchase',
    at: Date,
    ref?: { id: Types.ObjectId; folio: string },
  ) => {
    if (previous.price === product.priceCents && previous.cost === product.costCents) return;
    out.priceHistory.push({
      _id: objectIdAt(at, rng),
      businessId,
      productId: product.id,
      salePriceCents: product.priceCents,
      costCents: product.costCents,
      previousSalePriceCents: previous.price,
      previousCostCents: previous.cost,
      source,
      refId: ref?.id ?? null,
      refFolio: ref?.folio ?? '',
      userId: admin.id,
      userName: admin.name,
      createdAt: at,
      __v: 0,
    });
  };

  /** Mañana: compras agrupadas por proveedor; lo preparado en cocina es "producción del día". */
  const restock = (at: Date, month: number) => {
    const bySupplier = new Map<SupplierKey, { product: SimProduct; qty: number; cost: number }[]>();
    for (const product of products) {
      const demand = dailyDemand.get(product) ?? 0;
      if (product.stock >= demand * 3) continue;
      const step = product.profile.step;
      const qty = Math.max(step, Math.ceil((demand * 6 - product.stock) / step) * step);
      const supplier = product.profile.supplier;
      if (supplier === null) {
        move(product, 'adjustment', qty, at, admin, { reason: 'otro', note: 'Producción del día' });
        continue;
      }
      const inflation = 1 + 0.004 * month;
      const cost = Math.max(1, Math.round(product.baseCostCents * inflation * rng.around(0.04)));
      bySupplier.set(supplier, [...(bySupplier.get(supplier) ?? []), { product, qty, cost }]);
    }

    for (const [key, lines] of bySupplier) {
      const supplier = input.suppliers[key];
      if (!supplier) throw new Error(`Falta el proveedor ${key}`);
      folios.purchase += 1;
      const id = objectIdAt(at, rng);
      const folio = formatFolio('purchase', folios.purchase);
      const items = lines.map(({ product, qty, cost }) => {
        const previous = { price: product.priceCents, cost: product.costCents };
        const lineTotal = lineTotalCents(cost, qty, unitScale(product.unit));
        product.costCents = weightedAverageCostCents(product.stock, product.costCents, qty, cost);
        move(product, 'purchase', qty, at, admin, {
          refId: id,
          refFolio: folio,
          unitCostCents: cost,
        });
        recordPrice(product, previous, 'purchase', at, { id, folio });
        return {
          productId: product.id,
          code: product.code,
          name: product.name,
          unit: product.unit,
          qtyBase: qty,
          unitCostCents: cost,
          lineTotalCents: lineTotal,
          previousCostCents: previous.cost,
          previousSalePriceCents: previous.price,
          newSalePriceCents: null,
        };
      });
      out.purchases.push({
        _id: id,
        businessId,
        folio: folios.purchase,
        supplierId: supplier.id,
        supplierName: supplier.name,
        invoiceNumber: `F-${10_000 + folios.purchase}`,
        notes: '',
        purchasedAt: at,
        items,
        totalCents: items.reduce((sum, item) => sum + item.lineTotalCents, 0),
        status: 'active',
        createdBy: admin.id,
        createdByName: admin.name,
        cancelledAt: null,
        cancelledByName: '',
        cancelReason: '',
        createdAt: at,
        updatedAt: at,
        __v: 0,
      });
    }
  };

  /** Lunes: merma de mariscos y pescados frescos. */
  const spoilage = (at: Date) => {
    for (const product of products) {
      if (product.unit !== 'kg') continue;
      if (product.profile.supplier !== 'puerto' && product.profile.supplier !== 'congeladora') {
        continue;
      }
      if (product.stock < 2000 || !rng.chance(0.25)) continue;
      const qty = Math.max(50, Math.round((product.stock * rng.int(1, 3)) / 100 / 10) * 10);
      move(product, 'adjustment', -Math.min(qty, product.stock), at, admin, {
        reason: 'merma',
        note: 'Merma semanal',
      });
    }
  };

  /** Arma un ticket con existencias reales; null si no hubo nada que vender. */
  const buildLines = () => {
    const count = rng.weighted(ITEMS_PER_TICKET, (n) => ITEMS_WEIGHT[n - 1] as number);
    const chosen = new Set<SimProduct>();
    for (let attempt = 0; chosen.size < count && attempt < 12; attempt++) {
      chosen.add(rng.weighted(products, (p) => p.profile.weight));
    }
    const lines = [];
    for (const product of chosen) {
      const { qtyMin, qtyMax, step } = product.profile;
      let qty = step * rng.int(Math.ceil(qtyMin / step), Math.floor(qtyMax / step));
      // Lo pesado en báscula no sale en múltiplos exactos.
      const weighed = product.unit === 'kg' && rng.chance(0.7);
      if (weighed) qty += rng.int(-40, 40);
      qty = Math.min(qty, product.stock);
      if (qty <= 0 || (product.unit !== 'pz' && qty < 50)) continue;
      const scale = unitScale(product.unit);
      const lineTotal = lineTotalCents(product.priceCents, qty, scale);
      lines.push({
        product,
        qty,
        weighed,
        lineTotal,
        lineCost: lineTotalCents(product.costCents, qty, scale),
        tax: includedTaxCents(lineTotal, product.taxRateBp),
      });
    }
    return lines.length ? lines : null;
  };

  const shiftHours = (shift: Shift) =>
    Object.keys(HOUR_WEIGHT)
      .map(Number)
      .filter((h) => h * 60 >= shift.open && h * 60 < shift.close);

  let dayIndex = 0;
  for (let date = input.startDate; date <= today; date = addDays(date, 1), dayIndex++) {
    const factor = demandFactor(date);
    if (factor === 0) continue;
    const dayStart = startOfDayInZone(date, timezone).getTime();
    const at = (minutes: number) => new Date(dayStart + minutes * MINUTE);
    const month = monthsBetween(input.startDate, date);

    for (const change of priceChanges.get(date) ?? []) {
      const when = at(8 * 60);
      if (when.getTime() > cutoff) continue;
      const previous = { price: change.product.priceCents, cost: change.product.costCents };
      change.product.priceCents = change.priceCents;
      recordPrice(change.product, previous, 'manual', when);
    }
    if (at(7 * 60 + 30).getTime() <= cutoff) restock(at(7 * 60 + 30), month);
    if (weekday(date) === 1 && at(8 * 60 + 45).getTime() <= cutoff) spoilage(at(8 * 60 + 45));

    const growth = 1 + 0.01 * month;
    const tickets = Math.round(input.ticketsPerDay * factor * growth * rng.around(0.15));

    input.shifts.forEach((shift, shiftIndex) => {
      const openAt = at(shift.open - 10);
      if (openAt.getTime() > cutoff) return;
      const hours = shiftHours(shift);
      const share = hours.reduce((sum, h) => sum + (HOUR_WEIGHT[h] ?? 0), 0);
      const allHours = Object.values(HOUR_WEIGHT).reduce((sum, w) => sum + w, 0);
      const shiftTickets = Math.round((tickets * share) / allHours);
      const times = Array.from({ length: shiftTickets }, () => {
        const hour = rng.weighted(hours, (h) => HOUR_WEIGHT[h] ?? 0);
        return dayStart + (hour * 60 + rng.int(0, 59)) * MINUTE + rng.int(0, 59) * 1000;
      })
        .filter((t) => t <= cutoff)
        .sort((a, b) => a - b);

      const cashier = input.cashiers[
        (dayIndex * input.shifts.length + shiftIndex) % input.cashiers.length
      ] as Person;
      folios.session += 1;
      const sessionId = objectIdAt(openAt, rng);
      const sessionFolio = folios.session;
      const openingFloat = shiftIndex === 0 ? 50_000 : 100_000;
      const byMethod = { cash: 0, card: 0, transfer: 0, other: 0 };
      let salesCount = 0;
      let salesTotal = 0;
      let cancelledCount = 0;

      times.forEach((time, index) => {
        const lines = buildLines();
        if (!lines) return;
        const when = new Date(time);
        folios.sale += 1;
        const id = objectIdAt(when, rng);
        const folio = formatFolio('sale', folios.sale);
        for (const line of lines) {
          move(line.product, 'sale', -line.qty, when, cashier, { refId: id, refFolio: folio });
        }
        const total = lines.reduce((sum, l) => sum + l.lineTotal, 0);
        const method = rng.weighted(METHODS, (m) => m.weight).method;
        let received = 0;
        if (method === 'cash') {
          const bills = [1000, 5000, 10_000, 20_000, 50_000]
            .map((bill) => Math.ceil(total / bill) * bill)
            .filter((value) => value > total);
          received = rng.chance(0.35) || !bills.length ? total : rng.pick(bills.slice(0, 3));
        }

        // ~1.2 % se cancelan unos minutos después (antes de la siguiente venta).
        const cancelled = rng.chance(0.012);
        const nextTime = times[index + 1] ?? time + 30 * MINUTE;
        const cancelledAt = cancelled
          ? new Date(
              Math.max(time + 1000, Math.min(time + rng.int(1, 5) * MINUTE, nextTime - 1000)),
            )
          : null;
        if (cancelledAt) {
          for (const line of lines) {
            move(line.product, 'sale_cancel', line.qty, cancelledAt, admin, {
              refId: id,
              refFolio: folio,
            });
          }
          cancelledCount += 1;
        } else {
          salesCount += 1;
          salesTotal += total;
          byMethod[method] += total;
        }

        out.sales.push({
          _id: id,
          businessId,
          folio: folios.sale,
          cashSessionId: sessionId,
          cashierId: cashier.id,
          cashierName: cashier.name,
          items: lines.map((l) => ({
            productId: l.product.id,
            code: l.product.code,
            name: l.product.name,
            categoryId: l.product.categoryId,
            unit: l.product.unit,
            qtyBase: l.qty,
            unitPriceCents: l.product.priceCents,
            unitCostCents: l.product.costCents,
            lineTotalCents: l.lineTotal,
            lineCostCents: l.lineCost,
            taxRateBp: l.product.taxRateBp,
            taxCents: l.tax,
            weighed: l.weighed,
          })),
          totalCents: total,
          taxCents: lines.reduce((sum, l) => sum + l.tax, 0),
          costCents: lines.reduce((sum, l) => sum + l.lineCost, 0),
          payments: [{ method, amountCents: total }],
          cashReceivedCents: method === 'cash' ? received : 0,
          changeCents: method === 'cash' ? received - total : 0,
          status: cancelledAt ? 'cancelled' : 'completed',
          cancelledAt,
          cancelledByName: cancelledAt ? admin.name : '',
          cancelReason: cancelledAt ? rng.pick(CANCEL_REASONS) : '',
          createdAt: when,
          updatedAt: cancelledAt ?? when,
          __v: 0,
        });
      });

      // Corte del turno: a veces un retiro de efectivo y diferencias pequeñas al contar.
      const closeAt = new Date(Math.min(at(shift.close + 10).getTime(), cutoff + 5 * MINUTE));
      const movements: Doc[] = [];
      if (byMethod.cash > 60_000 && rng.chance(0.2)) {
        movements.push({
          type: 'out',
          amountCents: Math.round((byMethod.cash * 0.3) / 1000) * 1000,
          reason: rng.pick(['Pago de hielo', 'Pago de gas', 'Retiro a caja fuerte']),
          userName: cashier.name,
          at: new Date((openAt.getTime() + closeAt.getTime()) / 2),
        });
      }
      if (rng.chance(0.08)) {
        movements.push({
          type: 'in',
          amountCents: 20_000,
          reason: 'Cambio adicional',
          userName: cashier.name,
          at: new Date(openAt.getTime() + 30 * MINUTE),
        });
      }
      const cashIn = movements
        .filter((m) => m.type === 'in')
        .reduce((sum, m) => sum + (m.amountCents as number), 0);
      const cashOut = movements
        .filter((m) => m.type === 'out')
        .reduce((sum, m) => sum + (m.amountCents as number), 0);
      const expected = openingFloat + byMethod.cash + cashIn - cashOut;
      const roll = rng.next();
      const difference =
        roll < 0.85 ? 0 : roll < 0.95 ? -rng.int(1, 20) * 1000 : rng.int(1, 10) * 500;
      out.sessions.push({
        _id: sessionId,
        businessId,
        folio: sessionFolio,
        userId: cashier.id,
        userName: cashier.name,
        status: 'closed',
        openedAt: openAt,
        openingFloatCents: openingFloat,
        movements,
        notes: difference < 0 ? 'Faltó efectivo al contar' : '',
        closedAt: closeAt,
        closedByName: cashier.name,
        countedCashCents: expected + difference,
        expectedCashCents: expected,
        differenceCents: difference,
        salesCount,
        salesTotalCents: salesTotal,
        cancelledCount,
        byMethod,
        createdAt: openAt,
        updatedAt: closeAt,
        __v: 0,
      });
    });
  }

  return { ...out, products, folios };
}
