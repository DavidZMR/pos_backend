import { Router } from 'express';
import { sendCreated, sendOk } from '../../common/http/response.js';
import { idParamsSchema } from '../../common/validation.js';
import { authenticate, authorize } from '../auth/auth.middleware.js';
import { requireBusinessId, resolveTenant } from '../auth/tenant.middleware.js';
import {
  createCategorySchema,
  listCategoriesQuerySchema,
  updateCategorySchema,
} from './category.schemas.js';
import * as service from './category.service.js';

export const categoryRouter = Router();

categoryRouter.use(authenticate, authorize('admin', 'superadmin'), resolveTenant());

categoryRouter.get('/', async (req, res) => {
  const query = listCategoriesQuerySchema.parse(req.query);
  const { items, meta } = await service.listCategories(requireBusinessId(req), query);
  sendOk(res, items, { meta: { ...meta } });
});

categoryRouter.post('/', async (req, res) => {
  const category = await service.createCategory(
    requireBusinessId(req),
    createCategorySchema.parse(req.body),
  );
  sendCreated(res, category, 'Categoría creada');
});

categoryRouter.get('/:id', async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  sendOk(res, await service.getCategory(requireBusinessId(req), id));
});

categoryRouter.patch('/:id', async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  const category = await service.updateCategory(
    requireBusinessId(req),
    id,
    updateCategorySchema.parse(req.body),
  );
  sendOk(res, category, { message: 'Categoría actualizada' });
});

categoryRouter.delete('/:id', async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  const category = await service.updateCategory(requireBusinessId(req), id, { active: false });
  sendOk(res, category, { message: 'Categoría desactivada' });
});
