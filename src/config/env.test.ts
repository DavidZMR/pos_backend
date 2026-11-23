import { describe, expect, it } from 'vitest';
import { loadEnv, parseCorsOrigins } from './env.js';

const base = {
  MONGODB_URI: 'mongodb://localhost/pos',
  JWT_SECRET: 'x'.repeat(32),
};

describe('loadEnv', () => {
  it('aplica valores por defecto', () => {
    const env = loadEnv(base);
    expect(env).toMatchObject({ PORT: 3000, HOST: '127.0.0.1', JWT_EXPIRES_IN: '12h' });
  });

  it('acepta PORT=0 para puerto libre', () => {
    expect(loadEnv({ ...base, PORT: '0' }).PORT).toBe(0);
  });

  it('rechaza JWT_SECRET corto o MONGODB_URI faltante', () => {
    expect(() => loadEnv({ ...base, JWT_SECRET: 'corto' })).toThrow(/JWT_SECRET/);
    expect(() => loadEnv({ JWT_SECRET: base.JWT_SECRET })).toThrow(/MONGODB_URI/);
  });
});

describe('parseCorsOrigins', () => {
  it('separa por coma y limpia espacios', () => {
    expect(parseCorsOrigins(' http://a.com, http://b.com ,')).toEqual([
      'http://a.com',
      'http://b.com',
    ]);
  });
});
