import { Router } from 'express';
import { authenticate, authorize } from '../auth/auth.middleware.js';
import { resolveTenant } from '../auth/tenant.middleware.js';
import * as controller from './business.controller.js';

export const businessRouter = Router();

businessRouter.use(authenticate);

// Negocio actual (el propio; el superadmin lo elige con x-business-id).
businessRouter.get('/current', resolveTenant(), controller.getCurrent);
businessRouter.patch(
  '/current',
  authorize('admin', 'superadmin'),
  resolveTenant(),
  controller.updateCurrent,
);

// Administración de todos los negocios: solo superadmin.
businessRouter.get('/', authorize('superadmin'), controller.list);
businessRouter.post('/', authorize('superadmin'), controller.create);
businessRouter.get('/:id', authorize('superadmin'), controller.getById);
businessRouter.patch('/:id', authorize('superadmin'), controller.update);
businessRouter.delete('/:id', authorize('superadmin'), controller.deactivate);
