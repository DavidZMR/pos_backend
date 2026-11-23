import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { useTestDatabase } from '../../test/db.js';
import { bearer, seedTwoBusinesses, testApp } from '../../test/factories.js';

useTestDatabase();
const app = testApp();

async function setup() {
  const seed = await seedTwoBusinesses();
  const admin = bearer(seed.adminA);
  const caja = bearer(seed.employeeA);
  const product = (
    await request(app)
      .post('/api/v1/products')
      .set(admin)
      .send({
        code: '1',
        name: 'Coctel',
        unit: 'pz',
        salePriceCents: 18500,
        taxRateBp: 1600,
        initialStock: 50,
      })
  ).body.data as { id: string };
  return { ...seed, admin, caja, product };
}

const sell = (auth: ReturnType<typeof bearer>, productId: string, method: string, qty = 1) =>
  request(app)
    .post('/api/v1/sales')
    .set(auth)
    .send({
      items: [{ productId, qtyBase: qty }],
      payments: [{ method, amountCents: 18500 * qty }],
      expectedTotalCents: 18500 * qty,
    });

describe('turnos de caja', () => {
  it('abrir: uno solo por cajero, con folio', async () => {
    const { caja } = await setup();
    const opened = await request(app)
      .post('/api/v1/cash-sessions/open')
      .set(caja)
      .send({ openingFloatCents: 50000 });
    expect(opened.status).toBe(201);
    expect(opened.body.data).toMatchObject({ folio: 1, status: 'open', openingFloatCents: 50000 });
    expect(opened.body.data.summary.expectedCashCents).toBe(50000);

    const twice = await request(app)
      .post('/api/v1/cash-sessions/open')
      .set(caja)
      .send({ openingFloatCents: 0 });
    expect(twice.status).toBe(409);

    const current = await request(app).get('/api/v1/cash-sessions/current').set(caja);
    expect(current.body.data.id).toBe(opened.body.data.id);
  });

  it('sin turno abierto, current = null y no hay movimientos ni corte', async () => {
    const { caja } = await setup();
    expect(
      (await request(app).get('/api/v1/cash-sessions/current').set(caja)).body.data,
    ).toBeNull();
    const close = await request(app)
      .post('/api/v1/cash-sessions/current/close')
      .set(caja)
      .send({ countedCashCents: 0 });
    expect(close.status).toBe(409);
  });

  it('corte: efectivo esperado = fondo + ventas en efectivo + entradas − salidas', async () => {
    const { caja, admin, product } = await setup();
    await request(app)
      .post('/api/v1/cash-sessions/open')
      .set(caja)
      .send({ openingFloatCents: 50000 });

    await sell(caja, product.id, 'cash', 2); // $370
    await sell(caja, product.id, 'card'); // $185 (no entra a efectivo)
    const cancelled = await sell(caja, product.id, 'cash'); // se cancelará
    await request(app)
      .post(`/api/v1/sales/${cancelled.body.data.id}/cancel`)
      .set(admin)
      .send({ reason: 'Error de captura' });

    await request(app)
      .post('/api/v1/cash-sessions/current/movements')
      .set(caja)
      .send({ type: 'out', amountCents: 20000, reason: 'Pago de hielo' });
    await request(app)
      .post('/api/v1/cash-sessions/current/movements')
      .set(caja)
      .send({ type: 'in', amountCents: 5000, reason: 'Cambio adicional' });

    const tooMuch = await request(app)
      .post('/api/v1/cash-sessions/current/movements')
      .set(caja)
      .send({ type: 'out', amountCents: 999_999, reason: 'Retiro grande' });
    expect(tooMuch.status).toBe(409);

    // 500 + 370 + 50 − 200 = $720.00 esperados; se cuentan $715.00 → faltan $5.00
    const closed = await request(app)
      .post('/api/v1/cash-sessions/current/close')
      .set(caja)
      .send({ countedCashCents: 71500 });
    expect(closed.status).toBe(200);
    expect(closed.body.data).toMatchObject({
      status: 'closed',
      expectedCashCents: 72000,
      countedCashCents: 71500,
      differenceCents: -500,
      salesCount: 2,
      salesTotalCents: 55500,
      cancelledCount: 1,
      byMethod: { cash: 37000, card: 18500, transfer: 0, other: 0 },
    });

    // Ya no puede vender sin abrir otro turno
    expect((await sell(caja, product.id, 'cash')).status).toBe(409);
  });

  it('el empleado solo ve sus turnos; el admin ve todos', async () => {
    const { caja, admin } = await setup();
    await request(app).post('/api/v1/cash-sessions/open').set(caja).send({ openingFloatCents: 0 });
    const adminSession = await request(app)
      .post('/api/v1/cash-sessions/open')
      .set(admin)
      .send({ openingFloatCents: 0 });

    expect((await request(app).get('/api/v1/cash-sessions').set(caja)).body.meta.total).toBe(1);
    expect((await request(app).get('/api/v1/cash-sessions').set(admin)).body.meta.total).toBe(2);
    expect(
      (await request(app).get(`/api/v1/cash-sessions/${adminSession.body.data.id}`).set(caja))
        .status,
    ).toBe(404);
  });
});
