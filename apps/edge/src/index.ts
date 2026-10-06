import { Hono } from 'hono';
import type {
  AdviceAction, AdviceReq, AdviceRes, BudgetRes, DifficultyName, LeaderboardRow, RecapReq, RecapRes, ScoreReq, SessionReq, Verdict,
} from '@crewstrike/shared';
import { ADVICE_ACTIONS } from '@crewstrike/shared';
import { templateReason, templateRecap, validateReason, validateRecap, type RecapFacts } from '@crewstrike/nl';
import { runJson, transcribe } from './ai';
import type { BudgetDO, Gate } from './budget-do';
import { ADVICE_SCHEMA, ADVICE_SYSTEM, RECAP_SCHEMA, RECAP_SYSTEM, RESERVE } from './prompts/advice';
import { hashIp, verifyTurnstile } from './turnstile';

export { BudgetDO } from './budget-do';

type Bindings = Env & { TURNSTILE_SECRET?: string };

const MISSIONS = new Set(['radar-breaker', 'iron-tide', 'bridge-fall']);
const DIFFICULTIES = new Set<DifficultyName>(['cadet', 'pilot', 'ace', 'custom']);
const VERDICTS = new Set<Verdict>(['ENGAGE', 'AVOID', 'ESCAPE', 'ABORT', 'CONTINUE', 'REROUTE']);
const CALLSIGN_RE = /^[A-Za-z0-9 _-]{1,16}$/;
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const MAX_STT_BYTES = 400_000;

const app = new Hono<{ Bindings: Bindings }>();

function budget(env: Bindings): DurableObjectStub<BudgetDO> {
  const ns = env.BUDGET as unknown as DurableObjectNamespace<BudgetDO>;
  return ns.get(ns.idFromName('global'));
}

const mockAi = (env: Bindings): boolean => String(env.MOCK_AI) === '1';

/** Only plain numbers and short strings may reach the model. */
function cleanFacts(facts: unknown): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  if (!facts || typeof facts !== 'object') return out;
  for (const [k, v] of Object.entries(facts as Record<string, unknown>).slice(0, 24)) {
    if (!/^[A-Za-z]{1,24}$/.test(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v * 100) / 100;
    else if (typeof v === 'string' && v.length <= 32) out[k] = v.replace(/[^\w :.-]/g, '');
  }
  return out;
}

async function gate(c: { env: Bindings; req: { header(n: string): string | undefined } }, neurons: number, session: string): Promise<Gate> {
  if (!ID_RE.test(session)) return { ok: false, remaining: 0, reason: 'unknown_session' };
  return budget(c.env).reserve(neurons, session, await hashIp(c.req.header('CF-Connecting-IP')));
}

app.get('/api/health', c => c.json({ ok: true }));

app.get('/api/config', c => c.json({
  turnstileSiteKey: c.env.TURNSTILE_SITE_KEY || null,
  model: c.env.AI_MODEL,
  mockAi: mockAi(c.env),
}));

app.post('/api/session', async c => {
  const body = await c.req.json<SessionReq>().catch(() => null);
  if (!body || typeof body.player !== 'string' || !ID_RE.test(body.player)) return c.json({ error: 'bad_request' }, 400);
  const ok = await verifyTurnstile(c.env.TURNSTILE_SECRET, body.turnstileToken, c.req.header('CF-Connecting-IP'));
  if (!ok) return c.json({ error: 'turnstile_failed' }, 403);
  const session = crypto.randomUUID();
  await budget(c.env).createSession(session);
  return c.json({ session });
});

app.post('/api/advice', async c => {
  const body = await c.req.json<AdviceReq>().catch(() => null);
  if (!body || !VERDICTS.has(body.verdict) || typeof body.session !== 'string') return c.json({ error: 'bad_request' }, 400);
  const facts = cleanFacts(body.facts);
  const g = await gate(c, RESERVE.advice, body.session);
  if (!g.ok) return c.json({ error: g.reason }, 429);
  c.header('X-Neurons-Remaining', String(g.remaining));

  const fallback: AdviceRes = { reason: templateReason(body.verdict, facts), action: 'none' };
  if (mockAi(c.env)) return c.json(fallback);
  try {
    const out = (await runJson(c.env, ADVICE_SYSTEM, JSON.stringify({ verdict: body.verdict, facts }), ADVICE_SCHEMA, 60)) as Partial<AdviceRes> | null;
    const reason = typeof out?.reason === 'string' ? out.reason.trim() : '';
    const action = ADVICE_ACTIONS.includes(out?.action as AdviceAction) ? (out!.action as AdviceAction) : 'none';
    if (!validateReason(reason, body.verdict, facts).ok) {
      c.header('X-Fallback', 'validation');
      return c.json(fallback);
    }
    return c.json({ reason, action } satisfies AdviceRes);
  } catch {
    c.header('X-Fallback', 'model_error');
    return c.json(fallback);
  }
});

app.post('/api/recap', async c => {
  const body = await c.req.json<RecapReq>().catch(() => null);
  if (!body || typeof body.session !== 'string') return c.json({ error: 'bad_request' }, 400);
  const facts = cleanFacts(body.facts);
  const template = templateRecap(facts as RecapFacts);
  const g = await gate(c, RESERVE.recap, body.session);
  if (!g.ok) return c.json({ lines: template, fallback: g.reason }, 200);
  c.header('X-Neurons-Remaining', String(g.remaining));
  // Recaps switch to templates first when the ledger nears the ceiling.
  if (mockAi(c.env) || g.remaining < 500) return c.json({ lines: template } satisfies RecapRes);
  try {
    const out = (await runJson(c.env, RECAP_SYSTEM, JSON.stringify(facts), RECAP_SCHEMA, 150)) as { lines?: unknown } | null;
    const lines = validateRecap(out?.lines, facts);
    return c.json({ lines: lines ?? template } satisfies RecapRes);
  } catch {
    return c.json({ lines: template } satisfies RecapRes);
  }
});

app.post('/api/stt', async c => {
  const session = c.req.header('X-Session') ?? '';
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength === 0 || buf.byteLength > MAX_STT_BYTES) return c.json({ error: 'bad_audio' }, 400);
  const seconds = Math.min(6, Math.max(1, Math.ceil(Number(c.req.header('X-Duration-S') ?? 6))));
  const g = await gate(c, RESERVE.sttPerSecond * seconds, session);
  if (!g.ok) return c.json({ error: g.reason }, 429);
  if (mockAi(c.env)) return c.json({ text: 'flares' });
  try {
    return c.json({ text: await transcribe(c.env, buf) });
  } catch {
    return c.json({ error: 'stt_failed' }, 502);
  }
});

export function validScore(b: unknown): b is ScoreReq {
  if (!b || typeof b !== 'object') return false;
  const s = b as Record<string, unknown>;
  const int = (v: unknown, lo: number, hi: number): boolean => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
  return typeof s.player === 'string' && ID_RE.test(s.player)
    && typeof s.callsign === 'string' && CALLSIGN_RE.test(s.callsign)
    && typeof s.missionId === 'string' && MISSIONS.has(s.missionId)
    && typeof s.difficulty === 'string' && DIFFICULTIES.has(s.difficulty as DifficultyName)
    && int(s.stars, 0, 3) && int(s.score, 0, 100_000) && int(s.durationS, 1, 3600);
}

app.post('/api/score', async c => {
  const body = await c.req.json<unknown>().catch(() => null);
  if (!validScore(body)) return c.json({ error: 'bad_request' }, 400);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO scores (id, player, callsign, mission_id, difficulty, stars, score, duration_s, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, body.player, body.callsign.trim(), body.missionId, body.difficulty, body.stars, body.score, body.durationS, Date.now()).run();
  return c.json({ id });
});

app.get('/api/leaderboard/:mission', async c => {
  const mission = c.req.param('mission');
  if (!MISSIONS.has(mission)) return c.json({ error: 'unknown_mission' }, 404);
  const difficulty = c.req.query('difficulty');
  const stmt = difficulty && DIFFICULTIES.has(difficulty as DifficultyName)
    ? c.env.DB.prepare(`SELECT callsign, difficulty, stars, score, duration_s, created_at FROM scores WHERE mission_id = ? AND difficulty = ? ORDER BY score DESC LIMIT 20`).bind(mission, difficulty)
    : c.env.DB.prepare(`SELECT callsign, difficulty, stars, score, duration_s, created_at FROM scores WHERE mission_id = ? ORDER BY score DESC LIMIT 20`).bind(mission);
  const { results } = await stmt.all<{ callsign: string; difficulty: DifficultyName; stars: number; score: number; duration_s: number; created_at: number }>();
  const rows: LeaderboardRow[] = results.map(r => ({ callsign: r.callsign, difficulty: r.difficulty, stars: r.stars, score: r.score, durationS: r.duration_s, createdAt: r.created_at }));
  c.header('Cache-Control', 'public, max-age=15');
  return c.json({ rows });
});

app.get('/api/budget', async c => {
  const s = await budget(c.env).status();
  return c.json(s satisfies BudgetRes);
});

app.all('/api/*', c => c.json({ error: 'not_found' }, 404));

export default app;
