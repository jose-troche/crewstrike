import type { WeaponId } from '@crewstrike/shared';
import type { ControlState } from './controls';
import {
  DEG, aim, add, clamp, compass, dist, dist2d, forward, norm, offBoresight, scale, segPointDist2, sub, wrap180, wrapPi, type V3,
} from './math';
import { chance, range } from './rng';
import { applyDamage } from './damage';
import {
  newId, pushEvent, pushFx, type Enemy, type GameState, type Missile,
} from './state';
import { surfaceHeight } from './terrain';

const BULLET_SPEED = 1100;
const HIT_RADIUS: Record<Enemy['kind'], number> = { fighter: 24, drone: 14, sam: 45, aaa: 35, ship: 90 };
const KILL_POINTS: Record<Enemy['kind'], number> = { fighter: 400, drone: 100, sam: 300, aaa: 200, ship: 500 };

// ---- spatial hash, rebuilt each step ----

const CELL = 2000;
export class SpatialHash {
  private cells = new Map<string, Enemy[]>();
  rebuild(list: Enemy[]): void {
    this.cells.clear();
    for (const e of list) {
      if (!e.alive) continue;
      const k = `${Math.floor(e.pos[0] / CELL)},${Math.floor(e.pos[2] / CELL)}`;
      const arr = this.cells.get(k);
      if (arr) arr.push(e);
      else this.cells.set(k, [e]);
    }
  }
  near(pos: V3, radius: number): Enemy[] {
    const out: Enemy[] = [];
    const r = Math.ceil(radius / CELL);
    const cx = Math.floor(pos[0] / CELL);
    const cz = Math.floor(pos[2] / CELL);
    for (let i = -r; i <= r; i++)
      for (let j = -r; j <= r; j++) {
        const arr = this.cells.get(`${cx + i},${cz + j}`);
        if (arr) out.push(...arr);
      }
    return out;
  }
}
const hashes = new WeakMap<GameState, SpatialHash>();
export function spatial(s: GameState): SpatialHash {
  let h = hashes.get(s);
  if (!h) {
    h = new SpatialHash();
    hashes.set(s, h);
  }
  return h;
}

// ---- kills ----

export function killEnemy(s: GameState, e: Enemy, by: 'player' | 'other' = 'player'): void {
  if (!e.alive) return;
  e.alive = false;
  e.hp = 0;
  pushFx(s, e.kind === 'ship' || e.kind === 'sam' ? 'big_explosion' : 'explosion', e.pos);
  if (by === 'player') {
    s.score.kills += 1;
    s.score.killPoints += KILL_POINTS[e.kind];
    pushEvent(s, { type: 'kill', detail: e.kind });
  }
}

export function damageEnemy(s: GameState, e: Enemy, amount: number): void {
  if (!e.alive) return;
  e.hp -= amount;
  if (e.hp <= 0) killEnemy(s, e);
}

export function damageTarget(s: GameState, amount: number): void {
  const t = s.target;
  if (!t.alive) return;
  t.hp = Math.max(0, t.hp - amount);
  pushEvent(s, { type: 'target_hit', detail: t.hp.toFixed(2) });
  if (t.hp <= 0.0001) {
    t.alive = false;
    pushFx(s, 'big_explosion', t.pos);
    pushEvent(s, { type: 'target_destroyed' });
    for (const e of s.enemies) if (e.isTarget) killEnemy(s, e, 'other');
    if (s.player.route === 'target') s.player.route = 'exit';
    s.player.waypoint = null;
    s.player.strikeLock = 'none';
  }
}

// ---- targeting helpers ----

function isAir(e: Enemy): boolean {
  return e.kind === 'fighter' || e.kind === 'drone';
}

/** Best target near the boresight (for aim assist and heat-seeker locks). */
export function boresightTarget(s: GameState, coneRad: number, maxRange: number, air = true): Enemy | null {
  const p = s.player;
  const dir = forward(p.heading, p.pitch);
  let best: Enemy | null = null;
  let bestScore = Infinity;
  for (const e of s.enemies) {
    if (!e.alive || (air && !isAir(e))) continue;
    const d = dist(p.pos, e.pos);
    if (d > maxRange || d < 50) continue;
    const off = offBoresight(p.pos, dir, e.pos);
    if (off > coneRad) continue;
    const score = off * 3 + d / maxRange;
    if (score < bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

export function lockCone(s: GameState): number {
  return (6 + s.profile.aimAssist * 20) * DEG;
}

export function lockTime(s: GameState): number {
  return 1.0 * (1 - 0.45 * s.profile.aimAssist);
}

export const LOCK_RANGE = 6000;
export const STRIKE_LOCK_TIME = 1.2;

/** Lead point for the cannon: where to aim so bullets meet the target. */
export function leadPoint(s: GameState, e: { pos: V3; vel: V3 }): V3 {
  const d = dist(s.player.pos, e.pos);
  const t = d / BULLET_SPEED;
  return add(e.pos, scale(e.vel, t));
}

export function enemyById(s: GameState, id: string | null): Enemy | null {
  if (!id) return null;
  for (const e of s.enemies) if (e.id === id) return e;
  return null;
}

// ---- player weapons ----

function fireCannon(s: GameState, dt: number, held: boolean): void {
  const p = s.player;
  if (!held || p.rounds <= 0) {
    p.cannonAcc = 1;
    return;
  }
  p.cannonAcc += dt * 20;
  const dir0 = forward(p.heading, p.pitch);
  let dir = dir0;
  const assist = s.profile.aimAssist;
  if (assist > 0) {
    const tgt = boresightTarget(s, assist * 7 * DEG, 2500, false);
    if (tgt) dir = norm(sub(leadPoint(s, tgt), p.pos));
  }
  while (p.cannonAcc >= 1 && p.rounds > 0) {
    p.cannonAcc -= 1;
    p.rounds -= 1;
    const spread: V3 = [range(s.rng, -0.004, 0.004), range(s.rng, -0.004, 0.004), range(s.rng, -0.004, 0.004)];
    const v = add(scale(norm(add(dir, spread)), BULLET_SPEED), p.vel);
    const muzzle = add(p.pos, scale(dir0, 12));
    s.bullets.push({ pos: muzzle, prevPos: [...muzzle], vel: v, life: 1.6 });
  }
  p.lastFiredAt = s.t;
}

export function fireMissile(s: GameState): boolean {
  const p = s.player;
  if (p.missiles <= 0) return false;
  p.missiles -= 1;
  p.selected = 'missile';
  const target = p.lockState === 'locked' ? p.lockTargetId : boresightTarget(s, 10 * DEG, LOCK_RANGE)?.id ?? null;
  const m: Missile = {
    id: newId(s, 'm'),
    kind: 'heat',
    owner: 'player',
    launcherId: null,
    pos: add(p.pos, [0, -3, 0]),
    prevPos: [...p.pos],
    vel: [...p.vel],
    heading: p.heading,
    pitch: p.pitch,
    speed: p.speed,
    maxSpeed: 680,
    turnRate: 1.7,
    targetId: target,
    age: 0,
    life: 8,
    alive: true,
    arc: null,
    decoyed: false,
  };
  s.missiles.push(m);
  p.lockState = 'none';
  p.lockTimer = 0;
  p.lastFiredAt = s.t;
  pushEvent(s, { type: 'fired', detail: 'missile' });
  return true;
}

export function inStrikeZone(s: GameState): boolean {
  return dist2d(s.player.pos, s.mission.strikeZone.center) < s.mission.strikeZone.radius;
}

export function strikeAvailable(s: GameState): boolean {
  return inStrikeZone(s) && s.player.strike > 0 && s.target.alive;
}

/** G: first press starts the lock, a press when locked fires. */
export function pressStrike(s: GameState): 'locking' | 'fired' | 'unavailable' {
  const p = s.player;
  if (!strikeAvailable(s)) return 'unavailable';
  p.selected = 'strike';
  if (p.strikeLock === 'locked') {
    p.strike -= 1;
    const from: V3 = add(p.pos, [0, -4, 0]);
    const to: V3 = [...s.target.pos];
    const d = dist(from, to);
    s.missiles.push({
      id: newId(s, 'k'),
      kind: 'strike',
      owner: 'player',
      launcherId: null,
      pos: [...from],
      prevPos: [...from],
      vel: [...p.vel],
      heading: p.heading,
      pitch: p.pitch,
      speed: 420,
      maxSpeed: 420,
      turnRate: 0,
      targetId: 'target',
      age: 0,
      life: d / 420 + 1,
      alive: true,
      arc: { from, to, duration: Math.max(1.5, d / 420), height: Math.min(1500, d * 0.15) },
      decoyed: false,
    });
    p.strikeLock = 'none';
    p.strikeLockTimer = 0;
    p.lastFiredAt = s.t;
    pushEvent(s, { type: 'fired', detail: 'strike' });
    return 'fired';
  }
  if (p.strikeLock === 'none') {
    p.strikeLock = 'seeking';
    p.strikeLockTimer = 0;
  }
  return 'locking';
}

export function fireFlares(s: GameState): boolean {
  const p = s.player;
  if (p.flares <= 0 || p.flareCooldown > 0) return false;
  p.flares -= 1;
  p.flareCooldown = 0.4;
  const ids: string[] = [];
  for (const side of [-1, 1]) {
    const id = newId(s, 'f');
    ids.push(id);
    const right: V3 = [Math.cos(p.heading), 0, Math.sin(p.heading)];
    const v = add(scale(p.vel, 0.35), add(scale(right, side * 40), [0, -25, 0]));
    s.flares.push({ id, pos: [...p.pos], prevPos: [...p.pos], vel: v, life: 3 });
  }
  pushEvent(s, { type: 'flare' });
  // Each inbound missile gets one roll against this salvo.
  const maxYaw = 0.8 * clamp(230 / p.speed, 0.65, 1.4);
  const hardTurn = Math.min(1, Math.abs(p.yawRate) / maxYaw);
  for (const m of s.missiles) {
    if (!m.alive || m.targetId !== 'player') continue;
    const d = dist(m.pos, p.pos);
    if (d > 5000) continue;
    const aspect = Math.abs(wrap180(compass(p.pos, m.pos) - p.heading / DEG));
    const aspectBonus = aspect > 60 ? 0.25 : 0.1;
    let pDecoy = Math.min(0.92, 0.45 + aspectBonus + 0.2 * hardTurn);
    if (s.training) pDecoy = 1;
    if (chance(s.rng, pDecoy)) {
      m.targetId = ids[0] ?? null;
      m.decoyed = true;
      pushEvent(s, { type: 'decoyed' });
    }
  }
  return true;
}

export function cycleTarget(s: GameState): string | null {
  const p = s.player;
  const list = s.enemies
    .filter(e => e.alive && isAir(e) && dist(p.pos, e.pos) < 15000)
    .sort((a, b) => dist(p.pos, a.pos) - dist(p.pos, b.pos));
  if (list.length === 0) {
    p.lockTargetId = null;
    return null;
  }
  const i = list.findIndex(e => e.id === p.lockTargetId);
  const nextT = list[(i + 1) % list.length] ?? list[0];
  p.lockTargetId = nextT?.id ?? null;
  p.lockState = 'none';
  p.lockTimer = 0;
  return p.lockTargetId;
}

export function selectWeapon(s: GameState, w: WeaponId): void {
  s.player.selected = w;
}

function updateLocks(s: GameState, dt: number): void {
  const p = s.player;
  // Heat-seeker lock: keep the target in the ring for the lock time.
  const cone = lockCone(s);
  let tgt = enemyById(s, p.lockTargetId);
  const dir = forward(p.heading, p.pitch);
  const inRing = (e: Enemy | null): boolean =>
    !!e && e.alive && dist(p.pos, e.pos) < LOCK_RANGE && offBoresight(p.pos, dir, e.pos) < cone;
  if (!inRing(tgt)) {
    const cand = p.missiles > 0 ? boresightTarget(s, cone, LOCK_RANGE) : null;
    if (cand && cand.id !== p.lockTargetId) {
      p.lockTargetId = cand.id;
      p.lockTimer = 0;
    }
    tgt = cand;
  }
  if (p.missiles > 0 && inRing(tgt)) {
    p.lockTimer += dt;
    if (p.lockTimer >= lockTime(s)) {
      if (p.lockState !== 'locked') pushEvent(s, { type: 'lock' });
      p.lockState = 'locked';
    } else p.lockState = 'seeking';
  } else {
    p.lockTimer = Math.max(0, p.lockTimer - dt * 2);
    p.lockState = 'none';
  }

  // Strike lock: needs the target ahead (within 70 degrees) while in the zone.
  if (p.strikeLock !== 'none') {
    const off = offBoresight(p.pos, forward(p.heading, 0), [s.target.pos[0], p.pos[1], s.target.pos[2]]);
    if (!strikeAvailable(s) || off > 70 * DEG) {
      p.strikeLock = 'none';
      p.strikeLockTimer = 0;
    } else if (p.strikeLock === 'seeking') {
      p.strikeLockTimer += dt;
      const need = STRIKE_LOCK_TIME * (1 - 0.5 * s.profile.aimAssist);
      if (p.strikeLockTimer >= need) {
        p.strikeLock = 'locked';
        pushEvent(s, { type: 'strike_lock' });
      }
    }
  }
}

// ---- projectiles ----

function updateBullets(s: GameState, dt: number): void {
  const hash = spatial(s);
  const terrain = s.mission.terrain;
  for (const b of s.bullets) {
    b.prevPos[0] = b.pos[0];
    b.prevPos[1] = b.pos[1];
    b.prevPos[2] = b.pos[2];
    b.pos[0] += b.vel[0] * dt;
    b.pos[1] += b.vel[1] * dt;
    b.pos[2] += b.vel[2] * dt;
    b.life -= dt;
    for (const e of hash.near(b.pos, 200)) {
      const r = HIT_RADIUS[e.kind];
      if (segPointDist2(b.prevPos, b.pos, e.pos) < r * r) {
        b.life = 0;
        if (chance(s.rng, 0.3)) pushFx(s, 'hit', e.pos);
        if (e.isTarget) damageTarget(s, 0.02);
        else damageEnemy(s, e, 1);
        break;
      }
    }
    if (b.life > 0 && s.target.alive && s.target.kind !== 'warship') {
      const r = s.target.radius;
      if (segPointDist2(b.prevPos, b.pos, s.target.pos) < r * r) {
        b.life = 0;
        if (chance(s.rng, 0.3)) pushFx(s, 'hit', b.pos);
        damageTarget(s, 0.02);
      }
    }
    if (b.life > 0 && b.pos[1] < surfaceHeight(terrain, b.pos[0], b.pos[2])) {
      b.life = 0;
      if (chance(s.rng, 0.08)) pushFx(s, b.pos[1] < 1 ? 'splash' : 'hit', b.pos);
    }
  }
  s.bullets = s.bullets.filter(b => b.life > 0);
}

function missileTargetPos(s: GameState, m: Missile): { pos: V3; vel: V3; radius: number } | null {
  const id = m.targetId;
  if (!id) return null;
  if (id === 'player') return s.status === 'playing' ? { pos: s.player.pos, vel: s.player.vel, radius: 40 } : null;
  if (id === 'target') return { pos: s.target.pos, vel: [0, 0, 0], radius: s.target.radius };
  const f = s.flares.find(x => x.id === id);
  if (f) return { pos: f.pos, vel: f.vel, radius: 20 };
  const e = enemyById(s, id);
  if (e && e.alive) return { pos: e.pos, vel: e.vel, radius: e.kind === 'drone' ? 30 : 35 };
  return null;
}

function detonate(s: GameState, m: Missile): void {
  m.alive = false;
  pushFx(s, 'explosion', m.pos);
  const id = m.targetId;
  if (id === 'player') {
    applyDamage(s, m.kind === 'sam' ? 0.3 : 0.26, m.prevPos);
  } else if (id && id !== 'target') {
    const e = enemyById(s, id);
    if (e) damageEnemy(s, e, 10);
  }
}

function updateMissiles(s: GameState, dt: number): void {
  const terrain = s.mission.terrain;
  for (const m of s.missiles) {
    if (!m.alive) continue;
    m.prevPos[0] = m.pos[0];
    m.prevPos[1] = m.pos[1];
    m.prevPos[2] = m.pos[2];
    m.age += dt;

    if (m.arc) {
      const u = Math.min(1, m.age / m.arc.duration);
      const { from, to, height } = m.arc;
      const np: V3 = [
        from[0] + (to[0] - from[0]) * u,
        from[1] + (to[1] - from[1]) * u + Math.sin(Math.PI * u) * height,
        from[2] + (to[2] - from[2]) * u,
      ];
      const a = aim(m.pos, np);
      m.heading = a.heading;
      m.pitch = a.pitch;
      m.vel = scale(sub(np, m.pos), 1 / dt);
      m.pos = np;
      if (u >= 1) {
        m.alive = false;
        pushFx(s, 'big_explosion', to);
        if (s.target.alive && dist(to, s.target.pos) < s.target.radius * 2) damageTarget(s, 2);
      }
      continue;
    }

    // Motor burn then coast.
    const burn = m.kind === 'heat' ? 4 : m.kind === 'sam' ? 9 : 6;
    if (m.age < burn) m.speed = Math.min(m.maxSpeed, m.speed + 320 * dt);
    else m.speed -= (m.kind === 'heat' ? 40 : 18) * dt;

    const tgt = missileTargetPos(s, m);
    if (tgt) {
      const d = dist(m.pos, tgt.pos);
      const tLead = Math.min(3, d / Math.max(m.speed, 1)) * 0.6;
      const aimPt = add(tgt.pos, scale(tgt.vel, tLead));
      const want = aim(m.pos, aimPt);
      const maxTurn = m.turnRate * dt;
      m.heading = wrapPi(m.heading + clamp(wrapPi(want.heading - m.heading), -maxTurn, maxTurn));
      m.pitch = m.pitch + clamp(want.pitch - m.pitch, -maxTurn, maxTurn);
    } else if (m.targetId && m.targetId !== 'target') {
      m.targetId = null;
    }
    const f = forward(m.heading, m.pitch);
    m.vel = scale(f, m.speed);
    m.pos[0] += m.vel[0] * dt;
    m.pos[1] += m.vel[1] * dt;
    m.pos[2] += m.vel[2] * dt;

    if (tgt) {
      const fuse = m.targetId === 'player' ? 40 : tgt.radius;
      if (segPointDist2(m.prevPos, m.pos, tgt.pos) < fuse * fuse) {
        if (m.decoyed || (m.targetId && m.targetId.startsWith('f'))) {
          m.alive = false;
          pushFx(s, 'explosion', m.pos);
        } else detonate(s, m);
        continue;
      }
    } else if (m.owner === 'player' && m.kind === 'heat') {
      // Dumbfire seekers can still acquire something in front of them.
      for (const e of s.enemies) {
        if (!e.alive || !isAir(e)) continue;
        if (dist(m.pos, e.pos) < 2500 && offBoresight(m.pos, f, e.pos) < 12 * DEG) {
          m.targetId = e.id;
          break;
        }
      }
    }
    if (m.pos[1] < surfaceHeight(terrain, m.pos[0], m.pos[2])) {
      m.alive = false;
      pushFx(s, m.pos[1] < 1 ? 'splash' : 'explosion', m.pos);
      continue;
    }
    if (m.age > m.life || m.speed < 160) {
      m.alive = false;
      pushFx(s, 'hit', m.pos);
    }
  }
  s.missiles = s.missiles.filter(m => m.alive);
}

function updateFlares(s: GameState, dt: number): void {
  for (const f of s.flares) {
    f.prevPos[0] = f.pos[0];
    f.prevPos[1] = f.pos[1];
    f.prevPos[2] = f.pos[2];
    f.vel[1] -= 9.8 * dt;
    f.pos[0] += f.vel[0] * dt;
    f.pos[1] += f.vel[1] * dt;
    f.pos[2] += f.vel[2] * dt;
    f.life -= dt;
  }
  s.flares = s.flares.filter(f => f.life > 0);
}

/** Launch an enemy missile (SAM, ship or fighter) at the player. */
export function launchEnemyMissile(s: GameState, from: V3, kind: 'sam' | 'air', launcherId: string | null): Missile {
  const a = aim(from, s.player.pos);
  const base = kind === 'sam' ? 480 : 520;
  const skill = s.profile.enemySkill;
  const m: Missile = {
    id: newId(s, 'x'),
    kind,
    owner: 'enemy',
    launcherId,
    pos: [...from],
    prevPos: [...from],
    vel: [0, 0, 0],
    heading: a.heading,
    pitch: kind === 'sam' ? Math.max(a.pitch, 0.5) : a.pitch,
    speed: kind === 'sam' ? 120 : 260,
    maxSpeed: base * s.profile.missileSpeed,
    turnRate: 0.75 + 0.55 * skill,
    targetId: 'player',
    age: 0,
    life: kind === 'sam' ? 26 : 16,
    alive: true,
    arc: null,
    decoyed: false,
  };
  s.missiles.push(m);
  s.inCombatUntil = Math.max(s.inCombatUntil, s.t + 8);
  const bearing = wrap180(compass(s.player.pos, from) - s.player.heading / DEG);
  pushEvent(s, { type: 'missile_launch', bearing: Math.round(bearing), detail: kind });
  return m;
}

export function updateCombat(s: GameState, c: ControlState, dt: number): void {
  const p = s.player;
  p.flareCooldown = Math.max(0, p.flareCooldown - dt);
  spatial(s).rebuild(s.enemies);
  fireCannon(s, dt, c.cannon);
  updateLocks(s, dt);
  updateBullets(s, dt);
  updateMissiles(s, dt);
  updateFlares(s, dt);
  if (c.cannon && p.rounds > 0 && boresightTarget(s, 15 * DEG, 3000, false)) s.inCombatUntil = Math.max(s.inCombatUntil, s.t + 3);
}
