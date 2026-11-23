import mongoose, { type ClientSession } from 'mongoose';

/**
 * Ejecuta `work` dentro de una transacción de MongoDB (requiere replica set: Atlas,
 * mongodb-memory-server en pruebas o `npm run dev:memory`). Reintenta solo ante errores
 * transitorios (conflictos de escritura entre cajas).
 */
export function withTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  return mongoose.connection.transaction(work);
}
