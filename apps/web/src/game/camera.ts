import * as THREE from 'three';
import type { DifficultyProfile } from '@crewstrike/game-core';

const MAX_ROLL = THREE.MathUtils.degToRad(15);

/** Comfort camera: the jet banks fully, the horizon barely tilts (capped at ±15° unless full roll is chosen). */
export function cameraRoll(bank: number, p: Pick<DifficultyProfile, 'fullRollCamera'>): number {
  return p.fullRollCamera ? bank : THREE.MathUtils.clamp(bank * 0.25, -MAX_ROLL, MAX_ROLL);
}
