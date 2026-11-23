import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { useTestDatabase } from '../../test/db.js';
import { bearer, createUser, seedTwoBusinesses, testApp } from '../../test/factories.js';
import { BUSINESS_HEADER } from '../auth/tenant.middleware.js';

useTestDatabase();
const app = testApp();

describe('administración de negocios (superadmin)', () => {
  it('crea, lista con búsqueda sin acentos, edita y desactiva', async () => {
    const superadmin = await createUser({ role: 'superadmin' });
    const auth = bearer(superadmin);

    const created = await request(app)
      .post('/api/v1/businesses')
      .set(auth)
      .send({ name: 'Marisquería El Camarón', taxId: 'abc010101xyz' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      name: 'Marisquería El Camarón',
      taxId: 'ABC010101XYZ',
      timezone: 'America/Mexico_City',
      active: true,
      settings: { allowNegativeStock: true },
    });
    expect(created.body.data).not.toHaveProperty('searchName');
    const id = created.body.data.id as string;

    const list = await request(app).get('/api/v1/businesses?search=marisqueria').set(auth);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta).toMatchObject({ total: 1, page: 1 });

    const updated = await request(app)
      .patch(`/api/v1/businesses/${id}`)
      .set(auth)
      .send({ ticket: { header: '¡Gracias por su compra!' } });
    expect(updated.status).toBe(200);
    expect(updated.body.data.ticket).toEqual({ header: '¡Gracias por su compra!', footer: '' });

    const removed = await request(app).delete(`/api/v1/businesses/${id}`).set(auth);
    expect(removed.status).toBe(200);
    expect(removed.body.data.active).toBe(false);
  });

  it('permite borrar un campo opcional enviando texto vacío', async () => {
    const auth = bearer(await createUser({ role: 'superadmin' }));
    const created = await request(app)
      .post('/api/v1/businesses')
      .set(auth)
      .send({ name: 'Con teléfono', phone: '322 000 0000' });
    const cleared = await request(app)
      .patch(`/api/v1/businesses/${created.body.data.id}`)
      .set(auth)
      .send({ phone: '' });

    expect(cleared.status).toBe(200);
    expect(cleared.body.data.phone).toBe('');
  });

  it('valida datos (400) y zona horaria', async () => {
    const auth = bearer(await createUser({ role: 'superadmin' }));
    const res = await request(app)
      .post('/api/v1/businesses')
      .set(auth)
      .send({ name: 'X', timezone: 'Marte/Olympus' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors).toHaveProperty('name');
    expect(res.body.error.details.fieldErrors).toHaveProperty('timezone');
  });

  it('id inválido → 400; inexistente → 404', async () => {
    const auth = bearer(await createUser({ role: 'superadmin' }));
    expect((await request(app).get('/api/v1/businesses/123').set(auth)).status).toBe(400);
    expect(
      (await request(app).get('/api/v1/businesses/64b7f0c2a1b2c3d4e5f60718').set(auth)).status,
    ).toBe(404);
  });

  it('admin y empleado no pueden administrar negocios → 403', async () => {
    const { adminA, employeeA } = await seedTwoBusinesses();
    for (const user of [adminA, employeeA]) {
      expect((await request(app).get('/api/v1/businesses').set(bearer(user))).status).toBe(403);
      expect(
        (await request(app).post('/api/v1/businesses').set(bearer(user)).send({ name: 'Otro' }))
          .status,
      ).toBe(403);
    }
  });
});

describe('negocio actual (/businesses/current)', () => {
  it('admin y empleado ven solo su negocio aunque manden otro x-business-id', async () => {
    const { businessA, businessB, adminA, employeeA } = await seedTwoBusinesses();
    for (const user of [adminA, employeeA]) {
      const res = await request(app)
        .get('/api/v1/businesses/current')
        .set(bearer(user))
        .set(BUSINESS_HEADER, businessB.id);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(businessA.id);
    }
  });

  it('superadmin necesita x-business-id (400) y con él ve ese negocio', async () => {
    const { superadmin, businessB } = await seedTwoBusinesses();
    const without = await request(app).get('/api/v1/businesses/current').set(bearer(superadmin));
    const withHeader = await request(app)
      .get('/api/v1/businesses/current')
      .set(bearer(superadmin))
      .set(BUSINESS_HEADER, businessB.id);

    expect(without.status).toBe(400);
    expect(withHeader.body.data.id).toBe(businessB.id);
  });

  it('admin edita datos de su negocio pero no puede desactivarlo; empleado no edita', async () => {
    const { adminA, employeeA } = await seedTwoBusinesses();
    const ok = await request(app)
      .patch('/api/v1/businesses/current')
      .set(bearer(adminA))
      .send({ phone: '322 123 4567', settings: { allowNegativeStock: false } });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({
      phone: '322 123 4567',
      settings: { allowNegativeStock: false },
    });

    const deactivate = await request(app)
      .patch('/api/v1/businesses/current')
      .set(bearer(adminA))
      .send({ active: false });
    expect(deactivate.status).toBe(400);

    const employee = await request(app)
      .patch('/api/v1/businesses/current')
      .set(bearer(employeeA))
      .send({ phone: '1' });
    expect(employee.status).toBe(403);
  });
});
