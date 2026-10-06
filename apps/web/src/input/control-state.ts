import { clamp, neutralControls, type ControlState } from '@crewstrike/game-core';
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
  private mouse = { x: 0, y: 0, active: false, down: false, lastX: 0, lastY: 0 };
  private padPrev: boolean[] = [];
  private padAxisLatch = 0;
  touch: TouchControls | null = null;
  /** Test hooks may force controls for scripted runs. */
  override: Partial<ControlState> | null = null;
  enabled = false;
  lastSource: 'keyboard' | 'mouse' | 'gamepad' | 'touch' = 'keyboard';
  remapListener: ((code: string) => void) | null = null;

  constructor(private settings: () => Settings, private cb: InputCallbacks, private stage: HTMLElement) {
    this.rebuildMap();
    window.addEventListener('keydown', e => this.onKey(e, true));
    window.addEventListener('keyup', e => this.onKey(e, false));
    window.addEventListener('blur', () => this.held.clear());
    stage.addEventListener('mousemove', e => this.onMouseMove(e));
    stage.addEventListener('mousedown', e => {
      cb.gesture();
      if (e.button === 0 && this.enabled) {
        this.mouse.down = true;
        this.lastSource = 'mouse';
      }
    });
    window.addEventListener('mouseup', () => {
      this.mouse.down = false;
    });
    stage.addEventListener('mouseleave', () => {
      this.mouse.active = false;
    });
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
        if (a === 'up' || a === 'down' || a === 'left' || a === 'right') this.mouse.active = false;
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

  private onMouseMove(e: MouseEvent): void {
    if (!this.settings().mouseSteer || !this.enabled) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const nx = (e.clientX - w / 2) / (Math.min(w, h) * 0.35);
    const ny = (e.clientY - h / 2) / (Math.min(w, h) * 0.35);
    // Only take over after a real movement so a resting mouse never steers.
    if (!this.mouse.active && Math.hypot(e.clientX - this.mouse.lastX, e.clientY - this.mouse.lastY) < 24) return;
    this.mouse.lastX = e.clientX;
    this.mouse.lastY = e.clientY;
    this.mouse.active = true;
    this.mouse.x = clamp(nx, -1, 1);
    this.mouse.y = clamp(ny, -1, 1);
    this.lastSource = 'mouse';
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
    this.mouse.down = false;
    this.mouse.active = false;
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

  /** Merge every source into one ControlState; latched presses are consumed once. */
  read(): ControlState {
    const c = neutralControls(this.throttle);
    if (!this.enabled) return c;
    const h = this.held;
    if (h.has('left')) c.stickX -= 1;
    if (h.has('right')) c.stickX += 1;
    if (h.has('up')) c.stickY += 1;
    if (h.has('down')) c.stickY -= 1;
    if (this.mouse.active && !(h.has('left') || h.has('right') || h.has('up') || h.has('down'))) {
      const dz = (v: number): number => (Math.abs(v) < 0.06 ? 0 : v);
      c.stickX += dz(this.mouse.x);
      c.stickY += -dz(this.mouse.y);
    }
    c.boost = h.has('boost');
    c.cannon = h.has('cannon') || this.mouse.down;
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
