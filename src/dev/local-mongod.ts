import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Ruta del `mongod` instalado en la máquina (evita descargar ~600 MB en pruebas/desarrollo).
 * Orden: MONGOMS_SYSTEM_BINARY → C:\Program Files\MongoDB\Server\<mayor versión>\bin\mongod.exe.
 */
export function findLocalMongod(): string | undefined {
  if (process.env.MONGOMS_SYSTEM_BINARY) return process.env.MONGOMS_SYSTEM_BINARY;
  const root = 'C:\\Program Files\\MongoDB\\Server';
  if (process.platform !== 'win32' || !existsSync(root)) return undefined;

  const versions = readdirSync(root).sort((a, b) =>
    b.localeCompare(a, undefined, { numeric: true }),
  );
  return versions.map((v) => join(root, v, 'bin', 'mongod.exe')).find((path) => existsSync(path));
}
