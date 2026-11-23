import { addDays } from '../../common/utils/dates.js';

/** Domingo de Pascua (algoritmo gregoriano anónimo) como `YYYY-MM-DD`. */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 0 = domingo … 6 = sábado. */
export function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y as number, (m as number) - 1, d as number)).getUTCDay();
}

/** Venta relativa por día de la semana en una marisquería (fin de semana fuerte). */
const WEEKDAY_FACTOR = [1.55, 0.7, 0.75, 0.8, 0.9, 1.15, 1.45];

/**
 * Cuánto se vende ese día respecto a un día normal: Cuaresma y Semana Santa son la temporada
 * alta del marisco; diciembre sube; enero baja. 0 = cerrado.
 */
export function demandFactor(date: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  if ((month === 1 && day === 1) || (month === 12 && day === 25)) return 0;

  let factor = WEEKDAY_FACTOR[weekday(date)] as number;
  const easter = easterSunday(year);
  const ashWednesday = addDays(easter, -46);
  const palmSunday = addDays(easter, -7);
  if (date >= palmSunday && date <= easter) factor *= 2.1;
  else if (date >= ashWednesday && date < palmSunday) factor *= 1.6;
  if (month === 12) factor *= 1.25;
  if (month === 1) factor *= 0.85;
  return factor;
}

/** Meses completos entre dos fechas de calendario (para la tendencia y la inflación). */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number) as [number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number];
  return (ty - fy) * 12 + (tm - fm);
}
