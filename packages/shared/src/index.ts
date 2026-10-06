// Shared contracts between the game core, the agents, the NL pipeline, the web app and the edge.

export type Vec3 = [number, number, number];

export type AgentId = 'radar' | 'weapons' | 'flight' | 'mission' | 'weather' | 'wingman';
export const AGENT_IDS: readonly AgentId[] = ['radar', 'weapons', 'flight', 'mission', 'weather', 'wingman'];

export type Level = 'red' | 'amber' | 'green' | 'info';

export type HudZone =
  | 'objective'
  | 'radar'
  | 'threat-ring'
  | 'damage'
  | 'fuel'
  | 'speed'
  | 'altitude'
  | 'weapons'
  | 'flares'
  | 'weather'
  | 'console'
  | 'mission-bar';

export const HUD_ZONES: readonly HudZone[] = [
  'objective', 'radar', 'threat-ring', 'damage', 'fuel', 'speed',
  'altitude', 'weapons', 'flares', 'weather', 'console', 'mission-bar',
];

/** Which agent owns which cockpit zones (spec section 9). */
export const ZONE_OWNERS: Record<AgentId, readonly HudZone[]> = {
  radar: ['radar', 'threat-ring'],
  weapons: ['weapons', 'flares'],
  flight: ['damage', 'fuel', 'speed', 'altitude'],
  mission: ['objective', 'mission-bar'],
  weather: ['weather'],
  wingman: ['console'],
};

/** One-line "?" explanation for every instrument (spec section 7). */
export const ZONE_HELP: Record<HudZone, string> = {
  objective: 'Where to go next, and which mission phase you are in.',
  radar: 'Top-down map: enemies, threat domes, storms, target and exit.',
  'threat-ring': 'Wedges point at whatever is tracking or shooting at you.',
  damage: 'Your jet: sections turn amber, then red, as they take hits.',
  fuel: 'Fuel left; keep it above the white home line to make it back.',
  speed: 'Speed, throttle notch and boost meter.',
  altitude: 'Height above ground; amber, then red, when too low.',
  weapons: 'What you can fire, how many are left, and lock state.',
  flares: 'Flares left to decoy incoming missiles.',
  weather: 'Wind direction and the nearest storm.',
  console: 'Your AI crew: one short line about what matters now.',
  'mission-bar': 'Mission time, score and stars so far.',
};

export type Phase = 'ingress' | 'fight' | 'strike' | 'egress';
export type MissionStatus = 'playing' | 'won' | 'lost' | 'aborted';
export type DifficultyName = 'cadet' | 'pilot' | 'ace' | 'custom';
export type WeaponId = 'cannon' | 'missile' | 'strike' | 'flare';
export type RouteKind = 'target' | 'exit' | 'safest' | 'north' | 'south' | 'none';
export type LockState = 'none' | 'seeking' | 'locked';

export type ThreatKind = 'fighter' | 'drone' | 'sam' | 'aaa' | 'ship' | 'missile';
export type ThreatState = 'idle' | 'patrol' | 'chase' | 'attack' | 'tracking' | 'locked' | 'launch' | 'cooldown' | 'inbound';

export interface Threat {
  id: string;
  kind: ThreatKind;
  state: ThreatState;
  level: Level;
  /** Bearing relative to the nose, degrees, -180..180 (negative = left). */
  bearing: number;
  /** Absolute compass bearing from the player, degrees 0..360. */
  compass: number;
  km: number;
  /** 0..1 contribution to the advisor's threat score. */
  danger: number;
  count?: number;
  /** Seconds to impact, missiles only. */
  tti?: number;
}

export interface Sections {
  nose: number;
  body: number;
  leftWing: number;
  rightWing: number;
  tail: number;
}

export type GameEventType =
  | 'hit'
  | 'kill'
  | 'missile_launch'
  | 'flare'
  | 'decoyed'
  | 'target_hit'
  | 'target_destroyed'
  | 'phase'
  | 'lock'
  | 'strike_lock'
  | 'fired'
  | 'lightning'
  | 'storm_enter'
  | 'training_step'
  | 'end';

export interface GameEvent {
  type: GameEventType;
  at: number;
  /** Relative bearing in degrees when the event has a direction (hits, launches). */
  bearing?: number;
  detail?: string;
}

/** Compact state the agents and the NL pipeline read; about 2 KB as JSON. */
export interface GameSnapshot {
  now: number;
  missionId: string;
  missionTitle: string;
  difficulty: DifficultyName;
  phase: Phase;
  status: MissionStatus;
  training: boolean;
  inCombat: boolean;
  own: {
    pos: Vec3;
    heading: number;
    pitch: number;
    bank: number;
    speed: number;
    throttle: 0 | 1 | 2;
    boost: boolean;
    boostPct: number;
    agl: number;
    alt: number;
    climbRate: number;
    stalled: boolean;
    stallWarn: boolean;
    groundWarn: boolean;
    autopilot: boolean;
    autopilotAllowed: boolean;
    route: RouteKind;
  };
  fuel: { kg: number; maxKg: number; fraction: number; needToExitKg: number };
  damage: number;
  sections: Sections;
  weapons: {
    rounds: number;
    roundsMax: number;
    cannonPct: number;
    missiles: number;
    missilesMax: number;
    strike: number;
    flares: number;
    flaresMax: number;
    selected: WeaponId;
    lock: LockState;
    lockTargetId: string | null;
    lockKm: number | null;
    strikeLock: LockState;
    strikeAvailable: boolean;
  };
  nav: {
    objective: 'target' | 'exit';
    kmToTarget: number;
    targetBearing: number;
    kmToExit: number;
    exitBearing: number;
    minutesToExit: number;
    inStrikeZone: boolean;
    inExit: boolean;
    kmToStrikeZone: number;
  };
  threats: Threat[];
  weather: {
    windFrom: number;
    windKt: number;
    inStorm: boolean;
    stormKm: number | null;
    stormBearing: number | null;
    stormEtaS: number | null;
  };
  target: { alive: boolean; hp: number; hpMax: number; kind: string; name: string };
  score: { score: number; kills: number; elapsedS: number; stars: number };
  events: GameEvent[];
  trainingStep: { index: number; total: number; text: string; control: string } | null;
}

export interface Finding {
  key: string;
  rank: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  level: Level;
  text: string;
  detail?: string;
  ttlMs: number;
  /** Optional voice clip id for critical lines. */
  clip?: string;
  /** Event-like finding: each occurrence counts, and repeats merge into "×N". */
  repeat?: boolean;
}

export interface ConsoleLine {
  id: number;
  key: string;
  agent: AgentId;
  level: Level;
  text: string;
  detail?: string;
  zones: HudZone[];
  at: number;
  ttlMs: number;
  /** Red lines stay until their condition clears. */
  sticky: boolean;
  count: number;
  clip?: string;
}

/** What the agent worker sends back to the main thread. */
export interface AgentOutput {
  lines: ConsoleLine[];
  /** Line that is new this tick (drives glow, voice and crew icon). */
  fresh: ConsoleLine | null;
  /** Agents with something to say this tick. */
  active: AgentId[];
  /** One-line status per agent for the crew strip tooltips. */
  status: Record<AgentId, string>;
  /** Keys of red findings that are still active (red lines stay until cleared). */
  liveKeys: string[];
}

export type Verdict = 'ENGAGE' | 'AVOID' | 'ESCAPE' | 'ABORT' | 'CONTINUE' | 'REROUTE';
export type StrategicKind = 'escape' | 'engage_or_avoid' | 'route_choice' | 'abort' | 'attack_plan';
export type AdviceAction = 'none' | 'route_exit' | 'route_safest' | 'route_target' | 'climb' | 'descend';
export const ADVICE_ACTIONS: readonly AdviceAction[] = ['none', 'route_exit', 'route_safest', 'route_target', 'climb', 'descend'];

export interface Advice {
  kind: StrategicKind;
  verdict: Verdict;
  facts: Record<string, number | string>;
  action: AdviceAction;
  /** Human label for the optional one-tap action, e.g. "Set route north?". */
  actionLabel: string | null;
  reason: string;
  source: 'template' | 'device' | 'edge';
}

/** The game-side surface the command grammar drives. */
export interface CommandSink {
  fire(weapon: WeaponId): void;
  setBoost(on: boolean): void;
  setThrottle(level: 0 | 1 | 2): void;
  cycleTarget(mode: 'nearest' | 'next'): void;
  setAutopilot(on: boolean): void;
  setRoute(route: RouteKind): void;
  setVoice(mode: VoiceMode): void;
  pause(): void;
  resume(): void;
}

export type VoiceMode = 'off' | 'critical' | 'all';

export type InputSource = 'voice' | 'typed' | 'test';

/** Result of running one utterance through the NL pipeline. */
export type NlResult =
  | { kind: 'command'; confirm: string }
  | { kind: 'tactical'; text: string; glow: HudZone[]; agent: AgentId }
  | { kind: 'howto'; text: string; highlight: string[] }
  | { kind: 'strategic'; advice: Advice }
  | { kind: 'unknown'; text: string };

// ---- Edge API shapes ----

export interface SessionReq { turnstileToken?: string; player: string }
export interface SessionRes { session: string }
export interface AdviceReq { session: string; verdict: Verdict; kind: StrategicKind; facts: Record<string, number | string> }
export interface AdviceRes { reason: string; action: AdviceAction }
export interface RecapReq { session: string; facts: Record<string, number | string> }
export interface RecapRes { lines: string[] }
export interface ScoreReq {
  player: string;
  callsign: string;
  missionId: string;
  difficulty: DifficultyName;
  stars: number;
  score: number;
  durationS: number;
}
export interface LeaderboardRow { callsign: string; difficulty: DifficultyName; stars: number; score: number; durationS: number; createdAt: number }
export interface BudgetRes { remaining: number; ceiling: number; used: number }
export * from './prompts';
