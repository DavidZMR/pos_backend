/**
 * Fechas "de calendario" en la zona horaria del negocio. Un filtro "del 1 al 3 de noviembre"
 * significa desde las 00:00 del día 1 hasta antes de las 00:00 del día 4 **hora local del negocio**,
 * no en UTC. (Se reutiliza en cortes de caja y reportes.)
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Minutos que la zona `timeZone` está desplazada respecto a UTC en el instante dado (CDMX = -360). */
export function timezoneOffsetMinutes(timeZone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** Instante UTC en que empieza el día `YYYY-MM-DD` en la zona del negocio. */
export function startOfDayInZone(date: string, timeZone: string): Date {
  return instantInZone(date, 0, timeZone);
}

/** Instante UTC de la hora local `minutes` (minutos desde la medianoche) del día `date`. */
export function instantInZone(date: string, minutes: number, timeZone: string): Date {
  const match = DATE_RE.exec(date);
  if (!match) throw new RangeError(`Fecha inválida: ${date}`);
  const localAsUtc =
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) + minutes * 60_000;
  // Primera aproximación con el desfase de ese día y corrección por si cruza un cambio de horario.
  let instant = localAsUtc - timezoneOffsetMinutes(timeZone, new Date(localAsUtc)) * 60_000;
  instant = localAsUtc - timezoneOffsetMinutes(timeZone, new Date(instant)) * 60_000;
  return new Date(instant);
}

/** Suma días a una fecha de calendario `YYYY-MM-DD`. */
export function addDays(date: string, days: number): string {
  const match = DATE_RE.exec(date);
  if (!match) throw new RangeError(`Fecha inválida: ${date}`);
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return utc.toISOString().slice(0, 10);
}

/**
 * Rango [from, to) en UTC para un filtro de días inclusivo en la zona del negocio.
 * Cualquiera de los dos extremos es opcional.
 */
export function dayRange(
  timeZone: string,
  from?: string,
  to?: string,
): { $gte?: Date; $lt?: Date } | undefined {
  if (!from && !to) return undefined;
  const range: { $gte?: Date; $lt?: Date } = {};
  if (from) range.$gte = startOfDayInZone(from, timeZone);
  if (to) range.$lt = startOfDayInZone(addDays(to, 1), timeZone);
  return range;
}

/** Fecha de calendario `YYYY-MM-DD` de un instante, vista en la zona del negocio. */
export function calendarDateInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}
