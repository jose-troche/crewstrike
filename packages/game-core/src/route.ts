import { cardinal, compass, type Cardinal } from './math';

/** A circular danger area on the ground plane (x, z) with a weight. */
export interface Hazard {
  x: number;
  z: number;
  r: number;
  w: number;
}

export interface RoutePlan {
  /** Detour point, or null when flying direct is best. */
  waypoint: [number, number] | null;
  /** Compass side of the detour (or of the destination when direct). */
  label: Cardinal;
  exposure: number;
  directExposure: number;
  /** Extra flight distance of the plan versus direct, meters. */
  extraM: number;
}

function exposureAlong(pts: [number, number][], hazards: Hazard[]): { exposure: number; length: number } {
  let exposure = 0;
  let length = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as [number, number];
    const b = pts[i] as [number, number];
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    length += segLen;
    const n = Math.max(1, Math.ceil(segLen / 500));
    for (let k = 0; k < n; k++) {
      const u = (k + 0.5) / n;
      const x = a[0] + (b[0] - a[0]) * u;
      const z = a[1] + (b[1] - a[1]) * u;
      for (const h of hazards) {
        const d = Math.hypot(x - h.x, z - h.z);
        if (d < h.r) exposure += h.w * (1 - d / h.r) * (segLen / n / 1000);
      }
    }
  }
  return { exposure, length };
}

/**
 * Lowest exposure-times-time route from `from` to `dest`, choosing between flying direct
 * and a detour to either side. Shared by the autopilot and the strategic advisor.
 */
export function planRoute(from: [number, number], dest: [number, number], hazards: Hazard[]): RoutePlan {
  const dx = dest[0] - from[0];
  const dz = dest[1] - from[1];
  const d = Math.hypot(dx, dz) || 1;
  const nx = -dz / d;
  const nz = dx / d;
  const mid: [number, number] = [from[0] + dx * 0.5, from[1] + dz * 0.5];
  const direct = exposureAlong([from, dest], hazards);
  const cost = (e: number, l: number): number => e * 4 + l / 1000 * 0.15;

  let best = { wp: null as [number, number] | null, e: direct.exposure, l: direct.length, c: cost(direct.exposure, direct.length) };
  for (const side of [1, -1]) {
    for (const off of [5000, 8000, 11000]) {
      const wp: [number, number] = [mid[0] + nx * off * side, mid[1] + nz * off * side];
      const r = exposureAlong([from, wp, dest], hazards);
      const c = cost(r.exposure, r.length);
      if (c < best.c - 0.05) best = { wp, e: r.exposure, l: r.length, c };
    }
  }
  const label = best.wp
    ? cardinal(compass([mid[0], 0, mid[1]], [best.wp[0], 0, best.wp[1]]))
    : cardinal(compass([from[0], 0, from[1]], [dest[0], 0, dest[1]]));
  return { waypoint: best.wp, label, exposure: best.e, directExposure: direct.exposure, extraM: best.l - direct.length };
}
