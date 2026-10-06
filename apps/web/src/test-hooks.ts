import { snapshot, type ControlState, type SpawnEvent } from '@crewstrike/game-core';
import type { AgentOutput, DifficultyName, GameSnapshot, NlResult } from '@crewstrike/shared';
import type { VoiceLogEntry } from './audio/audio';
import { TEST_HOOKS_PAUSED, type GameApp } from './app';

/** window.__wm: drives a seeded, steppable game from Playwright. Only compiled into VITE_TEST_HOOKS=1 builds. */
export interface Wm {
  start(mission: string, opts?: { seed?: number; difficulty?: DifficultyName }): void;
  pause(): void;
  resume(): void;
  step(frames: number): void;
  spawn(ev: SpawnEvent): void;
  ask(text: string): Promise<NlResult>;
  snapshot(): GameSnapshot;
  lines(): { agent: string; level: string; text: string }[];
  controls(c: Partial<ControlState> | null): void;
  audio(): VoiceLogEntry[];
  output(): AgentOutput | null;
  mode(): string;
  screen(): string;
}

declare global {
  interface Window {
    __wm: Wm;
  }
}

export function installTestHooks(app: GameApp): void {
  window.__wm = {
    start: (mission, opts = {}) => {
      TEST_HOOKS_PAUSED.value = false;
      app.startMission(mission, opts.difficulty ?? 'cadet', opts.seed ?? 42);
    },
    pause: () => {
      TEST_HOOKS_PAUSED.value = true;
    },
    resume: () => {
      TEST_HOOKS_PAUSED.value = false;
    },
    step: n => app.stepFrames(n),
    spawn: ev => app.spawn(ev),
    ask: t => app.ask(t, 'test'),
    snapshot: () => snapshot(app.state),
    lines: () => [...document.querySelectorAll<HTMLElement>('[data-testid="console"] li')].map(li => ({
      agent: li.dataset.agent ?? '', level: li.dataset.level ?? '', text: li.querySelector('.text')?.textContent ?? '',
    })),
    controls: c => {
      app.manualOverride = c;
    },
    audio: () => [...app.audio.log],
    output: () => app.lastOutput,
    mode: () => app.hud.mode,
    screen: () => app.ui.get().screen,
  };
}
