import { Router } from 'express';
import { authenticate, authorize } from '../auth/auth.middleware.js';
import * as controller from './user.controller.js';

export const userRouter = Router();

// Empleados no administran usuarios. Las reglas finas (admin solo empleados de su negocio) viven en el service.
userRouter.use(authenticate, authorize('superadmin', 'admin'));

userRouter.get('/', controller.list);
userRouter.post('/', controller.create);
userRouter.get('/:id', controller.getById);
userRouter.patch('/:id', controller.update);
userRouter.delete('/:id', controller.deactivate);
