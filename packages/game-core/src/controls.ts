import { clamp } from './math';

/** Device-independent controls; keyboard, gamepad and touch all produce this. */
export interface ControlState {
  /** -1..1, right is positive. */
  stickX: number;
  /** -1..1, nose up is positive. */
  stickY: number;
  throttle: 0 | 1 | 2;
  boost: boolean;
  cannon: boolean;
  missile: boolean;
  strike: boolean;
  flare: boolean;
  nextTarget: boolean;
  autopilot: boolean;
  pushToTalk: boolean;
}

export function neutralControls(throttle: 0 | 1 | 2 = 1): ControlState {
  return {
    stickX: 0, stickY: 0, throttle, boost: false, cannon: false, missile: false,
    strike: false, flare: false, nextTarget: false, autopilot: false, pushToTalk: false,
  };
}

/** Keyboard roll ramp, in stick units per second. */
export const KEY_STEER = { build: 1.25, recentre: 1.6, counter: 5 };

/**
 * Turns on/off steering keys into a smooth stick axis. Holding a key builds the
 * turn gradually; letting go eases back to centre; pressing the other way snaps
 * back to centre quickly before building the new turn.
 */
export function rampKeyAxis(x: number, dir: -1 | 0 | 1, dt: number): number {
  if (dir === 0) return x > 0 ? Math.max(0, x - KEY_STEER.recentre * dt) : Math.min(0, x + KEY_STEER.recentre * dt);
  if (x * dir < 0) return dir > 0 ? Math.min(0, x + KEY_STEER.counter * dt) : Math.max(0, x - KEY_STEER.counter * dt);
  return clamp(x + dir * KEY_STEER.build * dt, -1, 1);
}
