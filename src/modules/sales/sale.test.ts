import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { useTestDatabase } from '../../test/db.js';
import { bearer, seedTwoBusinesses, testApp } from '../../test/factories.js';
import { Business } from '../businesses/business.model.js';
import { InventoryMovement } from '../inventory/movement.model.js';
import { Product } from '../products/product.model.js';

useTestDatabase();
const app = testApp();

type Auth = ReturnType<typeof bearer>;

async function setup() {
  const seed = await seedTwoBusinesses();
  const admin = bearer(seed.adminA);
  const caja = bearer(seed.employeeA);
  const create = async (body: Record<string, unknown>) =>
    (await request(app).post('/api/v1/products').set(admin).send(body)).body.data as { id: string };

  // Camarón: $389.00/kg (costo $290.00), tasa 0 %, 10 kg
  const camaron = await create({
    code: '101',
    name: 'Camarón',
    unit: 'kg',
    salePriceCents: 38900,
    costCents: 29000,
    taxRateBp: 0,
    initialStock: 10_000,
  });
  // Cerveza: $32.00 (costo $19.00), IVA 16 %, 24 pz
  const cerveza = await create({
    code: '402',
    name: 'Cerveza',
    unit: 'pz',
    salePriceCents: 3200,
    costCents: 1900,
    taxRateBp: 1600,
    initialStock: 24,
  });
  return { ...seed, admin, caja, camaron, cerveza };
}

const open = (auth: Auth, openingFloatCents = 50000) =>
  request(app).post('/api/v1/cash-sessions/open').set(auth).send({ openingFloatCents });

// 1.250 kg de camarón ($486.25) + 3 cervezas ($96.00) = $582.25
const basket = (camaronId: string, cervezaId: string) => [
  { productId: camaronId, qtyBase: 1250, weighed: true },
  { productId: cervezaId, qtyBase: 3 },
];

describe('ventas', () => {
  it('sin caja abierta no se puede vender (409 CASH_SESSION_REQUIRED)', async () => {
    const { caja, cerveza } = await setup();
    const res = await request(app)
      .post('/api/v1/sales')
      .set(caja)
      .send({
        items: [{ productId: cerveza.id, qtyBase: 1 }],
        payments: [{ method: 'cash', amountCents: 3200 }],
        expectedTotalCents: 3200,
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CASH_SESSION_REQUIRED');
  });

  it('registra la venta con snapshot de precio/costo/IVA, cambio y existencias', async () => {
    const { caja, camaron, cerveza } = await setup();
    await open(caja);

    const res = await request(app)
      .post('/api/v1/sales')
      .set(caja)
      .send({
        items: basket(camaron.id, cerveza.id),
        payments: [{ method: 'cash', amountCents: 58225 }],
        cashReceivedCents: 60000,
        expectedTotalCents: 58225,
      });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Venta V-000001 registrada');
    expect(res.body.data).toMatchObject({
      folio: 1,
      status: 'completed',
      totalCents: 58225,
      // IVA solo de la cerveza: 9600 × 1600 / 11600 = 1324.1 → 1324
      taxCents: 1324,
      // costo: 1.25 kg × $290 = $362.50 + 3 × $19 = $57 → $419.50
      costCents: 41950,
      cashReceivedCents: 60000,
      changeCents: 1775,
    });
    expect(res.body.data.items[0]).toMatchObject({
      unitPriceCents: 38900,
      unitCostCents: 29000,
      lineTotalCents: 48625,
      taxCents: 0,
      weighed: true,
    });

    expect(await Product.findById(camaron.id)).toMatchObject({ stock: 8750 });
    expect(await Product.findById(cerveza.id)).toMatchObject({ stock: 21 });
    expect(await InventoryMovement.findOne({ productId: cerveza.id, type: 'sale' })).toMatchObject({
      qtyBase: -3,
      stockAfter: 21,
      refFolio: 'V-000001',
    });
  });

  it('el precio vendido queda congelado aunque después cambie el producto', async () => {
    const { caja, admin, cerveza } = await setup();
    await open(caja);
    const sale = await request(app)
      .post('/api/v1/sales')
      .set(caja)
      .send({
        items: [{ productId: cerveza.id, qtyBase: 2 }],
        payments: [{ method: 'card', amountCents: 6400 }],
        expectedTotalCents: 6400,
      });
    await request(app)
      .patch(`/api/v1/products/${cerveza.id}`)
      .set(admin)
      .send({ salePriceCents: 4000 });

    const again = await request(app).get(`/api/v1/sales/${sale.body.data.id}`).set(caja);
    expect(again.body.data.items[0].unitPriceCents).toBe(3200);
    expect(again.body.data.totalCents).toBe(6400);
  });

  it('si el total que vio el cajero ya no coincide → 409 PRICE_CHANGED con el total real', async () => {
    const { caja, admin, cerveza } = await setup();
    await open(caja);
    await request(app)
      .patch(`/api/v1/products/${cerveza.id}`)
      .set(admin)
      .send({ salePriceCents: 3500 });

    const res = await request(app)
      .post('/api/v1/sales')
      .set(caja)
      .send({
        items: [{ productId: cerveza.id, qtyBase: 1 }],
        payments: [{ method: 'cash', amountCents: 3200 }],
        expectedTotalCents: 3200,
      });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'PRICE_CHANGED', details: { totalCents: 3500 } });
    expect(await Product.findById(cerveza.id)).toMatchObject({ stock: 24 });
  });

  it('valida pagos: la suma debe dar el total y el efectivo recibido alcanzar', async () => {
    const { caja, cerveza } = await setup();
    await open(caja);
    const items = [{ productId: cerveza.id, qtyBase: 1 }];

    const short = await request(app)
      .post('/api/v1/sales')
      .set(caja)
      .send({ items, payments: [{ method: 'cash', amountCents: 3000 }], expectedTotalCents: 3200 });
    expect(short.status).toBe(400);

    const notEnoughCash = await request(app)
      .post('/api/v1/sales')
      .set(caja)
      .send({
        items,
        payments: [{ method: 'cash', amountCents: 3200 }],
        cashReceivedCents: 2000,
        expectedTotalCents: 3200,
      });
    expect(notEnoughCash.status).toBe(400);

    const mixed = await request(app)
      .post('/api/v1/sales')
      .set(caja)
      .send({
        items,
        payments: [
          { method: 'cash', amountCents: 1200 },
          { method: 'card', amountCents: 2000 },
        ],
        cashReceivedCents: 1500,
        expectedTotalCents: 3200,
      });
    expect(mixed.status).toBe(201);
    expect(mixed.body.data.changeCents).toBe(300);
  });

  it('respeta "no vender sin existencia" del negocio', async () => {
    const { caja, cerveza, businessA } = await setup();
    await Business.updateOne({ _id: businessA._id }, { 'settings.allowNegativeStock': false });
    await open(caja);
    const res = await request(app)
      .post('/api/v1/sales')
      .set(caja)
      .send({
        items: [
          { productId: cerveza.id, qtyBase: 20 },
          { productId: cerveza.id, qtyBase: 5 },
        ],
        payments: [{ method: 'cash', amountCents: 80000 }],
        expectedTotalCents: 80000,
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('el empleado ve solo sus ventas; cancelar es de admin y regresa la mercancía', async () => {
    const { caja, admin, camaron, cerveza } = await setup();
    await open(caja);
    const sale = await request(app)
      .post('/api/v1/sales')
      .set(caja)
      .send({
        items: basket(camaron.id, cerveza.id),
        payments: [{ method: 'transfer', amountCents: 58225 }],
        expectedTotalCents: 58225,
      });
    const id = sale.body.data.id as string;

    expect(
      (await request(app).post(`/api/v1/sales/${id}/cancel`).set(caja).send({ reason: 'x' }))
        .status,
    ).toBe(403);

    const cancelled = await request(app)
      .post(`/api/v1/sales/${id}/cancel`)
      .set(admin)
      .send({ reason: 'Cliente devolvió todo' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('cancelled');
    expect(await Product.findById(camaron.id)).toMatchObject({ stock: 10_000 });
    expect(
      await InventoryMovement.findOne({ productId: camaron.id, type: 'sale_cancel' }),
    ).toMatchObject({ qtyBase: 1250, note: 'Cliente devolvió todo' });

    const twice = await request(app)
      .post(`/api/v1/sales/${id}/cancel`)
      .set(admin)
      .send({ reason: 'otra vez' });
    expect(twice.status).toBe(409);

    // El admin también vende con su propia caja; el empleado no ve esa venta.
    await open(admin);
    await request(app)
      .post('/api/v1/sales')
      .set(admin)
      .send({
        items: [{ productId: cerveza.id, qtyBase: 1 }],
        payments: [{ method: 'cash', amountCents: 3200 }],
        expectedTotalCents: 3200,
      });
    const own = await request(app).get('/api/v1/sales').set(caja);
    const all = await request(app).get('/api/v1/sales').set(admin);
    expect(own.body.meta.total).toBe(1);
    expect(all.body.meta.total).toBe(2);
    expect(
      (await request(app).get('/api/v1/sales?search=V-000002').set(admin)).body.data[0].folio,
    ).toBe(2);
  });

  it('catálogo de caja disponible para el empleado (solo activos)', async () => {
    const { caja, admin, cerveza } = await setup();
    await request(app).delete(`/api/v1/products/${cerveza.id}`).set(admin);
    const res = await request(app).get('/api/v1/pos/catalog').set(caja);
    expect(res.status).toBe(200);
    expect(res.body.data.products.map((p: { code: string }) => p.code)).toEqual(['101']);
    expect(res.body.data.products[0]).toMatchObject({ unit: 'kg', salePriceCents: 38900 });
    expect(res.body.data.products[0]).not.toHaveProperty('costCents');
  });
});
