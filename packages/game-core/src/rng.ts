/** Small seeded PRNG (mulberry32); state is a plain number so game state stays serializable. */
export interface Rng {
  s: number;
}

export function rng(seed: number): Rng {
  return { s: seed >>> 0 || 1 };
}

export function next(r: Rng): number {
  r.s = (r.s + 0x6d2b79f5) >>> 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const range = (r: Rng, lo: number, hi: number): number => lo + (hi - lo) * next(r);
export const chance = (r: Rng, p: number): boolean => next(r) < p;
