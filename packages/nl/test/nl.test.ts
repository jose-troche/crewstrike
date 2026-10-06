import { describe, expect, it } from 'vitest';
import { applySpawn, createGame, neutralControls, snapshot, step } from '@crewstrike/game-core';
import type { CommandSink, GameSnapshot } from '@crewstrike/shared';
import {
  advise, classify, handle, normalize, templateReason, templateRecap, validateReason, validateRecap,
} from '../src';

function sink(): CommandSink & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fire: w => calls.push(`fire:${w}`),
    setBoost: on => calls.push(`boost:${on}`),
    setThrottle: l => calls.push(`throttle:${l}`),
    cycleTarget: m => calls.push(`target:${m}`),
    setAutopilot: on => calls.push(`autopilot:${on}`),
    setRoute: r => calls.push(`route:${r}`),
    setVoice: m => calls.push(`voice:${m}`),
    pause: () => calls.push('pause'),
    resume: () => calls.push('resume'),
  };
}

function snap(mut?: (s: ReturnType<typeof createGame>) => void): GameSnapshot {
  const s = createGame('radar-breaker', { seed: 42, difficulty: 'pilot' });
  mut?.(s);
  step(s, neutralControls());
  return snapshot(s);
}

describe('normalize', () => {
  it('lowercases, maps numbers and synonyms, strips filler', () => {
    expect(normalize('Hey wingman, pop CHAFF please')).toBe('pop flares');
    expect(normalize('Two bogeys?')).toBe('2 enemy?');
    expect(normalize('Can you engage autopilot')).toBe('engage autopilot');
    expect(normalize('RTB')).toBe('home');
  });
});

describe('instant commands', () => {
  const cases: [string, string, string][] = [
    ['Flares', 'fire:flare', 'Flares'],
    ['boost', 'boost:true', 'Boost'],
    ['next target', 'target:nearest', 'Target'],
    ['autopilot on', 'autopilot:true', 'Autopilot on'],
    ['Autopilot off.', 'autopilot:false', 'Autopilot off'],
    ['go to target', 'route:target', 'Routing to target'],
    ['head home', 'route:exit', 'Routing home'],
    ['RTB', 'route:exit', 'Routing home'],
    ['voice off', 'voice:off', 'Voice off'],
    ['pause', 'pause', 'Paused'],
    ['go north', 'route:north', 'Routing north'],
    ['full throttle', 'throttle:2', 'Throttle fast'],
    ['fox two', 'fire:missile', 'Missile away'],
  ];
  for (const [text, call, confirm] of cases) {
    it(`"${text}" executes and confirms`, () => {
      const g = sink();
      const r = handle(text, snap(), g);
      expect(r).toEqual({ kind: 'command', confirm });
      expect(g.calls).toEqual([call]);
    });
  }
});

describe('tactical and how-to answers', () => {
  it('answers from game state and names the gauge to glow', () => {
    const g = sink();
    const s = snap();
    const fuel = handle('fuel?', s, g);
    expect(fuel.kind).toBe('tactical');
    if (fuel.kind === 'tactical') {
      expect(fuel.text).toMatch(/^Fuel \d+%, \d+ min to exit\.$/);
      expect(fuel.glow).toEqual(['fuel']);
    }
    const m = handle('how many missiles?', s, g);
    expect(m.kind === 'tactical' && m.text).toBe('6 missiles, 2 strike.');
    const where = handle("where's the target?", s, g);
    expect(where.kind === 'tactical' && where.text).toMatch(/^Target \d+\.\d km, \d+ o'clock\.$/);
    expect(g.calls).toEqual([]);
  });
  it('how-to questions return a help card with highlights', () => {
    const r = handle('How do I use the strike missile?', snap(), sink());
    expect(r.kind).toBe('howto');
    if (r.kind === 'howto') {
      expect(r.text).toContain('press G');
      expect(r.highlight).toContain('weapon-strike');
    }
    const f = handle('how do flares work?', snap(), sink());
    expect(f.kind === 'howto' && f.highlight).toContain('flares');
  });
});

describe('strategic classifier and advisor', () => {
  it('classifies the five kinds', () => {
    expect(classify(normalize('Should I escape?'))).toBe('escape');
    expect(classify(normalize('Dogfight or avoid?'))).toBe('engage_or_avoid');
    expect(classify(normalize('This route or that one?'))).toBe('route_choice');
    expect(classify(normalize('Should I abort?'))).toBe('abort');
    expect(classify(normalize('Best way to hit the target?'))).toBe('attack_plan');
    expect(classify(normalize('fuel'))).toBeNull();
  });

  it('avoids two fighters with a weak loadout and offers a route', () => {
    const s = snap(g => {
      applySpawn(g, { type: 'fighters', count: 2, range_km: 8 });
      applySpawn(g, { type: 'ammo', missiles: 2 });
      applySpawn(g, { type: 'damage', amount: 0.3 });
    });
    const a = advise('engage_or_avoid', s);
    expect(a.verdict).toBe('AVOID');
    expect(a.action).toBe('route_safest');
    expect(a.actionLabel).toMatch(/^Set route (north|south|east|west)\?$/);
    expect(validateReason(a.reason, a.verdict, a.facts).ok).toBe(true);
  });

  it('engages when strong against a weak threat', () => {
    const s = snap(g => applySpawn(g, { type: 'drones', count: 2, range_km: 3 }));
    expect(advise('engage_or_avoid', s).verdict).toBe('ENGAGE');
  });

  it('aborts on low fuel or heavy damage regardless of the question', () => {
    const s = snap(g => applySpawn(g, { type: 'damage', amount: 0.8 }));
    const a = advise('engage_or_avoid', s);
    expect(a.verdict).toBe('ABORT');
    expect(a.actionLabel).toBe('Set route home?');
  });

  it('strategic questions come through the pipeline with a verdict and template reason', () => {
    const r = handle('should I dogfight or avoid them?', snap(g => applySpawn(g, { type: 'fighters', count: 2, range_km: 8 })), sink());
    expect(r.kind).toBe('strategic');
    if (r.kind === 'strategic') {
      expect(['AVOID', 'ENGAGE']).toContain(r.advice.verdict);
      expect(r.advice.reason.split(/\s+/).length).toBeLessThanOrEqual(15);
      expect(r.advice.source).toBe('template');
    }
  });
});

describe('guardrails', () => {
  const facts = { missiles: 2, damagePct: 30, fuelPct: 64, threats: 2, route: 'north' };
  it('accepts numbers from the facts', () => {
    expect(validateReason('Two fighters, you have 2 missiles and 30% damage. Go north.', 'AVOID', facts).ok).toBe(true);
  });
  it('rejects invented numbers, long answers and contradicting verdicts', () => {
    expect(validateReason('You have 5 missiles, take them.', 'AVOID', facts).ok).toBe(false);
    expect(validateReason('word '.repeat(16), 'AVOID', facts).ok).toBe(false);
    expect(validateReason('You should engage them now.', 'AVOID', facts).ok).toBe(false);
  });
  it('every template reason passes its own guardrail', () => {
    for (const v of ['ENGAGE', 'AVOID', 'ESCAPE', 'ABORT', 'CONTINUE', 'REROUTE'] as const) {
      const f = { ...facts, strength: 1.2, threat: 1.6 };
      expect(validateReason(templateReason(v, f), v, f), v).toEqual({ ok: true });
    }
  });
  it('recaps are three lines and validated', () => {
    const f = { outcome: 'won', mission: 'Radar Breaker', stars: 3, score: 9800, kills: 2, damagePct: 10, durationS: 245, missilesLeft: 4, strikeLeft: 1 };
    const lines = templateRecap(f);
    expect(lines).toHaveLength(3);
    expect(validateRecap(lines, f)).toEqual(lines);
    expect(validateRecap(['a', 'b'], f)).toBeNull();
    expect(validateRecap(['Score 12345.', 'b', 'c'], f)).toBeNull();
  });
});
