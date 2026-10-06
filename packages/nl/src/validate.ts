import type { Advice, Verdict } from '@crewstrike/shared';

const VERDICT_WORDS: Record<Verdict, RegExp> = {
  ENGAGE: /\bengage\b/i, AVOID: /\bavoid\b/i, ESCAPE: /\bescape\b/i, ABORT: /\babort\b/i, CONTINUE: /\bcontinue\b/i, REROUTE: /\breroute\b/i,
};

/** All numbers a reason may mention: the facts, and rounded forms of them. */
function allowedNumbers(facts: Advice['facts']): Set<string> {
  const out = new Set<string>();
  for (const v of Object.values(facts)) {
    if (typeof v !== 'number') continue;
    out.add(String(v));
    out.add(String(Math.round(v)));
    out.add(String(Math.round(v * 10) / 10));
    out.add(String(Math.round(v * 100)));
    if (v <= 100) out.add(String(100 - Math.round(v)));
  }
  return out;
}

export interface Validation {
  ok: boolean;
  why?: string;
}

/** Every number the model says is checked against game state; word limit enforced; verdict may not change. */
export function validateReason(reason: string, verdict: Verdict, facts: Advice['facts'], maxWords = 15): Validation {
  const text = reason.trim();
  if (!text) return { ok: false, why: 'empty' };
  const words = text.split(/\s+/).length;
  if (words > maxWords) return { ok: false, why: `too long: ${words} words` };
  const allowed = allowedNumbers(facts);
  for (const m of text.match(/\d+(?:\.\d+)?/g) ?? []) {
    if (!allowed.has(m) && !allowed.has(String(Number(m)))) return { ok: false, why: `unknown number ${m}` };
  }
  for (const [v, re] of Object.entries(VERDICT_WORDS) as [Verdict, RegExp][]) {
    if (v !== verdict && re.test(text)) return { ok: false, why: `contradicts verdict with ${v}` };
  }
  return { ok: true };
}

export function validateRecap(lines: unknown, facts: Record<string, number | string>): string[] | null {
  if (!Array.isArray(lines) || lines.length !== 3) return null;
  const allowed = allowedNumbers(facts);
  for (const l of lines) {
    if (typeof l !== 'string' || !l.trim() || l.split(/\s+/).length > 16) return null;
    for (const m of l.match(/\d+(?:\.\d+)?/g) ?? []) if (!allowed.has(m)) {
      // Allow mm:ss times built from durationS.
      const d = Number(facts.durationS ?? -1);
      const ok = d >= 0 && (m === String(Math.floor(d / 60)) || m === String(d % 60).padStart(2, '0'));
      if (!ok) return null;
    }
  }
  return lines.map(l => String(l).trim());
}
