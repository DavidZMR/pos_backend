import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { useTestDatabase } from '../../test/db.js';
import { bearer, seedTwoBusinesses, testApp } from '../../test/factories.js';
import { Business } from '../businesses/business.model.js';
import { InventoryMovement } from '../inventory/movement.model.js';
import { PriceHistory } from '../products/price-history.model.js';
import { Product } from '../products/product.model.js';

useTestDatabase();
const app = testApp();

type Auth = ReturnType<typeof bearer>;

async function product(auth: Auth, body: Record<string, unknown>) {
  const res = await request(app)
    .post('/api/v1/products')
    .set(auth)
    .send({ taxRateBp: 0, ...body });
  return res.body.data as { id: string };
}

async function setup() {
  const seed = await seedTwoBusinesses();
  const auth = bearer(seed.adminA);
  // Camarón: 10 kg a $100.00/kg de costo, vende a $150.00/kg
  const camaron = await product(auth, {
    code: '101',
    name: 'Camarón',
    unit: 'kg',
    salePriceCents: 15000,
    costCents: 10000,
    initialStock: 10_000,
  });
  const cerveza = await product(auth, {
    code: '402',
    name: 'Cerveza',
    unit: 'pz',
    salePriceCents: 3200,
    costCents: 1900,
  });
  const supplier = (
    await request(app).post('/api/v1/suppliers').set(auth).send({ name: 'Pescadería del Puerto' })
  ).body.data as { id: string };
  return { ...seed, auth, camaron, cerveza, supplier };
}

describe('entradas de mercancía', () => {
  it('suben existencia, recalculan costo promedio, cambian precio y dejan rastro', async () => {
    const { auth, camaron, cerveza, supplier } = await setup();

    const res = await request(app)
      .post('/api/v1/purchases')
      .set(auth)
      .send({
        supplierId: supplier.id,
        invoiceNumber: 'F-889',
        items: [
          // 10 kg más a $120.00/kg → promedio (10×100 + 10×120)/20 = $110.00
          {
            productId: camaron.id,
            qtyBase: 10_000,
            unitCostCents: 12000,
            newSalePriceCents: 16500,
          },
          { productId: cerveza.id, qtyBase: 24, unitCostCents: 2000 },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Entrada E-000001 registrada');
    expect(res.body.data).toMatchObject({
      folio: 1,
      supplierName: 'Pescadería del Puerto',
      invoiceNumber: 'F-889',
      status: 'active',
      totalCents: 120_000 + 48_000,
    });
    expect(res.body.data.items[0]).toMatchObject({
      lineTotalCents: 120_000,
      previousCostCents: 10000,
      previousSalePriceCents: 15000,
      newSalePriceCents: 16500,
    });
    expect(res.body.data.items[1].newSalePriceCents).toBeNull();

    const cam = await Product.findById(camaron.id);
    expect(cam).toMatchObject({ stock: 20_000, costCents: 11000, salePriceCents: 16500 });
    // Cerveza sin existencia previa: toma el costo nuevo
    expect(await Product.findById(cerveza.id)).toMatchObject({ stock: 24, costCents: 2000 });

    const movement = await InventoryMovement.findOne({ productId: camaron.id, type: 'purchase' });
    expect(movement).toMatchObject({
      qtyBase: 10_000,
      stockBefore: 10_000,
      stockAfter: 20_000,
      unitCostCents: 12000,
      refFolio: 'E-000001',
    });

    const history = await PriceHistory.findOne({ productId: camaron.id, source: 'purchase' });
    expect(history).toMatchObject({
      salePriceCents: 16500,
      costCents: 11000,
      previousSalePriceCents: 15000,
      refFolio: 'E-000001',
    });

    const second = await request(app)
      .post('/api/v1/purchases')
      .set(auth)
      .send({ items: [{ productId: cerveza.id, qtyBase: 12, unitCostCents: 2000 }] });
    expect(second.body.data.folio).toBe(2);
  });

  it('valida renglones y productos de otro negocio', async () => {
    const { auth, camaron, adminB } = await setup();

    const empty = await request(app).post('/api/v1/purchases').set(auth).send({ items: [] });
    expect(empty.status).toBe(400);

    const zero = await request(app)
      .post('/api/v1/purchases')
      .set(auth)
      .send({ items: [{ productId: camaron.id, qtyBase: 0, unitCostCents: 100 }] });
    expect(zero.status).toBe(400);

    const foreign = await request(app)
      .post('/api/v1/purchases')
      .set(bearer(adminB))
      .send({ items: [{ productId: camaron.id, qtyBase: 1000, unitCostCents: 100 }] });
    expect(foreign.status).toBe(400);
    expect(await Product.findById(camaron.id)).toMatchObject({ stock: 10_000 });
  });

  it('si un renglón falla no se aplica nada (transacción)', async () => {
    const { auth, camaron } = await setup();
    const res = await request(app)
      .post('/api/v1/purchases')
      .set(auth)
      .send({
        items: [
          { productId: camaron.id, qtyBase: 5000, unitCostCents: 12000 },
          { productId: '64b7f0c2a1b2c3d4e5f60718', qtyBase: 1, unitCostCents: 1 },
        ],
      });
    expect(res.status).toBe(400);
    expect(await Product.findById(camaron.id)).toMatchObject({ stock: 10_000, costCents: 10000 });
    expect(await InventoryMovement.countDocuments({ type: 'purchase' })).toBe(0);
  });

  it('no acepta fechas futuras; fecha pasada queda a mediodía local', async () => {
    const { auth, cerveza } = await setup();
    const future = await request(app)
      .post('/api/v1/purchases')
      .set(auth)
      .send({
        purchaseDate: '2999-01-01',
        items: [{ productId: cerveza.id, qtyBase: 1, unitCostCents: 1 }],
      });
    expect(future.status).toBe(400);

    const past = await request(app)
      .post('/api/v1/purchases')
      .set(auth)
      .send({
        purchaseDate: '2026-01-15',
        items: [{ productId: cerveza.id, qtyBase: 1, unitCostCents: 1 }],
      });
    expect(past.body.data.purchasedAt).toBe('2026-01-15T18:00:00.000Z');
  });

  it('cancelar revierte existencias (sin tocar el costo) y no se puede cancelar dos veces', async () => {
    const { auth, camaron } = await setup();
    const created = await request(app)
      .post('/api/v1/purchases')
      .set(auth)
      .send({ items: [{ productId: camaron.id, qtyBase: 10_000, unitCostCents: 12000 }] });
    const id = created.body.data.id as string;

    const noReason = await request(app).post(`/api/v1/purchases/${id}/cancel`).set(auth).send({});
    expect(noReason.status).toBe(400);

    const cancelled = await request(app)
      .post(`/api/v1/purchases/${id}/cancel`)
      .set(auth)
      .send({ reason: 'Capturada dos veces' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data).toMatchObject({
      status: 'cancelled',
      cancelReason: 'Capturada dos veces',
    });
    expect(await Product.findById(camaron.id)).toMatchObject({ stock: 10_000, costCents: 11000 });
    expect(
      await InventoryMovement.findOne({ type: 'purchase_cancel', productId: camaron.id }),
    ).toMatchObject({ qtyBase: -10_000, refFolio: 'E-000001', note: 'Capturada dos veces' });

    const again = await request(app)
      .post(`/api/v1/purchases/${id}/cancel`)
      .set(auth)
      .send({ reason: 'Otra vez' });
    expect(again.status).toBe(409);
  });

  it('si el negocio no permite negativos, no cancela una entrada ya vendida', async () => {
    const { auth, cerveza, businessA } = await setup();
    await Business.updateOne({ _id: businessA._id }, { 'settings.allowNegativeStock': false });
    const created = await request(app)
      .post('/api/v1/purchases')
      .set(auth)
      .send({ items: [{ productId: cerveza.id, qtyBase: 24, unitCostCents: 2000 }] });
    await Product.updateOne({ _id: cerveza.id }, { stock: 5 }); // se vendieron 19

    const res = await request(app)
      .post(`/api/v1/purchases/${created.body.data.id}/cancel`)
      .set(auth)
      .send({ reason: 'Error' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('lista con filtros de fecha (zona del negocio), proveedor, estado y folio', async () => {
    const { auth, cerveza, supplier } = await setup();
    const line = [{ productId: cerveza.id, qtyBase: 1, unitCostCents: 100 }];
    await request(app)
      .post('/api/v1/purchases')
      .set(auth)
      .send({ purchaseDate: '2026-03-01', items: line });
    await request(app)
      .post('/api/v1/purchases')
      .set(auth)
      .send({
        purchaseDate: '2026-03-02',
        supplierId: supplier.id,
        invoiceNumber: 'NOTA-7',
        items: line,
      });

    const folios = async (query: string) =>
      (await request(app).get(`/api/v1/purchases?${query}`).set(auth)).body.data.map(
        (p: { folio: number }) => p.folio,
      );

    expect(await folios('')).toEqual([2, 1]);
    expect(await folios('from=2026-03-02&to=2026-03-02')).toEqual([2]);
    expect(await folios(`supplierId=${supplier.id}`)).toEqual([2]);
    expect(await folios('search=E-000001')).toEqual([1]);
    expect(await folios('search=nota-7')).toEqual([2]);
    expect(await folios('status=cancelled')).toEqual([]);
  });

  it('empleado no registra entradas; admin de otro negocio no ve la entrada', async () => {
    const { auth, employeeA, adminB, cerveza } = await setup();
    const created = await request(app)
      .post('/api/v1/purchases')
      .set(auth)
      .send({ items: [{ productId: cerveza.id, qtyBase: 1, unitCostCents: 100 }] });

    expect((await request(app).get('/api/v1/purchases').set(bearer(employeeA))).status).toBe(403);
    expect(
      (await request(app).get(`/api/v1/purchases/${created.body.data.id}`).set(bearer(adminB)))
        .status,
    ).toBe(404);
  });
});
