import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';
import { findLocalMongod } from '../dev/local-mongod.js';

let replSet: MongoMemoryReplSet | undefined;

export async function setup(project: TestProject) {
  const systemBinary = findLocalMongod();
  // La versión local (p. ej. 7.0) difiere de la que trae la librería; para pruebas da igual.
  if (systemBinary) process.env.MONGOMS_SYSTEM_BINARY_VERSION_CHECK ??= 'false';
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    ...(systemBinary && { binary: { systemBinary, checkMD5: false } }),
  });
  project.provide('mongoUri', replSet.getUri());
}

export async function teardown() {
  await replSet?.stop();
}
