import { DEG, aim, clamp, dist, dist2d, forward, offBoresight, sub, wrapPi, type V3 } from './math';
import { chance, range } from './rng';
import { applyDamage } from './damage';
import { killEnemy, launchEnemyMissile } from './combat';
import { pushFx, type Enemy, type GameState } from './state';
import { surfaceHeight, terrainBlocks } from './terrain';
import { inActiveStorm } from './weather';

export function samRange(s: GameState): number {
  return 12000 * (0.85 + 0.3 * s.profile.enemySkill);
}
export const AAA_RADIUS = 3000;
export const SHIP_GUN_RADIUS = 4000;

/** Storms hide the player from enemy radar. */
function playerHidden(s: GameState): boolean {
  return inActiveStorm(s, s.player.pos);
}

function refreshLos(s: GameState, e: Enemy): void {
  e.losCheck -= 1;
  if (e.losCheck > 0) return;
  e.losCheck = 15;
  const from: V3 = [e.pos[0], e.pos[1] + 20, e.pos[2]];
  e.los = !terrainBlocks(s.mission.terrain, from, s.player.pos, 20);
}

function missileAlive(s: GameState, id: string | null): boolean {
  return !!id && s.missiles.some(m => m.id === id && m.alive);
}

/** Ground missile site logic shared by SAM sites and ships: idle, tracking, locked, launch, cooldown. */
function siteMissiles(s: GameState, e: Enemy, dt: number, rangeM: number): void {
  const skill = s.profile.enemySkill;
  const d = dist(e.pos, s.player.pos);
  refreshLos(s, e);
  const canSee = d < rangeM && e.los && !playerHidden(s) && s.player.agl > 40 && s.status === 'playing';
  e.cooldown -= dt;
  e.stateTimer += dt;
  switch (e.state) {
    case 'idle':
      if (canSee && e.cooldown <= 0 && !missileAlive(s, e.missileId)) {
        e.state = 'tracking';
        e.stateTimer = 0;
      }
      break;
    case 'tracking':
      if (!canSee) e.state = 'idle';
      else if (e.stateTimer > 3.5 - 2 * skill) {
        e.state = 'locked';
        e.stateTimer = 0;
      }
      break;
    case 'locked':
      if (!canSee) e.state = 'idle';
      else if (e.stateTimer > 2.6 - 1.2 * skill) {
        const m = launchEnemyMissile(s, [e.pos[0], e.pos[1] + 25, e.pos[2]], 'sam', e.id);
        e.missileId = m.id;
        e.state = 'launch';
        e.stateTimer = 0;
      }
      break;
    case 'launch':
      if (e.stateTimer > 1.5) {
        e.state = 'cooldown';
        e.cooldown = 13 - 6 * skill;
      }
      break;
    case 'cooldown':
      if (e.cooldown <= 0 && !missileAlive(s, e.missileId)) e.state = 'idle';
      break;
    default:
      e.state = 'idle';
  }
  if (e.state === 'tracking' || e.state === 'locked' || e.state === 'launch') s.inCombatUntil = Math.max(s.inCombatUntil, s.t + 3);
}

/** Flak: bursts near the player while inside the gun zone. */
function guns(s: GameState, e: Enemy, dt: number, radius: number): boolean {
  const p = s.player;
  const inside = dist2d(e.pos, p.pos) < radius && p.pos[1] - e.pos[1] < 3200 && !playerHidden(s) && s.status === 'playing';
  if (!inside) return false;
  e.gunAcc += dt;
  if (e.gunAcc >= 0.5) {
    e.gunAcc = 0;
    const skill = s.profile.enemySkill;
    const miss = 220 - 160 * skill;
    pushFx(s, 'flak', [p.pos[0] + range(s.rng, -miss, miss), p.pos[1] + range(s.rng, -miss, miss) * 0.5, p.pos[2] + range(s.rng, -miss, miss)]);
    if (chance(s.rng, 0.1 * (0.5 + skill))) applyDamage(s, 0.025, e.pos);
  }
  s.inCombatUntil = Math.max(s.inCombatUntil, s.t + 2);
  return true;
}

function steer(e: Enemy, wantHeading: number, wantPitch: number, turnRate: number, dt: number): void {
  const dh = wrapPi(wantHeading - e.heading);
  const yaw = clamp(dh, -turnRate * dt, turnRate * dt);
  e.heading = wrapPi(e.heading + yaw);
  e.bank += (clamp(dh * 1.5, -1.2, 1.2) - e.bank) * Math.min(1, dt * 3);
  e.pitch += clamp(wantPitch - e.pitch, -turnRate * 0.7 * dt, turnRate * 0.7 * dt);
  e.pitch = clamp(e.pitch, -0.6, 0.6);
}

function move(s: GameState, e: Enemy, dt: number, minAgl: number): void {
  const f = forward(e.heading, e.pitch);
  e.vel = [f[0] * e.speed, f[1] * e.speed, f[2] * e.speed];
  e.pos[0] += e.vel[0] * dt;
  e.pos[1] += e.vel[1] * dt;
  e.pos[2] += e.vel[2] * dt;
  const g = surfaceHeight(s.mission.terrain, e.pos[0], e.pos[2]);
  if (e.pos[1] < g + minAgl) {
    e.pos[1] = g + minAgl;
    e.pitch = Math.max(e.pitch, 0.15);
  }
}

function fighter(s: GameState, e: Enemy, dt: number): void {
  const p = s.player;
  const skill = s.profile.enemySkill;
  const turn = 0.45 + 0.45 * skill;
  const d = dist(e.pos, p.pos);
  const hidden = playerHidden(s) && d > 2500;
  const detect = 9000 + 6000 * skill;
  e.cooldown -= dt;
  e.stateTimer += dt;

  // Threatened by a player missile: break hard.
  const threat = s.missiles.find(m => m.alive && m.owner === 'player' && m.targetId === e.id && dist(m.pos, e.pos) < 2500);
  if (threat && e.state !== 'cooldown') {
    if (e.state !== 'idle') {
      // 'idle' marks an evasion already in progress.
      e.state = 'idle';
      e.stateTimer = 0;
      if (chance(s.rng, 0.4 * skill)) {
        threat.targetId = null;
        pushFx(s, 'hit', e.pos);
      }
    }
  }
  if (e.hp < e.hpMax * 0.3 && e.state !== 'cooldown') {
    e.state = 'cooldown';
    e.stateTimer = 0;
  }

  let wantH = e.heading;
  let wantP = 0;
  let speed = 230;
  const toP = aim(e.pos, p.pos);
  switch (e.state) {
    case 'patrol': {
      const toHome = aim(e.pos, e.home);
      const dh = dist2d(e.pos, e.home);
      wantH = dh > 3000 ? toHome.heading : e.heading + 0.4;
      wantP = clamp((e.home[1] - e.pos[1]) / 1500, -0.3, 0.3);
      if (!hidden && d < detect && s.status === 'playing') {
        e.state = 'chase';
        e.stateTimer = 0;
      }
      break;
    }
    case 'chase': {
      const lead: V3 = [p.pos[0] + p.vel[0] * 1.5, p.pos[1] + p.vel[1] * 1.5, p.pos[2] + p.vel[2] * 1.5];
      const a = aim(e.pos, lead);
      wantH = a.heading;
      wantP = a.pitch;
      speed = 270;
      if (hidden && e.stateTimer > 5) e.state = 'patrol';
      const off = offBoresight(e.pos, forward(e.heading, e.pitch), p.pos);
      if (d < 4800 && off < 35 * DEG) {
        e.state = 'attack';
        e.stateTimer = 0;
      }
      s.inCombatUntil = Math.max(s.inCombatUntil, d < 7000 ? s.t + 2 : s.inCombatUntil);
      break;
    }
    case 'attack': {
      wantH = toP.heading;
      wantP = toP.pitch;
      speed = 250;
      const off = offBoresight(e.pos, forward(e.heading, e.pitch), p.pos);
      if (d > 7000 || off > 70 * DEG) {
        e.state = 'chase';
        e.stateTimer = 0;
      }
      // Locking takes a moment, which gives the player a "locking" warning first.
      if (e.state === 'attack' && !e.passive && e.cooldown <= 0 && d > 1100 && d < 5000 && off < 25 * DEG && e.stateTimer > 1.8 - skill) {
        const m = launchEnemyMissile(s, e.pos, 'air', e.id);
        e.missileId = m.id;
        e.cooldown = 14 - 8 * skill;
        e.state = 'idle';
        e.stateTimer = -1;
      }
      // Make passes instead of sitting on the player's tail: break off when too close or after a while.
      if (e.state === 'attack' && (d < 650 || e.stateTimer > 7)) {
        e.state = 'idle';
        e.stateTimer = 0;
      }
      if (d < 1100 && off < 8 * DEG && !e.passive) {
        e.gunAcc += dt;
        if (e.gunAcc > 0.4) {
          e.gunAcc = 0;
          if (chance(s.rng, 0.35 * skill)) applyDamage(s, 0.03, e.pos);
        }
      }
      s.inCombatUntil = Math.max(s.inCombatUntil, s.t + 3);
      break;
    }
    case 'idle': {
      // Evading: turn away from the player at full speed for three seconds.
      wantH = toP.heading + Math.PI * 0.7;
      wantP = 0.1;
      speed = 310;
      if (e.stateTimer > 3.5) {
        e.state = 'chase';
        e.stateTimer = 0;
      }
      break;
    }
    case 'cooldown': {
      // Retreat on damage, then return to patrol somewhere new.
      wantH = toP.heading + Math.PI;
      wantP = 0.05;
      speed = 280;
      if (e.stateTimer > 20) {
        e.home = [e.pos[0], Math.max(1500, e.pos[1]), e.pos[2]];
        e.state = 'patrol';
        e.hp = Math.max(e.hp, e.hpMax * 0.31);
      }
      break;
    }
    default:
      e.state = 'patrol';
  }
  e.speed += (speed - e.speed) * Math.min(1, dt);
  steer(e, wantH, wantP, turn, dt);
  move(s, e, dt, 200);
}

function drone(s: GameState, e: Enemy, dt: number): void {
  const p = s.player;
  const skill = s.profile.enemySkill;
  const d = dist(e.pos, p.pos);
  let wantH: number;
  let wantP: number;
  if (e.passive) {
    // Training drone: slow lazy circle.
    wantH = e.heading + 0.15;
    wantP = clamp((e.home[1] - e.pos[1]) / 500, -0.2, 0.2);
    e.speed = 90;
  } else if (d < 8000 && !playerHidden(s) && s.status === 'playing') {
    e.state = 'chase';
    const a = aim(e.pos, p.pos);
    wantH = a.heading;
    wantP = a.pitch;
    e.speed = 175;
  } else {
    e.state = 'patrol';
    const toHome = aim(e.pos, e.home);
    wantH = dist2d(e.pos, e.home) > 1500 ? toHome.heading : e.heading + 0.5;
    wantP = clamp((e.home[1] - e.pos[1]) / 600, -0.2, 0.2);
    e.speed = 140;
  }
  // Separation from the rest of the swarm.
  for (const o of s.enemies) {
    if (o === e || !o.alive || o.groupId !== e.groupId) continue;
    const dd = dist(o.pos, e.pos);
    if (dd < 70 && dd > 0.1) {
      const away = sub(e.pos, o.pos);
      e.pos[0] += (away[0] / dd) * 20 * dt;
      e.pos[1] += (away[1] / dd) * 10 * dt;
      e.pos[2] += (away[2] / dd) * 20 * dt;
    }
  }
  steer(e, wantH, wantP, 1.1, dt);
  move(s, e, dt, 80);
  if (e.passive || s.status !== 'playing') return;
  if (d < 22) {
    applyDamage(s, 0.06, e.pos);
    killEnemy(s, e, 'other');
    return;
  }
  if (d < 500 && offBoresight(e.pos, forward(e.heading, e.pitch), p.pos) < 15 * DEG) {
    e.gunAcc += dt;
    if (e.gunAcc > 0.5) {
      e.gunAcc = 0;
      if (chance(s.rng, 0.25 * skill)) applyDamage(s, 0.015, e.pos);
    }
  }
  if (e.state === 'chase' && d < 3000) s.inCombatUntil = Math.max(s.inCombatUntil, s.t + 2);
}

export function updateEnemies(s: GameState, dt: number): void {
  for (const e of s.enemies) {
    if (!e.alive) continue;
    e.prevPos[0] = e.pos[0];
    e.prevPos[1] = e.pos[1];
    e.prevPos[2] = e.pos[2];
    switch (e.kind) {
      case 'fighter':
        fighter(s, e, dt);
        break;
      case 'drone':
        drone(s, e, dt);
        break;
      case 'sam':
        siteMissiles(s, e, dt, samRange(s));
        break;
      case 'aaa':
        e.state = guns(s, e, dt, AAA_RADIUS) ? 'tracking' : 'idle';
        break;
      case 'ship': {
        siteMissiles(s, e, dt, 14000 * (0.85 + 0.3 * s.profile.enemySkill));
        guns(s, e, dt, SHIP_GUN_RADIUS);
        break;
      }
    }
  }
}
