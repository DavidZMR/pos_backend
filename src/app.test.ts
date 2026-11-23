import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const app = createApp({ corsOrigins: ['http://localhost:4200'], requestLogging: false });

describe('app', () => {
  it('GET /api/health responde 200 aunque la BD no esté conectada', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, data: { status: 'ok', db: 'disconnected' } });
  });

  it('rutas desconocidas responden 404 con el sobre de error', async () => {
    const res = await request(app).get('/api/v1/no-existe');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('JSON inválido responde 400 INVALID_JSON', async () => {
    const res = await request(app)
      .post('/api/v1/cualquiera')
      .set('Content-Type', 'application/json')
      .send('{"mal json"');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('permite el origen "null" de Electron y los orígenes configurados', async () => {
    const electron = await request(app).get('/api/health').set('Origin', 'null');
    const dev = await request(app).get('/api/health').set('Origin', 'http://localhost:4200');
    const other = await request(app).get('/api/health').set('Origin', 'http://evil.example');

    expect(electron.headers['access-control-allow-origin']).toBe('null');
    expect(dev.headers['access-control-allow-origin']).toBe('http://localhost:4200');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });
});
