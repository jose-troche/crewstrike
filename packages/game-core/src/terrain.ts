import type { V3 } from './math';

export type TerrainFeature =
  | { type: 'hill'; pos: [number, number]; radius: number; height: number }
  | { type: 'valley'; from: [number, number]; to: [number, number]; width: number; depth: number }
  | { type: 'flat'; pos: [number, number]; radius: number; height: number };

export interface TerrainDef {
  kind: 'land' | 'sea';
  seed: number;
  /** Base height in meters (negative for sea floor). */
  base: number;
  /** Noise amplitude in meters. */
  amp: number;
  /** Noise feature size in meters. */
  scale: number;
  features: TerrainFeature[];
}

export const SEA_LEVEL = 0;

function hash(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const a = hash(ix, iz, seed);
  const b = hash(ix + 1, iz, seed);
  const c = hash(ix, iz + 1, seed);
  const d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

function fbm(x: number, z: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let o = 0; o < 4; o++) {
    sum += amp * valueNoise(x * f, z * f, seed + o * 17);
    f *= 2.03;
    amp *= 0.5;
  }
  return sum / 0.9375;
}

function segDist(px: number, pz: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l2)) : 0;
  return Math.hypot(px - (a[0] + dx * t), pz - (a[1] + dz * t));
}

/** Terrain height at (x, z) in meters; below 0 is water. Deterministic and DOM-free. */
export function groundHeight(t: TerrainDef, x: number, z: number): number {
  let h: number;
  if (t.kind === 'sea') {
    h = t.base + t.amp * (fbm(x / t.scale, z / t.scale, t.seed) - 0.5);
  } else {
    const n = fbm(x / t.scale, z / t.scale, t.seed);
    h = t.base + t.amp * n * n * 1.6;
  }
  for (const f of t.features) {
    if (f.type === 'hill') {
      const d = Math.hypot(x - f.pos[0], z - f.pos[1]) / f.radius;
      if (d < 2.5) h += f.height * Math.exp(-d * d * 1.6);
    } else if (f.type === 'valley') {
      const d = segDist(x, z, f.from, f.to) / f.width;
      if (d < 2) h -= f.depth * Math.exp(-d * d * 2.2);
    } else {
      const d = Math.hypot(x - f.pos[0], z - f.pos[1]) / f.radius;
      if (d < 1.6) {
        const w = d < 1 ? 1 : 1 - smooth((d - 1) / 0.6);
        h = h + (f.height - h) * w;
      }
    }
  }
  return h;
}

/** Height of whatever you would crash into: ground or water surface. */
export function surfaceHeight(t: TerrainDef, x: number, z: number): number {
  return Math.max(groundHeight(t, x, z), SEA_LEVEL);
}

/** True when terrain blocks the straight line between a and b. */
export function terrainBlocks(t: TerrainDef, a: V3, b: V3, samples = 16): boolean {
  for (let i = 1; i < samples; i++) {
    const u = i / samples;
    const x = a[0] + (b[0] - a[0]) * u;
    const y = a[1] + (b[1] - a[1]) * u;
    const z = a[2] + (b[2] - a[2]) * u;
    if (surfaceHeight(t, x, z) > y) return true;
  }
  return false;
}
