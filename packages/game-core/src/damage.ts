import { DEG, compass, wrap180, type V3 } from './math';
import { pushEvent, type GameState } from './state';

/** Apply damage to the player; `from` decides which section of the jet takes it. */
export function applyDamage(s: GameState, amount: number, from: V3 | null): void {
  const p = s.player;
  if (s.status !== 'playing') return;
  const dmg = amount * s.profile.damageTaken;
  let bearing = 0;
  if (from) bearing = wrap180(compass(p.pos, from) - p.heading / DEG);
  const sec = p.sections;
  const add = dmg * 2.6;
  if (!from) sec.body = Math.min(1, sec.body + add);
  else if (Math.abs(bearing) < 45) sec.nose = Math.min(1, sec.nose + add);
  else if (Math.abs(bearing) > 135) sec.tail = Math.min(1, sec.tail + add);
  else if (bearing < 0) sec.leftWing = Math.min(1, sec.leftWing + add);
  else sec.rightWing = Math.min(1, sec.rightWing + add);
  sec.body = Math.min(1, sec.body + add * 0.3);
  p.damage = Math.min(1, p.damage + dmg);
  s.score.hitsTaken += 1;
  s.lastHitAt = s.t;
  s.lastHitBearing = bearing;
  s.inCombatUntil = Math.max(s.inCombatUntil, s.t + 6);
  pushEvent(s, { type: 'hit', bearing: Math.round(bearing), detail: dmg.toFixed(3) });
}
