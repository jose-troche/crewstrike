import type {
  DifficultyName, GameEvent, LockState, MissionStatus, Phase, RouteKind, Sections, ThreatState, WeaponId,
} from '@crewstrike/shared';
import { profileFor, type DifficultyProfile } from './difficulty';
import { getMission, type MissionDef, type TargetType } from './mission';
import { DEG, type V3 } from './math';
import { rng, range, type Rng } from './rng';
import { surfaceHeight } from './terrain';

export const ROUNDS_MAX = 600;
export const MISSILES_MAX = 6;
export const STRIKE_MAX = 2;
export const FLARES_MAX = 16;
export const DEFAULT_FUEL_KG = 1500;
export const THROTTLE_SPEEDS = [180, 250, 320] as const;
export const CRUISE_SPEED = THROTTLE_SPEEDS[1];
export const BURN_KG_S = [1.6, 2.2, 3.0] as const;

export interface Player {
  pos: V3;
  prevPos: V3;
  vel: V3;
  heading: number;
  pitch: number;
  bank: number;
  prevHeading: number;
  prevPitch: number;
  prevBank: number;
  yawRate: number;
  speed: number;
  throttle: 0 | 1 | 2;
  boost: boolean;
  boostEnergy: number;
  fuel: number;
  fuelMax: number;
  damage: number;
  sections: Sections;
  rounds: number;
  missiles: number;
  strike: number;
  flares: number;
  selected: WeaponId;
  lockTargetId: string | null;
  lockTimer: number;
  lockState: LockState;
  strikeLockTimer: number;
  strikeLock: LockState;
  autopilot: boolean;
  route: RouteKind;
  waypoint: V3 | null;
  stalled: boolean;
  stallWarn: boolean;
  groundWarn: boolean;
  agl: number;
  climbRate: number;
  cannonAcc: number;
  flareCooldown: number;
  lastFiredAt: number;
  boostCommand: boolean;
}

export type EnemyKind = 'fighter' | 'drone' | 'sam' | 'aaa' | 'ship';

export interface Enemy {
  id: string;
  kind: EnemyKind;
  pos: V3;
  prevPos: V3;
  vel: V3;
  heading: number;
  pitch: number;
  bank: number;
  speed: number;
  hp: number;
  hpMax: number;
  state: ThreatState;
  stateTimer: number;
  cooldown: number;
  home: V3;
  alive: boolean;
  groupId: string | null;
  /** Ship enemy that is the mission target itself. */
  isTarget: boolean;
  /** Id of the missile this site or fighter has in the air, if any. */
  missileId: string | null;
  gunAcc: number;
  /** Training drones never shoot. */
  passive: boolean;
  /** Cached line of sight to the player, refreshed a few times a second. */
  los: boolean;
  losCheck: number;
}

export type MissileKind = 'heat' | 'strike' | 'sam' | 'air';

export interface Missile {
  id: string;
  kind: MissileKind;
  owner: 'player' | 'enemy';
  launcherId: string | null;
  pos: V3;
  prevPos: V3;
  vel: V3;
  heading: number;
  pitch: number;
  speed: number;
  maxSpeed: number;
  turnRate: number;
  /** 'player', an enemy id, 'target', a flare id, or null for dumbfire. */
  targetId: string | null;
  age: number;
  life: number;
  alive: boolean;
  /** Strike missile arc. */
  arc: { from: V3; to: V3; duration: number; height: number } | null;
  decoyed: boolean;
}

export interface Bullet {
  pos: V3;
  prevPos: V3;
  vel: V3;
  life: number;
}

export interface Flare {
  id: string;
  pos: V3;
  prevPos: V3;
  vel: V3;
  life: number;
}

export interface Storm {
  pos: V3;
  radius: number;
  vel: [number, number];
  active: boolean;
  spawnPhase: Phase | null;
}

export interface Target {
  id: 'target';
  kind: TargetType;
  name: string;
  pos: V3;
  hp: number;
  hpMax: number;
  alive: boolean;
  radius: number;
}

export type FxKind = 'explosion' | 'hit' | 'flak' | 'lightning' | 'splash' | 'big_explosion';
export interface Fx {
  id: number;
  kind: FxKind;
  pos: V3;
  at: number;
}

export interface TrainingStep {
  kind: 'rings' | 'drone' | 'flare' | 'strike' | 'done';
  text: string;
  control: string;
}

export const TRAINING_STEPS: TrainingStep[] = [
  { kind: 'rings', text: 'Fly through the three rings', control: 'stick' },
  { kind: 'drone', text: 'Shoot the drone with the cannon', control: 'cannon' },
  { kind: 'flare', text: 'Missile! Fire a flare', control: 'flare' },
  { kind: 'strike', text: 'Lock and fire a strike missile', control: 'strike' },
  { kind: 'done', text: 'Training complete', control: 'none' },
];

export interface Score {
  kills: number;
  killPoints: number;
  hitsTaken: number;
}

export interface ButtonEdges {
  missile: boolean;
  strike: boolean;
  flare: boolean;
  nextTarget: boolean;
  autopilot: boolean;
}

export interface GameState {
  mission: MissionDef;
  profile: DifficultyProfile;
  difficulty: DifficultyName;
  rng: Rng;
  /** Game time in seconds. */
  t: number;
  frame: number;
  phase: Phase;
  fightStarted: boolean;
  status: MissionStatus;
  endedAt: number | null;
  endReason: string | null;
  player: Player;
  enemies: Enemy[];
  missiles: Missile[];
  bullets: Bullet[];
  flares: Flare[];
  storms: Storm[];
  target: Target;
  fx: Fx[];
  events: GameEvent[];
  score: Score;
  wind: V3;
  inCombatUntil: number;
  lastHitAt: number;
  lastHitBearing: number;
  nextId: number;
  prevButtons: ButtonEdges;
  spawnedPhases: Phase[];
  training: { step: number; ringIndex: number; rings: V3[]; stepStartedAt: number } | null;
  /** Lowest altitude the jet may fly in Cadet (meters above ground). */
  floor: number;
  inStorm: boolean;
}

export interface StartOptions {
  seed?: number;
  difficulty?: DifficultyName;
  custom?: Partial<DifficultyProfile>;
}

export function newId(s: GameState, prefix: string): string {
  s.nextId += 1;
  return `${prefix}${s.nextId}`;
}

function makeEnemy(s: GameState, kind: EnemyKind, pos: V3, groupId: string | null = null): Enemy {
  const hp = { fighter: 10, drone: 2, sam: 15, aaa: 10, ship: 40 }[kind];
  const speed = { fighter: 230, drone: 160, sam: 0, aaa: 0, ship: 8 }[kind];
  const ground = kind === 'sam' || kind === 'aaa' || kind === 'ship';
  const y = ground ? surfaceHeight(s.mission.terrain, pos[0], pos[2]) : pos[1];
  const p: V3 = [pos[0], y, pos[2]];
  return {
    id: newId(s, kind[0] ?? 'e'),
    kind,
    pos: p,
    prevPos: [...p],
    vel: [0, 0, 0],
    heading: range(s.rng, 0, Math.PI * 2),
    pitch: 0,
    bank: 0,
    speed,
    hp,
    hpMax: hp,
    state: kind === 'fighter' || kind === 'drone' ? 'patrol' : 'idle',
    stateTimer: 0,
    cooldown: range(s.rng, 0, 3),
    home: [...p],
    alive: true,
    groupId,
    isTarget: false,
    missileId: null,
    gunAcc: 0,
    passive: false,
    los: false,
    losCheck: 0,
  };
}

/** Spawn enemies whose spawn phase matches; fighters without a position appear between player and target. */
export function spawnEnemiesFor(s: GameState, phase: Phase | null): void {
  for (const def of s.mission.enemies) {
    const when = def.spawn?.phase ?? null;
    if (when !== phase) continue;
    if (def.type === 'fighter') {
      for (let i = 0; i < def.count; i++) {
        let pos: V3;
        if (def.pos) {
          pos = [def.pos[0] + i * 600, def.pos[1], def.pos[2] + i * 400];
        } else {
          // Ahead of the player toward the target, offset to the side.
          const p = s.player.pos;
          const t = s.target.pos;
          const dx = t[0] - p[0];
          const dz = t[2] - p[2];
          const d = Math.hypot(dx, dz) || 1;
          const ahead = Math.min(9000, d * 0.6);
          const side = (i % 2 === 0 ? 1 : -1) * (1500 + i * 700);
          pos = [p[0] + (dx / d) * ahead - (dz / d) * side, Math.max(p[1], 1500), p[2] + (dz / d) * ahead + (dx / d) * side];
        }
        const e = makeEnemy(s, 'fighter', pos);
        if (when) e.state = 'chase';
        s.enemies.push(e);
      }
    } else if (def.type === 'drones') {
      const gid = newId(s, 'g');
      for (let i = 0; i < def.count; i++) {
        const a = (i / def.count) * Math.PI * 2;
        s.enemies.push(makeEnemy(s, 'drone', [def.pos[0] + Math.cos(a) * 120, def.pos[1] + (i % 3) * 30, def.pos[2] + Math.sin(a) * 120], gid));
      }
    } else {
      s.enemies.push(makeEnemy(s, def.type, def.pos));
    }
  }
  for (const st of s.storms) if (st.spawnPhase === phase && phase !== null) st.active = true;
  if (phase) s.spawnedPhases.push(phase);
}

export function createGame(missionId: string, opts: StartOptions = {}): GameState {
  const mission = getMission(missionId);
  const difficulty = opts.difficulty ?? 'cadet';
  const profile = profileFor(difficulty, opts.custom);
  const r = rng(opts.seed ?? mission.seed);
  const start = mission.start;
  const heading = start.heading * DEG;
  const fuel = mission.fuelKg ?? DEFAULT_FUEL_KG;
  const [windFrom, windKt] = mission.weather.windKt;
  const toward = (windFrom + 180) * DEG;
  const windMs = windKt * 0.514;
  const [tx, , tz] = mission.target.pos;
  // A bridge deck sits at the valley rim, not on the river bed.
  const targetY = mission.target.type === 'bridge'
    ? Math.max(surfaceHeight(mission.terrain, tx - 350, tz), surfaceHeight(mission.terrain, tx + 350, tz))
    : surfaceHeight(mission.terrain, tx, tz);
  const targetRadius = { radar_station: 60, warship: 110, bridge: 140, training_tower: 50 }[mission.target.type];

  const player: Player = {
    pos: [...start.pos],
    prevPos: [...start.pos],
    vel: [0, 0, 0],
    heading,
    pitch: 0,
    bank: 0,
    prevHeading: heading,
    prevPitch: 0,
    prevBank: 0,
    yawRate: 0,
    speed: CRUISE_SPEED,
    throttle: 1,
    boost: false,
    boostEnergy: 1,
    fuel,
    fuelMax: fuel,
    damage: 0,
    sections: { nose: 0, body: 0, leftWing: 0, rightWing: 0, tail: 0 },
    rounds: ROUNDS_MAX,
    missiles: MISSILES_MAX,
    strike: STRIKE_MAX,
    flares: FLARES_MAX,
    selected: 'cannon',
    lockTargetId: null,
    lockTimer: 0,
    lockState: 'none',
    strikeLockTimer: 0,
    strikeLock: 'none',
    autopilot: false,
    route: 'target',
    waypoint: null,
    stalled: false,
    stallWarn: false,
    groundWarn: false,
    agl: start.pos[1],
    climbRate: 0,
    cannonAcc: 0,
    flareCooldown: 0,
    lastFiredAt: -100,
    boostCommand: false,
  };

  const s: GameState = {
    mission,
    profile,
    difficulty,
    rng: r,
    t: 0,
    frame: 0,
    phase: 'ingress',
    fightStarted: false,
    status: 'playing',
    endedAt: null,
    endReason: null,
    player,
    enemies: [],
    missiles: [],
    bullets: [],
    flares: [],
    storms: mission.weather.storms.map(st => ({
      pos: [...st.pos],
      radius: st.radius,
      vel: st.vel ?? [0, 0],
      active: !st.spawn,
      spawnPhase: st.spawn?.phase ?? null,
    })),
    target: {
      id: 'target',
      kind: mission.target.type,
      name: mission.target.name,
      pos: [mission.target.pos[0], targetY, mission.target.pos[2]],
      hp: mission.target.hp,
      hpMax: mission.target.hp,
      alive: true,
      radius: targetRadius,
    },
    fx: [],
    events: [],
    score: { kills: 0, killPoints: 0, hitsTaken: 0 },
    wind: [Math.sin(toward) * windMs, 0, -Math.cos(toward) * windMs],
    inCombatUntil: 0,
    lastHitAt: -100,
    lastHitBearing: 0,
    nextId: 0,
    prevButtons: { missile: false, strike: false, flare: false, nextTarget: false, autopilot: false },
    spawnedPhases: [],
    training: mission.training
      ? { step: 0, ringIndex: 0, rings: mission.training.rings.map(r2 => [...r2] as V3), stepStartedAt: 0 }
      : null,
    floor: 120,
    inStorm: false,
  };
  player.agl = start.pos[1] - surfaceHeight(mission.terrain, start.pos[0], start.pos[2]);

  // The warship target also shoots back.
  if (mission.target.type === 'warship') {
    const ship = makeEnemy(s, 'ship', s.target.pos);
    ship.isTarget = true;
    ship.hp = 9999;
    ship.hpMax = 9999;
    s.enemies.push(ship);
  }
  spawnEnemiesFor(s, null);
  if (difficulty === 'cadet') player.autopilot = false;
  return s;
}

export function pushEvent(s: GameState, e: Omit<GameEvent, 'at'>): void {
  s.events.push({ ...e, at: Math.round(s.t * 1000) });
  if (s.events.length > 64) s.events.splice(0, s.events.length - 64);
}

export function pushFx(s: GameState, kind: FxKind, pos: V3): void {
  s.nextId += 1;
  s.fx.push({ id: s.nextId, kind, pos: [...pos], at: s.t });
  if (s.fx.length > 80) s.fx.splice(0, s.fx.length - 80);
}

export function makeTrainingDrone(s: GameState, pos: V3): Enemy {
  const e = makeEnemy(s, 'drone', pos, 'train');
  e.passive = true;
  e.speed = 90;
  e.hp = 1;
  e.hpMax = 1;
  return e;
}

export { makeEnemy };
