function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Aplana un objeto parcial a rutas con punto para actualizaciones parciales de subdocumentos:
 * { ticket: { header: 'x' } } → { 'ticket.header': 'x' }. Omite valores `undefined`.
 */
export function toDottedPaths(
  input: Record<string, unknown>,
  prefix = '',
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) Object.assign(out, toDottedPaths(value, path));
    else out[path] = value;
  }
  return out;
}
