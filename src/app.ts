import cors from 'cors';
import express, { Router } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { logger } from './common/logger.js';
import { errorHandler, notFoundHandler } from './common/middleware/error-handler.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { businessRouter } from './modules/businesses/business.routes.js';
import { cashSessionRouter } from './modules/cash-sessions/cash-session.routes.js';
import { categoryRouter } from './modules/categories/category.routes.js';
import { healthRouter } from './modules/health/health.routes.js';
import { inventoryRouter } from './modules/inventory/inventory.routes.js';
import { posRouter } from './modules/pos/pos.routes.js';
import { productRouter } from './modules/products/product.routes.js';
import { purchaseRouter } from './modules/purchases/purchase.routes.js';
import { reportRouter } from './modules/reports/reports.routes.js';
import { saleRouter } from './modules/sales/sale.routes.js';
import { supplierRouter } from './modules/suppliers/supplier.routes.js';
import { userRouter } from './modules/users/user.routes.js';

export interface AppOptions {
  corsOrigins: string[];
  /** Desactiva el log por petición (útil en tests). */
  requestLogging?: boolean;
}

export function createApp({ corsOrigins, requestLogging = true }: AppOptions) {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      // Electron carga la UI desde file://, cuyo origen llega como "null".
      origin: (origin, callback) => {
        callback(null, !origin || origin === 'null' || corsOrigins.includes(origin));
      },
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  if (requestLogging) app.use(pinoHttp({ logger }));

  app.use('/api', healthRouter);

  const v1 = Router();
  v1.use('/auth', authRouter);
  v1.use('/businesses', businessRouter);
  v1.use('/users', userRouter);
  v1.use('/categories', categoryRouter);
  v1.use('/suppliers', supplierRouter);
  v1.use('/products', productRouter);
  v1.use('/purchases', purchaseRouter);
  v1.use('/inventory', inventoryRouter);
  v1.use('/pos', posRouter);
  v1.use('/cash-sessions', cashSessionRouter);
  v1.use('/sales', saleRouter);
  v1.use('/reports', reportRouter);
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
