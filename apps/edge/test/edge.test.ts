import { describe, expect, it } from 'vitest';
import app, { validScore } from '../src/index';
import type { Gate } from '../src/budget-do';

interface FakeOpts { gate?: Gate; aiReply?: unknown; mock?: boolean }

function fakeEnv(o: FakeOpts = {}) {
  const inserted: unknown[][] = [];
  const reserves: number[] = [];
  const stub = {
    reserve: async (n: number) => { reserves.push(n); return o.gate ?? { ok: true, remaining: 8000 }; },
    status: async () => ({ used: 1000, remaining: 8000, ceiling: 9000 }),
    createSession: async () => undefined,
  };
  const env = {
    NEURON_CEILING: '9000',
    AI_MODEL: '@cf/meta/llama-3.1-8b-instruct-fp8',
    MOCK_AI: o.mock ? '1' : '0',
    TURNSTILE_SITE_KEY: '',
    AI: { run: async () => ({ response: o.aiReply ?? { reason: 'Two threats ahead. Go north.', action: 'route_safest' } }) },
    BUDGET: { idFromName: () => 'id', get: () => stub },
    DB: {
      prepare: (_sql: string) => ({
        bind: (...args: unknown[]) => ({
          run: async () => { inserted.push(args); return {}; },
          all: async () => ({ results: [{ callsign: 'ACE', difficulty: 'pilot', stars: 3, score: 9000, duration_s: 200, created_at: 1 }] }),
        }),
      }),
    },
    ASSETS: { fetch: async () => new Response('') },
  };
  return { env: env as unknown as Env, inserted, reserves };
}

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const session = '0f8c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';

describe('edge routes', () => {
  it('health and config', async () => {
    const { env } = fakeEnv();
    expect(await (await app.request('/api/health', {}, env)).json()).toEqual({ ok: true });
    const cfg = await (await app.request('/api/config', {}, env)).json() as { turnstileSiteKey: unknown };
    expect(cfg.turnstileSiteKey).toBeNull();
  });

  it('creates a session without Turnstile when no secret is set', async () => {
    const { env } = fakeEnv();
    const res = await app.request('/api/session', json({ player: 'player-12345678' }), env);
    expect(res.status).toBe(200);
    expect((await res.json() as { session: string }).session).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('advice reserves 7 neurons and returns a validated model reason', async () => {
    const { env, reserves } = fakeEnv({ aiReply: { reason: 'Two threats and 2 missiles. Avoid them.', action: 'route_safest' } });
    const res = await app.request('/api/advice', json({ session, verdict: 'AVOID', kind: 'engage_or_avoid', facts: { threats: 2, missiles: 2 } }), env);
    expect(res.status).toBe(200);
    expect(reserves).toEqual([7]);
    expect(await res.json()).toEqual({ reason: 'Two threats and 2 missiles. Avoid them.', action: 'route_safest' });
  });

  it('advice falls back to the template when the model invents numbers', async () => {
    const { env } = fakeEnv({ aiReply: { reason: 'You have 9 missiles, go.', action: 'none' } });
    const res = await app.request('/api/advice', json({ session, verdict: 'AVOID', kind: 'engage_or_avoid', facts: { threats: 2, missiles: 2, route: 'north' } }), env);
    expect(res.headers.get('X-Fallback')).toBe('validation');
    expect((await res.json() as { reason: string }).reason).toBe('2 threats, 2 missiles left. Avoid; go north.');
  });

  it('advice is refused with 429 when the budget gate says no', async () => {
    const { env } = fakeEnv({ gate: { ok: false, remaining: 0, reason: 'daily_ceiling' } });
    const res = await app.request('/api/advice', json({ session, verdict: 'ENGAGE', kind: 'escape', facts: {} }), env);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'daily_ceiling' });
  });

  it('recap with MOCK_AI returns three template lines', async () => {
    const { env, reserves } = fakeEnv({ mock: true });
    const res = await app.request('/api/recap', json({ session, facts: { outcome: 'won', mission: 'Radar Breaker', stars: 2, score: 8000, kills: 1, damagePct: 20, durationS: 300, missilesLeft: 3, strikeLeft: 0 } }), env);
    expect(reserves).toEqual([12]);
    const body = await res.json() as { lines: string[] };
    expect(body.lines).toHaveLength(3);
    expect(body.lines[0]).toContain('Radar Breaker complete');
  });

  it('scores are validated and stored; leaderboard returns rows', async () => {
    const { env, inserted } = fakeEnv();
    const good = { player: 'player-12345678', callsign: 'Maverick', missionId: 'radar-breaker', difficulty: 'pilot', stars: 2, score: 8000, durationS: 260 };
    expect(validScore(good)).toBe(true);
    expect(validScore({ ...good, callsign: '<script>' })).toBe(false);
    expect(validScore({ ...good, stars: 4 })).toBe(false);
    expect(validScore({ ...good, missionId: 'nope' })).toBe(false);
    expect((await app.request('/api/score', json({ ...good, score: -1 }), env)).status).toBe(400);
    expect((await app.request('/api/score', json(good), env)).status).toBe(200);
    expect(inserted).toHaveLength(1);
    const lb = await (await app.request('/api/leaderboard/radar-breaker', {}, env)).json() as { rows: { callsign: string; durationS: number }[] };
    expect(lb.rows[0]).toMatchObject({ callsign: 'ACE', durationS: 200 });
    expect((await app.request('/api/leaderboard/nowhere', {}, env)).status).toBe(404);
  });

  it('budget reports the ledger', async () => {
    const { env } = fakeEnv();
    expect(await (await app.request('/api/budget', {}, env)).json()).toEqual({ used: 1000, remaining: 8000, ceiling: 9000 });
  });
});
