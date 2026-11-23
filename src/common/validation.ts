import { z } from 'zod';

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'ID inválido');

export const idParamsSchema = z.object({ id: objectIdSchema });

/**
 * Texto opcional recortado. "" se conserva para poder **borrar** el campo al editar
 * (omitir la propiedad = no cambiarla).
 */
export const optionalText = (max: number) =>
  z.string().trim().max(max, `Máximo ${max} caracteres`).optional();

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` que de verdad existe (rechaza 2026-02-30, 2026-04-31, 2026-01-00…). */
export function isCalendarDate(value: string): boolean {
  const match = CALENDAR_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Fecha de calendario (sin hora) para filtros; se interpreta en la zona del negocio. */
export const calendarDateSchema = z
  .string()
  .regex(CALENDAR_DATE, 'Fecha inválida (AAAA-MM-DD)')
  .refine(isCalendarDate, 'Esa fecha no existe');
