import type { Phase, Vec3 } from '@crewstrike/shared';
import type { TerrainDef } from './terrain';
import radarBreaker from './missions/radar-breaker.json';
import ironTide from './missions/iron-tide.json';
import bridgeFall from './missions/bridge-fall.json';
import training from './missions/training.json';

export type TargetType = 'radar_station' | 'warship' | 'bridge' | 'training_tower';

export type EnemyDef =
  | { type: 'sam' | 'aaa' | 'ship'; pos: Vec3; spawn?: { phase: Phase } }
  | { type: 'fighter'; count: number; pos?: Vec3; spawn?: { phase: Phase } }
  | { type: 'drones'; count: number; pos: Vec3; spawn?: { phase: Phase } };

export interface StormDef {
  pos: Vec3;
  radius: number;
  /** Drift in m/s along x and z. */
  vel?: [number, number];
  spawn?: { phase: Phase };
}

export interface MissionDef {
  id: string;
  title: string;
  brief: string;
  hard: string;
  seed: number;
  start: { pos: Vec3; heading: number };
  target: { type: TargetType; name: string; pos: Vec3; hp: number };
  strikeZone: { center: Vec3; radius: number };
  exit: { center: Vec3; radius: number };
  enemies: EnemyDef[];
  weather: { storms: StormDef[]; windKt: [number, number]; clouds?: number };
  terrain: TerrainDef;
  fuelKg?: number;
  /** Distance (m) from the strike zone edge that starts the fight phase. */
  fightRange?: number;
  training?: { rings: Vec3[] };
}

export const MISSIONS: Record<string, MissionDef> = {
  'radar-breaker': radarBreaker as unknown as MissionDef,
  'iron-tide': ironTide as unknown as MissionDef,
  'bridge-fall': bridgeFall as unknown as MissionDef,
  training: training as unknown as MissionDef,
};

export const MISSION_ORDER = ['radar-breaker', 'iron-tide', 'bridge-fall'] as const;

export function getMission(id: string): MissionDef {
  const m = MISSIONS[id];
  if (!m) throw new Error(`Unknown mission: ${id}`);
  return m;
}
