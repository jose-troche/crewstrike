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
