import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { useTestDatabase } from '../../test/db.js';
import {
  bearer,
  createBusiness,
  createUser,
  TEST_PASSWORD,
  testApp,
  tokenFor,
} from '../../test/factories.js';
import { User } from '../users/user.model.js';

useTestDatabase();
const app = testApp();

const login = (username: string, password = TEST_PASSWORD) =>
  request(app).post('/api/v1/auth/login').send({ username, password });

describe('POST /api/v1/auth/login', () => {
  it('devuelve token, usuario (sin hash) y negocio', async () => {
    const business = await createBusiness();
    const user = await createUser({ role: 'admin', businessId: business._id, username: 'ana' });

    const res = await login('ANA');

    expect(res.status).toBe(200);
    expect(res.body.data.token).toEqual(expect.any(String));
    expect(res.body.data.user).toMatchObject({ id: user.id, username: 'ana', role: 'admin' });
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
    expect(res.body.data.user).not.toHaveProperty('_id');
    expect(res.body.data.business).toMatchObject({ id: business.id, name: business.name });
    expect((await User.findById(user.id))?.lastLoginAt).toBeInstanceOf(Date);
  });

  it('superadmin inicia sesión sin negocio', async () => {
    await createUser({ role: 'superadmin', username: 'root' });
    const res = await login('root');
    expect(res.status).toBe(200);
    expect(res.body.data.business).toBeNull();
  });

  it('contraseña incorrecta o usuario inexistente → 401 con el mismo mensaje', async () => {
    await createUser({ role: 'superadmin', username: 'root' });
    const wrong = await login('root', 'otra-clave');
    const missing = await login('nadie');

    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(missing.body.error.message).toBe(wrong.body.error.message);
  });

  it('usuario desactivado → 403', async () => {
    await createUser({ role: 'superadmin', username: 'old', active: false });
    const res = await login('old');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('USER_INACTIVE');
  });

  it('negocio desactivado → 403', async () => {
    const business = await createBusiness({ active: false });
    await createUser({ role: 'employee', businessId: business._id, username: 'caja1' });
    const res = await login('caja1');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('BUSINESS_INACTIVE');
  });

  it('valida el cuerpo → 400', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ username: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/v1/auth/me', () => {
  it('devuelve el perfil con token válido', async () => {
    const user = await createUser({ role: 'superadmin' });
    const res = await request(app).get('/api/v1/auth/me').set(bearer(user));
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(user.id);
  });

  it('sin token o con token inválido → 401', async () => {
    const none = await request(app).get('/api/v1/auth/me');
    const bad = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer xxx.yyy.zzz');
    expect(none.status).toBe(401);
    expect(bad.status).toBe(401);
  });

  it('un token deja de servir si el usuario se desactiva', async () => {
    const user = await createUser({ role: 'superadmin' });
    const token = tokenFor(user);
    await User.updateOne({ _id: user._id }, { active: false });

    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/auth/change-password', () => {
  it('cambia la contraseña con la actual correcta', async () => {
    const user = await createUser({ role: 'superadmin', username: 'root' });
    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set(bearer(user))
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'NuevaClave2026' });

    expect(res.status).toBe(200);
    expect((await login('root', 'NuevaClave2026')).status).toBe(200);
    expect((await login('root')).status).toBe(401);
  });

  it('rechaza contraseña actual incorrecta (400) o nueva muy corta (400)', async () => {
    const user = await createUser({ role: 'superadmin' });
    const wrong = await request(app)
      .post('/api/v1/auth/change-password')
      .set(bearer(user))
      .send({ currentPassword: 'no-es', newPassword: 'NuevaClave2026' });
    const short = await request(app)
      .post('/api/v1/auth/change-password')
      .set(bearer(user))
      .send({ currentPassword: TEST_PASSWORD, newPassword: '123' });

    expect(wrong.status).toBe(400);
    expect(short.status).toBe(400);
  });
});
