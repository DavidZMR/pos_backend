import cors from 'cors';
import express, { Router } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { logger } from './common/logger.js';
import { errorHandler, notFoundHandler } from './common/middleware/error-handler.js';
import { healthRouter } from './modules/health/health.routes.js';

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
  // Los módulos se montan aquí: v1.use('/auth', authRouter), etc.
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
