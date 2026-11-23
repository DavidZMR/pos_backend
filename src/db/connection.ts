import mongoose from 'mongoose';
import { logger } from '../common/logger.js';

export type DatabaseState = 'disconnected' | 'connected' | 'connecting' | 'disconnecting';

const STATES: Record<number, DatabaseState> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

interface ConnectOptions {
  /** Intentos máximos antes de rendirse (Infinity = reintentar siempre). */
  retries?: number;
  delayMs?: number;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Conecta a MongoDB con reintentos. A diferencia de JJ no hace `process.exit`:
 * el servidor sigue arriba y `/api/health` reporta el estado para que la UI avise al usuario.
 */
export async function connectDatabase(uri: string, options: ConnectOptions = {}) {
  const { retries = Number.POSITIVE_INFINITY, delayMs = 5000 } = options;
  mongoose.set('strictQuery', true);

  for (let attempt = 1; ; attempt++) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
      logger.info({ db: mongoose.connection.name }, 'MongoDB conectado');
      return mongoose.connection;
    } catch (err) {
      logger.error({ err, attempt }, 'No se pudo conectar a MongoDB');
      if (attempt >= retries) throw err;
      await wait(delayMs);
    }
  }
}

export function databaseState(): DatabaseState {
  return STATES[mongoose.connection.readyState] ?? 'disconnected';
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
