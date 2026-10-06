import {
  MISSIONS, STEP, applyRoute, applySpawn, computeScore, createGame, cycleTarget, fire, setAutopilot, setBoost,
  snapshot, step, type ControlState, type GameState, type ScoreResult, type SpawnEvent,
} from '@crewstrike/game-core';
import { handle, templateRecap, type RecapFacts } from '@crewstrike/nl';
import type { Chatter } from '@crewstrike/agents';
import type {
  Advice, AgentOutput, CommandSink, DifficultyName, GameEvent, GameSnapshot, LeaderboardRow, NlResult, VoiceMode,
} from '@crewstrike/shared';
import { AudioEngine } from './audio/audio';
import { InlineAgentHost, WorkerAgentHost, type AgentHost } from './agents-host';
import { GameScene } from './game/scene';
import { Hud, type LayoutMode } from './hud/hud';
import { InputManager } from './input/control-state';
import { api } from './net/api';
import {
  keyLabel, loadSettings, markExplainerSeen, playerId, prefersReducedMotion, saveSettings, seenExplainer, type Action, type Settings,
} from './settings';
import { Store } from './store';
import { PhraseRouter, PushToTalk } from './voice/router';

export type Screen = 'menu' | 'playing' | 'paused' | 'results';

export interface Results {
  missionId: string;
  title: string;
  training: boolean;
  score: ScoreResult;
  reason: string;
  recap: string[];
  recapSource: 'template' | 'edge';
  submitted: boolean;
}

export interface UiState {
  screen: Screen;
  explainer: boolean;
  settingsOpen: boolean;
  rotate: boolean;
  mode: LayoutMode;
  missionId: string;
  difficulty: DifficultyName;
  results: Results | null;
  leaderboard: LeaderboardRow[];
  settings: Settings;
  device: 'keyboard' | 'gamepad' | 'touch';
}

const TEST_HOOKS = import.meta.env.VITE_TEST_HOOKS === '1';
const YES = /^(?:yes|yeah|yep|yup|do it|confirm|affirmative|ok do it|sure)\b/i;

export class GameApp {
  settings: Settings = loadSettings();
  readonly ui: Store<UiState>;
  readonly scene: GameScene;
  readonly hud: Hud;
  readonly input: InputManager;
  readonly audio = new AudioEngine();
  readonly agents: AgentHost;
  readonly router = new PhraseRouter();
  readonly ptt: PushToTalk;
  state: GameState;
  readonly testMode = TEST_HOOKS;
  /** True while the simulation is advancing in real time. */
  running = false;
  private acc = 0;
  private last = performance.now();
  private lastSnapNow = -1;
  private lastEvent: GameEvent | null = null;
  private pending: Advice | null = null;
  private endTimer = 0;
  private sessionPromise: Promise<string | null> | null = null;
  lastOutput: AgentOutput | null = null;
  readonly player = playerId();
  manualOverride: Partial<ControlState> | null = null;

  constructor(private stage: HTMLElement, uiRoot: HTMLElement) {
    const coarse = matchMedia('(pointer: coarse)').matches;
    this.scene = new GameScene(stage, { lowPower: coarse });
    this.ui = new Store<UiState>({
      screen: 'menu',
      explainer: !seenExplainer(),
      settingsOpen: false,
      rotate: false,
      mode: 'wide',
      missionId: this.settings.lastMission in MISSIONS ? this.settings.lastMission : 'radar-breaker',
      difficulty: this.settings.difficulty,
      results: null,
      leaderboard: [],
      settings: this.settings,
      device: coarse ? 'touch' : 'keyboard',
    });
    this.input = new InputManager(() => this.settings, {
      pause: () => this.togglePause(),
      voice: () => this.cycleVoice(),
      type: () => this.openCommand(),
      explain: () => this.hud.explain(),
      accept: () => this.acceptAction(),
      pttStart: () => void this.pttStart(),
      pttEnd: () => void this.pttEnd(),
      gesture: () => this.audio.unlock(),
    }, stage);
    this.hud = new Hud(uiRoot.parentElement ?? document.body, {
      help: () => this.openExplainer(),
      pause: () => this.togglePause(),
      cycleVoice: () => this.cycleVoice(),
      voice: () => this.cycleVoice(),
      explain: () => this.hud.explain(),
      type: () => this.openCommand(),
      submitCommand: t => void this.ask(t, 'typed'),
      acceptAction: () => this.acceptAction(),
      selectTarget: id => {
        this.state.player.lockTargetId = id;
        this.state.player.lockState = 'none';
        this.state.player.lockTimer = 0;
      },
      keyFor: a => this.keyFor(a),
      pttStart: () => void this.pttStart(),
      pttEnd: () => void this.pttEnd(),
      gesture: () => this.audio.unlock(),
    });
    this.input.touch = this.hud.touch;
    this.agents = TEST_HOOKS ? new InlineAgentHost() : new WorkerAgentHost();
    this.agents.onOutput = o => this.onAgents(o);
    this.ptt = new PushToTalk(() => this.router.session);
    this.state = createGame(this.ui.get().missionId, { difficulty: this.settings.difficulty });
    this.applySettings();
    this.layout();
    window.addEventListener('resize', () => this.layout());
    window.addEventListener('orientationchange', () => this.layout());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.ui.get().screen === 'playing' && !TEST_HOOKS) this.pause();
    });
    window.addEventListener('pointerdown', () => this.audio.unlock(), { once: false, passive: true });
    void this.refreshAiStatus();
    requestAnimationFrame(t => this.frame(t));
  }

  // ---- settings and layout ----

  keyFor(action: string): string {
    if (action === 'stick') return this.ui.get().device === 'touch' ? 'Stick' : 'Mouse/Arrows';
    if (action === 'ptt') action = 'pushToTalk';
    if (action === 'target') action = 'nextTarget';
    if (action === 'throttle') return `${keyLabel(this.settings.keys.throttleUp[0] ?? 'KeyW')}/${keyLabel(this.settings.keys.throttleDown[0] ?? 'KeyS')}`;
    const codes = this.settings.keys[action as Action];
    return codes?.[0] ? keyLabel(codes[0]) : action;
  }

  updateSettings(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    this.ui.set({ settings: this.settings, difficulty: this.settings.difficulty });
    this.applySettings();
  }

  private applySettings(): void {
    const s = this.settings;
    document.documentElement.dataset.palette = s.palette;
    this.hud.setPaletteChanged();
    this.hud.setReducedMotion(prefersReducedMotion(s));
    this.scene.setFov(s.fov);
    this.audio.voice = s.voice;
    this.hud.setVoice(s.voice);
    this.input.rebuildMap();
    this.hud.refreshKeycaps();
    this.scene.fullRoll = s.fullRoll && (this.state.profile.steering === 'manual' || this.state.difficulty === 'custom');
    this.agents?.setChatter(this.chatter());
  }

  private chatter(): Chatter {
    return this.settings.chatter === 'auto' ? this.state.profile.chatter : this.settings.chatter;
  }

  layout(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const coarse = matchMedia('(pointer: coarse)').matches;
    let mode: LayoutMode;
    if (h > w && (coarse || w < 900)) mode = 'rotate';
    else if (coarse) mode = 'touch';
    else if (w >= 1280 && h > 720) mode = 'wide';
    else mode = 'compact';
    this.hud.setMode(mode);
    const rotate = mode === 'rotate';
    if (rotate && this.ui.get().screen === 'playing') this.pause();
    this.ui.set({ mode, rotate, device: coarse ? 'touch' : this.ui.get().device });
    this.scene.resize();
  }

  // ---- mission flow ----

  startMission(missionId: string, difficulty: DifficultyName = this.settings.difficulty, seed?: number): void {
    clearTimeout(this.endTimer);
    this.updateSettings({ difficulty, lastMission: missionId === 'training' ? this.settings.lastMission : missionId });
    this.state = createGame(missionId, seed === undefined ? { difficulty, custom: this.settings.custom } : { difficulty, seed, custom: this.settings.custom });
    this.scene.load(this.state);
    this.applySettings();
    this.agents.reset(this.chatter());
    this.hud.clearConsole();
    this.lastSnapNow = -1;
    this.lastEvent = null;
    this.pending = null;
    this.acc = 0;
    this.input.resetHeld();
    this.input.throttle = 1;
    this.input.enabled = true;
    this.running = !this.ui.get().rotate;
    this.ui.set({ screen: this.running ? 'playing' : 'paused', missionId, difficulty, results: null, explainer: false, settingsOpen: false });
    this.audio.unlock();
    if (!TEST_HOOKS) void this.ensureSession();
  }

  ensureSession(): Promise<string | null> {
    if (this.router.session) return Promise.resolve(this.router.session);
    if (!this.sessionPromise) {
      this.sessionPromise = (async () => {
        const cfg = await api.config();
        if (!cfg) return null;
        let token: string | undefined;
        if (cfg.turnstileSiteKey) token = (await turnstileToken(cfg.turnstileSiteKey)) ?? undefined;
        const s = await api.session(this.player, token);
        this.router.session = s;
        void this.refreshAiStatus();
        return s;
      })().finally(() => {
        if (!this.router.session) this.sessionPromise = null;
      });
    }
    return this.sessionPromise;
  }

  async refreshAiStatus(): Promise<void> {
    if (await this.router.hasDevice()) return this.hud.setAiStatus('device', 'AI: on-device model');
    if (TEST_HOOKS) return this.hud.setAiStatus('template', 'AI: local templates');
    const b = await api.budget();
    if (!b) return this.hud.setAiStatus('offline', 'AI: offline, local advisor only');
    if (b.remaining < 500) return this.hud.setAiStatus('low', `AI: ${b.remaining} neurons left today`);
    this.hud.setAiStatus(this.router.session ? 'edge' : 'template', `AI: edge model, ${b.remaining} neurons left today`);
  }

  pause(): void {
    if (this.ui.get().screen !== 'playing') return;
    this.running = false;
    this.input.enabled = false;
    this.input.resetHeld();
    this.audio.silenceEngine();
    this.ui.set({ screen: 'paused' });
  }

  resume(): void {
    if (this.ui.get().screen !== 'paused' || this.ui.get().rotate) return;
    this.running = true;
    this.input.enabled = true;
    this.last = performance.now();
    this.acc = 0;
    this.ui.set({ screen: 'playing', settingsOpen: false });
  }

  togglePause(): void {
    const ui = this.ui.get();
    if (ui.explainer) return this.closeExplainer();
    if (ui.settingsOpen) return this.ui.set({ settingsOpen: false });
    if (ui.screen === 'playing') this.pause();
    else if (ui.screen === 'paused') this.resume();
  }

  quitToMenu(): void {
    clearTimeout(this.endTimer);
    this.running = false;
    this.input.enabled = false;
    this.audio.silenceEngine();
    this.state = createGame(this.ui.get().missionId === 'training' ? 'radar-breaker' : this.ui.get().missionId, { difficulty: this.settings.difficulty });
    this.scene.load(this.state);
    this.hud.clearConsole();
    this.ui.set({ screen: 'menu', results: null });
  }

  openExplainer(): void {
    if (this.ui.get().screen === 'playing') this.pause();
    this.ui.set({ explainer: true });
  }

  closeExplainer(): void {
    markExplainerSeen();
    this.ui.set({ explainer: false });
  }

  private endMission(): void {
    const s = this.state;
    this.running = false;
    this.input.enabled = false;
    this.audio.silenceEngine();
    const score = computeScore(s);
    const facts: RecapFacts = {
      outcome: s.status, mission: s.mission.title, stars: score.stars, score: score.score, kills: s.score.kills,
      damagePct: Math.round(s.player.damage * 100), durationS: score.durationS, missilesLeft: s.player.missiles, strikeLeft: s.player.strike,
    };
    const results: Results = {
      missionId: s.mission.id, title: s.mission.title, training: !!s.training, score, reason: s.endReason ?? '',
      recap: templateRecap(facts), recapSource: 'template', submitted: false,
    };
    this.ui.set({ screen: 'results', results, leaderboard: [] });
    if (!s.training && !TEST_HOOKS) {
      void (async () => {
        const session = await this.ensureSession();
        if (session) {
          const lines = await api.recap(session, facts);
          const cur = this.ui.get().results;
          if (lines && cur && cur === results) this.ui.set({ results: { ...cur, recap: lines, recapSource: 'edge' } });
        }
      })();
      void this.loadLeaderboard(s.mission.id);
    }
  }

  async loadLeaderboard(missionId: string): Promise<void> {
    this.ui.set({ leaderboard: await api.leaderboard(missionId) });
  }

  async submitScore(callsign: string): Promise<boolean> {
    const r = this.ui.get().results;
    if (!r || r.training || r.submitted) return false;
    const cs = callsign.trim().slice(0, 16);
    this.updateSettings({ callsign: cs });
    const ok = await api.score({
      player: this.player, callsign: cs, missionId: r.missionId, difficulty: this.state.difficulty,
      stars: r.score.stars, score: r.score.score, durationS: Math.max(1, r.score.durationS),
    });
    if (ok) {
      this.ui.set({ results: { ...r, submitted: true } });
      await this.loadLeaderboard(r.missionId);
    }
    return ok;
  }

  // ---- the loop ----

  private frame(now: number): void {
    const dtMs = Math.min(now - this.last, 250);
    this.last = now;
    if (this.running && !TEST_HOOKS_PAUSED.value) {
      this.acc += dtMs / 1000;
      let n = 0;
      while (this.acc >= STEP && n < 8) {
        this.tick();
        this.acc -= STEP;
        n++;
      }
      if (this.acc > STEP * 8) this.acc = 0;
    }
    // Test builds freeze drawing while a test steps the game by hand.
    if (!TEST_HOOKS_PAUSED.value) {
      this.renderFrame(now, dtMs);
      this.scene.trackFrame(dtMs);
    }
    requestAnimationFrame(t => this.frame(t));
  }

  renderFrame(now: number, dtMs: number, force = false): void {
    const alpha = this.running && !force ? Math.min(1, this.acc / STEP) : 1;
    this.scene.render(this.state, alpha, now);
    this.hud.draw(this.state, this.scene, now, dtMs, this.settings.vignette, force);
  }

  /** One fixed 60 Hz step plus the 10 Hz agent snapshot. */
  tick(controls?: ControlState): void {
    const s = this.state;
    const c = controls ?? this.input.read();
    if (this.manualOverride) Object.assign(c, this.manualOverride);
    const wasPlaying = s.status === 'playing';
    step(s, c);
    this.handleEvents(c);
    if (s.frame % 6 === 0) {
      const snap = snapshot(s, this.lastSnapNow);
      this.lastSnapNow = snap.now;
      this.agents.post(snap);
    }
    if (wasPlaying && s.status !== 'playing') {
      this.audio.explosion(s.status === 'lost');
      if (TEST_HOOKS) this.endMission();
      else this.endTimer = window.setTimeout(() => this.endMission(), 1800);
    }
  }

  private handleEvents(c: ControlState): void {
    const s = this.state;
    const evs = s.events;
    let i = evs.length - 1;
    while (i >= 0 && evs[i] !== this.lastEvent) i--;
    for (let k = i + 1; k < evs.length; k++) {
      const e = evs[k]!;
      switch (e.type) {
        case 'missile_launch': this.audio.missileLaunch(); break;
        case 'fired': this.audio.missileLaunch(); break;
        case 'flare': this.audio.flare(); break;
        case 'hit': this.audio.hit(); break;
        case 'kill': this.audio.explosion(false); break;
        case 'target_destroyed': this.audio.explosion(true); break;
        case 'training_step': this.audio.ringPass(); break;
        case 'phase':
          if (e.detail === 'autopilot_on') this.hud.localLine('mission', 'Autopilot on.', 'info', s.t * 1000);
          break;
        default: break;
      }
    }
    if (evs.length) this.lastEvent = evs[evs.length - 1]!;
    const now = performance.now();
    this.audio.cannon(c.cannon && s.player.rounds > 0, now);
    const inbound = s.missiles.some(m => m.targetId === 'player');
    const tracked = s.enemies.some(e => e.alive && (e.state === 'locked' || (e.kind === 'fighter' && e.state === 'attack')));
    this.audio.setTone(inbound ? 'launch' : tracked ? 'tracking' : s.player.lockState === 'locked' ? 'locked' : s.player.lockState === 'seeking' ? 'seeking' : 'none', now);
    this.audio.engineHum(s.player.speed, s.player.boost);
  }

  private onAgents(o: AgentOutput): void {
    this.lastOutput = o;
    this.hud.applyAgents(o, this.state.t * 1000);
    if (o.fresh) this.audio.say(o.fresh);
  }

  // ---- voice, commands and questions ----

  cycleVoice(): void {
    const order: VoiceMode[] = ['off', 'critical', 'all'];
    const next = order[(order.indexOf(this.settings.voice) + 1) % order.length] ?? 'critical';
    this.updateSettings({ voice: next });
    this.hud.localLine('wingman', `Voice ${next}.`, 'info', this.state.t * 1000);
  }

  openCommand(): void {
    this.hud.openCommand();
  }

  private async pttStart(): Promise<void> {
    this.audio.unlock();
    this.hud.setListening(true);
    await this.ptt.start();
  }

  private async pttEnd(): Promise<void> {
    this.hud.setListening(false);
    const text = await this.ptt.stop();
    if (text) await this.ask(text, 'voice');
  }

  readonly sink: CommandSink = {
    fire: w => {
      if (w === 'cannon') this.manualCannonBurst();
      else fire(this.state, w);
    },
    setBoost: on => setBoost(this.state, on),
    setThrottle: l => {
      this.input.throttle = l;
    },
    cycleTarget: () => void cycleTarget(this.state),
    setAutopilot: on => {
      if (!setAutopilot(this.state, on)) this.hud.localLine('mission', 'Autopilot not available now.', 'amber', this.state.t * 1000);
    },
    setRoute: r => void applyRoute(this.state, r),
    setVoice: m => this.updateSettings({ voice: m }),
    pause: () => this.pause(),
    resume: () => this.resume(),
  };

  private manualCannonBurst(): void {
    this.state.player.selected = 'cannon';
  }

  /** Every utterance or typed line goes through the local pipeline first. */
  async ask(text: string, _source: 'voice' | 'typed' | 'test' = 'typed'): Promise<NlResult> {
    const s = this.state;
    const now = s.t * 1000;
    if (this.pending && YES.test(text.trim())) {
      this.acceptAction();
      return { kind: 'command', confirm: 'Accepted' };
    }
    const snap: GameSnapshot = snapshot(s);
    const r = handle(text, snap, this.sink);
    switch (r.kind) {
      case 'command':
        this.hud.localLine('wingman', `${r.confirm}.`, 'info', now);
        break;
      case 'tactical':
        this.hud.localLine(r.agent, r.text, 'info', now);
        this.hud.glow(r.glow, 'info');
        break;
      case 'howto':
        this.hud.localLine('wingman', r.text, 'info', now);
        this.hud.highlight(r.highlight);
        break;
      case 'unknown':
        this.hud.localLine('wingman', r.text, 'info', now);
        break;
      case 'strategic': {
        const a = r.advice;
        this.pending = a;
        this.hud.showVerdict(a);
        if (!TEST_HOOKS || this.router.session) await this.ensureSessionQuick();
        const better = await this.router.phrase(a);
        if (this.pending === a) {
          this.pending = better;
          this.hud.showVerdict(better);
        }
        return { kind: 'strategic', advice: better };
      }
    }
    return r;
  }

  private async ensureSessionQuick(): Promise<void> {
    if (this.router.session) return;
    await Promise.race([this.ensureSession(), new Promise(r => setTimeout(r, 1200))]);
  }

  acceptAction(): void {
    const a = this.pending;
    if (!a || !this.hud.verdictVisible()) return;
    const s = this.state;
    switch (a.action) {
      case 'route_exit': applyRoute(s, 'exit'); break;
      case 'route_safest': applyRoute(s, 'safest'); break;
      case 'route_target': applyRoute(s, 'target'); break;
      case 'climb': s.player.pitch = Math.max(s.player.pitch, 0.25); break;
      case 'descend': s.player.pitch = Math.min(s.player.pitch, -0.12); break;
      default: break;
    }
    if (a.actionLabel) this.hud.localLine('mission', a.actionLabel.replace(/^Set /, '').replace('?', ' set.').replace(/^route/, 'Route'), 'green', s.t * 1000);
    this.pending = null;
    this.hud.hideVerdict();
  }

  // ---- test hooks support ----

  spawn(ev: SpawnEvent): void {
    applySpawn(this.state, ev);
  }

  /** Advance n fixed steps synchronously (test hooks), then draw one frame. */
  stepFrames(n: number, render = true): void {
    for (let i = 0; i < n; i++) {
      if (this.state.status !== 'playing' && this.ui.get().screen === 'results') break;
      this.tick();
    }
    if (render) this.renderFrame(performance.now(), 16, true);
  }
}

/** Shared flag so test hooks can freeze the real-time loop while stepping manually. */
export const TEST_HOOKS_PAUSED = { value: false };

async function turnstileToken(siteKey: string): Promise<string | null> {
  type Turnstile = { render(el: HTMLElement, opts: Record<string, unknown>): string };
  const w = window as unknown as { turnstile?: Turnstile };
  if (!w.turnstile) {
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('turnstile'));
      document.head.append(s);
    }).catch(() => undefined);
  }
  if (!w.turnstile) return null;
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:50%;top:64px;transform:translateX(-50%);z-index:100';
  document.body.append(box);
  return new Promise(resolve => {
    const done = (t: string | null): void => {
      setTimeout(() => box.remove(), 500);
      resolve(t);
    };
    try {
      w.turnstile!.render(box, {
        sitekey: siteKey,
        appearance: 'interaction-only',
        callback: (t: string) => done(t),
        'error-callback': () => done(null),
      });
    } catch {
      done(null);
    }
    setTimeout(() => done(null), 15000);
  });
}
