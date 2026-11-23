import { Types } from 'mongoose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { includedTaxCents, lineTotalCents } from '../../common/utils/money.js';
import { unitScale } from '../../common/utils/qty.js';
import { useTestDatabase } from '../../test/db.js';
import { bearer, seedTwoBusinesses, testApp } from '../../test/factories.js';
import { Category } from '../categories/category.model.js';
import { Purchase } from '../purchases/purchase.model.js';
import { Sale } from '../sales/sale.model.js';

useTestDatabase();
const app = testApp();

type Auth = ReturnType<typeof bearer>;
const get = (
  auth: Auth,
  path: string,
  query: Record<string, string | number>,
  business?: string,
) => {
  const req = request(app).get(`/api/v1/reports/${path}`).set(auth).query(query);
  return business ? req.set('x-business-id', business) : req;
};

interface Line {
  productId: Types.ObjectId;
  code: string;
  unit: 'pz' | 'kg';
  qty: number;
  price: number;
  cost: number;
  taxRateBp?: number;
  categoryId?: Types.ObjectId | null;
}

let folio = 0;
/** Inserta una venta con fecha exacta (las del API usan "ahora"). Montos con money.ts. */
async function insertSale(
  businessId: Types.ObjectId,
  at: string,
  lines: Line[],
  opts: {
    method?: string;
    status?: 'completed' | 'cancelled';
    cashier?: Types.ObjectId;
    cashierName?: string;
  } = {},
) {
  const items = lines.map((l) => {
    const total = lineTotalCents(l.price, l.qty, unitScale(l.unit));
    return {
      productId: l.productId,
      code: l.code,
      name: `Producto ${l.code}`,
      categoryId: l.categoryId ?? null,
      unit: l.unit,
      qtyBase: l.qty,
      unitPriceCents: l.price,
      unitCostCents: l.cost,
      lineTotalCents: total,
      lineCostCents: lineTotalCents(l.cost, l.qty, unitScale(l.unit)),
      taxRateBp: l.taxRateBp ?? 0,
      taxCents: includedTaxCents(total, l.taxRateBp ?? 0),
      weighed: false,
    };
  });
  const total = items.reduce((s, i) => s + i.lineTotalCents, 0);
  folio += 1;
  await Sale.collection.insertOne({
    businessId,
    folio,
    cashSessionId: new Types.ObjectId(),
    cashierId: opts.cashier ?? new Types.ObjectId(),
    cashierName: opts.cashierName ?? 'Caja',
    items,
    totalCents: total,
    taxCents: items.reduce((s, i) => s + i.taxCents, 0),
    costCents: items.reduce((s, i) => s + i.lineCostCents, 0),
    payments: [{ method: opts.method ?? 'cash', amountCents: total }],
    cashReceivedCents: total,
    changeCents: 0,
    status: opts.status ?? 'completed',
    cancelledAt: null,
    cancelledByName: '',
    cancelReason: '',
    createdAt: new Date(at),
    updatedAt: new Date(at),
  });
}

async function insertPurchase(
  businessId: Types.ObjectId,
  at: string,
  lines: {
    productId: Types.ObjectId;
    code: string;
    unit: 'pz' | 'kg';
    qty: number;
    cost: number;
  }[],
  opts: { supplier?: { id: Types.ObjectId; name: string }; status?: 'active' | 'cancelled' } = {},
) {
  const items = lines.map((l) => ({
    productId: l.productId,
    code: l.code,
    name: `Producto ${l.code}`,
    unit: l.unit,
    qtyBase: l.qty,
    unitCostCents: l.cost,
    lineTotalCents: lineTotalCents(l.cost, l.qty, unitScale(l.unit)),
    previousCostCents: 0,
    previousSalePriceCents: 0,
    newSalePriceCents: null,
  }));
  await Purchase.collection.insertOne({
    businessId,
    folio: ++folio,
    supplierId: opts.supplier?.id ?? null,
    supplierName: opts.supplier?.name ?? '',
    purchasedAt: new Date(at),
    items,
    totalCents: items.reduce((s, i) => s + i.lineTotalCents, 0),
    status: opts.status ?? 'active',
    createdBy: new Types.ObjectId(),
    createdByName: 'Admin',
    createdAt: new Date(at),
    updatedAt: new Date(at),
  });
}

const SHRIMP = {
  productId: new Types.ObjectId(),
  code: '101',
  unit: 'kg',
  price: 38900,
  cost: 29000,
} as const;
const BEER = {
  productId: new Types.ObjectId(),
  code: '402',
  unit: 'pz',
  price: 3200,
  cost: 1900,
  taxRateBp: 1600,
} as const;

describe('reportes: flujo real (API) — el histórico no cambia con el precio', () => {
  it('vender, cancelar y cambiar precio: el reporte usa el snapshot', async () => {
    const seed = await seedTwoBusinesses();
    const admin = bearer(seed.adminA);
    const caja = bearer(seed.employeeA);
    const product = (
      await request(app).post('/api/v1/products').set(admin).send({
        code: '101',
        name: 'Camarón',
        unit: 'kg',
        salePriceCents: 38900,
        costCents: 29000,
        taxRateBp: 0,
        initialStock: 10_000,
      })
    ).body.data;
    await request(app).post('/api/v1/cash-sessions/open').set(caja).send({ openingFloatCents: 0 });
    const sell = (qtyBase: number, expectedTotalCents: number) =>
      request(app)
        .post('/api/v1/sales')
        .set(caja)
        .send({
          items: [{ productId: product.id, qtyBase }],
          payments: [{ method: 'cash', amountCents: expectedTotalCents }],
          cashReceivedCents: expectedTotalCents,
          expectedTotalCents,
        });
    await sell(1250, 48625); // 1.25 kg × $389 = $486.25 (costo $362.50)
    const toCancel = (await sell(500, 19450)).body.data; // $194.50
    await request(app)
      .post(`/api/v1/sales/${toCancel.id}/cancel`)
      .set(admin)
      .send({ reason: 'Prueba' });

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(
      new Date(),
    );
    const range = { from: today, to: today };
    const before = (await get(admin, 'summary', range)).body.data.totals;
    expect(before).toMatchObject({
      salesCents: 48625,
      costCents: 36250,
      profitCents: 12375,
      tickets: 1,
      avgTicketCents: 48625,
      cancelledCount: 1,
      cancelledCents: 19450,
    });
    expect(before.marginBp).toBe(Math.round((12375 * 10_000) / 48625));

    // Sube precio y costo: lo ya vendido NO cambia en el reporte.
    await request(app)
      .patch(`/api/v1/products/${product.id}`)
      .set(admin)
      .send({ salePriceCents: 45000, costCents: 35000 });
    const after = (await get(admin, 'summary', range)).body.data.totals;
    expect(after.salesCents).toBe(48625);
    expect(after.costCents).toBe(36250);
    const top = (await get(admin, 'top-products', range)).body.data.items;
    expect(top[0]).toMatchObject({ code: '101', qtyBase: 1250, salesCents: 48625 });
  });
});

describe('reportes: cálculos con fechas exactas', () => {
  async function scenario() {
    const seed = await seedTwoBusinesses();
    const A = seed.businessA._id as Types.ObjectId;
    const B = seed.businessB._id as Types.ObjectId;
    const seafood = await Category.create({
      businessId: A,
      name: 'Mariscos',
      searchName: 'mariscos',
    });
    const drinks = await Category.create({ businessId: A, name: 'Bebidas', searchName: 'bebidas' });
    const shrimp = { ...SHRIMP, categoryId: seafood._id };
    const beer = { ...BEER, categoryId: drinks._id };
    const ana = new Types.ObjectId();
    const beto = new Types.ObjectId();
    // Lunes 2 de marzo de 2026 = inicio de semana. CDMX = UTC-6.
    await insertSale(A, '2026-03-02T16:00:00Z', [{ ...shrimp, qty: 1000 }], {
      cashier: ana,
      cashierName: 'Ana',
    }); // 38900
    await insertSale(A, '2026-03-02T17:00:00Z', [{ ...beer, qty: 6 }], {
      method: 'card',
      cashier: beto,
      cashierName: 'Beto',
    }); // 19200
    await insertSale(
      A,
      '2026-03-08T20:00:00Z',
      [
        { ...shrimp, qty: 500 },
        { ...beer, qty: 2 },
      ],
      { cashier: ana, cashierName: 'Ana' },
    ); // 19450 + 6400
    // 23:30 del domingo 8 en CDMX = 05:30 UTC del lunes 9: cuenta en el día 8 (y en la semana del 2).
    await insertSale(A, '2026-03-09T05:30:00Z', [{ ...beer, qty: 1 }], {
      method: 'transfer',
      cashier: beto,
      cashierName: 'Beto',
    }); // 3200
    await insertSale(A, '2026-03-10T18:00:00Z', [{ ...shrimp, qty: 2000 }], {
      cashier: ana,
      cashierName: 'Ana',
    }); // 77800
    await insertSale(A, '2026-03-10T19:00:00Z', [{ ...shrimp, qty: 3000 }], {
      status: 'cancelled',
    }); // no cuenta
    await insertSale(B, '2026-03-03T18:00:00Z', [{ ...BEER, qty: 100 }]); // otro negocio: 320000
    await insertPurchase(A, '2026-03-02T14:00:00Z', [{ ...SHRIMP, qty: 10_000, cost: 29000 }], {
      supplier: { id: new Types.ObjectId(), name: 'Pescadería del Puerto' },
    }); // 290000
    await insertPurchase(A, '2026-03-05T14:00:00Z', [{ ...BEER, qty: 24, cost: 1900 }], {
      supplier: { id: new Types.ObjectId(), name: 'Distribuidora Bahía' },
    }); // 45600
    await insertPurchase(A, '2026-03-06T14:00:00Z', [{ ...BEER, qty: 24, cost: 1900 }], {
      status: 'cancelled',
    });
    return { ...seed, A, B, seafood, drinks, ana };
  }
  const MARCH = { from: '2026-03-01', to: '2026-03-31' };

  it('resumen: totales, ganancia, IVA, tickets, canceladas y compras del negocio', async () => {
    const s = await scenario();
    const res = await get(bearer(s.adminA), 'summary', MARCH);
    expect(res.status).toBe(200);
    const t = res.body.data.totals;
    expect(t.salesCents).toBe(38900 + 19200 + 25850 + 3200 + 77800);
    expect(t.costCents).toBe(29000 + 11400 + 14500 + 3800 + 1900 + 58000);
    expect(t.tickets).toBe(5);
    expect(t.lines).toBe(6);
    expect(t.taxCents).toBe(
      includedTaxCents(19200, 1600) + includedTaxCents(6400, 1600) + includedTaxCents(3200, 1600),
    );
    expect(t.cancelledCount).toBe(1);
    expect(t.purchasesCents).toBe(290000 + 45600);
    expect(res.body.data.previous).toMatchObject({ from: '2026-01-29', to: '2026-02-28' });
  });

  it('zona horaria: 23:30 local cuenta en su día, no en el siguiente (UTC)', async () => {
    const s = await scenario();
    const day8 = (await get(bearer(s.adminA), 'summary', { from: '2026-03-08', to: '2026-03-08' }))
      .body.data.totals;
    expect(day8.salesCents).toBe(25850 + 3200);
    const day9 = (await get(bearer(s.adminA), 'summary', { from: '2026-03-09', to: '2026-03-09' }))
      .body.data.totals;
    expect(day9.salesCents).toBe(0);
  });

  it('serie semanal: semanas desde el lunes y periodos vacíos en cero', async () => {
    const s = await scenario();
    const res = await get(bearer(s.adminA), 'sales-series', { ...MARCH, granularity: 'week' });
    const points = res.body.data.points as {
      period: string;
      salesCents: number;
      tickets: number;
    }[];
    expect(points.map((p) => p.period)).toEqual([
      '2026-02-23',
      '2026-03-02',
      '2026-03-09',
      '2026-03-16',
      '2026-03-23',
      '2026-03-30',
    ]);
    expect(points[1]).toMatchObject({ salesCents: 38900 + 19200 + 25850 + 3200, tickets: 4 });
    expect(points[2]).toMatchObject({ salesCents: 77800, tickets: 1 });
    expect(points[3]).toMatchObject({ salesCents: 0, tickets: 0 });
    const daily = (await get(bearer(s.adminA), 'sales-series', MARCH)).body.data;
    expect(daily.granularity).toBe('day');
    expect(daily.points).toHaveLength(31);
  });

  it('más vendidos por importe, por cantidad (con unidad) y por ganancia', async () => {
    const s = await scenario();
    const byAmount = (await get(bearer(s.adminA), 'top-products', MARCH)).body.data;
    expect(byAmount.items.map((i: { code: string }) => i.code)).toEqual(['101', '402']);
    expect(byAmount.items[0]).toMatchObject({ qtyBase: 3500, salesCents: 136150, tickets: 3 });
    const byQty = (
      await get(bearer(s.adminA), 'top-products', { ...MARCH, sort: 'qty', unit: 'pz' })
    ).body.data;
    expect(byQty.items).toHaveLength(1);
    expect(byQty.items[0]).toMatchObject({ code: '402', qtyBase: 9 });
    const noUnit = await get(bearer(s.adminA), 'top-products', { ...MARCH, sort: 'qty' });
    expect(noUnit.status).toBe(400);
    expect(noUnit.body.error.details.fieldErrors.unit).toBeDefined();
  });

  it('filtros: categoría, producto, cajero y forma de pago', async () => {
    const s = await scenario();
    const auth = bearer(s.adminA);
    const drinks = (await get(auth, 'summary', { ...MARCH, categoryId: String(s.drinks._id) })).body
      .data.totals;
    expect(drinks).toMatchObject({ salesCents: 19200 + 6400 + 3200, tickets: 3 });
    const shrimp = (await get(auth, 'summary', { ...MARCH, productId: String(SHRIMP.productId) }))
      .body.data.totals;
    expect(shrimp.salesCents).toBe(136150);
    expect(shrimp.purchasesCents).toBe(290000);
    const ana = (await get(auth, 'summary', { ...MARCH, cashierId: String(s.ana) })).body.data
      .totals;
    expect(ana.tickets).toBe(3);
    const card = (await get(auth, 'summary', { ...MARCH, method: 'card' })).body.data.totals;
    expect(card.salesCents).toBe(19200);
  });

  it('categorías, formas de pago, cajeros y horas pico', async () => {
    const s = await scenario();
    const auth = bearer(s.adminA);
    const cats = (await get(auth, 'categories', MARCH)).body.data.items;
    expect(cats.map((c: { name: string }) => c.name)).toEqual(['Mariscos', 'Bebidas']);
    const pay = (await get(auth, 'payments', MARCH)).body.data;
    expect(pay.byMethod.find((m: { method: string }) => m.method === 'card').amountCents).toBe(
      19200,
    );
    expect(pay.byMethod.map((m: { method: string }) => m.method)).toEqual([
      'cash',
      'card',
      'transfer',
      'other',
    ]);
    expect(pay.byCashier[0]).toMatchObject({
      name: 'Ana',
      tickets: 3,
      salesCents: 38900 + 25850 + 77800,
    });
    // Domingo 8 a las 23:30 local → weekday 7, hora 23.
    expect(pay.hours).toContainEqual({ weekday: 7, hour: 23, salesCents: 3200, tickets: 1 });
  });

  it('compras: serie, proveedores y costo promedio por unidad (sin canceladas)', async () => {
    const s = await scenario();
    const data = (await get(bearer(s.adminA), 'purchases', MARCH)).body.data;
    expect(data).toMatchObject({ totalCents: 335600, count: 2 });
    expect(data.bySupplier.map((x: { name: string }) => x.name)).toEqual([
      'Pescadería del Puerto',
      'Distribuidora Bahía',
    ]);
    const beer = data.byProduct.find((p: { code: string }) => p.code === '402');
    expect(beer).toMatchObject({ qtyBase: 24, totalCents: 45600, avgUnitCostCents: 1900 });
  });

  it('permisos y alcance: admin solo su negocio; superadmin todos o el elegido; empleado 403', async () => {
    const s = await scenario();
    expect((await get(bearer(s.employeeA), 'summary', MARCH)).status).toBe(403);
    const adminB = (await get(bearer(s.adminB), 'summary', MARCH)).body.data.totals;
    expect(adminB.salesCents).toBe(320000);
    const root = bearer(s.superadmin);
    const all = (await get(root, 'summary', MARCH)).body.data.totals;
    expect(all.salesCents).toBe(164950 + 320000);
    const onlyA = (await get(root, 'summary', MARCH, String(s.A))).body.data.totals;
    expect(onlyA.salesCents).toBe(164950);
    const compare = await get(root, 'businesses', MARCH);
    expect(compare.body.data.items.map((b: { name: string }) => b.name)).toEqual([
      'Abarrotes La Esquina',
      'Mariscos El Faro',
    ]);
    expect(compare.body.data.items[1]).toMatchObject({
      salesCents: 164950,
      purchasesCents: 335600,
      tickets: 5,
    });
    expect((await get(bearer(s.adminA), 'businesses', MARCH)).status).toBe(403);
  });

  it('validación: fechas al revés, rango enorme y agrupación inválida → 400', async () => {
    const s = await scenario();
    const auth = bearer(s.adminA);
    expect((await get(auth, 'summary', { from: '2026-03-10', to: '2026-03-01' })).status).toBe(400);
    expect((await get(auth, 'summary', { from: '2010-01-01', to: '2026-03-01' })).status).toBe(400);
    expect((await get(auth, 'sales-series', { ...MARCH, granularity: 'hour' })).status).toBe(400);
    expect((await get(auth, 'summary', { from: '2026-3-1', to: '2026-03-02' })).status).toBe(400);
  });

  it('fechas que no existen → 400 (y sin errores de rango de más)', async () => {
    const s = await scenario();
    const auth = bearer(s.adminA);
    for (const bad of [
      '2026-02-30',
      '2026-02-29',
      '2026-04-31',
      '2026-01-32',
      '2026-00-10',
      '2026-01-00',
    ]) {
      const res = await get(auth, 'summary', { from: bad, to: '2026-10-31' });
      expect(res.status, bad).toBe(400);
      expect(res.body.error.details.fieldErrors.from).toEqual(['Esa fecha no existe']);
      expect(res.body.error.details.fieldErrors.to).toBeUndefined();
    }
    expect((await get(auth, 'summary', { from: '2028-02-29', to: '2028-03-01' })).status).toBe(200); // bisiesto
    // El mismo validador se usa en el resto de los filtros por fecha.
    const purchases = await request(app)
      .get('/api/v1/purchases')
      .set(auth)
      .query({ from: '2026-04-31' });
    expect(purchases.status).toBe(400);
  });
});
