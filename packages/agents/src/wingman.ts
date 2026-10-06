import {
  AGENT_IDS, ZONE_OWNERS, type AgentId, type AgentOutput, type ConsoleLine, type GameSnapshot,
} from '@crewstrike/shared';
import { createAgents } from './agents';
import type { Agent, Chatter, Tagged } from './types';
import { clampWords } from './words';

export const PACE_MS = 2000;
export const KEY_COOLDOWN_MS = 8000;
export const MAX_LINES = 2;
export const HISTORY = 30;

export interface ConsoleState {
  lines: ConsoleLine[];
  /** key -> time it was last shown (ms). */
  recent: Map<string, number>;
  lastShownAt: number;
  history: ConsoleLine[];
  nextId: number;
  lastSeen: Map<number, number>;
}

export function newConsoleState(): ConsoleState {
  return { lines: [], recent: new Map(), lastShownAt: -Infinity, history: [], nextId: 1, lastSeen: new Map() };
}

/** Chatter level: tips shows everything, key alerts drops tips, critical keeps only red and locks. */
export function chatterAllows(chatter: Chatter, f: Tagged): boolean {
  if (chatter === 'tips') return true;
  if (chatter === 'key') return f.rank <= 7;
  return f.level === 'red' || f.rank <= 3;
}

/**
 * Wingman arbiter: pick the single most important new line by the fixed safety order (rank),
 * after dedupe, combat quiet and chatter filters, and at most one non-red line every 2 seconds.
 */
export function pick(findings: Tagged[], st: ConsoleState, s: GameSnapshot, chatter: Chatter): Tagged | null {
  const visible = new Set(st.lines.map(l => l.key));
  const allowed = findings
    .filter(f => !visible.has(f.key))
    .filter(f => f.level === 'red' || s.now - (st.recent.get(f.key) ?? -Infinity) >= KEY_COOLDOWN_MS)
    .filter(f => !s.inCombat || f.level === 'red' || f.level === 'amber')
    .filter(f => chatterAllows(chatter, f));
  allowed.sort((a, b) => a.rank - b.rank);
  const top = allowed[0];
  if (!top) return null;
  if (top.level !== 'red' && s.now - st.lastShownAt < PACE_MS) return null;
  return top;
}

/** Runs the six agents over each snapshot and keeps the message console state. */
export class AgentRuntime {
  agents: Agent[];
  st: ConsoleState = newConsoleState();
  chatter: Chatter;

  constructor(chatter: Chatter = 'tips') {
    this.agents = createAgents();
    this.chatter = chatter;
  }

  reset(chatter?: Chatter): void {
    this.st = newConsoleState();
    this.agents = createAgents();
    if (chatter) this.chatter = chatter;
  }

  tick(s: GameSnapshot): AgentOutput {
    const st = this.st;
    const all: Tagged[] = [];
    const status = {} as Record<AgentId, string>;
    for (const a of this.agents) {
      for (const f of a.step(s)) all.push({ ...f, agent: a.id, text: clampWords(f.text) });
      status[a.id] = a.status(s);
    }
    const live = new Set(all.map(f => f.key));

    // Refresh visible lines: continuing conditions update their text, repeats merge into a count.
    for (const line of st.lines) {
      const f = all.find(x => x.key === line.key);
      if (!f) continue;
      st.lastSeen.set(line.id, s.now);
      if (f.repeat) {
        line.count += 1;
        line.at = s.now;
      } else {
        line.text = f.text;
        if (f.detail) line.detail = f.detail;
        line.level = f.level;
        line.sticky = f.level === 'red';
      }
    }
    const mergedKeys = new Set(st.lines.map(l => l.key));

    // Expire: red lines stay until the danger is over; others fade after their lifetime.
    st.lines = st.lines.filter(l => {
      const seen = st.lastSeen.get(l.id) ?? l.at;
      if (l.sticky) return live.has(l.key) || s.now - seen < 600;
      return s.now - l.at < l.ttlMs;
    });

    const candidates = all.filter(f => !mergedKeys.has(f.key));
    const top = pick(candidates, st, s, this.chatter);
    let fresh: ConsoleLine | null = null;
    if (top) {
      fresh = {
        id: st.nextId++,
        key: top.key,
        agent: top.agent,
        level: top.level,
        text: top.text,
        zones: [...ZONE_OWNERS[top.agent]],
        at: s.now,
        ttlMs: top.ttlMs,
        sticky: top.level === 'red',
        count: 1,
        ...(top.detail ? { detail: top.detail } : {}),
        ...(top.clip ? { clip: top.clip } : {}),
      };
      st.lines.unshift(fresh);
      st.lastSeen.set(fresh.id, s.now);
      while (st.lines.length > MAX_LINES) {
        // Drop the oldest non-red line first.
        let idx = -1;
        for (let i = st.lines.length - 1; i >= 0; i--) if (!st.lines[i]!.sticky) { idx = i; break; }
        st.lines.splice(idx >= 0 ? idx : st.lines.length - 1, 1);
      }
      st.recent.set(top.key, s.now);
      st.lastShownAt = s.now;
      st.history.unshift({ ...fresh });
      if (st.history.length > HISTORY) st.history.length = HISTORY;
    }

    const active = AGENT_IDS.filter(id => all.some(f => f.agent === id && chatterAllows(this.chatter, f)));
    return {
      lines: st.lines.map(l => ({ ...l })),
      fresh,
      active,
      status,
      liveKeys: all.filter(f => f.level === 'red').map(f => f.key),
    };
  }
}
