import { describe, expect, it } from 'vitest';
import { applySpawn, createGame, neutralControls, setAutopilot, snapshot, step, type GameState } from '@crewstrike/game-core';
import type { AgentOutput, DifficultyName, GameSnapshot } from '@crewstrike/shared';
import { AgentRuntime, KEY_COOLDOWN_MS, newConsoleState, pick, wordCount, type Tagged } from '../src';

/** Step the game and tick agents at 10 Hz, like the worker does. */
function drive(s: GameState, rt: AgentRuntime, frames: number): AgentOutput[] {
  const outs: AgentOutput[] = [];
  let since = -1;
  for (let i = 0; i < frames; i++) {
    step(s, neutralControls());
    if (s.frame % 6 === 0) {
      const snap = snapshot(s, since);
      since = snap.now;
      outs.push(rt.tick(snap));
    }
  }
  return outs;
}

function game(d: DifficultyName = 'pilot'): GameState {
  return createGame('radar-breaker', { seed: 42, difficulty: d });
}

const f = (over: Partial<Tagged>): Tagged => ({ key: 'k', rank: 8, level: 'info', text: 'x', ttlMs: 4000, agent: 'mission', ...over });
const snapAt = (now: number, inCombat = false): GameSnapshot => ({ ...snapshot(game()), now, inCombat });

describe('arbiter', () => {
  it('picks by the fixed safety order', () => {
    const st = newConsoleState();
    const top = pick([f({ key: 'tip', rank: 8 }), f({ key: 'missile', rank: 2, level: 'red' }), f({ key: 'pull-up', rank: 1, level: 'red' })], st, snapAt(10000), 'tips');
    expect(top?.key).toBe('pull-up');
  });
  it('paces non-red lines to one every 2 seconds', () => {
    const st = newConsoleState();
    st.lastShownAt = 9000;
    expect(pick([f({ key: 'a', level: 'amber', rank: 5 })], st, snapAt(10000), 'tips')).toBeNull();
    expect(pick([f({ key: 'b', level: 'red', rank: 2 })], st, snapAt(10000), 'tips')?.key).toBe('b');
    expect(pick([f({ key: 'a', level: 'amber', rank: 5 })], st, snapAt(11001), 'tips')?.key).toBe('a');
  });
  it('keeps quiet in combat except red and amber', () => {
    const st = newConsoleState();
    expect(pick([f({ key: 'tip', level: 'info' })], st, snapAt(10000, true), 'tips')).toBeNull();
    expect(pick([f({ key: 'lock', level: 'amber', rank: 3 })], st, snapAt(10000, true), 'tips')?.key).toBe('lock');
  });
  it('dedupes keys shown recently', () => {
    const st = newConsoleState();
    st.recent.set('fuel', 5000);
    expect(pick([f({ key: 'fuel', level: 'amber' })], st, snapAt(5000 + KEY_COOLDOWN_MS - 1), 'tips')).toBeNull();
    expect(pick([f({ key: 'fuel', level: 'amber' })], st, snapAt(5000 + KEY_COOLDOWN_MS), 'tips')?.key).toBe('fuel');
  });
  it('critical chatter drops tips and route advice', () => {
    const st = newConsoleState();
    expect(pick([f({ key: 'tip', rank: 8 }), f({ key: 'route', rank: 7, level: 'amber' })], st, snapAt(10000), 'critical')).toBeNull();
  });
});

describe('agents', () => {
  it('low fuel lights the Flight agent and the fuel zone', () => {
    const s = game('pilot');
    const rt = new AgentRuntime('key');
    applySpawn(s, { type: 'set_fuel', fraction: 0.12 });
    const outs = drive(s, rt, 30);
    const line = outs.flatMap(o => o.lines).find(l => l.agent === 'flight');
    expect(line?.text).toMatch(/Fuel: \d+ min to exit/);
    expect(line?.zones).toContain('fuel');
    expect(outs.at(-1)?.active).toContain('flight');
  });

  it('a missile launch is a red radar line that stays until the danger is over', () => {
    const s = game('pilot');
    const rt = new AgentRuntime('key');
    drive(s, rt, 6);
    applySpawn(s, { type: 'missile', bearing: -90, range_km: 4 });
    let outs = drive(s, rt, 12);
    const red = outs.flatMap(o => o.lines).find(l => l.key === 'missile');
    expect(red?.level).toBe('red');
    expect(red?.agent).toBe('radar');
    expect(red?.text).toMatch(/Missile, (left|behind)! Flares\./);
    expect(red?.clip).toMatch(/^missile_/);
    // Still visible after its nominal lifetime while the missile flies.
    outs = drive(s, rt, 60 * 3);
    const stillThere = s.missiles.some(m => m.targetId === 'player');
    if (stillThere) expect(outs.at(-1)?.lines.some(l => l.key === 'missile')).toBe(true);
    // Defeat it and the line clears.
    for (const m of s.missiles) m.alive = false;
    s.missiles = [];
    outs = drive(s, rt, 60);
    expect(outs.at(-1)?.lines.some(l => l.key === 'missile')).toBe(false);
  });

  it('pull-up wins over everything else', () => {
    const s = createGame('radar-breaker', { seed: 42, difficulty: 'ace' });
    const rt = new AgentRuntime('critical');
    applySpawn(s, { type: 'missile', bearing: 180, range_km: 6 });
    applySpawn(s, { type: 'ground', agl: 120 });
    const outs = drive(s, rt, 6);
    expect(outs[0]?.fresh?.key).toBe('pull-up');
    expect(outs[0]?.fresh?.level).toBe('red');
  });

  it('every console line is eight words or fewer across a whole mission', () => {
    for (const d of ['cadet', 'pilot'] as const) {
      const s = createGame('bridge-fall', { seed: 3, difficulty: d });
      setAutopilot(s, true);
      const rt = new AgentRuntime('tips');
      const outs = drive(s, rt, 60 * 120);
      const texts = new Set(outs.flatMap(o => o.lines.map(l => l.text)));
      expect(texts.size).toBeGreaterThan(2);
      for (const t of texts) expect(wordCount(t), t).toBeLessThanOrEqual(8);
      expect(outs.every(o => o.lines.length <= 2)).toBe(true);
    }
  });

  it('keeps a history of the last 30 lines and status for every agent', () => {
    const s = game('cadet');
    setAutopilot(s, true);
    const rt = new AgentRuntime('tips');
    const outs = drive(s, rt, 60 * 90);
    expect(rt.st.history.length).toBeGreaterThan(0);
    expect(rt.st.history.length).toBeLessThanOrEqual(30);
    const status = outs.at(-1)!.status;
    expect(Object.keys(status).sort()).toEqual(['flight', 'mission', 'radar', 'weapons', 'weather', 'wingman']);
    expect(status.weapons).toMatch(/^Weapons: \d+ rounds/);
  });
});
