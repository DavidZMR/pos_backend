import { Types } from 'mongoose';

/**
 * Azar reproducible (mulberry32): la misma semilla genera exactamente los mismos datos, así una
 * prueba que falla se puede repetir.
 */
export function createRng(seed: number) {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));

  return {
    next,
    int,
    chance: (probability: number) => next() < probability,
    /** Factor aleatorio alrededor de 1 (p. ej. spread 0.15 → 0.85…1.15). */
    around: (spread: number) => 1 - spread + next() * spread * 2,
    pick<T>(items: readonly T[]): T {
      return items[Math.floor(next() * items.length)] as T;
    },
    weighted<T>(items: readonly T[], weight: (item: T) => number): T {
      const total = items.reduce((sum, item) => sum + weight(item), 0);
      let roll = next() * total;
      for (const item of items) {
        roll -= weight(item);
        if (roll < 0) return item;
      }
      return items[items.length - 1] as T;
    },
    hex(length: number): string {
      let out = '';
      while (out.length < length) out += Math.floor(next() * 16).toString(16);
      return out;
    },
  };
}

export type Rng = ReturnType<typeof createRng>;

/** ObjectId cuyo timestamp es el del evento (así ordenar por _id = ordenar por fecha). */
export function objectIdAt(instant: Date, rng: Rng): Types.ObjectId {
  const seconds = Math.floor(instant.getTime() / 1000)
    .toString(16)
    .padStart(8, '0');
  return new Types.ObjectId(seconds + rng.hex(16));
}
