import { Router } from 'express';
import { sendCreated, sendOk } from '../../common/http/response.js';
import { idParamsSchema } from '../../common/validation.js';
import { authenticate, authorize, requireUser } from '../auth/auth.middleware.js';
import { requireBusinessId, resolveTenant } from '../auth/tenant.middleware.js';
import { formatFolio } from '../counters/counter.model.js';
import { cancelSaleSchema, createSaleSchema, listSalesQuerySchema } from './sale.schemas.js';
import * as service from './sale.service.js';

/** Ventas: todos los roles venden y consultan (empleado: solo las suyas); cancelar es de admin. */
export const saleRouter = Router();

saleRouter.use(authenticate, resolveTenant());

saleRouter.post('/', async (req, res) => {
  const sale = await service.createSale(
    requireBusinessId(req),
    requireUser(req),
    createSaleSchema.parse(req.body),
  );
  sendCreated(res, sale, `Venta ${formatFolio('sale', sale?.folio ?? 0)} registrada`);
});

saleRouter.get('/', async (req, res) => {
  const query = listSalesQuerySchema.parse(req.query);
  const { items, meta } = await service.listSales(requireBusinessId(req), requireUser(req), query);
  sendOk(res, items, { meta: { ...meta } });
});

saleRouter.get('/:id', async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  sendOk(res, await service.getSale(requireBusinessId(req), requireUser(req), id));
});

saleRouter.post('/:id/cancel', authorize('admin', 'superadmin'), async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  const { reason } = cancelSaleSchema.parse(req.body);
  const sale = await service.cancelSale(requireBusinessId(req), requireUser(req), id, reason);
  sendOk(res, sale, { message: 'Venta cancelada' });
});
