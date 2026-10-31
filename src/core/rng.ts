// Small deterministic PRNG utilities. Same seed gives the same sequence on every device.

/** 32-bit FNV-1a hash of a string. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type Rng = () => number;

/** mulberry32: fast, well-distributed 32-bit generator returning floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seeded(key: string): Rng {
  return mulberry32(hashString(key));
}

export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Picks `count` distinct items, each draw weighted by `weight(item)`. */
export function weightedSample<T>(rng: Rng, items: readonly T[], count: number, weight: (t: T) => number): T[] {
  const pool = items.slice();
  const weights = pool.map(weight);
  const out: T[] = [];
  while (out.length < count && pool.length) {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    let i = 0;
    while (i < pool.length - 1 && r >= weights[i]) r -= weights[i++];
    out.push(pool[i]);
    pool.splice(i, 1);
    weights.splice(i, 1);
  }
  return out;
}
