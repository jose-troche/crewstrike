import type {
  AdviceReq, AdviceRes, BudgetRes, LeaderboardRow, RecapRes, ScoreReq, SessionRes,
} from '@crewstrike/shared';

async function post<T>(path: string, body: unknown, timeoutMs = 4000): Promise<{ status: number; data: T | null }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const data = (await res.json().catch(() => null)) as T | null;
    return { status: res.status, data };
  } catch {
    return { status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}

export interface EdgeConfig {
  turnstileSiteKey: string | null;
  model: string;
  mockAi: boolean;
}

export const api = {
  async config(): Promise<EdgeConfig | null> {
    try {
      const r = await fetch('/api/config');
      return r.ok ? ((await r.json()) as EdgeConfig) : null;
    } catch {
      return null;
    }
  },
  async session(player: string, turnstileToken?: string): Promise<string | null> {
    const r = await post<SessionRes>('/api/session', turnstileToken ? { player, turnstileToken } : { player });
    return r.status === 200 && r.data ? r.data.session : null;
  },
  advice(req: AdviceReq): Promise<{ status: number; data: AdviceRes | null }> {
    return post<AdviceRes>('/api/advice', req, 2500);
  },
  async recap(session: string, facts: Record<string, number | string>): Promise<string[] | null> {
    const r = await post<RecapRes>('/api/recap', { session, facts }, 5000);
    return r.status === 200 && r.data && Array.isArray(r.data.lines) ? r.data.lines : null;
  },
  async score(req: ScoreReq): Promise<boolean> {
    const r = await post<{ id: string }>('/api/score', req);
    return r.status === 200;
  },
  async leaderboard(mission: string): Promise<LeaderboardRow[]> {
    try {
      const r = await fetch(`/api/leaderboard/${encodeURIComponent(mission)}`);
      if (!r.ok) return [];
      return ((await r.json()) as { rows: LeaderboardRow[] }).rows;
    } catch {
      return [];
    }
  },
  async budget(): Promise<BudgetRes | null> {
    try {
      const r = await fetch('/api/budget');
      return r.ok ? ((await r.json()) as BudgetRes) : null;
    } catch {
      return null;
    }
  },
  async stt(session: string, audio: Blob, seconds: number): Promise<string | null> {
    try {
      const r = await fetch('/api/stt', {
        method: 'POST',
        headers: { 'X-Session': session, 'X-Duration-S': String(Math.ceil(seconds)), 'content-type': audio.type || 'audio/webm' },
        body: audio,
      });
      if (!r.ok) return null;
      return ((await r.json()) as { text?: string }).text ?? null;
    } catch {
      return null;
    }
  },
};
