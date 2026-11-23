import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, inject } from 'vitest';

/**
 * Conecta Mongoose a una base de datos exclusiva del archivo de prueba,
 * crea los índices (para probar duplicados) y limpia las colecciones antes de cada prueba.
 */
export function useTestDatabase(): void {
  beforeAll(async () => {
    await mongoose.connect(inject('mongoUri'), { dbName: `test_${randomUUID().slice(0, 8)}` });
    await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).createIndexes()));
  });

  beforeEach(async () => {
    const collections = Object.values(mongoose.connection.collections);
    await Promise.all(collections.map((collection) => collection.deleteMany({})));
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
}
