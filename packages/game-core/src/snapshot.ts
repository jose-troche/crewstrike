import type { GameEvent, GameSnapshot, Level, Threat, ThreatState } from '@crewstrike/shared';
import { enemyById, inStrikeZone, strikeAvailable } from './combat';
import { AAA_RADIUS, SHIP_GUN_RADIUS, samRange } from './enemies';
import { autopilotAllowed, fuelToExit, isInCombat, minutesToExit } from './flight';
import { DEG, compass, dist, dist2d, wrap180 } from './math';
import { liveScore, starsSoFar } from './score';
import { FLARES_MAX, MISSILES_MAX, ROUNDS_MAX, TRAINING_STEPS, type Enemy, type GameState } from './state';
import { nearestStorm } from './weather';

const r1 = (v: number): number => Math.round(v * 10) / 10;

function threatOf(s: GameState, e: Enemy): Threat | null {
  const p = s.player;
  const d = dist(p.pos, e.pos);
  const km = d / 1000;
  const comp = compass(p.pos, e.pos);
  const bearing = wrap180(comp - p.heading / DEG);
  const base = { id: e.id, compass: Math.round(comp), bearing: Math.round(bearing), km: r1(km) };
  let state: ThreatState = e.state;
  let level: Level = 'info';
  let danger = 0;
  switch (e.kind) {
    case 'fighter':
      if (km > 25) return null;
      if (e.state === 'attack') {
        state = e.stateTimer > 0.3 ? 'locked' : 'attack';
        level = 'amber';
        danger = 0.9;
      } else if (e.state === 'chase' || e.state === 'idle') {
        state = 'chase';
        level = 'amber';
        danger = 0.8;
      } else {
        state = 'patrol';
        danger = e.state === 'cooldown' ? 0.2 : 0.4;
      }
      return { ...base, kind: 'fighter', state, level, danger };
    case 'sam':
    case 'ship': {
      const rng = e.kind === 'sam' ? samRange(s) : 14000;
      if (d > rng * 1.4 && e.state === 'idle') return null;
      if (e.state === 'tracking' || e.state === 'locked') level = 'amber';
      else if (e.state === 'launch') level = 'red';
      if (e.kind === 'ship' && dist2d(p.pos, e.pos) < SHIP_GUN_RADIUS) level = level === 'red' ? 'red' : 'amber';
      danger = e.state === 'idle' || e.state === 'cooldown' ? (d < rng ? 0.5 : 0.25) : 0.9;
      return { ...base, kind: e.kind, state, level, danger };
    }
    case 'aaa': {
      if (km > 8) return null;
      const inside = dist2d(p.pos, e.pos) < AAA_RADIUS;
      return { ...base, kind: 'aaa', state: inside ? 'tracking' : 'idle', level: inside ? 'amber' : 'info', danger: inside ? 0.5 : 0.25 };
    }
    default:
      return null;
  }
}

/** Compact snapshot for the agents and the NL pipeline; events newer than `sinceMs` are included. */
export function snapshot(s: GameState, sinceMs = -1): GameSnapshot {
  const p = s.player;
  const threats: Threat[] = [];
  const swarms = new Map<string, Enemy[]>();
  for (const e of s.enemies) {
    if (!e.alive || e.isTarget) continue;
    if (e.kind === 'drone') {
      if (e.passive) continue;
      const key = e.groupId ?? e.id;
      const arr = swarms.get(key);
      if (arr) arr.push(e);
      else swarms.set(key, [e]);
      continue;
    }
    const t = threatOf(s, e);
    if (t) threats.push(t);
  }
  // The warship target shoots back too.
  for (const e of s.enemies) {
    if (!e.alive || !e.isTarget) continue;
    const t = threatOf(s, e);
    if (t) threats.push(t);
  }
  for (const [, group] of swarms) {
    let nearest = group[0] as Enemy;
    for (const e of group) if (dist(p.pos, e.pos) < dist(p.pos, nearest.pos)) nearest = e;
    const km = dist(p.pos, nearest.pos) / 1000;
    if (km > 14) continue;
    const comp = compass(p.pos, nearest.pos);
    const chasing = group.some(e => e.state === 'chase');
    threats.push({
      id: nearest.groupId ?? nearest.id,
      kind: 'drone',
      state: chasing ? 'chase' : 'patrol',
      level: chasing ? 'amber' : 'info',
      bearing: Math.round(wrap180(comp - p.heading / DEG)),
      compass: Math.round(comp),
      km: r1(km),
      danger: Math.min(0.9, 0.1 * group.length),
      count: group.length,
    });
  }
  for (const m of s.missiles) {
    if (!m.alive || m.targetId !== 'player') continue;
    const d = dist(p.pos, m.pos);
    const comp = compass(p.pos, m.pos);
    threats.push({
      id: m.id,
      kind: 'missile',
      state: 'inbound',
      level: 'red',
      bearing: Math.round(wrap180(comp - p.heading / DEG)),
      compass: Math.round(comp),
      km: r1(d / 1000),
      danger: 1,
      tti: r1(d / Math.max(80, m.speed - p.speed * 0.3)),
    });
  }
  threats.sort((a, b) => b.danger - a.danger || a.km - b.km);
  if (threats.length > 10) threats.length = 10;

  const tgt = s.target;
  const zone = s.mission.strikeZone;
  const exit = s.mission.exit;
  const storm = nearestStorm(s, p.pos);
  const lockT = enemyById(s, p.lockTargetId);
  const events: GameEvent[] = s.events.filter(e => e.at > sinceMs);
  const tr = s.training;
  const trStep = tr ? TRAINING_STEPS[tr.step] : null;
  const [windFrom, windKt] = s.mission.weather.windKt;
  const stormKm = storm ? Math.max(0, storm.edgeM) / 1000 : null;
  const closing = storm ? (storm.storm.vel[0] ** 2 + storm.storm.vel[1] ** 2) ** 0.5 : 0;

  return {
    now: Math.round(s.t * 1000),
    missionId: s.mission.id,
    missionTitle: s.mission.title,
    difficulty: s.difficulty,
    phase: s.phase,
    status: s.status,
    training: !!tr,
    inCombat: isInCombat(s),
    own: {
      pos: [Math.round(p.pos[0]), Math.round(p.pos[1]), Math.round(p.pos[2])],
      heading: Math.round(((p.heading / DEG) % 360 + 360) % 360),
      pitch: Math.round(p.pitch / DEG),
      bank: Math.round(p.bank / DEG),
      speed: Math.round(p.speed),
      throttle: p.throttle,
      boost: p.boost,
      boostPct: r1(p.boostEnergy),
      agl: Math.round(p.agl),
      alt: Math.round(p.pos[1]),
      climbRate: Math.round(p.climbRate),
      stalled: p.stalled,
      stallWarn: p.stallWarn,
      groundWarn: p.groundWarn,
      autopilot: p.autopilot,
      autopilotAllowed: autopilotAllowed(s),
      route: p.route,
    },
    fuel: { kg: Math.round(p.fuel), maxKg: p.fuelMax, fraction: Math.round((p.fuel / p.fuelMax) * 1000) / 1000, needToExitKg: Math.round(fuelToExit(s)) },
    damage: Math.round(p.damage * 100) / 100,
    sections: {
      nose: r1(p.sections.nose), body: r1(p.sections.body), leftWing: r1(p.sections.leftWing),
      rightWing: r1(p.sections.rightWing), tail: r1(p.sections.tail),
    },
    weapons: {
      rounds: p.rounds,
      roundsMax: ROUNDS_MAX,
      cannonPct: Math.round((p.rounds / ROUNDS_MAX) * 100) / 100,
      missiles: p.missiles,
      missilesMax: MISSILES_MAX,
      strike: p.strike,
      flares: p.flares,
      flaresMax: FLARES_MAX,
      selected: p.selected,
      lock: p.lockState,
      lockTargetId: p.lockTargetId,
      lockKm: lockT ? r1(dist(p.pos, lockT.pos) / 1000) : null,
      strikeLock: p.strikeLock,
      strikeAvailable: strikeAvailable(s),
    },
    nav: {
      objective: tgt.alive ? 'target' : 'exit',
      kmToTarget: r1(dist2d(p.pos, tgt.pos) / 1000),
      targetBearing: Math.round(wrap180(compass(p.pos, tgt.pos) - p.heading / DEG)),
      kmToExit: r1(dist2d(p.pos, exit.center) / 1000),
      exitBearing: Math.round(wrap180(compass(p.pos, exit.center) - p.heading / DEG)),
      minutesToExit: r1(minutesToExit(s)),
      inStrikeZone: inStrikeZone(s),
      inExit: dist2d(p.pos, exit.center) < exit.radius,
      kmToStrikeZone: r1(Math.max(0, dist2d(p.pos, zone.center) - zone.radius) / 1000),
    },
    threats,
    weather: {
      windFrom,
      windKt,
      inStorm: s.inStorm,
      stormKm: stormKm === null ? null : r1(stormKm),
      stormBearing: storm ? Math.round(wrap180(compass(p.pos, storm.storm.pos) - p.heading / DEG)) : null,
      stormEtaS: storm && storm.edgeM > 0 ? Math.round(storm.edgeM / Math.max(1, p.speed + closing)) : null,
    },
    target: { alive: tgt.alive, hp: r1(tgt.hp), hpMax: tgt.hpMax, kind: tgt.kind, name: tgt.name },
    score: { score: liveScore(s), kills: s.score.kills, elapsedS: Math.round(s.t), stars: starsSoFar(s) },
    events,
    trainingStep: tr && trStep
      ? { index: Math.min(tr.step, TRAINING_STEPS.length - 2), total: TRAINING_STEPS.length - 1, text: trStep.text, control: trStep.control }
      : null,
  };
}

