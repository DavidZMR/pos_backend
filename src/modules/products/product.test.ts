import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { useTestDatabase } from '../../test/db.js';
import { bearer, seedTwoBusinesses, testApp } from '../../test/factories.js';
import { InventoryMovement } from '../inventory/movement.model.js';
import { PriceHistory } from './price-history.model.js';

useTestDatabase();
const app = testApp();

const camaron = (overrides: Record<string, unknown> = {}) => ({
  code: '101',
  name: 'Camarón grande U-15',
  unit: 'kg',
  salePriceCents: 38900,
  costCents: 29000,
  taxRateBp: 0,
  minStock: 5000,
  ...overrides,
});

describe('productos', () => {
  it('alta con existencia inicial: crea kárdex "initial" e historial de precio', async () => {
    const { adminA } = await seedTwoBusinesses();
    const res = await request(app)
      .post('/api/v1/products')
      .set(bearer(adminA))
      .send(camaron({ code: 'cam-g', initialStock: 18500 }));

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ code: 'CAM-G', stock: 18500, unit: 'kg' });
    expect(res.body.data).not.toHaveProperty('barcode');

    const movements = await InventoryMovement.find({ productId: res.body.data.id });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      type: 'initial',
      qtyBase: 18500,
      stockBefore: 0,
      stockAfter: 18500,
    });

    const history = await PriceHistory.find({ productId: res.body.data.id });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ source: 'create', salePriceCents: 38900, costCents: 29000 });
  });

  it('valida dinero entero, unidad y tasa de IVA', async () => {
    const { adminA } = await seedTwoBusinesses();
    const res = await request(app)
      .post('/api/v1/products')
      .set(bearer(adminA))
      .send(camaron({ salePriceCents: 389.5, unit: 'caja', taxRateBp: 1500 }));
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.details.fieldErrors)).toEqual(
      expect.arrayContaining(['salePriceCents', 'unit', 'taxRateBp']),
    );
  });

  it('código y código de barras únicos por negocio, con error en el campo', async () => {
    const { adminA, adminB } = await seedTwoBusinesses();
    await request(app)
      .post('/api/v1/products')
      .set(bearer(adminA))
      .send(camaron({ barcode: '750100' }));

    const dupCode = await request(app).post('/api/v1/products').set(bearer(adminA)).send(camaron());
    const dupBarcode = await request(app)
      .post('/api/v1/products')
      .set(bearer(adminA))
      .send(camaron({ code: '999', barcode: '750100' }));
    const otherBusiness = await request(app)
      .post('/api/v1/products')
      .set(bearer(adminB))
      .send(camaron({ barcode: '750100' }));

    expect(dupCode.status).toBe(409);
    expect(dupCode.body.error.details.fieldErrors).toHaveProperty('code');
    expect(dupBarcode.status).toBe(409);
    expect(dupBarcode.body.error.details.fieldErrors).toHaveProperty('barcode');
    expect(otherBusiness.status).toBe(201);
  });

  it('varios productos sin código de barras no chocan', async () => {
    const { adminA } = await seedTwoBusinesses();
    const a = await request(app)
      .post('/api/v1/products')
      .set(bearer(adminA))
      .send(camaron({ code: '1' }));
    const b = await request(app)
      .post('/api/v1/products')
      .set(bearer(adminA))
      .send(camaron({ code: '2', barcode: '' }));
    expect([a.status, b.status]).toEqual([201, 201]);
  });

  it('editar precio registra historial; cambiar unidad con movimientos → 409', async () => {
    const { adminA } = await seedTwoBusinesses();
    const created = await request(app)
      .post('/api/v1/products')
      .set(bearer(adminA))
      .send(camaron({ initialStock: 1000 }));
    const id = created.body.data.id as string;

    const priced = await request(app)
      .patch(`/api/v1/products/${id}`)
      .set(bearer(adminA))
      .send({ salePriceCents: 41900 });
    expect(priced.status).toBe(200);

    const renamed = await request(app)
      .patch(`/api/v1/products/${id}`)
      .set(bearer(adminA))
      .send({ name: 'Camarón jumbo' });
    expect(renamed.status).toBe(200);

    const history = await request(app)
      .get(`/api/v1/products/${id}/price-history`)
      .set(bearer(adminA));
    expect(history.body.data.map((h: { source: string }) => h.source)).toEqual([
      'manual',
      'create',
    ]);
    expect(history.body.data[0]).toMatchObject({
      salePriceCents: 41900,
      previousSalePriceCents: 38900,
    });

    const unit = await request(app)
      .patch(`/api/v1/products/${id}`)
      .set(bearer(adminA))
      .send({ unit: 'pz' });
    expect(unit.status).toBe(409);
    expect(unit.body.error.details.fieldErrors).toHaveProperty('unit');
  });

  it('quitar el código de barras con ""', async () => {
    const { adminA } = await seedTwoBusinesses();
    const created = await request(app)
      .post('/api/v1/products')
      .set(bearer(adminA))
      .send(camaron({ barcode: '750200' }));
    const res = await request(app)
      .patch(`/api/v1/products/${created.body.data.id}`)
      .set(bearer(adminA))
      .send({ barcode: '' });
    expect(res.body.data).not.toHaveProperty('barcode');
  });

  it('búsqueda por nombre sin acentos, código, código de barras; filtros de stock', async () => {
    const { adminA } = await seedTwoBusinesses();
    const auth = bearer(adminA);
    await request(app)
      .post('/api/v1/products')
      .set(auth)
      .send(camaron({ initialStock: 2000 })); // bajo (min 5 kg)
    await request(app)
      .post('/api/v1/products')
      .set(auth)
      .send(
        camaron({
          code: '402',
          name: 'Cerveza clara',
          unit: 'pz',
          barcode: '7501',
          minStock: 10,
          initialStock: 50,
        }),
      );
    await request(app)
      .post('/api/v1/products')
      .set(auth)
      .send(camaron({ code: '105', name: 'Jaiba suave', minStock: 0 }));

    const names = async (query: string) =>
      (await request(app).get(`/api/v1/products?${query}`).set(auth)).body.data.map(
        (p: { code: string }) => p.code,
      );

    expect(await names('search=CAMARON')).toEqual(['101']);
    expect(await names('search=40')).toEqual(['402']);
    expect(await names('search=7501')).toEqual(['402']);
    expect(await names('stock=low')).toEqual(['101']);
    expect(await names('stock=out')).toEqual(['105']);
    // stock en unidad base: 2000 g > 50 pz > 0 g
    expect(await names('sort=stock&order=desc')).toEqual(['101', '402', '105']);
  });

  it('lookup exacto por código o código de barras y siguiente código sugerido', async () => {
    const { adminA } = await seedTwoBusinesses();
    const auth = bearer(adminA);
    await request(app)
      .post('/api/v1/products')
      .set(auth)
      .send(camaron({ code: '120' }));
    await request(app)
      .post('/api/v1/products')
      .set(auth)
      .send(camaron({ code: 'CAM-X', name: 'Otro', barcode: '7509' }));

    expect(
      (await request(app).get('/api/v1/products/lookup?code=7509').set(auth)).body.data.code,
    ).toBe('CAM-X');
    expect(
      (await request(app).get('/api/v1/products/lookup?code=cam-x').set(auth)).body.data.code,
    ).toBe('CAM-X');
    expect((await request(app).get('/api/v1/products/lookup?code=000').set(auth)).status).toBe(404);
    expect((await request(app).get('/api/v1/products/next-code').set(auth)).body.data.code).toBe(
      '121',
    );
  });

  it('aislamiento entre negocios y permisos', async () => {
    const { adminA, adminB, employeeA } = await seedTwoBusinesses();
    const created = await request(app).post('/api/v1/products').set(bearer(adminA)).send(camaron());
    const id = created.body.data.id as string;

    expect((await request(app).get(`/api/v1/products/${id}`).set(bearer(adminB))).status).toBe(404);
    expect((await request(app).get('/api/v1/products').set(bearer(employeeA))).status).toBe(403);
  });

  it('categoría de otro negocio → 400 en el campo', async () => {
    const { adminA, adminB } = await seedTwoBusinesses();
    const category = await request(app)
      .post('/api/v1/categories')
      .set(bearer(adminB))
      .send({ name: 'Bebidas' });
    const res = await request(app)
      .post('/api/v1/products')
      .set(bearer(adminA))
      .send(camaron({ categoryId: category.body.data.id }));
    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors).toHaveProperty('categoryId');
  });
});
