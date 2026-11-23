import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { useTestDatabase } from '../../test/db.js';
import { bearer, createBusiness, seedTwoBusinesses, testApp } from '../../test/factories.js';
import { User } from './user.model.js';

useTestDatabase();
const app = testApp();

const newUser = (overrides: Record<string, unknown> = {}) => ({
  name: 'Juan Pérez',
  username: 'juan',
  password: 'Password123',
  ...overrides,
});

describe('superadmin', () => {
  it('crea un admin para un negocio y un superadmin sin negocio', async () => {
    const { superadmin, businessA } = await seedTwoBusinesses();

    const admin = await request(app)
      .post('/api/v1/users')
      .set(bearer(superadmin))
      .send(newUser({ role: 'admin', businessId: businessA.id }));
    expect(admin.status).toBe(201);
    expect(admin.body.data).toMatchObject({ role: 'admin', businessId: businessA.id });
    expect(admin.body.data).not.toHaveProperty('passwordHash');

    const root = await request(app)
      .post('/api/v1/users')
      .set(bearer(superadmin))
      .send(newUser({ username: 'root2', role: 'superadmin', businessId: businessA.id }));
    expect(root.status).toBe(201);
    expect(root.body.data.businessId).toBeNull();
  });

  it('exige negocio para admin/empleado (400) y que esté activo', async () => {
    const { superadmin } = await seedTwoBusinesses();
    const inactive = await createBusiness({ active: false });

    const missing = await request(app)
      .post('/api/v1/users')
      .set(bearer(superadmin))
      .send(newUser({ role: 'employee' }));
    const off = await request(app)
      .post('/api/v1/users')
      .set(bearer(superadmin))
      .send(newUser({ role: 'employee', businessId: inactive.id }));

    expect(missing.status).toBe(400);
    expect(off.status).toBe(400);
  });

  it('lista todos los usuarios y filtra por negocio', async () => {
    const { superadmin, businessB } = await seedTwoBusinesses();
    const all = await request(app).get('/api/v1/users').set(bearer(superadmin));
    const onlyB = await request(app)
      .get(`/api/v1/users?businessId=${businessB.id}`)
      .set(bearer(superadmin));

    expect(all.body.meta.total).toBe(5);
    expect(onlyB.body.meta.total).toBe(2);
  });

  it('no puede desactivarse ni cambiarse el rol a sí mismo', async () => {
    const { superadmin } = await seedTwoBusinesses();
    const off = await request(app).delete(`/api/v1/users/${superadmin.id}`).set(bearer(superadmin));
    const role = await request(app)
      .patch(`/api/v1/users/${superadmin.id}`)
      .set(bearer(superadmin))
      .send({ role: 'admin' });
    expect(off.status).toBe(400);
    expect(role.status).toBe(400);
  });
});

describe('admin', () => {
  it('crea empleados siempre en su negocio aunque mande otro businessId', async () => {
    const { adminA, businessA, businessB } = await seedTwoBusinesses();
    const res = await request(app)
      .post('/api/v1/users')
      .set(bearer(adminA))
      .send(newUser({ role: 'employee', businessId: businessB.id }));

    expect(res.status).toBe(201);
    expect(res.body.data.businessId).toBe(businessA.id);
  });

  it('no puede crear admins ni superadmins → 403', async () => {
    const { adminA } = await seedTwoBusinesses();
    for (const role of ['admin', 'superadmin']) {
      const res = await request(app)
        .post('/api/v1/users')
        .set(bearer(adminA))
        .send(newUser({ username: `x${role}`, role }));
      expect(res.status).toBe(403);
    }
  });

  it('solo ve usuarios de su negocio; los de otro negocio dan 404', async () => {
    const { adminA, employeeB, businessA } = await seedTwoBusinesses();
    const list = await request(app).get('/api/v1/users').set(bearer(adminA));
    const other = await request(app).get(`/api/v1/users/${employeeB.id}`).set(bearer(adminA));
    const otherPatch = await request(app)
      .patch(`/api/v1/users/${employeeB.id}`)
      .set(bearer(adminA))
      .send({ name: 'Hackeado' });

    expect(list.body.meta.total).toBe(2);
    expect(list.body.data.every((u: { businessId: string }) => u.businessId === businessA.id)).toBe(
      true,
    );
    expect(other.status).toBe(404);
    expect(otherPatch.status).toBe(404);
    expect((await User.findById(employeeB.id))?.name).not.toBe('Hackeado');
  });

  it('edita y desactiva empleados de su negocio, pero no a otros admins', async () => {
    const { adminA, employeeA, businessA } = await seedTwoBusinesses();
    const otherAdmin = await User.create({
      name: 'Otro admin',
      username: 'otroadmin',
      passwordHash: 'x',
      role: 'admin',
      businessId: businessA._id,
    });

    const edit = await request(app)
      .patch(`/api/v1/users/${employeeA.id}`)
      .set(bearer(adminA))
      .send({ name: 'Cajero Uno', password: 'OtraClave123' });
    const promote = await request(app)
      .patch(`/api/v1/users/${employeeA.id}`)
      .set(bearer(adminA))
      .send({ role: 'admin' });
    const off = await request(app).delete(`/api/v1/users/${employeeA.id}`).set(bearer(adminA));
    const touchAdmin = await request(app)
      .patch(`/api/v1/users/${otherAdmin.id}`)
      .set(bearer(adminA))
      .send({ name: 'Nombre cambiado' });

    expect(edit.status).toBe(200);
    expect(edit.body.data.name).toBe('Cajero Uno');
    expect(promote.status).toBe(403);
    expect(off.status).toBe(200);
    expect(off.body.data.active).toBe(false);
    expect(touchAdmin.status).toBe(403);
  });
});

describe('empleado y validaciones', () => {
  it('empleado no accede a usuarios → 403', async () => {
    const { employeeA } = await seedTwoBusinesses();
    expect((await request(app).get('/api/v1/users').set(bearer(employeeA))).status).toBe(403);
  });

  it('usuario duplicado → 409 y formato inválido → 400', async () => {
    const { adminA } = await seedTwoBusinesses();
    const first = await request(app).post('/api/v1/users').set(bearer(adminA)).send(newUser());
    const dup = await request(app)
      .post('/api/v1/users')
      .set(bearer(adminA))
      .send(newUser({ username: 'JUAN' }));
    const bad = await request(app)
      .post('/api/v1/users')
      .set(bearer(adminA))
      .send(newUser({ username: 'con espacio', password: '123' }));

    expect(first.status).toBe(201);
    expect(dup.status).toBe(409);
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.details.fieldErrors)).toEqual(
      expect.arrayContaining(['username', 'password']),
    );
  });
});
