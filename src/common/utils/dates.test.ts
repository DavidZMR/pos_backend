import { describe, expect, it } from 'vitest';
import {
  addDays,
  calendarDateInZone,
  dayRange,
  instantInZone,
  startOfDayInZone,
  timezoneOffsetMinutes,
} from './dates.js';

describe('fechas en la zona del negocio', () => {
  it('CDMX está a UTC-6 (sin horario de verano desde 2022)', () => {
    expect(timezoneOffsetMinutes('America/Mexico_City', new Date('2026-07-01T12:00:00Z'))).toBe(
      -360,
    );
  });

  it('el día empieza a medianoche local', () => {
    expect(startOfDayInZone('2026-11-22', 'America/Mexico_City').toISOString()).toBe(
      '2026-11-22T06:00:00.000Z',
    );
    expect(startOfDayInZone('2026-11-22', 'America/Cancun').toISOString()).toBe(
      '2026-11-22T05:00:00.000Z',
    );
  });

  it('respeta el horario de verano en Tijuana', () => {
    expect(startOfDayInZone('2026-07-01', 'America/Tijuana').toISOString()).toBe(
      '2026-07-01T07:00:00.000Z',
    );
    expect(startOfDayInZone('2026-12-01', 'America/Tijuana').toISOString()).toBe(
      '2026-12-01T08:00:00.000Z',
    );
  });

  it('dayRange es inclusivo en días: [from 00:00, to+1 00:00)', () => {
    expect(dayRange('America/Mexico_City', '2026-11-01', '2026-11-03')).toEqual({
      $gte: new Date('2026-11-01T06:00:00.000Z'),
      $lt: new Date('2026-11-04T06:00:00.000Z'),
    });
    expect(dayRange('America/Mexico_City')).toBeUndefined();
  });

  it('instantInZone: una hora local del día (también el día del cambio de horario)', () => {
    expect(instantInZone('2026-03-02', 10 * 60 + 30, 'America/Mexico_City').toISOString()).toBe(
      '2026-03-02T16:30:00.000Z',
    );
    // Tijuana pasa a horario de verano el 8 de marzo de 2026 a las 2:00: a las 10:00 ya es UTC-7.
    expect(instantInZone('2026-03-08', 10 * 60, 'America/Tijuana').toISOString()).toBe(
      '2026-03-08T17:00:00.000Z',
    );
    expect(instantInZone('2026-03-02', 0, 'America/Mexico_City')).toEqual(
      startOfDayInZone('2026-03-02', 'America/Mexico_City'),
    );
  });

  it('addDays cruza fin de mes', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
  });

  it('calendarDateInZone: 23:30 de CDMX sigue siendo el mismo día', () => {
    expect(calendarDateInZone(new Date('2026-11-23T05:30:00Z'), 'America/Mexico_City')).toBe(
      '2026-11-22',
    );
  });

  it('rechaza fechas mal formadas', () => {
    expect(() => startOfDayInZone('22/11/2026', 'America/Mexico_City')).toThrow(RangeError);
  });
});
