import type { MissionStatus } from '@crewstrike/shared';
import type { GameState } from './state';

export interface ScoreResult {
  outcome: MissionStatus;
  score: number;
  stars: number;
  durationS: number;
  breakdown: { target: number; kills: number; damage: number; time: number; leftover: number; survive: number };
  multiplier: number;
}

const MULT = { cadet: 1, pilot: 1.5, ace: 2, custom: 1 } as const;

/** Score: target, kills, damage taken, time, missiles left over; 0 to 3 stars. */
export function computeScore(s: GameState): ScoreResult {
  const p = s.player;
  const outcome = s.status;
  const durationS = Math.round(s.endedAt ?? s.t);
  const destroyed = !s.target.alive;
  const target = destroyed ? 5000 : 0;
  const kills = s.score.killPoints;
  const damage = -Math.round(p.damage * 2000);
  const time = outcome === 'won' ? Math.max(0, Math.round(3000 - durationS * 6)) : 0;
  const leftover = outcome === 'won' ? p.missiles * 100 + p.strike * 400 : 0;
  const survive = outcome === 'won' ? 1000 : outcome === 'aborted' ? 500 : 0;
  const multiplier = MULT[s.difficulty];
  const raw = target + kills + damage + time + leftover + survive;
  const score = Math.max(0, Math.round(raw * multiplier));
  let stars = 0;
  if (outcome === 'won') stars = 1 + (p.damage < 0.35 ? 1 : 0) + (durationS < 360 ? 1 : 0);
  else if (outcome === 'aborted') stars = 1;
  return { outcome, score, stars, durationS, breakdown: { target, kills, damage, time, leftover, survive }, multiplier };
}

/** Stars earned so far, for the mission bar while playing. */
export function starsSoFar(s: GameState): number {
  if (s.target.alive) return 0;
  return 1 + (s.player.damage < 0.35 ? 1 : 0) + (s.t < 360 ? 1 : 0);
}

export function liveScore(s: GameState): number {
  const destroyed = !s.target.alive ? 5000 : 0;
  return Math.max(0, Math.round((destroyed + s.score.killPoints - s.player.damage * 2000) * MULT[s.difficulty]));
}
