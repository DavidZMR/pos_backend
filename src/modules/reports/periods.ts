import { addDays } from '../../common/utils/dates.js';

/**
 * Periodos de calendario de los reportes (en la zona del negocio). Deben coincidir con
 * `$dateTrunc` de MongoDB: la semana empieza en lunes. Sirven para rellenar con ceros los
 * periodos sin ventas (una gráfica sin huecos engañosos).
 */
export const GRANULARITIES = ['day', 'week', 'month', 'year'] as const;
export type Granularity = (typeof GRANULARITIES)[number];

function parts(date: string): [number, number, number] {
  return date.split('-').map(Number) as [number, number, number];
}

/** Días del rango [from, to], ambos incluidos. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000) + 1;
}

/** Primer día del periodo que contiene `date`. */
export function periodStart(date: string, granularity: Granularity): string {
  const [y, m, d] = parts(date);
  switch (granularity) {
    case 'day':
      return date;
    case 'week': {
      const sundayZero = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      return addDays(date, -((sundayZero + 6) % 7));
    }
    case 'month':
      return `${date.slice(0, 7)}-01`;
    case 'year':
      return `${date.slice(0, 4)}-01-01`;
  }
}

function nextPeriod(start: string, granularity: Granularity): string {
  const [y, m] = parts(start);
  switch (granularity) {
    case 'day':
      return addDays(start, 1);
    case 'week':
      return addDays(start, 7);
    case 'month':
      return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    case 'year':
      return `${y + 1}-01-01`;
  }
}

/** Inicio de cada periodo que toca el rango, en orden. */
export function enumeratePeriods(from: string, to: string, granularity: Granularity): string[] {
  const periods: string[] = [];
  for (let p = periodStart(from, granularity); p <= to; p = nextPeriod(p, granularity)) {
    periods.push(p);
  }
  return periods;
}

/** Agrupación sugerida según el largo del rango (no más de ~45 barras). */
export function autoGranularity(from: string, to: string): Granularity {
  const days = daysBetween(from, to);
  if (days <= 45) return 'day';
  if (days <= 210) return 'week';
  if (days <= 1100) return 'month';
  return 'year';
}

/** Periodo anterior del mismo largo (para comparar: "vs. los 30 días previos"). */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const days = daysBetween(from, to);
  return { from: addDays(from, -days), to: addDays(from, -1) };
}
