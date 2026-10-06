import type { DifficultyName, VoiceMode } from '@crewstrike/shared';
import type { DifficultyProfile } from '@crewstrike/game-core';

export type Palette = 'default' | 'deuteranopia' | 'protanopia' | 'tritanopia';
export type ChatterSetting = 'auto' | 'tips' | 'key' | 'critical';

export type Action =
  | 'up' | 'down' | 'left' | 'right' | 'throttleUp' | 'throttleDown' | 'boost' | 'cannon' | 'missile' | 'strike'
  | 'flare' | 'nextTarget' | 'autopilot' | 'pushToTalk' | 'type' | 'voice' | 'pause' | 'explain' | 'accept';

export const ACTION_LABELS: Record<Action, string> = {
  up: 'Nose up', down: 'Nose down', left: 'Steer left', right: 'Steer right',
  throttleUp: 'Throttle up', throttleDown: 'Throttle down', boost: 'Boost (hold)', cannon: 'Cannon (hold)',
  missile: 'Heat-seeking missile', strike: 'Strike missile', flare: 'Flares', nextTarget: 'Next target',
  autopilot: 'Autopilot', pushToTalk: 'Push-to-talk (hold)', type: 'Type a question', voice: 'Voice on or off',
  pause: 'Pause', explain: 'Explain instruments', accept: 'Accept suggestion',
};

export const DEFAULT_KEYS: Record<Action, string[]> = {
  up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
  throttleUp: ['KeyW'], throttleDown: ['KeyS'], boost: ['ShiftLeft', 'ShiftRight'], cannon: ['Space'],
  missile: ['KeyF'], strike: ['KeyG'], flare: ['KeyE'], nextTarget: ['Tab'], autopilot: ['KeyR'],
  pushToTalk: ['KeyV'], type: ['Slash'], voice: ['KeyM'], pause: ['Escape', 'KeyP'], explain: ['KeyH'], accept: ['KeyY'],
};

export interface Settings {
  difficulty: DifficultyName;
  custom: Partial<DifficultyProfile>;
  voice: VoiceMode;
  chatter: ChatterSetting;
  palette: Palette;
  fov: number;
  vignette: boolean;
  fullRoll: boolean;
  invertPitch: boolean;
  mouseSteer: boolean;
  reducedMotion: 'auto' | 'on' | 'off';
  keys: Record<Action, string[]>;
  callsign: string;
  lastMission: string;
}

export const DEFAULT_SETTINGS: Settings = {
  difficulty: 'cadet',
  custom: {},
  voice: 'critical',
  chatter: 'auto',
  palette: 'default',
  fov: 75,
  vignette: false,
  fullRoll: false,
  invertPitch: false,
  mouseSteer: true,
  reducedMotion: 'auto',
  keys: DEFAULT_KEYS,
  callsign: '',
  lastMission: 'radar-breaker',
};

const KEY = 'wm.settings';

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    // storage unavailable (private mode); settings stay in memory
  }
}

export function loadSettings(): Settings {
  const raw = safeGet(KEY);
  if (!raw) return structuredClone(DEFAULT_SETTINGS);
  try {
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...structuredClone(DEFAULT_SETTINGS), ...parsed, keys: { ...DEFAULT_KEYS, ...(parsed.keys ?? {}) } };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings): void {
  safeSet(KEY, JSON.stringify(s));
}

export function seenExplainer(): boolean {
  return safeGet('wm.seenExplainer') === '1';
}
export function markExplainerSeen(): void {
  safeSet('wm.seenExplainer', '1');
}

/** Anonymous player id kept in the browser; no accounts. */
export function playerId(): string {
  let id = safeGet('wm.player');
  if (!id || !/^[A-Za-z0-9-]{8,64}$/.test(id)) {
    id = `p-${crypto.randomUUID()}`;
    safeSet('wm.player', id);
  }
  return id;
}

export function prefersReducedMotion(s: Settings): boolean {
  if (s.reducedMotion === 'on') return true;
  if (s.reducedMotion === 'off') return false;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'Shift',
    Slash: '/', Escape: 'Esc', Tab: 'Tab', Enter: 'Enter', ControlLeft: 'Ctrl', AltLeft: 'Alt',
  };
  return map[code] ?? code;
}
