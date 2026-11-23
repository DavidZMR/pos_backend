import type { AddressInfo } from 'node:net';
import { createApp } from './app.js';
import { logger } from './common/logger.js';
import { loadEnv, parseCorsOrigins } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './db/connection.js';

const env = loadEnv();

const app = createApp({ corsOrigins: parseCorsOrigins(env.CORS_ORIGINS) });

const server = app.listen(env.PORT, env.HOST, () => {
  const { port } = server.address() as AddressInfo;
  logger.info({ host: env.HOST, port }, 'Backend escuchando');
  // Línea estable que Electron lee de stdout para conocer el puerto (PORT=0 asigna uno libre).
  console.log(`POS_BACKEND_READY port=${port}`);
});

void connectDatabase(env.MONGODB_URI);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Cerrando backend');
  server.close();
  await disconnectDatabase().catch((err) => logger.error({ err }, 'Error al desconectar MongoDB'));
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
