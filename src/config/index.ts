import { loadEnv } from './env.js';

/** Configuración validada del proceso. Falla al importar si el entorno es inválido. */
export const env = loadEnv();
