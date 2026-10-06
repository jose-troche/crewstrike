import type { Vec3 } from '@crewstrike/shared';

export type V3 = Vec3;

export const DEG = Math.PI / 180;
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const v3 = (x = 0, y = 0, z = 0): V3 => [x, y, z];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const dist2d = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[2] - b[2]);
export const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const copyInto = (dst: V3, src: V3): void => {
  dst[0] = src[0];
  dst[1] = src[1];
  dst[2] = src[2];
};

/** Wrap an angle in degrees to -180..180. */
export function wrap180(d: number): number {
  let a = d % 360;
  if (a > 180) a -= 360;
  if (a < -180) a += 360;
  return a;
}

/** Wrap an angle in radians to -PI..PI. */
export function wrapPi(r: number): number {
  let a = r % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** World convention: x east, y up, z south. Heading 0 = north (-z), 90 = east (+x). */
export function forward(heading: number, pitch: number): V3 {
  const cp = Math.cos(pitch);
  return [Math.sin(heading) * cp, Math.sin(pitch), -Math.cos(heading) * cp];
}

/** Compass bearing in degrees 0..360 from a to b. */
export function compass(a: V3, b: V3): number {
  const deg = Math.atan2(b[0] - a[0], -(b[2] - a[2])) / DEG;
  return (deg + 360) % 360;
}

/** Heading (radians) and pitch (radians) that point from a toward b. */
export function aim(a: V3, b: V3): { heading: number; pitch: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  return { heading: Math.atan2(dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

/** Angle between a direction and the vector toward a point, radians. */
export function offBoresight(from: V3, dir: V3, to: V3): number {
  const d = norm(sub(to, from));
  return Math.acos(clamp(dot(d, dir), -1, 1));
}

/** Closest approach of segment p0-p1 to point c, squared. */
export function segPointDist2(p0: V3, p1: V3, c: V3): number {
  const d = sub(p1, p0);
  const l2 = dot(d, d);
  let t = l2 > 0 ? dot(sub(c, p0), d) / l2 : 0;
  t = clamp(t, 0, 1);
  const q: V3 = [p0[0] + d[0] * t - c[0], p0[1] + d[1] * t - c[1], p0[2] + d[2] * t - c[2]];
  return dot(q, q);
}

export const CARDINALS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'] as const;
export type Cardinal = (typeof CARDINALS)[number];

export function cardinal(compassDeg: number, eight = false): Cardinal {
  if (eight) return CARDINALS[Math.round(((compassDeg % 360) + 360) % 360 / 45) % 8] as Cardinal;
  const four = ['north', 'east', 'south', 'west'] as const;
  return four[Math.round(((compassDeg % 360) + 360) % 360 / 90) % 4] as Cardinal;
}

/** "2 o'clock" style direction from a relative bearing. */
export function clock(relDeg: number): string {
  let h = Math.round(wrap180(relDeg) / 30);
  if (h <= 0) h += 12;
  return `${h} o'clock`;
}
