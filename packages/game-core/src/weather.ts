import { dist2d, type V3 } from './math';
import { chance } from './rng';
import { pushEvent, pushFx, type GameState, type Storm } from './state';
import { applyDamage } from './damage';

export function inActiveStorm(s: GameState, pos: V3): boolean {
  for (const st of s.storms) if (st.active && dist2d(st.pos, pos) < st.radius && pos[1] < 9000) return true;
  return false;
}

export function nearestStorm(s: GameState, pos: V3): { storm: Storm; edgeM: number } | null {
  let best: { storm: Storm; edgeM: number } | null = null;
  for (const st of s.storms) {
    if (!st.active) continue;
    const edge = dist2d(st.pos, pos) - st.radius;
    if (!best || edge < best.edgeM) best = { storm: st, edgeM: edge };
  }
  return best;
}

export function updateWeather(s: GameState, dt: number): void {
  for (const st of s.storms) {
    if (!st.active) continue;
    st.pos[0] += st.vel[0] * dt;
    st.pos[2] += st.vel[1] * dt;
  }
  const inside = inActiveStorm(s, s.player.pos);
  if (inside && !s.inStorm) pushEvent(s, { type: 'storm_enter' });
  s.inStorm = inside;
  // Lightning: roughly one strike every 12 seconds inside a cell.
  if (inside && chance(s.rng, dt / 12)) {
    pushFx(s, 'lightning', s.player.pos);
    pushEvent(s, { type: 'lightning' });
    applyDamage(s, 0.02, null);
  }
}
