import type { Phase } from '@crewstrike/shared';
import type { ControlState } from './controls';
import { fire, nextTarget, toggleAutopilot } from './actions';
import { inStrikeZone, launchEnemyMissile, updateCombat } from './combat';
import { updateEnemies } from './enemies';
import { updatePlayer } from './flight';
import { dist2d, forward, segPointDist2 } from './math';
import {
  TRAINING_STEPS, makeTrainingDrone, pushEvent, spawnEnemiesFor, type GameState,
} from './state';
import { updateWeather } from './weather';

export const STEP = 1 / 60;

function engaged(s: GameState): boolean {
  return s.enemies.some(
    e => e.alive && (
      (e.kind === 'fighter' && (e.state === 'chase' || e.state === 'attack')) ||
      ((e.kind === 'sam' || e.kind === 'ship') && (e.state === 'tracking' || e.state === 'locked' || e.state === 'launch'))
    ),
  );
}

function updatePhase(s: GameState): void {
  const zone = s.mission.strikeZone;
  const dZone = dist2d(s.player.pos, zone.center) - zone.radius;
  if (!s.fightStarted && !s.training && (dZone < (s.mission.fightRange ?? 8000) || engaged(s))) {
    s.fightStarted = true;
    if (!s.spawnedPhases.includes('fight')) spawnEnemiesFor(s, 'fight');
  }
  let phase: Phase;
  if (!s.target.alive) phase = 'egress';
  else if (inStrikeZone(s)) phase = 'strike';
  else if (s.fightStarted) phase = 'fight';
  else phase = 'ingress';
  if (phase !== s.phase) {
    s.phase = phase;
    pushEvent(s, { type: 'phase', detail: phase });
    if (phase === 'strike' && !s.spawnedPhases.includes('strike')) spawnEnemiesFor(s, 'strike');
  }
}

function advanceTraining(s: GameState): void {
  const tr = s.training;
  if (!tr) return;
  tr.step += 1;
  tr.stepStartedAt = s.t;
  pushEvent(s, { type: 'training_step', detail: TRAINING_STEPS[tr.step]?.kind ?? 'done' });
  const p = s.player;
  const f = forward(p.heading, 0);
  const kind = TRAINING_STEPS[tr.step]?.kind;
  if (kind === 'drone') {
    s.enemies.push(makeTrainingDrone(s, [p.pos[0] + f[0] * 1500, p.pos[1], p.pos[2] + f[2] * 1500]));
  } else if (kind === 'flare') {
    const m = launchEnemyMissile(s, [p.pos[0] - f[0] * 3200, p.pos[1] + 150, p.pos[2] - f[2] * 3200], 'air', null);
    m.maxSpeed = 360;
    m.turnRate = 0.6;
  }
}

function updateTraining(s: GameState): void {
  const tr = s.training;
  if (!tr) return;
  const kind = TRAINING_STEPS[tr.step]?.kind;
  const p = s.player;
  if (kind === 'rings') {
    const ring = tr.rings[tr.ringIndex];
    if (ring && segPointDist2(p.prevPos, p.pos, ring) < 160 * 160) {
      tr.ringIndex += 1;
      pushEvent(s, { type: 'training_step', detail: `ring${tr.ringIndex}` });
      if (tr.ringIndex >= tr.rings.length) advanceTraining(s);
    }
  } else if (kind === 'drone') {
    if (!s.enemies.some(e => e.alive && e.groupId === 'train')) advanceTraining(s);
  } else if (kind === 'flare') {
    const inbound = s.missiles.some(m => m.alive && m.targetId === 'player');
    if (!inbound && s.t - tr.stepStartedAt > 0.5) advanceTraining(s);
  } else if (kind === 'strike') {
    if (!s.target.alive) advanceTraining(s);
  }
}

function end(s: GameState, status: GameState['status'], reason: string): void {
  if (s.status !== 'playing') return;
  s.status = status;
  s.endedAt = s.t;
  s.endReason = reason;
  s.player.autopilot = false;
  pushEvent(s, { type: 'end', detail: `${status}:${reason}` });
}

function checkEnd(s: GameState): void {
  const p = s.player;
  if (p.damage >= 1) return end(s, 'lost', 'shot down');
  if (p.agl <= 0) return end(s, 'lost', 'crashed');
  if (p.fuel <= 0) return end(s, 'lost', 'out of fuel');
  if (s.training) {
    const tr = s.training;
    if (TRAINING_STEPS[tr.step]?.kind === 'done' && s.t - tr.stepStartedAt > 1.5) end(s, 'won', 'training complete');
    return;
  }
  const inExit = dist2d(p.pos, s.mission.exit.center) < s.mission.exit.radius;
  if (inExit && !s.target.alive) return end(s, 'won', 'target destroyed, home safe');
  if (inExit && s.target.alive && s.t > 30) return end(s, 'aborted', 'returned before the strike');
}

/** Advance the simulation one fixed step. Mutates and returns the state; deterministic for a seed and input stream. */
export function step(s: GameState, c: ControlState, dt: number = STEP): GameState {
  if (s.status !== 'playing') {
    s.t += dt;
    s.frame += 1;
    return s;
  }
  s.t += dt;
  s.frame += 1;
  const p = s.player;
  p.throttle = c.throttle;

  const b = s.prevButtons;
  if (c.missile && !b.missile) fire(s, 'missile');
  if (c.strike && !b.strike) fire(s, 'strike');
  if (c.flare && !b.flare) fire(s, 'flare');
  if (c.nextTarget && !b.nextTarget) nextTarget(s);
  if (c.autopilot && !b.autopilot) toggleAutopilot(s);
  if (c.cannon) p.selected = 'cannon';
  s.prevButtons = { missile: c.missile, strike: c.strike, flare: c.flare, nextTarget: c.nextTarget, autopilot: c.autopilot };

  updateWeather(s, dt);
  updatePlayer(s, c, dt);
  updateCombat(s, c, dt);
  updateEnemies(s, dt);
  updatePhase(s);
  updateTraining(s);
  checkEnd(s);
  return s;
}
