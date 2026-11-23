import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { useTestDatabase } from '../../test/db.js';
import { bearer, seedTwoBusinesses, testApp } from '../../test/factories.js';
import { Business } from '../businesses/business.model.js';
import { Product } from '../products/product.model.js';

useTestDatabase();
const app = testApp();

async function setup() {
  const seed = await seedTwoBusinesses();
  const auth = bearer(seed.adminA);
  const create = async (body: Record<string, unknown>) =>
    (
      await request(app)
        .post('/api/v1/products')
        .set(auth)
        .send({ taxRateBp: 0, ...body })
    ).body.data as { id: string };

  // Pulpo: 3.200 kg a $240.00/kg (mínimo 4 kg → bajo)
  const pulpo = await create({
    code: '103',
    name: 'Pulpo',
    unit: 'kg',
    salePriceCents: 32900,
    costCents: 24000,
    initialStock: 3200,
    minStock: 4000,
  });
  // Cerveza: 120 pz a $19.00
  const cerveza = await create({
    code: '402',
    name: 'Cerveza',
    unit: 'pz',
    salePriceCents: 3200,
    costCents: 1900,
    initialStock: 120,
  });
  // Jaiba sin existencia
  await create({ code: '105', name: 'Jaiba', unit: 'kg', salePriceCents: 28000, costCents: 19000 });
  return { ...seed, auth, pulpo, cerveza };
}

const adjust = (auth: ReturnType<typeof bearer>, body: Record<string, unknown>) =>
  request(app).post('/api/v1/inventory/adjustments').set(auth).send(body);

describe('ajustes de inventario', () => {
  it('merma resta, entrada suma y conteo físico fija la existencia', async () => {
    const { auth, pulpo } = await setup();

    const merma = await adjust(auth, {
      productId: pulpo.id,
      mode: 'remove',
      qtyBase: 450,
      reason: 'merma',
      note: 'Se descompuso',
    });
    expect(merma.status).toBe(201);
    expect(merma.body.data.movement).toMatchObject({
      type: 'adjustment',
      reason: 'merma',
      qtyBase: -450,
      stockBefore: 3200,
      stockAfter: 2750,
      note: 'Se descompuso',
    });

    await adjust(auth, { productId: pulpo.id, mode: 'add', qtyBase: 250, reason: 'otro' });
    const conteo = await adjust(auth, {
      productId: pulpo.id,
      mode: 'set',
      qtyBase: 2900,
      reason: 'conteo',
    });
    expect(conteo.body.data.movement).toMatchObject({ qtyBase: -100, stockAfter: 2900 });
    expect(await Product.findById(pulpo.id)).toMatchObject({ stock: 2900 });
  });

  it('conteo igual a la existencia → 400; cantidad 0 en merma → 400', async () => {
    const { auth, cerveza } = await setup();
    const same = await adjust(auth, {
      productId: cerveza.id,
      mode: 'set',
      qtyBase: 120,
      reason: 'conteo',
    });
    expect(same.status).toBe(400);
    const zero = await adjust(auth, {
      productId: cerveza.id,
      mode: 'remove',
      qtyBase: 0,
      reason: 'merma',
    });
    expect(zero.status).toBe(400);
    expect(zero.body.error.details.fieldErrors).toHaveProperty('qtyBase');
  });

  it('respeta la regla de existencia negativa del negocio', async () => {
    const { auth, cerveza, businessA } = await setup();
    const allowed = await adjust(auth, {
      productId: cerveza.id,
      mode: 'remove',
      qtyBase: 130,
      reason: 'merma',
    });
    expect(allowed.status).toBe(201);
    expect(allowed.body.data.product.stock).toBe(-10);

    await Business.updateOne({ _id: businessA._id }, { 'settings.allowNegativeStock': false });
    const blocked = await adjust(auth, {
      productId: cerveza.id,
      mode: 'remove',
      qtyBase: 1,
      reason: 'merma',
    });
    expect(blocked.status).toBe(409);
  });
});

describe('kárdex y resumen', () => {
  it('lista movimientos del más reciente al más antiguo con filtros', async () => {
    const { auth, pulpo } = await setup();
    await adjust(auth, { productId: pulpo.id, mode: 'remove', qtyBase: 200, reason: 'merma' });

    const all = await request(app)
      .get(`/api/v1/inventory/movements?productId=${pulpo.id}`)
      .set(auth);
    expect(all.body.data.map((m: { type: string }) => m.type)).toEqual(['adjustment', 'initial']);

    const onlyAdjust = await request(app)
      .get('/api/v1/inventory/movements?type=adjustment')
      .set(auth);
    expect(onlyAdjust.body.meta.total).toBe(1);
  });

  it('resumen: valor del inventario, stock bajo, agotados y negativos', async () => {
    const { auth, cerveza } = await setup();
    await adjust(auth, { productId: cerveza.id, mode: 'set', qtyBase: 0, reason: 'conteo' });

    const res = await request(app).get('/api/v1/inventory/summary').set(auth);
    // Pulpo 3.2 kg × $240 = $768.00; cerveza 0; jaiba 0
    expect(res.body.data).toEqual({
      products: 3,
      inventoryValueCents: 76800,
      lowStock: 1,
      outOfStock: 2,
      negativeStock: 0,
    });
  });

  it('empleado → 403 y aislamiento entre negocios', async () => {
    const { employeeA, adminB, pulpo } = await setup();
    expect(
      (await request(app).get('/api/v1/inventory/summary').set(bearer(employeeA))).status,
    ).toBe(403);
    const foreign = await adjust(bearer(adminB), {
      productId: pulpo.id,
      mode: 'add',
      qtyBase: 1,
      reason: 'otro',
    });
    expect(foreign.status).toBe(404);
    const summaryB = await request(app).get('/api/v1/inventory/summary').set(bearer(adminB));
    expect(summaryB.body.data.products).toBe(0);
  });
});
