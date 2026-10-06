import { DurableObject } from 'cloudflare:workers';

export interface Gate {
  ok: boolean;
  remaining: number;
  reason?: 'daily_ceiling' | 'ip_hourly' | 'session_cap' | 'too_fast' | 'unknown_session';
}

export const IP_HOURLY = 120;
export const SESSION_CAP = 150;
export const SESSION_MIN_GAP_MS = 3000;
const DAY_MS = 86_400_000;

const utcDay = (now: number): string => new Date(now).toISOString().slice(0, 10);

/**
 * Single SQLite-backed ledger for every AI call: a daily ceiling, a per-IP hourly cap and a per-session cap.
 * One object processes one call at a time, so no locks are needed.
 */
export class BudgetDO extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS ledger (day TEXT PRIMARY KEY, used INTEGER NOT NULL)`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS ip_hour (ip TEXT NOT NULL, hour INTEGER NOT NULL, used INTEGER NOT NULL, PRIMARY KEY (ip, hour))`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY, used INTEGER NOT NULL, last_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`);
      if ((await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(Date.now() + DAY_MS);
    });
  }

  private ceiling(): number {
    return Number(this.env.NEURON_CEILING) || 9000;
  }

  private usedToday(now: number): number {
    const row = this.sql.exec<{ used: number }>(`SELECT used FROM ledger WHERE day = ?`, utcDay(now)).toArray()[0];
    return row?.used ?? 0;
  }

  async createSession(id: string): Promise<void> {
    const now = Date.now();
    this.sql.exec(`INSERT OR IGNORE INTO session (id, used, last_at, created_at) VALUES (?, 0, 0, ?)`, id, now);
  }

  /** Reserve neurons before an AI call; refuses when any limit would be exceeded. */
  async reserve(neurons: number, session: string, ipHash: string): Promise<Gate> {
    const now = Date.now();
    const day = utcDay(now);
    const hour = Math.floor(now / 3_600_000);
    const used = this.usedToday(now);
    const remaining = this.ceiling() - used;
    if (neurons > remaining) return { ok: false, remaining: Math.max(0, remaining), reason: 'daily_ceiling' };

    const sess = this.sql.exec<{ used: number; last_at: number }>(`SELECT used, last_at FROM session WHERE id = ?`, session).toArray()[0];
    if (!sess) return { ok: false, remaining, reason: 'unknown_session' };
    if (sess.used + neurons > SESSION_CAP) return { ok: false, remaining, reason: 'session_cap' };
    if (now - sess.last_at < SESSION_MIN_GAP_MS) return { ok: false, remaining, reason: 'too_fast' };

    const ipRow = this.sql.exec<{ used: number }>(`SELECT used FROM ip_hour WHERE ip = ? AND hour = ?`, ipHash, hour).toArray()[0];
    if ((ipRow?.used ?? 0) + neurons > IP_HOURLY) return { ok: false, remaining, reason: 'ip_hourly' };

    this.sql.exec(`INSERT INTO ledger (day, used) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET used = used + excluded.used`, day, neurons);
    this.sql.exec(`INSERT INTO ip_hour (ip, hour, used) VALUES (?, ?, ?) ON CONFLICT(ip, hour) DO UPDATE SET used = used + excluded.used`, ipHash, hour, neurons);
    this.sql.exec(`UPDATE session SET used = used + ?, last_at = ? WHERE id = ?`, neurons, now, session);
    return { ok: true, remaining: remaining - neurons };
  }

  async status(): Promise<{ used: number; remaining: number; ceiling: number }> {
    const used = this.usedToday(Date.now());
    const ceiling = this.ceiling();
    return { used, remaining: Math.max(0, ceiling - used), ceiling };
  }

  /** Daily cleanup of rows older than a day. */
  async alarm(): Promise<void> {
    const now = Date.now();
    this.sql.exec(`DELETE FROM ledger WHERE day < ?`, utcDay(now - DAY_MS));
    this.sql.exec(`DELETE FROM ip_hour WHERE hour < ?`, Math.floor((now - DAY_MS) / 3_600_000));
    this.sql.exec(`DELETE FROM session WHERE created_at < ?`, now - DAY_MS);
    await this.ctx.storage.setAlarm(now + DAY_MS);
  }
}
