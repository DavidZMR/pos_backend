import { Router } from 'express';
import { sendCreated, sendOk } from '../../common/http/response.js';
import { authenticate, authorize, requireUser } from '../auth/auth.middleware.js';
import { requireBusinessId, resolveTenant } from '../auth/tenant.middleware.js';
import { createAdjustmentSchema, listMovementsQuerySchema } from './inventory.schemas.js';
import * as service from './inventory.service.js';

export const inventoryRouter = Router();

inventoryRouter.use(authenticate, authorize('admin', 'superadmin'), resolveTenant());

inventoryRouter.get('/summary', async (req, res) => {
  sendOk(res, await service.getSummary(requireBusinessId(req)));
});

inventoryRouter.get('/movements', async (req, res) => {
  const query = listMovementsQuerySchema.parse(req.query);
  const { items, meta } = await service.listMovements(requireBusinessId(req), query);
  sendOk(res, items, { meta: { ...meta } });
});

inventoryRouter.post('/adjustments', async (req, res) => {
  const result = await service.createAdjustment(
    requireBusinessId(req),
    requireUser(req),
    createAdjustmentSchema.parse(req.body),
  );
  sendCreated(res, result, 'Existencia ajustada');
});
