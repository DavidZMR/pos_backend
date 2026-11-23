import { describe, expect, it } from 'vitest';
import { toDottedPaths } from './flatten.js';
import { containsRegex, normalizeText } from './text.js';

describe('normalizeText', () => {
  it('quita acentos, baja a minúsculas y colapsa espacios', () => {
    expect(normalizeText('  Camarón   GRANDE ')).toBe('camaron grande');
    expect(normalizeText('Pulpo Español ñ')).toBe('pulpo espanol n');
  });
});

describe('containsRegex', () => {
  it('busca sin acentos y escapa caracteres especiales', () => {
    expect(containsRegex('CAMARÓN').test('camaron grande')).toBe(true);
    expect(containsRegex('1.5 (kg)').test('filete 1.5 (kg)')).toBe(true);
    expect(containsRegex('.*').test('cualquier cosa')).toBe(false);
  });
});

describe('toDottedPaths', () => {
  it('aplana objetos anidados y omite undefined', () => {
    expect(
      toDottedPaths({ name: 'A', ticket: { header: 'H', footer: undefined }, tags: ['x'] }),
    ).toEqual({ name: 'A', 'ticket.header': 'H', tags: ['x'] });
  });
});
