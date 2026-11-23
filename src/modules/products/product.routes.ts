import { Router } from 'express';
import { sendCreated, sendOk } from '../../common/http/response.js';
import { paginationQuerySchema } from '../../common/utils/pagination.js';
import { idParamsSchema } from '../../common/validation.js';
import { authenticate, authorize, requireUser } from '../auth/auth.middleware.js';
import { requireBusinessId, resolveTenant } from '../auth/tenant.middleware.js';
import {
  createProductSchema,
  listProductsQuerySchema,
  lookupQuerySchema,
  updateProductSchema,
} from './product.schemas.js';
import * as service from './product.service.js';

export const productRouter = Router();

productRouter.use(authenticate, authorize('admin', 'superadmin'), resolveTenant());

productRouter.get('/', async (req, res) => {
  const query = listProductsQuerySchema.parse(req.query);
  const { items, meta } = await service.listProducts(requireBusinessId(req), query);
  sendOk(res, items, { meta: { ...meta } });
});

productRouter.get('/next-code', async (req, res) => {
  sendOk(res, { code: await service.suggestNextCode(requireBusinessId(req)) });
});

productRouter.get('/lookup', async (req, res) => {
  const { code } = lookupQuerySchema.parse(req.query);
  sendOk(res, await service.lookupProduct(requireBusinessId(req), code));
});

productRouter.post('/', async (req, res) => {
  const product = await service.createProduct(
    requireBusinessId(req),
    requireUser(req),
    createProductSchema.parse(req.body),
  );
  sendCreated(res, product, 'Producto creado');
});

productRouter.get('/:id', async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  sendOk(res, await service.getProduct(requireBusinessId(req), id));
});

productRouter.patch('/:id', async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  const product = await service.updateProduct(
    requireBusinessId(req),
    requireUser(req),
    id,
    updateProductSchema.parse(req.body),
  );
  sendOk(res, product, { message: 'Producto actualizado' });
});

productRouter.delete('/:id', async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  const product = await service.updateProduct(requireBusinessId(req), requireUser(req), id, {
    active: false,
  });
  sendOk(res, product, { message: 'Producto desactivado' });
});

productRouter.get('/:id/price-history', async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  const query = paginationQuerySchema.parse(req.query);
  const { items, meta } = await service.listPriceHistory(requireBusinessId(req), id, query);
  sendOk(res, items, { meta: { ...meta } });
});
