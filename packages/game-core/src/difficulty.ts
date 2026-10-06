import type { DifficultyName } from '@crewstrike/shared';

/** Every assist from the spec's difficulty table is one field; difficulty is data, not code paths. */
export interface DifficultyProfile {
  steering: 'assisted' | 'semi' | 'manual';
  autoLevel: boolean;
  autopilot: 'always' | 'outOfCombat' | 'off';
  groundProtection: 'auto' | 'gentle' | 'warn';
  stall: 'none' | 'recover' | 'real';
  /** 0..1, magnetism and auto-lock strength. */
  aimAssist: number;
  /** 0..1, reaction time and accuracy. */
  enemySkill: number;
  /** Multiplier on enemy missile speed. */
  missileSpeed: number;
  fuelBurn: number;
  damageTaken: number;
  chatter: 'tips' | 'key' | 'critical';
  /** Stick multiplier. */
  sensitivity: number;
  fullRollCamera: boolean;
}

export const CADET: DifficultyProfile = {
  steering: 'assisted', autoLevel: true, autopilot: 'always', groundProtection: 'auto', stall: 'none',
  aimAssist: 0.8, enemySkill: 0.25, missileSpeed: 0.7, fuelBurn: 0.5, damageTaken: 0.5,
  chatter: 'tips', sensitivity: 0.8, fullRollCamera: false,
};

export const PILOT: DifficultyProfile = {
  steering: 'semi', autoLevel: false, autopilot: 'outOfCombat', groundProtection: 'gentle', stall: 'recover',
  aimAssist: 0.35, enemySkill: 0.55, missileSpeed: 0.85, fuelBurn: 1, damageTaken: 1,
  chatter: 'key', sensitivity: 1, fullRollCamera: false,
};

export const ACE: DifficultyProfile = {
  steering: 'manual', autoLevel: false, autopilot: 'off', groundProtection: 'warn', stall: 'real',
  aimAssist: 0, enemySkill: 0.9, missileSpeed: 1, fuelBurn: 1.5, damageTaken: 1.5,
  chatter: 'critical', sensitivity: 1.3, fullRollCamera: false,
};

export const PROFILES: Record<Exclude<DifficultyName, 'custom'>, DifficultyProfile> = {
  cadet: CADET,
  pilot: PILOT,
  ace: ACE,
};

export function profileFor(name: DifficultyName, custom?: Partial<DifficultyProfile>): DifficultyProfile {
  if (name === 'custom') return { ...PILOT, ...custom };
  return { ...PROFILES[name] };
}
