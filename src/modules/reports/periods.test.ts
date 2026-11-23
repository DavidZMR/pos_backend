import { describe, expect, it } from 'vitest';
import {
  autoGranularity,
  daysBetween,
  enumeratePeriods,
  periodStart,
  previousRange,
} from './periods.js';

describe('periodos de reportes', () => {
  it('inicio de periodo: semana desde el lunes, mes y año', () => {
    expect(periodStart('2026-03-08', 'week')).toBe('2026-03-02'); // domingo → lunes anterior
    expect(periodStart('2026-03-02', 'week')).toBe('2026-03-02');
    expect(periodStart('2026-03-31', 'month')).toBe('2026-03-01');
    expect(periodStart('2026-12-31', 'year')).toBe('2026-01-01');
  });

  it('enumera periodos sin huecos, cruzando fin de año', () => {
    expect(enumeratePeriods('2025-11-15', '2026-02-02', 'month')).toEqual([
      '2025-11-01',
      '2025-12-01',
      '2026-01-01',
      '2026-02-01',
    ]);
    expect(enumeratePeriods('2026-02-27', '2026-03-02', 'day')).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
  });

  it('días, periodo anterior y agrupación automática', () => {
    expect(daysBetween('2026-03-01', '2026-03-31')).toBe(31);
    expect(previousRange('2026-03-01', '2026-03-31')).toEqual({
      from: '2026-01-29',
      to: '2026-02-28',
    });
    expect(autoGranularity('2026-03-01', '2026-03-31')).toBe('day');
    expect(autoGranularity('2026-01-01', '2026-06-30')).toBe('week');
    expect(autoGranularity('2025-01-01', '2026-12-31')).toBe('month');
    expect(autoGranularity('2022-01-01', '2026-12-31')).toBe('year');
  });
});
