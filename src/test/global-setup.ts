import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

/**
 * Usa el mongod instalado en la máquina si existe (evita descargar ~600 MB).
 * Orden: MONGOMS_SYSTEM_BINARY → C:\Program Files\MongoDB\Server\<mayor versión>\bin\mongod.exe → descarga.
 */
function findLocalMongod(): string | undefined {
  if (process.env.MONGOMS_SYSTEM_BINARY) return process.env.MONGOMS_SYSTEM_BINARY;
  const root = 'C:\\Program Files\\MongoDB\\Server';
  if (process.platform !== 'win32' || !existsSync(root)) return undefined;

  const versions = readdirSync(root).sort((a, b) =>
    b.localeCompare(a, undefined, { numeric: true }),
  );
  return versions.map((v) => join(root, v, 'bin', 'mongod.exe')).find((path) => existsSync(path));
}

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
