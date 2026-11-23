/**
 * Backend de desarrollo SIN Atlas: replica set en memoria (con el mongod local) + datos demo.
 *   npm run dev:memory            → BD vacía
 *   npm run dev:memory -- --seed  → marisquería de demostración (usuarios demo.*, clave Demo12345)
 * Los datos se pierden al detener el proceso. Útil para pruebas E2E y demos.
 */

import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { findLocalMongod } from './local-mongod.js';

const seed = process.argv.includes('--seed');
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
