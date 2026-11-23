import { Router } from 'express';
import { sendOk } from '../../common/http/response.js';
import { authenticate, authorize } from '../auth/auth.middleware.js';
import { resolveTenant } from '../auth/tenant.middleware.js';
import {
  businessesReportQuerySchema,
  purchasesReportQuerySchema,
  reportQuerySchema,
  topProductsQuerySchema,
} from './reports.schemas.js';
import * as service from './reports.service.js';

/**
 * Reportes: admin (su negocio) y superadmin (el negocio de `x-business-id`, o TODOS si no
 * envía el encabezado). El empleado no ve reportes.
 */
export const reportRouter = Router();

reportRouter.use(
  authenticate,
  authorize('admin', 'superadmin'),
  resolveTenant({ required: false }),
);

reportRouter.get('/summary', async (req, res) => {
  const query = reportQuerySchema.parse(req.query);
  sendOk(res, await service.summary(await service.resolveScope(req.businessId), query));
});

reportRouter.get('/sales-series', async (req, res) => {
  const query = reportQuerySchema.parse(req.query);
  sendOk(res, await service.salesSeries(await service.resolveScope(req.businessId), query));
});

reportRouter.get('/top-products', async (req, res) => {
  const query = topProductsQuerySchema.parse(req.query);
  sendOk(res, await service.topProducts(await service.resolveScope(req.businessId), query));
});

reportRouter.get('/categories', async (req, res) => {
  const query = reportQuerySchema.parse(req.query);
  sendOk(res, await service.byCategory(await service.resolveScope(req.businessId), query));
});

reportRouter.get('/payments', async (req, res) => {
  const query = reportQuerySchema.parse(req.query);
  sendOk(res, await service.payments(await service.resolveScope(req.businessId), query));
});

reportRouter.get('/purchases', async (req, res) => {
  const query = purchasesReportQuerySchema.parse(req.query);
  sendOk(res, await service.purchasesReport(await service.resolveScope(req.businessId), query));
});

/** Comparativa entre negocios: solo superadmin (ignora `x-business-id`). */
reportRouter.get('/businesses', authorize('superadmin'), async (req, res) => {
  const query = businessesReportQuerySchema.parse(req.query);
  sendOk(res, await service.businessesReport(query));
});
