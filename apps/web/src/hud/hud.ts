import {
  AGENT_IDS, HUD_ZONES, ZONE_HELP, ZONE_OWNERS,
  type Advice, type AgentId, type AgentOutput, type ConsoleLine, type HudZone, type Level, type VoiceMode,
} from '@crewstrike/shared';
import {
  DEG, compass, dist, dist2d, fuelToExit, strikeAvailable, wrap180, TRAINING_STEPS, type GameState,
} from '@crewstrike/game-core';
import { AGENT_NAMES, agentIcon } from './icons';
import { Radar } from './radar';
import { Overlay } from './overlay';
import { readPalette, type PaletteColors } from './palette';
import type { GameScene } from '../game/scene';
import { TouchControls, type TouchCallbacks } from '../input/touch';
import './hud.css';

export type LayoutMode = 'wide' | 'compact' | 'touch' | 'rotate';

export interface HudHost extends TouchCallbacks {
  help(): void;
  pause(): void;
  cycleVoice(): void;
  explain(): void;
  submitCommand(text: string): void;
  acceptAction(): void;
  selectTarget(id: string): void;
  keyFor(action: string): string;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  if (html) e.innerHTML = html;
  return e;
}

const DAMAGE_SVG = `<svg viewBox="0 0 100 110" aria-hidden="true">
  <path data-sec="nose" d="M50 2 L58 28 L42 28 Z"/>
  <path data-sec="body" d="M42 28 L58 28 L60 78 L40 78 Z"/>
  <path data-sec="leftWing" d="M42 40 L4 70 L4 78 L41 66 Z"/>
  <path data-sec="rightWing" d="M58 40 L96 70 L96 78 L59 66 Z"/>
  <path data-sec="tail" d="M40 78 L60 78 L72 102 L50 96 L28 102 Z"/>
</svg>`;

const ARROW_SVG = '<svg class="obj-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 L20 20 L12 15 L4 20 Z" fill="currentColor"/></svg>';
const WIND_SVG = '<svg class="wind" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 L17 10 H13.5 V22 H10.5 V10 H7 Z" fill="currentColor"/></svg>';

const lvl3 = (v: number, amber: number, red: number): Level => (v >= red ? 'red' : v >= amber ? 'amber' : 'green');

/** DOM HUD: SVG gauges and CSS grid, written directly and only when values change. */
export class Hud {
  readonly root: HTMLDivElement;
  readonly overlay = new Overlay();
  readonly radar = new Radar();
  readonly touch: TouchControls;
  private cache = new Map<Element, string>();
  private z = {} as Record<HudZone, HTMLElement>;
  private el: Record<string, HTMLElement> = {};
  private crew = {} as Record<AgentId, HTMLButtonElement>;
  private wedges: SVGPathElement[] = [];
  private ttis: SVGTextElement[] = [];
  private frame = 0;
  private palette: PaletteColors = readPalette();
  private explainTimer = 0;
  private highlightTimer = 0;
  private verdictTimer = 0;
  private glowTimers = new Map<Element, number>();
  private hitFlashAt = -1;
  mode: LayoutMode = 'wide';
  history: ConsoleLine[] = [];
  private lines: ConsoleLine[] = [];
  private lastTick = 0;

  constructor(container: HTMLElement, private host: HudHost) {
    const root = h('div', { class: 'hud', 'data-testid': 'cockpit', 'data-mode': 'wide' });
    this.root = root;
    this.touch = new TouchControls(host);
    root.append(this.touch.stickZone);

    // Top row.
    const weather = h('section', { class: 'panel weather area-weather', 'data-zone': 'weather', 'data-help': 'weather' },
      `<span class="label">Wind</span>${WIND_SVG}<span class="wind-kt big" style="font-size:1em">0 kt</span><span class="storm"></span>`);
    const missionArea = h('div', { class: 'area-mission' });
    const topbar = h('div', { class: 'topbar' });
    const helpBtn = h('button', { class: 'iconbtn', 'aria-label': 'Help', 'data-testid': 'help-btn', type: 'button', title: 'Help' }, '?');
    helpBtn.addEventListener('click', () => host.help());
    const pauseBtn = h('button', { class: 'iconbtn', 'aria-label': 'Pause', 'data-testid': 'pause-btn', type: 'button', title: 'Pause (Esc)' }, '❚❚');
    pauseBtn.addEventListener('click', () => host.pause());
    const voiceBtn = h('button', { class: 'iconbtn', 'aria-label': 'Voice: critical', 'data-testid': 'voice-toggle', type: 'button', title: 'Voice mode (M)' }, '🔊');
    voiceBtn.addEventListener('click', () => host.cycleVoice());
    topbar.append(helpBtn, pauseBtn, voiceBtn);
    const missionBar = h('section', { class: 'panel mission-bar', 'data-zone': 'mission-bar', 'data-help': 'mission-bar' },
      '<span class="timer">00:00</span><span class="score">0</span><span class="stars">☆☆☆</span>');
    missionArea.append(topbar, missionBar);
    const objective = h('section', { class: 'panel objective area-objective', 'data-zone': 'objective', 'data-help': 'objective', 'data-target': 'target' },
      `<span class="phase-chip" data-phase="ingress">INGRESS</span>${ARROW_SVG}<span class="obj-dist big" style="font-size:1.1em">--</span>`);

    // Middle row.
    const left = h('div', { class: 'area-left' });
    const speed = h('section', { class: 'panel tape speed', 'data-zone': 'speed', 'data-help': 'speed' },
      `<span class="label">Speed kt</span><span class="big spd">0</span><div class="bar"><i class="fill"></i></div>
       <div class="notches"><span class="notch-ind" data-n="0">S</span><span class="notch-ind" data-n="1">C</span><span class="notch-ind" data-n="2">F</span></div>
       <div class="boost" title="Boost"><i></i></div>`);
    const fuel = h('section', { class: 'panel fuel', 'data-zone': 'fuel', 'data-help': 'fuel' },
      '<span class="label">Fuel</span> <span class="big fpct" style="font-size:1.05em">100%</span><div class="bar"><i class="fill lvl"></i><i class="home"></i></div>');
    left.append(speed, fuel);
    const right = h('div', { class: 'area-right' });
    const altitude = h('section', { class: 'panel tape altitude', 'data-zone': 'altitude', 'data-help': 'altitude' },
      '<span class="label">Alt m AGL</span><span class="big alt">0</span><div class="bar"><i class="fill"></i></div>');
    const damage = h('section', { class: 'panel damage', 'data-zone': 'damage', 'data-help': 'damage' },
      `<span class="label">Damage</span>${DAMAGE_SVG}<span class="big dpct" style="font-size:1em">0%</span>`);
    right.append(altitude, damage);

    const aim = h('div', { class: 'aim-area', 'data-testid': 'aim-area' });
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ring.setAttribute('class', 'threat-ring');
    ring.setAttribute('viewBox', '-100 -100 200 200');
    ring.setAttribute('data-zone', 'threat-ring');
    ring.setAttribute('data-help', 'threat-ring');
    ring.innerHTML = '<circle class="base" r="80"/>';
    for (let i = 0; i < 8; i++) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('class', 'wedge');
      p.style.display = 'none';
      ring.append(p);
      this.wedges.push(p);
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('text-anchor', 'middle');
      t.style.display = 'none';
      ring.append(t);
      this.ttis.push(t);
    }
    aim.append(ring);

    // Bottom row.
    const radarSec = h('section', { class: 'panel radar area-radar', 'data-zone': 'radar', 'data-help': 'radar' });
    radarSec.append(this.radar.canvas);
    const rangeBtn = h('button', { class: 'range', type: 'button', 'aria-label': 'Radar range', 'data-testid': 'radar-range' }, '20 km');
    rangeBtn.addEventListener('click', e => {
      e.stopPropagation();
      this.radar.cycleRange();
      rangeBtn.textContent = `${this.radar.range / 1000} km`;
    });
    radarSec.append(rangeBtn);
    this.radar.canvas.addEventListener('pointerdown', e => {
      host.gesture();
      if (!this.lastState) return;
      const en = this.radar.enemyAt(this.lastState, e.clientX, e.clientY);
      if (en) host.selectTarget(en.id);
    });

    const consoleArea = h('div', { class: 'area-console' });
    const verdict = h('div', { class: 'verdict interactive', 'data-testid': 'verdict' },
      '<span class="verdict-chip" data-testid="verdict-chip"></span><span class="verdict-reason" data-testid="verdict-reason"></span>');
    const vAction = h('button', { class: 'verdict-action', 'data-testid': 'verdict-action', type: 'button' });
    vAction.addEventListener('click', () => host.acceptAction());
    verdict.append(vAction);
    const consoleList = h('ul', { class: 'console', 'data-zone': 'console', 'data-testid': 'console', 'data-help': 'console', 'aria-live': 'polite' });
    consoleList.addEventListener('click', e => {
      const li = (e.target as HTMLElement).closest('li');
      li?.classList.toggle('open');
    });
    const ptt = h('div', { class: 'ptt', 'data-testid': 'ptt-indicator' }, '● LISTENING');
    const command = h('form', { class: 'command', 'data-testid': 'command' });
    const input = h('input', { 'data-testid': 'command-input', placeholder: 'Ask the crew: fuel? / should I escape?', 'aria-label': 'Ask the crew', autocomplete: 'off', enterkeyhint: 'send' });
    command.append(input);
    command.addEventListener('submit', e => {
      e.preventDefault();
      const v = input.value.trim();
      input.value = '';
      this.closeCommand();
      if (v) host.submitCommand(v);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.closeCommand();
      }
    });
    const strip = h('div', { class: 'crew-strip', 'data-testid': 'crew-strip' });
    for (const id of AGENT_IDS) {
      const b = h('button', { class: 'crew', type: 'button', 'data-agent-icon': id, 'data-active': 'false', 'aria-label': `${AGENT_NAMES[id]} agent` },
        `${agentIcon(id, 20)}<span class="tip">${AGENT_NAMES[id]}</span>`);
      b.addEventListener('click', () => {
        host.gesture();
        b.classList.toggle('show-tip');
        setTimeout(() => b.classList.remove('show-tip'), 2500);
      });
      this.crew[id] = b;
      strip.append(b);
    }
    const explainBtn = h('button', { class: 'crew', type: 'button', 'data-testid': 'explain-btn', 'aria-label': 'Explain instruments', title: 'Explain instruments (H)' }, '<b>i</b>');
    explainBtn.style.opacity = '1';
    explainBtn.addEventListener('click', () => host.explain());
    const logBtn = h('button', { class: 'crew', type: 'button', 'data-testid': 'log-btn', 'aria-label': 'Message log', title: 'Message log' }, '<b>≡</b>');
    logBtn.style.opacity = '1';
    logBtn.addEventListener('click', () => this.toggleHistory());
    const ai = h('span', { class: 'ai-status', 'data-testid': 'ai-status', 'data-state': 'template', title: 'AI: local templates' });
    strip.append(explainBtn, logBtn, ai);
    const legend = h('div', { class: 'legend', 'data-testid': 'legend' });
    consoleArea.append(verdict, consoleList, ptt, command, strip, legend);

    const weaponsArea = h('div', { class: 'area-weapons' });
    const weapons = h('section', { class: 'panel weapons', 'data-zone': 'weapons', 'data-help': 'weapons' });
    const card = (id: string, name: string, key: string): HTMLElement => h('div', { class: 'wcard', 'data-w': id, 'data-help': `weapon-${id}` },
      `<span class="wname">${name}</span><span class="wcount">0</span><span class="lock"></span><span class="keycap" data-help="key-${id}" data-key="${key}">${host.keyFor(key)}</span>`);
    weapons.append(card('cannon', 'Cannon', 'cannon'), card('missile', 'Missile', 'missile'), card('strike', 'Strike', 'strike'), card('flare', 'Flare', 'flare'));
    const flares = h('section', { class: 'panel flares', 'data-zone': 'flares', 'data-help': 'flares' });
    for (let i = 0; i < 16; i++) flares.append(h('i'));
    weaponsArea.append(weapons, flares);

    root.append(weather, missionArea, objective, left, right, aim, radarSec, consoleArea, weaponsArea);
    this.touch.fireCluster.classList.add('touch-only');
    this.touch.throttle.classList.add('touch-only');
    this.touch.utility.classList.add('touch-only');
    this.touch.stickZone.classList.add('touch-only');
    root.append(this.touch.fireCluster, this.touch.throttle, this.touch.utility);

    const frame = h('div', { class: 'frame' });
    const vignette = h('div', { class: 'vignette' });
    const flash = h('div', { class: 'edge-flash', 'data-testid': 'edge-flash' });
    const hint = h('div', { class: 'training-hint', 'data-testid': 'training-hint' });
    const hist = h('div', { class: 'history', 'data-testid': 'history', role: 'dialog', 'aria-label': 'Message log' });
    const explain = h('div', { class: 'explain-layer', 'data-testid': 'explain-layer' });
    container.append(frame, vignette, this.overlay.canvas, flash, root, hint, hist, explain);

    for (const zone of HUD_ZONES) {
      const e = root.querySelector<HTMLElement>(`[data-zone="${zone}"]`) ?? (zone === 'threat-ring' ? (ring as unknown as HTMLElement) : null);
      if (!e) throw new Error(`missing zone ${zone}`);
      e.setAttribute('title', ZONE_HELP[zone]);
      e.dataset.helpText = ZONE_HELP[zone];
      this.z[zone] = e;
    }
    Object.assign(this.el, { weather, objective, speed, fuel, altitude, damage, missionBar, weapons, flares, consoleList, verdict, vAction, input, command, ptt, ai, legend, voiceBtn, frame, vignette, flash, hint, hist, explain, aim, strip });
  }

  private lastState: GameState | null = null;

  private set(e: Element | null | undefined, text: string): void {
    if (!e) return;
    if (this.cache.get(e) === text) return;
    this.cache.set(e, text);
    e.textContent = text;
  }

  private attr(e: Element | null | undefined, name: string, v: string): void {
    if (!e) return;
    if (e.getAttribute(name) !== v) e.setAttribute(name, v);
  }

  private q<T extends Element = HTMLElement>(parent: Element, sel: string): T | null {
    return parent.querySelector<T>(sel);
  }

  setMode(mode: LayoutMode): void {
    this.mode = mode;
    this.attr(this.root, 'data-mode', mode);
  }

  setPaletteChanged(): void {
    this.palette = readPalette();
  }

  setReducedMotion(on: boolean): void {
    this.overlay.reducedMotion = on;
    this.root.classList.toggle('reduced', on);
  }

  setVoice(mode: VoiceMode): void {
    this.el.voiceBtn!.textContent = mode === 'off' ? '🔇' : mode === 'all' ? '🔊+' : '🔊';
    this.attr(this.el.voiceBtn, 'aria-label', `Voice: ${mode}`);
    this.attr(this.el.voiceBtn, 'data-voice', mode);
  }

  setAiStatus(state: 'edge' | 'device' | 'template' | 'low' | 'offline', title: string): void {
    this.attr(this.el.ai, 'data-state', state);
    this.attr(this.el.ai, 'title', title);
  }

  /** Menus sit over the live cockpit; the HUD dims but stays visible. */
  setDim(on: boolean): void {
    this.root.classList.toggle('dim', on);
    this.overlay.canvas.style.visibility = on ? 'hidden' : 'visible';
  }

  /** Per-frame: overlay and threat ring at 60 Hz, gauges and radar at 30 Hz. */
  draw(s: GameState, scene: GameScene, nowMs: number, dtMs: number, comfortVignette: boolean): void {
    this.lastState = s;
    this.frame += 1;
    this.overlay.draw(s, scene, this.palette, nowMs, dtMs);
    this.drawThreatRing(s);
    if (this.frame % 2 === 0) {
      this.drawGauges(s);
      this.radar.draw(s, this.palette);
    }
    // Comfort vignette darkens the edges during hard turns.
    const turn = Math.abs(s.player.yawRate) / 0.9;
    this.el.vignette!.style.opacity = comfortVignette ? String(Math.min(0.85, Math.max(0, turn - 0.35) * 1.3)) : '0';
    // Hit flash at the edge the hit came from.
    if (s.lastHitAt !== this.hitFlashAt && s.lastHitAt > 0) {
      this.hitFlashAt = s.lastHitAt;
      const b = s.lastHitBearing;
      const dir = Math.abs(b) < 45 ? 'top' : Math.abs(b) > 135 ? 'bottom' : b < 0 ? 'left' : 'right';
      const c = this.palette.red;
      this.el.flash!.style.background = `linear-gradient(to ${({ top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const)[dir]}, ${c}aa, transparent 22%)`;
      this.el.flash!.style.transition = 'none';
      this.el.flash!.style.opacity = '1';
      void this.el.flash!.offsetWidth;
      this.el.flash!.style.transition = 'opacity 0.5s';
      this.el.flash!.style.opacity = '0';
    }
    this.touch.setStrikeVisible(strikeAvailable(s));
    this.touch.setThrottleUi(s.player.throttle);
    this.drawTraining(s);
  }

  private drawGauges(s: GameState): void {
    const p = s.player;
    // Speed.
    const sp = this.el.speed!;
    this.set(this.q(sp, '.spd'), String(Math.round(p.speed * 1.944)));
    (this.q(sp, '.fill') as HTMLElement).style.height = `${Math.min(100, (p.speed / 470) * 100)}%`;
    sp.querySelectorAll<HTMLElement>('.notch-ind').forEach(n => n.classList.toggle('on', Number(n.dataset.n) === p.throttle));
    (this.q(sp, '.boost > i') as HTMLElement).style.width = `${Math.round(p.boostEnergy * 100)}%`;
    this.attr(sp, 'data-level', p.stalled ? 'red' : p.stallWarn ? 'amber' : 'green');

    // Fuel with the home line.
    const need = fuelToExit(s);
    const fu = this.el.fuel!;
    const frac = p.fuel / p.fuelMax;
    this.set(this.q(fu, '.fpct'), `${Math.round(frac * 100)}%`);
    (this.q(fu, '.fill') as HTMLElement).style.width = `${(frac * 100).toFixed(1)}%`;
    (this.q(fu, '.home') as HTMLElement).style.left = `${Math.min(99, (need / p.fuelMax) * 100).toFixed(1)}%`;
    this.attr(fu, 'data-level', p.fuel > need * 1.3 && frac >= 0.2 ? 'green' : p.fuel > need ? 'amber' : 'red');

    // Altitude.
    const al = this.el.altitude!;
    this.set(this.q(al, '.alt'), String(Math.max(0, Math.round(p.agl))));
    (this.q(al, '.fill') as HTMLElement).style.height = `${Math.min(100, (Math.log10(Math.max(10, p.agl)) - 1) / 2.6 * 100)}%`;
    this.attr(al, 'data-level', p.agl < 150 || (p.groundWarn && p.climbRate < 0) ? 'red' : p.agl < 300 || p.groundWarn ? 'amber' : 'green');

    // Damage silhouette.
    const dm = this.el.damage!;
    for (const [sec, v] of Object.entries(p.sections)) this.attr(this.q(dm, `[data-sec="${sec}"]`), 'data-level', lvl3(v, 0.34, 0.67));
    this.set(this.q(dm, '.dpct'), `${Math.round(p.damage * 100)}%`);
    this.attr(dm, 'data-level', lvl3(p.damage, 0.3, 0.6));

    // Weather.
    const we = this.el.weather!;
    const [windFrom, windKt] = s.mission.weather.windKt;
    const rel = windFrom + 180 - p.heading / DEG;
    (this.q(we, '.wind') as HTMLElement).style.transform = `rotate(${rel.toFixed(0)}deg)`;
    this.set(this.q(we, '.wind-kt'), `${windKt} kt`);
    let storm = '';
    if (s.inStorm) storm = 'IN STORM';
    else {
      let best = Infinity;
      for (const st of s.storms) if (st.active) best = Math.min(best, dist2d(st.pos, p.pos) - st.radius);
      if (best < 15000) storm = `Storm ${(Math.max(0, best) / 1000).toFixed(1)} km`;
    }
    this.set(this.q(we, '.storm'), storm);
    this.attr(we, 'data-level', s.inStorm ? 'amber' : 'green');

    // Objective and phase chip.
    const ob = this.el.objective!;
    const chip = this.q(ob, '.phase-chip');
    const phaseLabel = s.training ? 'TRAINING' : { ingress: 'INGRESS', fight: 'FIGHT', strike: 'STRIKE', egress: 'EGRESS' }[s.phase];
    this.set(chip, phaseLabel);
    this.attr(chip, 'data-phase', s.phase);
    const obj = this.overlay.objective(s);
    this.attr(ob, 'data-target', obj.color === 'green' ? 'exit' : 'target');
    this.set(this.q(ob, '.obj-dist'), `${obj.label} ${(dist2d(p.pos, obj.pos) / 1000).toFixed(1)} km`);
    const bearing = wrap180(compass(p.pos, obj.pos) - p.heading / DEG);
    (this.q(ob, '.obj-arrow') as HTMLElement).style.transform = `rotate(${bearing.toFixed(0)}deg)`;

    // Mission bar.
    const mb = this.el.missionBar!;
    const t = Math.floor(s.t);
    this.set(this.q(mb, '.timer'), `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
    const live = Math.max(0, Math.round(((s.target.alive ? 0 : 5000) + s.score.killPoints - p.damage * 2000) * ({ cadet: 1, pilot: 1.5, ace: 2, custom: 1 }[s.difficulty])));
    this.set(this.q(mb, '.score'), live.toLocaleString('en-US'));
    const stars = s.target.alive ? 0 : 1 + (p.damage < 0.35 ? 1 : 0) + (s.t < 360 ? 1 : 0);
    this.set(this.q(mb, '.stars'), '★'.repeat(stars) + '☆'.repeat(3 - stars));

    // Weapons.
    const wp = this.el.weapons!;
    const card = (w: string): HTMLElement => this.q(wp, `[data-w="${w}"]`) as HTMLElement;
    const setCard = (w: string, count: number, level: Level, lock: string, disabled: boolean): void => {
      const c = card(w);
      this.set(this.q(c, '.wcount'), String(count));
      this.attr(c, 'data-level', level);
      const l = this.q(c, '.lock');
      this.set(l, lock === 'locked' ? 'LOCK' : lock === 'seeking' ? 'SEEK' : '');
      this.attr(l, 'data-lock', lock);
      c.classList.toggle('selected', p.selected === w);
      c.classList.toggle('disabled', disabled);
    };
    setCard('cannon', p.rounds, p.rounds === 0 ? 'red' : p.rounds < 100 ? 'amber' : 'green', 'none', p.rounds === 0);
    setCard('missile', p.missiles, p.missiles === 0 ? 'red' : p.missiles <= 1 ? 'amber' : 'green', p.lockState, p.missiles === 0);
    setCard('strike', p.strike, p.strike === 0 ? 'red' : 'green', p.strikeLock, !strikeAvailable(s));
    setCard('flare', p.flares, p.flares === 0 ? 'red' : p.flares <= 3 ? 'amber' : 'green', 'none', p.flares === 0);
    this.attr(wp, 'data-level', p.missiles === 0 && p.rounds === 0 ? 'red' : p.rounds < 100 || p.missiles === 0 ? 'amber' : 'green');
    const fl = this.el.flares!;
    fl.querySelectorAll('i').forEach((pip, i) => pip.classList.toggle('used', i >= p.flares));
    this.attr(fl, 'data-level', p.flares === 0 ? 'red' : p.flares <= 3 ? 'amber' : 'green');

    // Lines fade by their lifetime in game time; red lines stay.
    const now = s.t * 1000;
    this.el.consoleList!.querySelectorAll<HTMLElement>('li').forEach(li => {
      const at = Number(li.dataset.at);
      const ttl = Number(li.dataset.ttl);
      if (li.dataset.level !== 'red' && now - at > ttl - 400) li.classList.add('fading');
    });
    this.lastTick = now;
  }

  private drawThreatRing(s: GameState): void {
    const p = s.player;
    type W = { bearing: number; level: Level; pulse: boolean; tti: number | null };
    const list: W[] = [];
    const rel = (pos: [number, number, number]): number => wrap180(compass(p.pos, pos) - p.heading / DEG);
    for (const e of s.enemies) {
      if (!e.alive) continue;
      if ((e.kind === 'sam' || e.kind === 'ship') && (e.state === 'tracking' || e.state === 'locked' || e.state === 'launch')) {
        list.push({ bearing: rel(e.pos), level: e.state === 'launch' ? 'red' : 'amber', pulse: e.state !== 'tracking', tti: null });
      } else if (e.kind === 'fighter' && e.state === 'attack' && dist(e.pos, p.pos) < 6000) {
        list.push({ bearing: rel(e.pos), level: 'amber', pulse: e.stateTimer > 0.3, tti: null });
      }
    }
    for (const m of s.missiles) {
      if (m.targetId !== 'player') continue;
      const d = dist(m.pos, p.pos);
      list.push({ bearing: rel(m.pos), level: 'red', pulse: true, tti: d / Math.max(80, m.speed - p.speed * 0.3) });
    }
    list.sort((a, b) => (a.level === 'red' ? 0 : 1) - (b.level === 'red' ? 0 : 1));
    this.wedges.forEach((w, i) => {
      const t = list[i];
      const txt = this.ttis[i]!;
      if (!t) {
        w.style.display = 'none';
        txt.style.display = 'none';
        return;
      }
      const a0 = (t.bearing - 14) * DEG;
      const a1 = (t.bearing + 14) * DEG;
      const r0 = 72;
      const r1 = t.level === 'red' ? 98 : 90;
      const pt = (r: number, a: number): string => `${(Math.sin(a) * r).toFixed(1)} ${(-Math.cos(a) * r).toFixed(1)}`;
      w.setAttribute('d', `M${pt(r0, a0)} L${pt(r1, a0)} A${r1} ${r1} 0 0 1 ${pt(r1, a1)} L${pt(r0, a1)} A${r0} ${r0} 0 0 0 ${pt(r0, a0)} Z`);
      w.setAttribute('data-level', t.level);
      w.classList.toggle('pulse', t.pulse);
      w.style.display = '';
      if (t.tti !== null) {
        const a = t.bearing * DEG;
        txt.setAttribute('x', (Math.sin(a) * 60).toFixed(1));
        txt.setAttribute('y', (-Math.cos(a) * 60 + 4).toFixed(1));
        txt.textContent = `${t.tti.toFixed(0)}s`;
        txt.style.display = '';
      } else txt.style.display = 'none';
    });
  }

  private drawTraining(s: GameState): void {
    const hint = this.el.hint!;
    const tr = s.training;
    const step = tr ? TRAINING_STEPS[tr.step] : null;
    if (!tr || !step || s.status !== 'playing') {
      hint.classList.remove('on');
      return;
    }
    const keyName = step.control === 'stick' ? 'stick' : step.control;
    const label = step.control === 'none' ? '' : this.host.keyFor(keyName);
    const html = `Step ${Math.min(tr.step + 1, 4)}/4 · ${step.text}${label ? `<span class="keycap">${label}</span>` : ''}`;
    if (this.cache.get(hint) !== html) {
      this.cache.set(hint, html);
      hint.innerHTML = html;
      this.highlight([`key-${keyName}`], 2500);
    }
    hint.classList.add('on');
  }

  // ---- console, crew, glow ----

  applyAgents(out: AgentOutput, gameNowMs: number): void {
    this.lines = out.lines;
    const ul = this.el.consoleList!;
    const html = out.lines.map(l => {
      const count = l.count > 1 ? `<span class="count">×${l.count}</span>` : '';
      const detail = l.detail ? `<span class="detail"> ${escapeHtml(l.detail)}</span>` : '';
      return `<li data-agent="${l.agent}" data-level="${l.level}" data-key="${l.key}" data-at="${l.at}" data-ttl="${l.ttlMs}" title="${escapeHtml(l.detail ?? '')}">${agentIcon(l.agent, 16)}<span class="text">${escapeHtml(l.text)}</span>${count}${detail}</li>`;
    }).join('');
    if (this.cache.get(ul) !== html) {
      this.cache.set(ul, html);
      ul.innerHTML = html;
    }
    for (const id of AGENT_IDS) {
      const b = this.crew[id];
      this.attr(b, 'data-active', String(out.active.includes(id) || out.fresh?.agent === id));
      const tip = b.querySelector('.tip');
      this.set(tip, out.status[id] ?? AGENT_NAMES[id]);
      this.attr(b, 'title', out.status[id] ?? AGENT_NAMES[id]);
    }
    if (out.fresh) {
      this.history.unshift(out.fresh);
      if (this.history.length > 30) this.history.length = 30;
      this.glow(out.fresh.zones, out.fresh.level);
      this.glowCrew(out.fresh.agent);
    }
    void gameNowMs;
  }

  /** Brief outline glow in the line's urgency color on every zone the speaking agent owns. */
  glow(zones: readonly HudZone[], level: Level): void {
    for (const zone of zones) {
      const e = this.z[zone];
      if (!e) continue;
      const prev = this.glowTimers.get(e);
      if (prev) clearTimeout(prev);
      e.classList.remove('glow', 'glow-red', 'glow-amber', 'glow-green', 'glow-info');
      void (e as HTMLElement).getBoundingClientRect();
      e.classList.add('glow', `glow-${level}`);
      this.glowTimers.set(e, window.setTimeout(() => e.classList.remove('glow', `glow-${level}`), 900));
    }
  }

  private glowCrew(agent: AgentId): void {
    const b = this.crew[agent];
    b.classList.remove('glow', 'glow-info');
    void b.offsetWidth;
    b.classList.add('glow', 'glow-info');
    setTimeout(() => b.classList.remove('glow', 'glow-info'), 900);
  }

  /** A local answer shown as a console line (tactical, how-to, command confirmations). */
  localLine(agent: AgentId, text: string, level: Level, gameNowMs: number): void {
    const line: ConsoleLine = { id: -Date.now(), key: `local-${gameNowMs}`, agent, level, text, zones: [], at: gameNowMs, ttlMs: 4000, sticky: false, count: 1 };
    const rest = this.lines.filter(l => l.sticky).slice(0, 1);
    this.applyAgents({ lines: [line, ...rest], fresh: null, active: [agent], status: this.statusSnapshot(), liveKeys: [] }, gameNowMs);
    this.history.unshift(line);
  }

  private statusSnapshot(): Record<AgentId, string> {
    const out = {} as Record<AgentId, string>;
    for (const id of AGENT_IDS) out[id] = this.crew[id].getAttribute('title') ?? AGENT_NAMES[id];
    return out;
  }

  clearConsole(): void {
    this.lines = [];
    this.history = [];
    this.el.consoleList!.innerHTML = '';
    this.cache.delete(this.el.consoleList!);
    this.hideVerdict();
    for (const id of AGENT_IDS) this.attr(this.crew[id], 'data-active', 'false');
  }

  // ---- verdict chip ----

  showVerdict(a: Advice): void {
    const v = this.el.verdict!;
    const chip = this.q(v, '[data-testid="verdict-chip"]')!;
    chip.textContent = a.verdict;
    chip.setAttribute('data-verdict', a.verdict);
    this.q(v, '[data-testid="verdict-reason"]')!.textContent = a.reason;
    const act = this.el.vAction!;
    act.textContent = a.actionLabel ?? '';
    act.style.display = a.actionLabel ? '' : 'none';
    v.classList.add('on');
    v.dataset.source = a.source;
    clearTimeout(this.verdictTimer);
    this.verdictTimer = window.setTimeout(() => this.hideVerdict(), 9000);
  }

  hideVerdict(): void {
    this.el.verdict!.classList.remove('on');
  }

  verdictVisible(): boolean {
    return this.el.verdict!.classList.contains('on');
  }

  // ---- command bar and push-to-talk ----

  openCommand(): void {
    this.el.command!.classList.add('on');
    (this.el.input as HTMLInputElement).focus();
  }

  closeCommand(): void {
    this.el.command!.classList.remove('on');
    (this.el.input as HTMLInputElement).blur();
  }

  setListening(on: boolean): void {
    this.el.ptt!.classList.toggle('on', on);
  }

  // ---- help: highlights, explain mode, history ----

  /** Highlight controls and gauges (by data-help or data-zone id) for a few seconds. */
  highlight(ids: string[], ms = 3500): void {
    clearTimeout(this.highlightTimer);
    document.querySelectorAll('.highlight').forEach(e => e.classList.remove('highlight'));
    const legend = this.el.legend!;
    legend.innerHTML = '';
    const touch = this.mode === 'touch';
    for (const id of ids) {
      const found = [...document.querySelectorAll<HTMLElement>(`[data-help="${id}"], [data-zone="${id}"]`)]
        .filter(e => e.offsetParent !== null || e.getClientRects().length > 0);
      found.forEach(e => e.classList.add('highlight'));
      if (id.startsWith('key-') && found.length === 0 && !touch) {
        const action = id.slice(4);
        const span = h('span', { 'data-help': id, class: 'highlight' }, `${this.host.keyFor(action)} · ${action}`);
        legend.append(span);
      }
    }
    legend.classList.toggle('on', legend.childElementCount > 0);
    this.highlightTimer = window.setTimeout(() => {
      document.querySelectorAll('.highlight').forEach(e => e.classList.remove('highlight'));
      legend.classList.remove('on');
    }, ms);
  }

  /** Explain mode: lines from each crew icon to the gauges it owns, with each gauge's "?" line; fades after 3 s. */
  explain(): void {
    const layer = this.el.explain!;
    const svgNs = 'http://www.w3.org/2000/svg';
    layer.innerHTML = '';
    const svg = document.createElementNS(svgNs, 'svg');
    layer.append(svg);
    const center = (e: Element): [number, number] => {
      const r = e.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    };
    for (const id of AGENT_IDS) {
      const [ix, iy] = center(this.crew[id]);
      for (const zone of ZONE_OWNERS[id]) {
        const e = this.z[zone];
        if (!e || e.getClientRects().length === 0) continue;
        const [zx, zy] = center(e);
        const line = document.createElementNS(svgNs, 'line');
        line.setAttribute('x1', String(ix));
        line.setAttribute('y1', String(iy));
        line.setAttribute('x2', String(zx));
        line.setAttribute('y2', String(zy));
        svg.append(line);
        const r = e.getBoundingClientRect();
        const label = h('div', { class: 'zlabel', 'data-zone-label': zone }, `<b>${AGENT_NAMES[id]}</b> · ${ZONE_HELP[zone]}`);
        label.style.left = `${Math.min(window.innerWidth - 210, Math.max(4, r.left))}px`;
        label.style.top = `${Math.min(window.innerHeight - 40, Math.max(4, r.top + r.height / 2 - 12))}px`;
        layer.append(label);
      }
    }
    layer.classList.add('on');
    clearTimeout(this.explainTimer);
    this.explainTimer = window.setTimeout(() => layer.classList.remove('on'), 3000);
  }

  toggleHistory(force?: boolean): void {
    const el = this.el.hist!;
    const on = force ?? !el.classList.contains('on');
    if (on) {
      const items = this.history.map(l => {
        const t = Math.round(l.at / 1000);
        return `<li data-level="${l.level}">${agentIcon(l.agent, 14)}<time>${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}</time><span>${escapeHtml(l.text)}</span></li>`;
      }).join('');
      el.innerHTML = `<div class="label" style="margin-bottom:6px">Last ${this.history.length} messages</div><ol>${items || '<li>No messages yet.</li>'}</ol>`;
    }
    el.classList.toggle('on', on);
  }

  refreshKeycaps(): void {
    this.root.querySelectorAll<HTMLElement>('.keycap[data-key]').forEach(k => {
      k.textContent = this.host.keyFor(k.dataset.key ?? '');
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}
