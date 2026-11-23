import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { useTestDatabase } from '../../test/db.js';
import { bearer, seedTwoBusinesses, testApp } from '../../test/factories.js';
import { BUSINESS_HEADER } from '../auth/tenant.middleware.js';

useTestDatabase();
const app = testApp();

describe('categorías', () => {
  it('CRUD por negocio con nombre único sin importar mayúsculas ni acentos', async () => {
    const { adminA } = await seedTwoBusinesses();
    const auth = bearer(adminA);

    const created = await request(app)
      .post('/api/v1/categories')
      .set(auth)
      .send({ name: 'Pescados' });
    expect(created.status).toBe(201);
    const dup = await request(app).post('/api/v1/categories').set(auth).send({ name: 'PESCADOS' });
    expect(dup.status).toBe(409);

    const id = created.body.data.id as string;
    const renamed = await request(app)
      .patch(`/api/v1/categories/${id}`)
      .set(auth)
      .send({ name: 'Pescados frescos' });
    expect(renamed.body.data.name).toBe('Pescados frescos');

    const off = await request(app).delete(`/api/v1/categories/${id}`).set(auth);
    expect(off.body.data.active).toBe(false);

    const list = await request(app).get('/api/v1/categories?active=false').set(auth);
    expect(list.body.data).toHaveLength(1);
  });

  it('aislamiento: el negocio B no ve ni edita categorías de A; el mismo nombre se permite en B', async () => {
    const { adminA, adminB } = await seedTwoBusinesses();
    const created = await request(app)
      .post('/api/v1/categories')
      .set(bearer(adminA))
      .send({ name: 'Bebidas' });
    const id = created.body.data.id as string;

    expect((await request(app).get(`/api/v1/categories/${id}`).set(bearer(adminB))).status).toBe(
      404,
    );
    expect(
      (
        await request(app)
          .patch(`/api/v1/categories/${id}`)
          .set(bearer(adminB))
          .send({ name: 'X1' })
      ).status,
    ).toBe(404);
    expect(
      (await request(app).post('/api/v1/categories').set(bearer(adminB)).send({ name: 'Bebidas' }))
        .status,
    ).toBe(201);
  });

  it('empleado → 403; superadmin necesita negocio seleccionado', async () => {
    const { employeeA, superadmin, businessA } = await seedTwoBusinesses();
    expect((await request(app).get('/api/v1/categories').set(bearer(employeeA))).status).toBe(403);
    expect((await request(app).get('/api/v1/categories').set(bearer(superadmin))).status).toBe(400);
    expect(
      (
        await request(app)
          .get('/api/v1/categories')
          .set(bearer(superadmin))
          .set(BUSINESS_HEADER, businessA.id)
      ).status,
    ).toBe(200);
  });
});

describe('proveedores', () => {
  it('CRUD con validación de correo y borrado de campos opcionales', async () => {
    const { adminA } = await seedTwoBusinesses();
    const auth = bearer(adminA);

    const bad = await request(app)
      .post('/api/v1/suppliers')
      .set(auth)
      .send({ name: 'Pescadería', email: 'no-es-correo' });
    expect(bad.status).toBe(400);

    const created = await request(app)
      .post('/api/v1/suppliers')
      .set(auth)
      .send({ name: 'Pescadería del Puerto', phone: '322 111 2233', email: 'Ventas@Puerto.MX' });
    expect(created.status).toBe(201);
    expect(created.body.data.email).toBe('ventas@puerto.mx');

    const id = created.body.data.id as string;
    const cleared = await request(app)
      .patch(`/api/v1/suppliers/${id}`)
      .set(auth)
      .send({ phone: '' });
    expect(cleared.body.data.phone).toBe('');

    const search = await request(app).get('/api/v1/suppliers?search=pescaderia').set(auth);
    expect(search.body.meta.total).toBe(1);
  });
});
