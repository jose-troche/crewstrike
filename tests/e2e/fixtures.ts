import { test as base, expect, type Page } from '@playwright/test';

type Difficulty = 'cadet' | 'pilot' | 'ace' | 'custom';
export type Spawn = Record<string, unknown> & { type: string };

export interface Line { agent: string; level: string; text: string }

/** Driver for the seeded, steppable game exposed as window.__wm in test builds. */
export interface Wm {
  start(mission?: string, difficulty?: Difficulty): Promise<void>;
  step(frames: number, render?: boolean): Promise<void>;
  spawn(e: Spawn): Promise<void>;
  ask(text: string): Promise<unknown>;
  snapshot(): Promise<Snapshot>;
  lines(): Promise<Line[]>;
  controls(c: Record<string, unknown> | null): Promise<void>;
}

export interface Snapshot {
  now: number;
  missionId: string;
  phase: string;
  status: string;
  inCombat: boolean;
  own: { speed: number; heading: number; autopilot: boolean; throttle: number; agl: number; boost: boolean };
  fuel: { fraction: number };
  weapons: { flares: number; missiles: number; strike: number; strikeAvailable: boolean; strikeLock: string; lock: string };
  threats: { kind: string; km: number }[];
}

// Minimal view of the hook object, as seen from page.evaluate.
type Hooks = {
  start(m: string, o: { seed: number; difficulty: Difficulty }): void;
  pause(): void;
  step(n: number, render?: boolean): void;
  spawn(e: Spawn): void;
  ask(t: string): Promise<unknown>;
  snapshot(): Snapshot;
  lines(): Line[];
  controls(c: Record<string, unknown> | null): void;
  audio(): { kind: string; id: string; text: string }[];
  connect(): Promise<string | null>;
  screen(): string;
  mode(): string;
};

export async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as unknown as { __wm?: unknown }).__wm);
}

export function driver(page: Page): Wm {
  return {
    start: async (mission = 'radar-breaker', difficulty = 'cadet') => {
      await page.goto('/');
      await ready(page);
      await page.evaluate(([m, d]) => {
        const w = (window as unknown as { __wm: Hooks }).__wm;
        w.start(m, { seed: 42, difficulty: d });
        w.pause();
      }, [mission, difficulty] as const);
    },
    step: (f, render = true) => page.evaluate(([n, r]) => (window as unknown as { __wm: Hooks }).__wm.step(n, r), [f, render] as const),
    spawn: e => page.evaluate(ev => (window as unknown as { __wm: Hooks }).__wm.spawn(ev), e),
    ask: t => page.evaluate(s => (window as unknown as { __wm: Hooks }).__wm.ask(s), t),
    snapshot: () => page.evaluate(() => (window as unknown as { __wm: Hooks }).__wm.snapshot()),
    lines: () => page.evaluate(() => (window as unknown as { __wm: Hooks }).__wm.lines()),
    controls: c => page.evaluate(x => (window as unknown as { __wm: Hooks }).__wm.controls(x), c),
  };
}

export const test = base.extend<{ wm: Wm }>({
  wm: async ({ page }, use) => {
    // Skip the first-visit explainer by default.
    await page.addInitScript(() => {
      try { localStorage.setItem('wm.seenExplainer', '1'); } catch { /* ignore */ }
    });
    await use(driver(page));
  },
});

export { expect };

export const isTouch = (project: string): boolean => project === 'tablet' || project === 'phone' || project === 'portrait';
