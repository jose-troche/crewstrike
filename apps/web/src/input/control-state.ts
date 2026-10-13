import { STEP, clamp, neutralControls, rampKeyAxis, type ControlState } from '@crewstrike/game-core';
import type { Action, Settings } from '../settings';
import type { TouchControls } from './touch';

export type { ControlState };

export interface InputCallbacks {
  pause(): void;
  voice(): void;
  type(): void;
  explain(): void;
  accept(): void;
  pttStart(): void;
  pttEnd(): void;
  gesture(): void;
}

const EDGE_ACTIONS = new Set<Action>(['missile', 'strike', 'flare', 'nextTarget', 'autopilot']);
const APP_ACTIONS = new Set<Action>(['pause', 'voice', 'type', 'explain', 'accept']);
const DEAD_ZONE = 0.12;

function isTyping(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

/** One ControlState hides whether the player uses keys, a gamepad or touch. */
export class InputManager {
  private held = new Set<Action>();
  private latched = new Set<Action>();
  private codeToActions = new Map<string, Action[]>();
  throttle: 0 | 1 | 2 = 1;
  private padPrev: boolean[] = [];
  private padAxisLatch = 0;
  /** Smoothed left/right keys, so a held arrow builds the turn instead of slamming it. */
  private keyX = 0;
  touch: TouchControls | null = null;
  /** Test hooks may force controls for scripted runs. */
  override: Partial<ControlState> | null = null;
  enabled = false;
  lastSource: 'keyboard' | 'gamepad' | 'touch' = 'keyboard';
  remapListener: ((code: string) => void) | null = null;

  /** Desktop flying is keyboard (or gamepad) only; the mouse never steers or fires. */
  constructor(private settings: () => Settings, private cb: InputCallbacks) {
    this.rebuildMap();
    window.addEventListener('keydown', e => this.onKey(e, true));
    window.addEventListener('keyup', e => this.onKey(e, false));
    window.addEventListener('blur', () => this.held.clear());
  }

  rebuildMap(): void {
    this.codeToActions.clear();
    const keys = this.settings().keys;
    for (const [action, codes] of Object.entries(keys) as [Action, string[]][]) {
      for (const c of codes) {
        const arr = this.codeToActions.get(c) ?? [];
        arr.push(action);
        this.codeToActions.set(c, arr);
      }
    }
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (this.remapListener && down) {
      e.preventDefault();
      this.remapListener(e.code);
      return;
    }
    if (isTyping(e)) return;
    const actions = this.codeToActions.get(e.code);
    if (!actions) return;
    if (down) this.cb.gesture();
    if (e.code === 'Tab' || e.code === 'Space' || e.code === 'Slash' || e.code.startsWith('Arrow')) e.preventDefault();
    this.lastSource = 'keyboard';
    for (const a of actions) {
      if (down) {
        if (e.repeat && a !== 'up' && a !== 'down' && a !== 'left' && a !== 'right') continue;
        if (APP_ACTIONS.has(a)) {
          this.app(a);
          continue;
        }
        if (a === 'pushToTalk') {
          if (!this.held.has(a)) this.cb.pttStart();
          this.held.add(a);
          continue;
        }
        if (!this.enabled) continue;
        if (a === 'throttleUp') this.throttle = Math.min(2, this.throttle + 1) as 0 | 1 | 2;
        else if (a === 'throttleDown') this.throttle = Math.max(0, this.throttle - 1) as 0 | 1 | 2;
        else if (EDGE_ACTIONS.has(a)) this.latched.add(a);
        this.held.add(a);
      } else {
        if (a === 'pushToTalk' && this.held.has(a)) this.cb.pttEnd();
        this.held.delete(a);
      }
    }
  }

  private app(a: Action): void {
    if (a === 'pause') this.cb.pause();
    else if (a === 'voice') this.cb.voice();
    else if (a === 'type') this.cb.type();
    else if (a === 'explain') this.cb.explain();
    else if (a === 'accept') this.cb.accept();
  }

  /** Simulate a pressed action (used by touch buttons and commands). */
  press(a: Action): void {
    if (a === 'throttleUp') this.throttle = Math.min(2, this.throttle + 1) as 0 | 1 | 2;
    else if (a === 'throttleDown') this.throttle = Math.max(0, this.throttle - 1) as 0 | 1 | 2;
    else this.latched.add(a);
  }

  resetHeld(): void {
    this.held.clear();
    this.latched.clear();
    this.keyX = 0;
    this.touch?.reset();
  }

  private gamepad(c: ControlState): void {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const pad = [...pads].find(p => p && p.connected);
    if (!pad) return;
    const ax = (i: number): number => {
      const v = pad.axes[i] ?? 0;
      return Math.abs(v) < DEAD_ZONE ? 0 : (v - Math.sign(v) * DEAD_ZONE) / (1 - DEAD_ZONE);
    };
    const btn = (i: number): boolean => !!pad.buttons[i]?.pressed;
    const edge = (i: number): boolean => btn(i) && !this.padPrev[i];
    const sx = ax(0);
    const sy = -ax(1);
    if (sx || sy) {
      c.stickX += sx;
      c.stickY += sy;
      this.lastSource = 'gamepad';
    }
    const ry = ax(3);
    if (ry < -0.6 && this.padAxisLatch === 0) {
      this.throttle = Math.min(2, this.throttle + 1) as 0 | 1 | 2;
      this.padAxisLatch = -1;
    } else if (ry > 0.6 && this.padAxisLatch === 0) {
      this.throttle = Math.max(0, this.throttle - 1) as 0 | 1 | 2;
      this.padAxisLatch = 1;
    } else if (Math.abs(ry) < 0.3) this.padAxisLatch = 0;
    if (btn(6)) c.boost = true;
    if (btn(7)) c.cannon = true;
    if (edge(5)) c.missile = true;
    if (edge(3)) c.strike = true;
    if (edge(4)) c.flare = true;
    if (edge(2)) c.nextTarget = true;
    if (edge(1)) c.autopilot = true;
    if (edge(13)) this.cb.pttStart();
    if (!btn(13) && this.padPrev[13]) this.cb.pttEnd();
    if (btn(13)) c.pushToTalk = true;
    if (edge(9)) this.cb.pause();
    if (edge(8)) this.cb.voice();
    if (edge(0)) this.cb.accept();
    this.padPrev = pad.buttons.map(b => b.pressed);
  }

  /** Merge every source into one ControlState; called once per fixed step, latched presses are consumed once. */
  read(): ControlState {
    const c = neutralControls(this.throttle);
    if (!this.enabled) {
      this.keyX = 0;
      return c;
    }
    const h = this.held;
    const dir = ((h.has('right') ? 1 : 0) - (h.has('left') ? 1 : 0)) as -1 | 0 | 1;
    this.keyX = rampKeyAxis(this.keyX, dir, STEP);
    c.stickX += this.keyX;
    if (h.has('up')) c.stickY += 1;
    if (h.has('down')) c.stickY -= 1;
    c.boost = h.has('boost');
    c.cannon = h.has('cannon');
    c.pushToTalk = h.has('pushToTalk');
    for (const a of this.latched) {
      if (a === 'missile') c.missile = true;
      else if (a === 'strike') c.strike = true;
      else if (a === 'flare') c.flare = true;
      else if (a === 'nextTarget') c.nextTarget = true;
      else if (a === 'autopilot') c.autopilot = true;
    }
    this.latched.clear();
    this.gamepad(c);
    if (this.touch) this.touch.apply(c, this);
    if (this.settings().invertPitch) c.stickY = -c.stickY;
    c.stickX = clamp(c.stickX, -1, 1);
    c.stickY = clamp(c.stickY, -1, 1);
    c.throttle = this.throttle;
    if (this.override) Object.assign(c, this.override);
    return c;
  }
}
