import { Router } from 'express';
import { sendCreated, sendOk } from '../../common/http/response.js';
import { idParamsSchema } from '../../common/validation.js';
import { authenticate, requireUser } from '../auth/auth.middleware.js';
import { requireBusinessId, resolveTenant } from '../auth/tenant.middleware.js';
import {
  cashMovementSchema,
  closeCashSessionSchema,
  listCashSessionsQuerySchema,
  openCashSessionSchema,
} from './cash-session.schemas.js';
import * as service from './cash-session.service.js';

/** Turnos de caja: todos los roles operan su propio turno; admin/superadmin ven todos. */
export const cashSessionRouter = Router();

cashSessionRouter.use(authenticate, resolveTenant());

cashSessionRouter.get('/current', async (req, res) => {
  sendOk(res, await service.getCurrent(requireBusinessId(req), requireUser(req)));
});

cashSessionRouter.post('/open', async (req, res) => {
  const session = await service.openSession(
    requireBusinessId(req),
    requireUser(req),
    openCashSessionSchema.parse(req.body),
  );
  sendCreated(res, session, 'Caja abierta');
});

cashSessionRouter.post('/current/movements', async (req, res) => {
  const session = await service.addMovement(
    requireBusinessId(req),
    requireUser(req),
    cashMovementSchema.parse(req.body),
  );
  sendCreated(res, session, 'Movimiento de efectivo registrado');
});

cashSessionRouter.post('/current/close', async (req, res) => {
  const session = await service.closeSession(
    requireBusinessId(req),
    requireUser(req),
    closeCashSessionSchema.parse(req.body),
  );
  sendOk(res, session, { message: 'Corte de caja realizado' });
});

cashSessionRouter.get('/', async (req, res) => {
  const query = listCashSessionsQuerySchema.parse(req.query);
  const { items, meta } = await service.listSessions(
    requireBusinessId(req),
    requireUser(req),
    query,
  );
  sendOk(res, items, { meta: { ...meta } });
});

cashSessionRouter.get('/:id', async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  sendOk(res, await service.getSession(requireBusinessId(req), requireUser(req), id));
});
