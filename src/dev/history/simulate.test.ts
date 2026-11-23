import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { calendarDateInZone, timezoneOffsetMinutes } from '../../common/utils/dates.js';
import { lineTotalCents } from '../../common/utils/money.js';
import { unitScale } from '../../common/utils/qty.js';
import { createRng } from './random.js';
import { type Doc, type SimInput, type SimProduct, simulateHistory } from './simulate.js';

const TZ = 'America/Mexico_City';
const NOW = new Date('2026-01-10T19:30:00.000Z'); // 13:30 en CDMX

function product(
  code: string,
  unit: 'pz' | 'kg',
  price: number,
  cost: number,
  stock: number,
  overrides: Partial<SimProduct['profile']> = {},
): SimProduct {
  return {
    id: new Types.ObjectId(),
    code,
    name: `Producto ${code}`,
    unit,
    categoryId: null,
    taxRateBp: unit === 'pz' ? 1600 : 0,
    priceCents: price,
    costCents: cost,
    stock,
    baseCostCents: cost,
    profile: {
      weight: 5,
      qtyMin: unit === 'kg' ? 250 : 1,
      qtyMax: unit === 'kg' ? 2000 : 4,
      step: unit === 'kg' ? 250 : 1,
      supplier: 'puerto',
      ...overrides,
    },
  };
}

function run(seed = 7) {
  const person = (name: string) => ({ id: new Types.ObjectId(), name });
  const input: SimInput = {
    businessId: new Types.ObjectId(),
    timezone: TZ,
    startDate: '2025-11-01',
    now: NOW,
    products: [
      product('101', 'kg', 38900, 29000, 18_500),
      product('402', 'pz', 3200, 1900, 120, { priceChanges: [{ monthsAgo: 1, priceCents: 3500 }] }),
      product('301', 'pz', 18500, 7500, 0, { supplier: null }),
      product('503', 'kg', 4500, 2800, 0, { supplier: 'verduras' }),
    ],
    cashiers: [person('Ana'), person('Beto')],
    admin: person('Admin'),
    suppliers: { puerto: person('Puerto'), verduras: person('Verduras') },
    ticketsPerDay: 30,
    shifts: [
      { open: 9 * 60, close: 15 * 60 },
      { open: 15 * 60, close: 21 * 60 },
    ],
    rng: createRng(seed),
    folios: { sale: 0, purchase: 0, session: 0 },
  };
  const initial = new Map(input.products.map((p) => [String(p.id), p.stock]));
  return { input, initial, result: simulateHistory(input) };
}

const time = (doc: Doc, field = 'createdAt') => (doc[field] as Date).getTime();
const localMinutes = (instant: Date) => {
  const local = new Date(instant.getTime() + timezoneOffsetMinutes(TZ, instant) * 60_000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
};

describe('simulateHistory', () => {
  const { input, initial, result } = run();

  it('genera un volumen razonable y es reproducible con la misma semilla', () => {
    expect(result.sales.length).toBeGreaterThan(1500);
    expect(result.purchases.length).toBeGreaterThan(10);
    const again = run().result;
    expect(again.sales.length).toBe(result.sales.length);
    expect(again.sales.map((s) => s.totalCents)).toEqual(result.sales.map((s) => s.totalCents));
  });

  it('kárdex consistente: cada movimiento parte de la existencia anterior y nunca es negativa', () => {
    for (const p of result.products) {
      const moves = result.movements.filter((m) => String(m.productId) === String(p.id));
      let stock = initial.get(String(p.id)) as number;
      for (const m of moves) {
        expect(m.stockBefore).toBe(stock);
        stock += m.qtyBase as number;
        expect(m.stockAfter).toBe(stock);
        expect(stock).toBeGreaterThanOrEqual(0);
      }
      expect(p.stock).toBe(stock);
    }
  });

  it('cada venta cuadra: líneas, IVA, costo, pago y cambio', () => {
    for (const sale of result.sales) {
      const items = sale.items as Doc[];
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        const scale = unitScale(item.unit as 'pz' | 'kg');
        expect(item.lineTotalCents).toBe(
          lineTotalCents(item.unitPriceCents as number, item.qtyBase as number, scale),
        );
        expect(item.lineCostCents).toBe(
          lineTotalCents(item.unitCostCents as number, item.qtyBase as number, scale),
        );
      }
      const sum = (field: string) => items.reduce((acc, i) => acc + (i[field] as number), 0);
      expect(sale.totalCents).toBe(sum('lineTotalCents'));
      expect(sale.costCents).toBe(sum('lineCostCents'));
      expect(sale.taxCents).toBe(sum('taxCents'));
      const payments = sale.payments as { method: string; amountCents: number }[];
      expect(payments.reduce((acc, p) => acc + p.amountCents, 0)).toBe(sale.totalCents);
      if (payments[0]?.method === 'cash') {
        expect(sale.changeCents).toBe(
          (sale.cashReceivedCents as number) - (sale.totalCents as number),
        );
        expect(sale.changeCents as number).toBeGreaterThanOrEqual(0);
      }
      if (sale.status === 'cancelled')
        expect(time(sale, 'cancelledAt')).toBeGreaterThan(time(sale));
    }
  });

  it('folios únicos y consecutivos en orden de tiempo', () => {
    const sales = [...result.sales].sort((a, b) => time(a) - time(b));
    expect(sales.map((sale) => sale.folio)).toEqual(sales.map((_, index) => index + 1));
    expect(result.folios.sale).toBe(sales.length);
  });

  it('cada corte coincide con sus ventas y con el efectivo esperado', () => {
    for (const session of result.sessions) {
      const sales = result.sales.filter((s) => String(s.cashSessionId) === String(session._id));
      const completed = sales.filter((s) => s.status === 'completed');
      expect(session.salesCount).toBe(completed.length);
      expect(session.salesTotalCents).toBe(
        completed.reduce((acc, s) => acc + (s.totalCents as number), 0),
      );
      expect(session.cancelledCount).toBe(sales.length - completed.length);
      const cash = completed
        .filter((s) => (s.payments as { method: string }[])[0]?.method === 'cash')
        .reduce((acc, s) => acc + (s.totalCents as number), 0);
      expect((session.byMethod as { cash: number }).cash).toBe(cash);
      const moves = session.movements as { type: string; amountCents: number }[];
      const net = moves.reduce(
        (acc, m) => acc + (m.type === 'in' ? m.amountCents : -m.amountCents),
        0,
      );
      expect(session.expectedCashCents).toBe((session.openingFloatCents as number) + cash + net);
      expect((session.countedCashCents as number) - (session.expectedCashCents as number)).toBe(
        session.differenceCents,
      );
      for (const sale of sales) {
        expect(time(sale)).toBeGreaterThanOrEqual(time(session, 'openedAt'));
        expect(time(sale)).toBeLessThanOrEqual(time(session, 'closedAt'));
      }
    }
  });

  it('el snapshot usa el precio vigente: antes y después del cambio manual', () => {
    const beer = input.products.find((p) => p.code === '402') as SimProduct;
    const change = result.priceHistory.find(
      (h) => h.source === 'manual' && String(h.productId) === String(beer.id),
    );
    expect(change).toBeDefined();
    const changedAt = time(change as Doc);
    const prices = (before: boolean) =>
      new Set(
        result.sales
          .filter((s) => (before ? time(s) < changedAt : time(s) > changedAt))
          .flatMap((s) =>
            (s.items as Doc[]).filter((i) => i.code === '402').map((i) => i.unitPriceCents),
          ),
      );
    expect([...prices(true)]).toEqual([3200]);
    expect([...prices(false)]).toEqual([3500]);
  });

  it('compras: total = suma de líneas; lo preparado no se compra (producción del día)', () => {
    for (const purchase of result.purchases) {
      const items = purchase.items as Doc[];
      expect(purchase.totalCents).toBe(
        items.reduce((acc, i) => acc + (i.lineTotalCents as number), 0),
      );
      expect(items.some((i) => i.code === '301')).toBe(false);
    }
    expect(
      result.movements.some((m) => m.productCode === '301' && m.note === 'Producción del día'),
    ).toBe(true);
  });

  it('horarios: ventas dentro de los turnos, nada después de "ahora" y cerrado el 25 de diciembre', () => {
    for (const sale of result.sales) {
      const minutes = localMinutes(sale.createdAt as Date);
      expect(minutes).toBeGreaterThanOrEqual(9 * 60);
      expect(minutes).toBeLessThan(21 * 60);
      expect(time(sale)).toBeLessThanOrEqual(NOW.getTime() - 10 * 60_000);
      expect(calendarDateInZone(sale.createdAt as Date, TZ)).not.toBe('2025-12-25');
    }
    for (const session of result.sessions) {
      expect(session.status).toBe('closed');
      expect(time(session, 'closedAt')).toBeLessThan(NOW.getTime());
    }
  });
});
