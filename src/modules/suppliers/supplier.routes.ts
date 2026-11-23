import { Router } from 'express';
import { sendCreated, sendOk } from '../../common/http/response.js';
import { idParamsSchema } from '../../common/validation.js';
import { authenticate, authorize } from '../auth/auth.middleware.js';
import { requireBusinessId, resolveTenant } from '../auth/tenant.middleware.js';
import {
  createSupplierSchema,
  listSuppliersQuerySchema,
  updateSupplierSchema,
} from './supplier.schemas.js';
import * as service from './supplier.service.js';

export const supplierRouter = Router();

supplierRouter.use(authenticate, authorize('admin', 'superadmin'), resolveTenant());

supplierRouter.get('/', async (req, res) => {
  const query = listSuppliersQuerySchema.parse(req.query);
  const { items, meta } = await service.listSuppliers(requireBusinessId(req), query);
  sendOk(res, items, { meta: { ...meta } });
});

supplierRouter.post('/', async (req, res) => {
  const supplier = await service.createSupplier(
    requireBusinessId(req),
    createSupplierSchema.parse(req.body),
  );
  sendCreated(res, supplier, 'Proveedor creado');
});

supplierRouter.get('/:id', async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  sendOk(res, await service.getSupplier(requireBusinessId(req), id));
});

supplierRouter.patch('/:id', async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  const supplier = await service.updateSupplier(
    requireBusinessId(req),
    id,
    updateSupplierSchema.parse(req.body),
  );
  sendOk(res, supplier, { message: 'Proveedor actualizado' });
});

supplierRouter.delete('/:id', async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  const supplier = await service.updateSupplier(requireBusinessId(req), id, { active: false });
  sendOk(res, supplier, { message: 'Proveedor desactivado' });
});
