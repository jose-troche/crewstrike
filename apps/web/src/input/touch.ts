import type { ControlState } from '@crewstrike/game-core';
import type { InputManager } from './control-state';

export interface TouchCallbacks {
  pause(): void;
  voice(): void;
  type(): void;
  pttStart(): void;
  pttEnd(): void;
  gesture(): void;
  /** A short buzz on phones that support it; the host decides whether haptics are on. */
  haptic(ms: number): void;
}

/** Touch inputs the cockpit tour can wait for ("try it" steps). */
export type TouchAction = 'stick' | 'cannon' | 'boost' | 'missile' | 'strike' | 'flare' | 'autopilot' | 'throttle';

type Weapon = 'cannon' | 'missile' | 'strike' | 'flare' | 'boost';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

const ICONS: Record<Weapon, string> = {
  cannon: '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5" stroke="currentColor" stroke-width="2"/>',
  missile: '<path d="M12 2c2 2 3 5 3 8v7l2 3h-3l-2-2-2 2H7l2-3v-7c0-3 1-6 3-8z" fill="currentColor"/>',
  strike: '<path d="M12 3l9 9-9 9-9-9z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/>',
  flare: '<path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l4 4M15 15l4 4M19 5l-4 4M9 15l-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  boost: '<path d="M4 6l7 6-7 6M12 6l7 6-7 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>',
};
const icon = (w: Weapon): string => `<svg class="tb-ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[w]}</svg>`;

interface PadButton {
  el: HTMLButtonElement;
  /** hold: on while a thumb rests on it; tap: fires as a thumb lands or slides onto it; click: fires on release (the soft keyboard needs that). */
  kind: 'hold' | 'tap' | 'click';
  press(): void;
  release?(): void;
}

/**
 * Buttons that share one touch surface. A thumb belongs to the nearest button within reach, so a
 * slightly-off press still lands, and a thumb can slide from one button to the next without lifting.
 */
class ThumbPad {
  private owner = new Map<number, PadButton | null>();
  private holds = new Map<PadButton, number>();

  constructor(readonly el: HTMLElement, private buttons: PadButton[], private haptic: (ms: number) => void, private gesture: () => void, private reach = 18) {
    el.addEventListener('pointerdown', e => this.down(e));
    el.addEventListener('pointermove', e => this.move(e));
    el.addEventListener('pointerup', e => this.end(e, true));
    el.addEventListener('pointercancel', e => this.end(e, false));
    el.addEventListener('contextmenu', e => e.preventDefault());
  }

  /** Distance from the button's edge (negative inside it). */
  private gap(b: PadButton, x: number, y: number): number {
    const r = b.el.getBoundingClientRect();
    if (!r.width || getComputedStyle(b.el).visibility === 'hidden') return Infinity;
    return Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2)) - Math.max(r.width, r.height) / 2;
  }

  private pick(x: number, y: number, cur: PadButton | null): PadButton | null {
    let best: PadButton | null = null;
    let bestGap = Infinity;
    for (const b of this.buttons) {
      const g = this.gap(b, x, y);
      if (g < bestGap) {
        bestGap = g;
        best = b;
      }
    }
    // A thumb keeps its button until it is clearly on another one, so a wobble never drops fire.
    if (cur && best !== cur && bestGap > -6 && this.gap(cur, x, y) <= this.reach * 1.6) return cur;
    return bestGap <= this.reach ? best : null;
  }

  private down(e: PointerEvent): void {
    e.preventDefault();
    this.gesture();
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      // synthetic or already-released pointer
    }
    const hit = (e.target as Element | null)?.closest('button');
    const b = this.buttons.find(x => x.el === hit) ?? this.pick(e.clientX, e.clientY, null);
    this.owner.set(e.pointerId, b);
    if (b) this.enter(b);
  }

  private move(e: PointerEvent): void {
    if (!this.owner.has(e.pointerId)) return;
    const cur = this.owner.get(e.pointerId) ?? null;
    const b = this.pick(e.clientX, e.clientY, cur);
    if (b === cur) return;
    if (cur) this.leave(cur, false);
    this.owner.set(e.pointerId, b);
    if (b) this.enter(b);
  }

  private end(e: PointerEvent, released: boolean): void {
    if (!this.owner.has(e.pointerId)) return;
    const cur = this.owner.get(e.pointerId) ?? null;
    this.owner.delete(e.pointerId);
    if (cur) this.leave(cur, released);
  }

  private enter(b: PadButton): void {
    b.el.classList.add('down');
    if (b.kind === 'hold') {
      const n = (this.holds.get(b) ?? 0) + 1;
      this.holds.set(b, n);
      if (n === 1) {
        this.haptic(8);
        b.press();
      }
    } else if (b.kind === 'tap') {
      this.haptic(14);
      b.press();
    }
  }

  private leave(b: PadButton, released: boolean): void {
    const still = [...this.owner.values()].includes(b);
    if (!still) b.el.classList.remove('down');
    if (b.kind === 'hold') {
      const n = Math.max(0, (this.holds.get(b) ?? 0) - 1);
      this.holds.set(b, n);
      if (n === 0) b.release?.();
    } else if (b.kind === 'click' && released) {
      this.haptic(10);
      b.press();
    }
  }

  reset(): void {
    for (const [b, n] of this.holds) if (n > 0) b.release?.();
    this.holds.clear();
    this.owner.clear();
    for (const b of this.buttons) b.el.classList.remove('down');
  }
}

/**
 * Touch controls. The left thumb flies: a floating stick that starts where the thumb lands, plus the
 * throttle rocker, autopilot and comms. The right thumb fights: a big Fire button with Missile, Flare,
 * Strike and Boost on an arc around it, each showing what is left.
 */
export class TouchControls {
  readonly stickZone: HTMLDivElement;
  readonly fireCluster: HTMLDivElement;
  readonly throttle: HTMLDivElement;
  readonly utility: HTMLDivElement;
  readonly buttons = {} as Record<Weapon, HTMLButtonElement>;
  /** The tour listens here for "try it" steps. */
  onAction: ((a: TouchAction) => void) | null = null;
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0, told: false };
  private holds = { cannon: false, boost: false };
  private taps = { missile: false, strike: false, flare: false, autopilot: false };
  private pendingThrottle: 0 | 1 | 2 | null = null;
  private notchEls: HTMLButtonElement[] = [];
  private pads: ThumbPad[] = [];
  strikeBtn: HTMLButtonElement;

  constructor(private cb: TouchCallbacks) {
    const tell = (a: TouchAction): void => this.onAction?.(a);

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
    this.stickZone.addEventListener('contextmenu', e => e.preventDefault());

    this.fireCluster = el('div', 'touch-fire', { 'data-testid': 'touch-fire' });
    const weapon = (w: Weapon, label: string, testid: string): HTMLButtonElement => {
      const b = el('button', `tbtn tbtn-${w}`, { 'data-testid': testid, 'aria-label': label, 'data-help': `key-${w}`, type: 'button' });
      b.innerHTML = `${icon(w)}<span class="tb-name">${label}</span><span class="tb-count"></span>`;
      this.buttons[w] = b;
      return b;
    };
    const fire = weapon('cannon', 'Fire', 'touch-cannon');
    const missile = weapon('missile', 'Missile', 'touch-missile');
    this.strikeBtn = weapon('strike', 'Strike', 'touch-strike');
    const flare = weapon('flare', 'Flare', 'touch-flare');
    const boost = weapon('boost', 'Boost', 'touch-boost');
    this.fireCluster.append(fire, missile, this.strikeBtn, flare, boost);
    const hold = (key: 'cannon' | 'boost', b: HTMLButtonElement): PadButton => ({
      el: b, kind: 'hold',
      press: () => {
        this.holds[key] = true;
        tell(key);
      },
      release: () => {
        this.holds[key] = false;
      },
    });
    const tap = (key: 'missile' | 'strike' | 'flare', b: HTMLButtonElement): PadButton => ({
      el: b, kind: 'tap',
      press: () => {
        this.taps[key] = true;
        tell(key);
      },
    });
    this.pads.push(new ThumbPad(this.fireCluster, [hold('cannon', fire), tap('missile', missile), tap('strike', this.strikeBtn), tap('flare', flare), hold('boost', boost)], ms => cb.haptic(ms), () => cb.gesture(), 22));

    this.throttle = el('div', 'touch-throttle', { 'data-testid': 'touch-throttle', 'data-help': 'key-throttle', role: 'group', 'aria-label': 'Throttle' });
    const notches: PadButton[] = ['Fast', 'Cruise', 'Slow'].map((label, i) => {
      const b = el('button', 'notch', { 'aria-label': `Throttle ${label.toLowerCase()}`, type: 'button' });
      b.textContent = label[0] ?? '';
      this.notchEls.push(b);
      this.throttle.append(b);
      return {
        el: b, kind: 'tap',
        press: () => {
          this.pendingThrottle = (2 - i) as 0 | 1 | 2;
          this.setThrottleUi(this.pendingThrottle);
          tell('throttle');
        },
      };
    });
    this.pads.push(new ThumbPad(this.throttle, notches, ms => cb.haptic(ms), () => cb.gesture(), 10));

    this.utility = el('div', 'touch-utility');
    const ubtn = (label: string, testid: string, html: string, help: string): HTMLButtonElement => {
      const b = el('button', 'ubtn', { 'data-testid': testid, 'aria-label': label, type: 'button', 'data-help': help });
      b.innerHTML = html;
      this.utility.append(b);
      return b;
    };
    const ap = ubtn('Autopilot', 'touch-autopilot', 'AP', 'key-autopilot');
    const mic = ubtn('Hold to talk', 'touch-mic', '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4" fill="none" stroke="currentColor" stroke-width="2"/></svg>', 'key-ptt');
    const kbd = ubtn('Type to the crew', 'touch-keyboard', '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 10h1M10 10h1M14 10h1M18 10h1M7 14h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>', 'key-type');
    this.pads.push(new ThumbPad(this.utility, [
      { el: ap, kind: 'tap', press: () => { this.taps.autopilot = true; tell('autopilot'); } },
      { el: mic, kind: 'hold', press: () => cb.pttStart(), release: () => cb.pttEnd() },
      { el: kbd, kind: 'click', press: () => cb.type() },
    ], ms => cb.haptic(ms), () => cb.gesture(), 10));
  }

  private stickDown(e: PointerEvent): void {
    if (this.stick.id !== -1) return;
    e.preventDefault();
    this.cb.gesture();
    try {
      this.stickZone.setPointerCapture(e.pointerId);
    } catch {
      // synthetic or already-released pointer
    }
    const r = this.stickZone.getBoundingClientRect();
    this.stick = { id: e.pointerId, ox: e.clientX - r.left, oy: e.clientY - r.top, x: 0, y: 0, told: false };
    this.placeBase();
    this.base.classList.add('on');
    this.knob.style.transform = 'translate(-50%, -50%)';
  }

  private placeBase(): void {
    this.base.style.left = `${this.stick.ox}px`;
    this.base.style.top = `${this.stick.oy}px`;
  }

  private stickMove(e: PointerEvent): void {
    if (e.pointerId !== this.stick.id) return;
    const r = this.stickZone.getBoundingClientRect();
    const radius = Math.max(36, this.base.offsetWidth * 0.46 || 46);
    let dx = e.clientX - r.left - this.stick.ox;
    let dy = e.clientY - r.top - this.stick.oy;
    const d = Math.hypot(dx, dy);
    if (d > radius) {
      // The base trails the thumb, so reversing direction answers at once instead of crossing back.
      this.stick.ox += dx * (1 - radius / d);
      this.stick.oy += dy * (1 - radius / d);
      this.placeBase();
      dx = (dx / d) * radius;
      dy = (dy / d) * radius;
    }
    // Small dead zone, then a gentle curve: fine aim near the middle, full rate at the edge.
    const m = Math.min(1, Math.hypot(dx, dy) / radius);
    const out = m < 0.08 ? 0 : ((m - 0.08) / 0.92) * (0.4 + 0.6 * m);
    const k = m > 0 ? out / m : 0;
    this.stick.x = (dx / radius) * k;
    this.stick.y = (dy / radius) * k;
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    if (!this.stick.told && m > 0.5) {
      this.stick.told = true;
      this.onAction?.('stick');
    }
  }

  private stickUp(e: PointerEvent): void {
    if (e.pointerId !== this.stick.id) return;
    this.stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0, told: false };
    this.base.classList.remove('on');
  }

  /** A faint stick at rest shows new pilots where the left thumb goes. */
  setGhost(on: boolean): void {
    this.stickZone.classList.toggle('ghost', on);
  }

  setStrikeVisible(on: boolean): void {
    this.strikeBtn.classList.toggle('off', !on);
  }

  setThrottleUi(t: 0 | 1 | 2): void {
    this.notchEls.forEach((b, i) => b.classList.toggle('active', 2 - i === t));
  }

  private counts = new Map<HTMLElement, string>();

  /** Rounds, missiles, strikes and flares left, and lock state, shown on the buttons themselves. */
  setWeapons(n: { cannon: number; missile: number; strike: number; flare: number; lock: string; strikeLock: string }): void {
    for (const w of ['cannon', 'missile', 'strike', 'flare'] as const) {
      const c = this.buttons[w].querySelector<HTMLElement>('.tb-count')!;
      const v = String(n[w]);
      if (this.counts.get(c) !== v) {
        this.counts.set(c, v);
        c.textContent = v;
      }
      this.buttons[w].classList.toggle('empty', n[w] === 0);
    }
    if (this.buttons.missile.dataset.lock !== n.lock) this.buttons.missile.dataset.lock = n.lock;
    if (this.buttons.strike.dataset.lock !== n.strikeLock) this.buttons.strike.dataset.lock = n.strikeLock;
  }

  /** Drop every held button and queued tap (on mission start, pause and tour exit). */
  reset(): void {
    for (const p of this.pads) p.reset();
    this.holds = { cannon: false, boost: false };
    this.taps = { missile: false, strike: false, flare: false, autopilot: false };
    this.pendingThrottle = null;
    this.stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0, told: false };
    this.base.classList.remove('on');
  }

  apply(c: ControlState, input: InputManager): void {
    if (this.stick.id !== -1) {
      c.stickX += this.stick.x;
      c.stickY += -this.stick.y;
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
