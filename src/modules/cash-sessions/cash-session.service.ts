import { type QueryFilter, Types } from 'mongoose';
import { AppError, conflict, notFound } from '../../common/http/errors.js';
import { dayRange } from '../../common/utils/dates.js';
import { pageMeta, skipFor } from '../../common/utils/pagination.js';
import { withTransaction } from '../../db/transaction.js';
import type { AuthUser } from '../../types/express.js';
import { Business } from '../businesses/business.model.js';
import { nextSequence } from '../counters/counter.model.js';
import { Sale } from '../sales/sale.model.js';
import {
  CashSession,
  type CashSessionData,
  type CashSessionDocument,
  PAYMENT_METHODS,
  type PaymentMethod,
} from './cash-session.model.js';
import type {
  CashMovementInput,
  CloseCashSessionInput,
  ListCashSessionsQuery,
  OpenCashSessionInput,
} from './cash-session.schemas.js';

export interface SessionSummary {
  salesCount: number;
  salesTotalCents: number;
  cancelledCount: number;
  byMethod: Record<PaymentMethod, number>;
  cashInCents: number;
  cashOutCents: number;
  /** Fondo + ventas en efectivo + entradas − salidas. */
  expectedCashCents: number;
}

const isManager = (actor: AuthUser) => actor.role === 'admin' || actor.role === 'superadmin';

/** Totales del turno calculados a partir de sus ventas y movimientos de efectivo. */
export async function summarize(session: CashSessionDocument): Promise<SessionSummary> {
  const [rows, cancelledCount] = await Promise.all([
    Sale.aggregate<{ _id: PaymentMethod; amount: number }>([
      { $match: { cashSessionId: session._id, status: 'completed' } },
      { $unwind: '$payments' },
      { $group: { _id: '$payments.method', amount: { $sum: '$payments.amountCents' } } },
    ]),
    Sale.countDocuments({ cashSessionId: session._id, status: 'cancelled' }),
  ]);
  const totals = await Sale.aggregate<{ count: number; total: number }>([
    { $match: { cashSessionId: session._id, status: 'completed' } },
    { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$totalCents' } } },
  ]);

  const byMethod = Object.fromEntries(PAYMENT_METHODS.map((m) => [m, 0])) as Record<
    PaymentMethod,
    number
  >;
  for (const row of rows) byMethod[row._id] = row.amount;

  const cashInCents = session.movements
    .filter((m) => m.type === 'in')
    .reduce((sum, m) => sum + m.amountCents, 0);
  const cashOutCents = session.movements
    .filter((m) => m.type === 'out')
    .reduce((sum, m) => sum + m.amountCents, 0);

  return {
    salesCount: totals[0]?.count ?? 0,
    salesTotalCents: totals[0]?.total ?? 0,
    cancelledCount,
    byMethod,
    cashInCents,
    cashOutCents,
    expectedCashCents: session.openingFloatCents + byMethod.cash + cashInCents - cashOutCents,
  };
}

export async function withSummary(session: CashSessionDocument) {
  return { ...session.toJSON(), summary: await summarize(session) };
}

export function findOpenSession(businessId: string, userId: string) {
  return CashSession.findOne({ businessId, userId, status: 'open' });
}

async function requireOpenSession(businessId: string, actor: AuthUser) {
  const session = await findOpenSession(businessId, actor.id);
  if (!session) {
    throw new AppError(409, 'CASH_SESSION_REQUIRED', 'No tienes la caja abierta');
  }
  return session;
}

export async function getCurrent(businessId: string, actor: AuthUser) {
  const session = await findOpenSession(businessId, actor.id);
  return session ? withSummary(session) : null;
}

export async function openSession(
  businessId: string,
  actor: AuthUser,
  input: OpenCashSessionInput,
) {
  if (await findOpenSession(businessId, actor.id)) {
    throw conflict('Ya tienes la caja abierta');
  }
  const session = await withTransaction(async (dbSession) => {
    const folio = await nextSequence(businessId, 'cash-session', dbSession);
    const [created] = await CashSession.create(
      [
        {
          businessId,
          folio,
          userId: actor.id,
          userName: actor.name,
          openedAt: new Date(),
          openingFloatCents: input.openingFloatCents,
          notes: input.notes ?? '',
        },
      ],
      { session: dbSession },
    );
    return created;
  });
  if (!session) throw new Error('No se pudo abrir la caja');
  return withSummary(session);
}

export async function addMovement(businessId: string, actor: AuthUser, input: CashMovementInput) {
  const session = await requireOpenSession(businessId, actor);
  if (input.type === 'out') {
    const { expectedCashCents } = await summarize(session);
    if (input.amountCents > expectedCashCents) {
      throw new AppError(
        409,
        'INSUFFICIENT_CASH',
        'No hay suficiente efectivo en caja para ese retiro',
        {
          fieldErrors: { amountCents: ['Mayor que el efectivo en caja'] },
        },
      );
    }
  }
  session.movements.push({ ...input, userName: actor.name, at: new Date() });
  await session.save();
  return withSummary(session);
}

/** Corte de caja: congela los totales y la diferencia contra lo contado. */
export async function closeSession(
  businessId: string,
  actor: AuthUser,
  input: CloseCashSessionInput,
) {
  const session = await requireOpenSession(businessId, actor);
  const summary = await summarize(session);

  session.set({
    status: 'closed',
    closedAt: new Date(),
    closedByName: actor.name,
    countedCashCents: input.countedCashCents,
    expectedCashCents: summary.expectedCashCents,
    differenceCents: input.countedCashCents - summary.expectedCashCents,
    salesCount: summary.salesCount,
    salesTotalCents: summary.salesTotalCents,
    cancelledCount: summary.cancelledCount,
    byMethod: summary.byMethod,
    ...(input.notes && { notes: input.notes }),
  });
  await session.save();
  return { ...session.toJSON(), summary };
}

export async function listSessions(
  businessId: string,
  actor: AuthUser,
  query: ListCashSessionsQuery,
) {
  const business = await Business.findById(businessId);
  const filter: QueryFilter<CashSessionData> = { businessId };
  // El empleado solo ve sus propios turnos.
  if (!isManager(actor)) filter.userId = actor.id;
  else if (query.userId) filter.userId = query.userId;
  if (query.status) filter.status = query.status;
  const range = dayRange(business?.timezone ?? 'America/Mexico_City', query.from, query.to);
  if (range) filter.openedAt = range;

  const [items, total] = await Promise.all([
    CashSession.find(filter).sort({ openedAt: -1 }).skip(skipFor(query)).limit(query.limit),
    CashSession.countDocuments(filter),
  ]);
  return { items, meta: pageMeta(total, query) };
}

export async function getSession(businessId: string, actor: AuthUser, id: string) {
  const session = await CashSession.findOne({
    _id: id,
    businessId,
    ...(!isManager(actor) && { userId: new Types.ObjectId(actor.id) }),
  });
  if (!session) throw notFound('Turno no encontrado');
  return withSummary(session);
}
