import 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    /** URI del replica set en memoria levantado en global-setup.ts. */
    mongoUri: string;
  }
}
