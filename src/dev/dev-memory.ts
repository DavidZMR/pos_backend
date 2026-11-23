/**
 * Backend de desarrollo SIN Atlas: replica set en memoria (con el mongod local) + datos demo.
 *   npm run dev:memory            → BD vacía
 *   npm run dev:memory -- --seed  → marisquería de demostración (usuarios demo.*, clave Demo12345)
 *   npm run dev:memory -- --history [--months=14]
 *        → la demo + ~14 meses de ventas, compras y cortes ficticios (para reportes), más
 *          cajeros demo.caja2/demo.caja3 y el negocio Abarrotes La Esquina (demo.esquina).
 * Los datos se pierden al detener el proceso. Útil para pruebas E2E y demos.
 */

import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { findLocalMongod } from './local-mongod.js';

const history = process.argv.includes('--history');
const seed = history || process.argv.includes('--seed');
const monthsArg = process.argv.find((a) => a.startsWith('--months='));
const months = monthsArg ? Number(monthsArg.split('=')[1]) : 14;
const systemBinary = findLocalMongod();
if (systemBinary) process.env.MONGOMS_SYSTEM_BINARY_VERSION_CHECK ??= 'false';

const replSet = await MongoMemoryReplSet.create({
  replSet: { count: 1, storageEngine: 'wiredTiger' },
  ...(systemBinary && { binary: { systemBinary, checkMD5: false } }),
});
process.env.MONGODB_URI = replSet.getUri('pos_dev');
process.env.NODE_ENV ??= 'development';
console.log(`MongoDB en memoria (replica set): ${process.env.MONGODB_URI}`);

await import('../server.js');

if (seed) {
  await mongoose.connection.asPromise();
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).createIndexes()));
  const { seedDemo, DEMO_PASSWORD } = await import('./demo-seed.js');
  await seedDemo();
  if (history) {
    const { seedHistory } = await import('./history/history-seed.js');
    const started = Date.now();
    const stats = await seedHistory({ months });
    for (const s of stats) {
      console.log(
        `Historial ${s.business} desde ${s.from}: ${s.sales} ventas (${s.cancelled} canceladas), ` +
          `${s.purchases} compras, ${s.sessions} cortes, ${s.movements} movimientos, ${s.products} productos`,
      );
    }
    console.log(`Historial generado en ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }
  console.log(
    `Datos demo listos — usuarios demo.root / demo.admin / demo.caja, clave ${DEMO_PASSWORD}`,
  );
}

const stop = async () => {
  await replSet.stop();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
