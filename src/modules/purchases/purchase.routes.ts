import { Router } from 'express';
import { sendCreated, sendOk } from '../../common/http/response.js';
import { idParamsSchema } from '../../common/validation.js';
import { authenticate, authorize, requireUser } from '../auth/auth.middleware.js';
import { requireBusinessId, resolveTenant } from '../auth/tenant.middleware.js';
import { formatFolio } from '../counters/counter.model.js';
import {
  cancelPurchaseSchema,
  createPurchaseSchema,
  listPurchasesQuerySchema,
} from './purchase.schemas.js';
import * as service from './purchase.service.js';

export const purchaseRouter = Router();

purchaseRouter.use(authenticate, authorize('admin', 'superadmin'), resolveTenant());

purchaseRouter.get('/', async (req, res) => {
  const query = listPurchasesQuerySchema.parse(req.query);
  const { items, meta } = await service.listPurchases(requireBusinessId(req), query);
  sendOk(res, items, { meta: { ...meta } });
});

purchaseRouter.post('/', async (req, res) => {
  const purchase = await service.createPurchase(
    requireBusinessId(req),
    requireUser(req),
    createPurchaseSchema.parse(req.body),
  );
  sendCreated(res, purchase, `Entrada ${formatFolio('purchase', purchase?.folio ?? 0)} registrada`);
});

purchaseRouter.get('/:id', async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  sendOk(res, await service.getPurchase(requireBusinessId(req), id));
});

purchaseRouter.post('/:id/cancel', async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  const { reason } = cancelPurchaseSchema.parse(req.body);
  const purchase = await service.cancelPurchase(
    requireBusinessId(req),
    requireUser(req),
    id,
    reason,
  );
  sendOk(res, purchase, { message: 'Entrada cancelada' });
});
