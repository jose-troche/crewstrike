import type { RouteKind, WeaponId } from '@crewstrike/shared';
import { cycleTarget, fireFlares, fireMissile, pressStrike } from './combat';
import { applyRoute, autopilotAllowed } from './flight';
import { pushEvent, type GameState } from './state';

/** One entry point for firing, used by button edges and by voice or typed commands. */
export function fire(s: GameState, w: WeaponId): boolean {
  if (s.status !== 'playing') return false;
  switch (w) {
    case 'missile':
      return fireMissile(s);
    case 'strike':
      return pressStrike(s) !== 'unavailable';
    case 'flare':
      return fireFlares(s);
    case 'cannon':
      s.player.selected = 'cannon';
      return s.player.rounds > 0;
  }
}

export function setAutopilot(s: GameState, on: boolean): boolean {
  if (on && !autopilotAllowed(s)) return false;
  s.player.autopilot = on;
  pushEvent(s, { type: 'phase', detail: on ? 'autopilot_on' : 'autopilot_off' });
  return true;
}

export function toggleAutopilot(s: GameState): boolean {
  return setAutopilot(s, !s.player.autopilot);
}

export function setRoute(s: GameState, r: RouteKind): string {
  return applyRoute(s, r);
}

export function setBoost(s: GameState, on: boolean): void {
  s.player.boostCommand = on;
}

export function nextTarget(s: GameState): string | null {
  return cycleTarget(s);
}
