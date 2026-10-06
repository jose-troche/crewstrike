import { DEG, forward, type V3 } from './math';
import { launchEnemyMissile, damageTarget } from './combat';
import { applyDamage } from './damage';
import { makeEnemy, newId, type GameState } from './state';
import { surfaceHeight } from './terrain';

/** Scripted events for test hooks and the training flight. */
export type SpawnEvent =
  | { type: 'set_fuel'; fraction: number }
  | { type: 'fighters'; count: number; range_km: number; bearing?: number }
  | { type: 'drones'; count: number; range_km: number; bearing?: number }
  | { type: 'missile'; bearing?: number; range_km?: number }
  | { type: 'damage'; amount: number }
  | { type: 'ground'; agl: number }
  | { type: 'ammo'; rounds?: number; missiles?: number; flares?: number }
  | { type: 'storm'; range_km: number; bearing?: number; radius_km?: number }
  | { type: 'teleport'; to: 'strike' | 'exit' | 'target_near' }
  | { type: 'kill_target' }
  | { type: 'sam_lock' };

function pointAt(s: GameState, rangeKm: number, relBearingDeg: number, dy = 0): V3 {
  const p = s.player;
  const h = p.heading + relBearingDeg * DEG;
  const f = forward(h, 0);
  return [p.pos[0] + f[0] * rangeKm * 1000, p.pos[1] + dy, p.pos[2] + f[2] * rangeKm * 1000];
}

export function applySpawn(s: GameState, ev: SpawnEvent): void {
  const p = s.player;
  switch (ev.type) {
    case 'set_fuel':
      p.fuel = Math.max(0, Math.min(1, ev.fraction)) * p.fuelMax;
      break;
    case 'fighters':
      for (let i = 0; i < ev.count; i++) {
        const e = makeEnemy(s, 'fighter', pointAt(s, ev.range_km, (ev.bearing ?? 0) + (i - (ev.count - 1) / 2) * 8, 200));
        e.state = 'chase';
        e.heading = p.heading + Math.PI;
        s.enemies.push(e);
      }
      break;
    case 'drones': {
      const gid = newId(s, 'g');
      const c = pointAt(s, ev.range_km, ev.bearing ?? 0);
      for (let i = 0; i < ev.count; i++) s.enemies.push(makeEnemy(s, 'drone', [c[0] + i * 40, c[1] + (i % 3) * 20, c[2] + i * 30], gid));
      break;
    }
    case 'missile':
      launchEnemyMissile(s, pointAt(s, ev.range_km ?? 3, ev.bearing ?? 180, 100), 'air', null);
      break;
    case 'damage':
      applyDamage(s, ev.amount / s.profile.damageTaken, null);
      break;
    case 'ground': {
      const g = surfaceHeight(s.mission.terrain, p.pos[0], p.pos[2]);
      p.pos[1] = g + ev.agl;
      p.agl = ev.agl;
      p.pitch = -0.35;
      break;
    }
    case 'ammo':
      if (ev.rounds !== undefined) p.rounds = ev.rounds;
      if (ev.missiles !== undefined) p.missiles = ev.missiles;
      if (ev.flares !== undefined) p.flares = ev.flares;
      break;
    case 'storm': {
      const c = pointAt(s, ev.range_km, ev.bearing ?? 0);
      s.storms.push({ pos: [c[0], 0, c[2]], radius: (ev.radius_km ?? 3) * 1000, vel: [0, 0], active: true, spawnPhase: null });
      break;
    }
    case 'teleport': {
      const z = ev.to === 'exit' ? s.mission.exit.center : s.mission.strikeZone.center;
      const off = ev.to === 'strike' ? s.mission.strikeZone.radius * 0.6 : ev.to === 'target_near' ? 2500 : 0;
      const t = s.target.pos;
      const dx = p.pos[0] - t[0];
      const dz = p.pos[2] - t[2];
      const d = Math.hypot(dx, dz) || 1;
      const x = ev.to === 'exit' ? z[0] : t[0] + (dx / d) * off;
      const zz = ev.to === 'exit' ? z[2] : t[2] + (dz / d) * off;
      const g = surfaceHeight(s.mission.terrain, x, zz);
      p.pos = [x, Math.max(g + 700, p.pos[1]), zz];
      p.prevPos = [...p.pos];
      p.heading = Math.atan2(t[0] - x, -(t[2] - zz));
      p.prevHeading = p.heading;
      break;
    }
    case 'kill_target':
      damageTarget(s, s.target.hp);
      break;
    case 'sam_lock': {
      const sam = s.enemies.find(e => e.alive && (e.kind === 'sam' || e.kind === 'ship'));
      if (sam) {
        sam.state = 'locked';
        sam.stateTimer = 0;
        sam.los = true;
        sam.losCheck = 600;
      }
      break;
    }
  }
}
