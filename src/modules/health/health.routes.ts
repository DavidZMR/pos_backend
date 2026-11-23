import { Router } from 'express';
import { sendOk } from '../../common/http/response.js';
import { databaseState } from '../../db/connection.js';

export const healthRouter = Router();

/**
 * Siempre responde 200 si el proceso está vivo (Electron lo usa para saber que el backend arrancó).
 * El estado de la BD va en `db` para que la UI muestre "sin conexión" sin confundirlo con un backend caído.
 */
healthRouter.get('/health', (_req, res) => {
  sendOk(res, {
    status: 'ok',
    db: databaseState(),
    uptimeSeconds: Math.round(process.uptime()),
  });
});
