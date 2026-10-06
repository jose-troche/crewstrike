import type { ControlState } from '@crewstrike/game-core';
import type { InputManager } from './control-state';

export interface TouchCallbacks {
  pause(): void;
  voice(): void;
  type(): void;
  pttStart(): void;
  pttEnd(): void;
  gesture(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/**
 * Touch controls: a floating virtual stick on the left half that starts where the thumb lands,
 * a fire cluster on the right, and a throttle slider on the left edge.
 */
export class TouchControls {
  readonly stickZone: HTMLDivElement;
  readonly fireCluster: HTMLDivElement;
  readonly throttle: HTMLDivElement;
  readonly utility: HTMLDivElement;
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private holds = { cannon: false, boost: false };
  private taps = { missile: false, strike: false, flare: false, autopilot: false };
  strikeBtn: HTMLButtonElement;
  private notchEls: HTMLButtonElement[] = [];

  constructor(private cb: TouchCallbacks) {
    this.stickZone = el('div', 'touch-stick-zone', { 'data-testid': 'touch-stick', 'data-help': 'key-stick' });
    this.base = el('div', 'stick-base');
    this.knob = el('div', 'stick-knob');
    this.base.append(this.knob);
    this.stickZone.append(this.base);
    this.stickZone.addEventListener('pointerdown', e => this.stickDown(e));
    this.stickZone.addEventListener('pointermove', e => this.stickMove(e));
    const up = (e: PointerEvent): void => this.stickUp(e);
    this.stickZone.addEventListener('pointerup', up);
    this.stickZone.addEventListener('pointercancel', up);

    this.fireCluster = el('div', 'touch-fire', { 'data-testid': 'touch-fire' });
    const hold = (label: string, key: 'cannon' | 'boost', testid: string, help: string): HTMLButtonElement => {
      const b = el('button', `tbtn tbtn-${key}`, { 'data-testid': testid, 'aria-label': label, 'data-help': help, type: 'button' });
      b.textContent = label;
      b.addEventListener('pointerdown', e => {
        e.preventDefault();
        cb.gesture();
        this.holds[key] = true;
        b.classList.add('down');
      });
      const release = (): void => {
        this.holds[key] = false;
        b.classList.remove('down');
      };
      b.addEventListener('pointerup', release);
      b.addEventListener('pointercancel', release);
      b.addEventListener('pointerleave', release);
      return b;
    };
    const tap = (label: string, key: keyof TouchControls['taps'], testid: string, help: string): HTMLButtonElement => {
      const b = el('button', `tbtn tbtn-${key}`, { 'data-testid': testid, 'aria-label': label, 'data-help': help, type: 'button' });
      b.textContent = label;
      b.addEventListener('pointerdown', e => {
        e.preventDefault();
        cb.gesture();
        this.taps[key] = true;
      });
      return b;
    };
    this.strikeBtn = tap('Strike', 'strike', 'touch-strike', 'key-strike');
    this.fireCluster.append(
      hold('Fire', 'cannon', 'touch-cannon', 'key-cannon'),
      tap('Missile', 'missile', 'touch-missile', 'key-missile'),
      this.strikeBtn,
      tap('Flare', 'flare', 'touch-flare', 'key-flare'),
      hold('Boost', 'boost', 'touch-boost', 'key-boost'),
    );

    this.throttle = el('div', 'touch-throttle', { 'data-testid': 'touch-throttle', 'data-help': 'key-throttle', role: 'group', 'aria-label': 'Throttle' });
    ['Fast', 'Cruise', 'Slow'].forEach((label, i) => {
      const b = el('button', 'notch', { 'aria-label': `Throttle ${label.toLowerCase()}`, type: 'button' });
      b.textContent = label[0] ?? '';
      b.addEventListener('pointerdown', e => {
        e.preventDefault();
        cb.gesture();
        this.pendingThrottle = (2 - i) as 0 | 1 | 2;
      });
      this.notchEls.push(b);
      this.throttle.append(b);
    });

    this.utility = el('div', 'touch-utility');
    const util = (label: string, testid: string, fn: () => void, help = ''): HTMLButtonElement => {
      const b = el('button', 'ubtn', { 'data-testid': testid, 'aria-label': label, type: 'button', ...(help ? { 'data-help': help } : {}) });
      b.textContent = label;
      b.addEventListener('click', () => {
        cb.gesture();
        fn();
      });
      return b;
    };
    const mic = el('button', 'ubtn', { 'data-testid': 'touch-mic', 'aria-label': 'Hold to talk', type: 'button', 'data-help': 'key-ptt' });
    mic.textContent = '🎙';
    mic.addEventListener('pointerdown', e => {
      e.preventDefault();
      cb.gesture();
      cb.pttStart();
    });
    mic.addEventListener('pointerup', () => cb.pttEnd());
    mic.addEventListener('pointercancel', () => cb.pttEnd());
    this.utility.append(
      util('AP', 'touch-autopilot', () => {
        this.taps.autopilot = true;
      }, 'key-autopilot'),
      mic,
      util('⌨', 'touch-keyboard', () => cb.type()),
    );
  }

  private pendingThrottle: 0 | 1 | 2 | null = null;

  private stickDown(e: PointerEvent): void {
    if (this.stick.id !== -1) return;
    this.cb.gesture();
    this.stickZone.setPointerCapture(e.pointerId);
    const r = this.stickZone.getBoundingClientRect();
    this.stick = { id: e.pointerId, ox: e.clientX - r.left, oy: e.clientY - r.top, x: 0, y: 0 };
    this.base.style.left = `${this.stick.ox}px`;
    this.base.style.top = `${this.stick.oy}px`;
    this.base.classList.add('on');
    this.knob.style.transform = 'translate(-50%, -50%)';
  }

  private stickMove(e: PointerEvent): void {
    if (e.pointerId !== this.stick.id) return;
    const r = this.stickZone.getBoundingClientRect();
    const radius = 46;
    let dx = e.clientX - r.left - this.stick.ox;
    let dy = e.clientY - r.top - this.stick.oy;
    const d = Math.hypot(dx, dy);
    if (d > radius) {
      dx = (dx / d) * radius;
      dy = (dy / d) * radius;
    }
    this.stick.x = dx / radius;
    this.stick.y = dy / radius;
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  private stickUp(e: PointerEvent): void {
    if (e.pointerId !== this.stick.id) return;
    this.stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
    this.base.classList.remove('on');
  }

  setStrikeVisible(on: boolean): void {
    this.strikeBtn.classList.toggle('hidden', !on);
  }

  setThrottleUi(t: 0 | 1 | 2): void {
    this.notchEls.forEach((b, i) => b.classList.toggle('active', 2 - i === t));
  }

  apply(c: ControlState, input: InputManager): void {
    if (this.stick.id !== -1) {
      const dz = (v: number): number => (Math.abs(v) < 0.1 ? 0 : v);
      c.stickX += dz(this.stick.x);
      c.stickY += -dz(this.stick.y);
      input.lastSource = 'touch';
    }
    if (this.holds.cannon) c.cannon = true;
    if (this.holds.boost) c.boost = true;
    if (this.taps.missile) c.missile = true;
    if (this.taps.strike) c.strike = true;
    if (this.taps.flare) c.flare = true;
    if (this.taps.autopilot) c.autopilot = true;
    this.taps = { missile: false, strike: false, flare: false, autopilot: false };
    if (this.pendingThrottle !== null) {
      input.throttle = this.pendingThrottle;
      this.pendingThrottle = null;
    }
  }
}
