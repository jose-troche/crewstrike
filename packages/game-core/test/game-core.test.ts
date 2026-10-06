import { describe, expect, it } from 'vitest';
import {
  CADET, ACE, MISSIONS, applySpawn, computeScore, createGame, fire, groundHeight, neutralControls, planRoute,
  profileFor, setAutopilot, snapshot, step, surfaceHeight, type GameState,
} from '../src';
import { autopilotRun } from './helpers';

function run(s: GameState, frames: number, c = neutralControls()): void {
  for (let i = 0; i < frames; i++) step(s, c);
}

describe('terrain', () => {
  it('is deterministic and places the radar station on a ridge', () => {
    const t = MISSIONS['radar-breaker']!.terrain;
    expect(groundHeight(t, 1000, 2000)).toBe(groundHeight(t, 1000, 2000));
    expect(surfaceHeight(t, 24000, 3000)).toBeGreaterThan(500);
  });
  it('is water at sea in Iron Tide', () => {
    const t = MISSIONS['iron-tide']!.terrain;
    expect(groundHeight(t, 23000, -4000)).toBeLessThan(0);
    expect(surfaceHeight(t, 23000, -4000)).toBe(0);
  });
});

describe('difficulty as data', () => {
  it('maps names to profiles and custom overrides', () => {
    expect(profileFor('cadet')).toEqual(CADET);
    expect(profileFor('ace').steering).toBe(ACE.steering);
    expect(profileFor('custom', { aimAssist: 0.1 }).aimAssist).toBe(0.1);
  });
});

describe('simulation', () => {
  it('is deterministic for a seed and input stream', () => {
    const a = createGame('radar-breaker', { seed: 42, difficulty: 'pilot' });
    const b = createGame('radar-breaker', { seed: 42, difficulty: 'pilot' });
    const c = { ...neutralControls(), stickX: 0.3, cannon: true };
    run(a, 600, c);
    run(b, 600, c);
    expect(a.player.pos).toEqual(b.player.pos);
    expect(a.player.rounds).toBe(b.player.rounds);
  });

  it('throttle and boost change speed; boost burns more fuel', () => {
    const slow = createGame('radar-breaker', { difficulty: 'pilot' });
    const fast = createGame('radar-breaker', { difficulty: 'pilot' });
    run(slow, 300, neutralControls(0));
    run(fast, 300, { ...neutralControls(2), boost: true });
    expect(fast.player.speed).toBeGreaterThan(slow.player.speed + 100);
    expect(fast.player.fuelMax - fast.player.fuel).toBeGreaterThan(2 * (slow.player.fuelMax - slow.player.fuel));
  });

  it('cadet ground protection prevents a crash when diving', () => {
    const s = createGame('radar-breaker', { difficulty: 'cadet' });
    run(s, 60 * 30, { ...neutralControls(), stickY: -1 });
    expect(s.status).toBe('playing');
    expect(s.player.agl).toBeGreaterThan(0);
  });

  it('ace can fly into the ground', () => {
    const s = createGame('radar-breaker', { difficulty: 'ace' });
    run(s, 60 * 40, { ...neutralControls(), stickY: -1 });
    expect(s.status).toBe('lost');
  });

  it('autopilot hands back on stick input', () => {
    const s = createGame('radar-breaker', { difficulty: 'cadet' });
    expect(setAutopilot(s, true)).toBe(true);
    run(s, 10);
    expect(s.player.autopilot).toBe(true);
    step(s, { ...neutralControls(), stickX: 0.8 });
    expect(s.player.autopilot).toBe(false);
  });

  it('ace has no autopilot', () => {
    const s = createGame('radar-breaker', { difficulty: 'ace' });
    expect(setAutopilot(s, true)).toBe(false);
  });

  it('strike missiles only work in the strike zone', () => {
    const s = createGame('radar-breaker', { difficulty: 'cadet' });
    expect(fire(s, 'strike')).toBe(false);
    applySpawn(s, { type: 'teleport', to: 'strike' });
    step(s, neutralControls());
    expect(fire(s, 'strike')).toBe(true);
    expect(s.player.strikeLock).toBe('seeking');
    run(s, 60);
    expect(s.player.strikeLock).toBe('locked');
    expect(fire(s, 'strike')).toBe(true);
    expect(s.player.strike).toBe(1);
    run(s, 60 * 15);
    expect(s.target.alive).toBe(false);
    expect(s.phase).toBe('egress');
  });

  it('flares decoy missiles in training', () => {
    const s = createGame('training', { difficulty: 'pilot' });
    applySpawn(s, { type: 'missile', bearing: 180, range_km: 3 });
    step(s, neutralControls());
    expect(s.missiles.some(m => m.targetId === 'player')).toBe(true);
    fire(s, 'flare');
    expect(s.missiles.some(m => m.targetId === 'player')).toBe(false);
  });

  it('fuel exhaustion loses the mission', () => {
    const s = createGame('radar-breaker', { difficulty: 'pilot' });
    applySpawn(s, { type: 'set_fuel', fraction: 0.0005 });
    run(s, 60);
    expect(s.status).toBe('lost');
    expect(s.endReason).toBe('out of fuel');
  });
});

describe('missions', () => {
  for (const id of ['radar-breaker', 'iron-tide', 'bridge-fall']) {
    it(`cadet autopilot completes ${id}`, () => {
      const s = autopilotRun(id, 'cadet', 600);
      expect(s.status).toBe('won');
      const sc = computeScore(s);
      expect(sc.stars).toBeGreaterThanOrEqual(1);
      expect(sc.score).toBeGreaterThan(5000);
    });
  }
  it('training flight takes about a minute', () => {
    const s = autopilotRun('training', 'cadet', 200);
    expect(s.status).toBe('won');
    expect(s.t).toBeLessThan(120);
  });
});

describe('snapshot', () => {
  it('is compact and reports threats relative to the nose', () => {
    const s = createGame('radar-breaker', { difficulty: 'pilot' });
    applySpawn(s, { type: 'fighters', count: 2, range_km: 8 });
    applySpawn(s, { type: 'missile', bearing: -90, range_km: 3 });
    step(s, neutralControls());
    const snap = snapshot(s);
    expect(JSON.stringify(snap).length).toBeLessThan(4000);
    const missile = snap.threats.find(t => t.kind === 'missile');
    expect(missile?.level).toBe('red');
    expect(missile?.bearing).toBeLessThan(0);
    expect(snap.threats.filter(t => t.kind === 'fighter').length).toBeGreaterThanOrEqual(2);
  });
});

describe('route planning', () => {
  it('detours around a hazard on the direct line', () => {
    const plan = planRoute([0, 0], [20000, 0], [{ x: 10000, z: 1500, r: 6000, w: 1 }]);
    expect(plan.waypoint).not.toBeNull();
    expect(plan.label).toBe('north');
    expect(plan.exposure).toBeLessThan(plan.directExposure);
  });
  it('flies direct when nothing is in the way', () => {
    const plan = planRoute([0, 0], [20000, 0], []);
    expect(plan.waypoint).toBeNull();
    expect(plan.label).toBe('east');
  });
});
