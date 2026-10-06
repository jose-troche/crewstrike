import type { Advice, Verdict } from '@crewstrike/shared';

type Facts = Advice['facts'];
const n = (f: Facts, k: string): number => Number(f[k] ?? 0);

/** Template reasons (15 words or fewer), used offline, over budget, or when a model reply fails validation. */
export function templateReason(v: Verdict, f: Facts): string {
  const route = String(f.route ?? 'north');
  switch (v) {
    case 'ENGAGE':
      return `You have ${n(f, 'missiles')} missiles and ${100 - n(f, 'damagePct')}% airframe. Take them.`;
    case 'AVOID':
      return `${n(f, 'threats')} threats, ${n(f, 'missiles')} missiles left. Avoid; go ${route}.`;
    case 'ESCAPE':
      return `Outgunned by ${n(f, 'threats')} threats. Boost away to the ${route}.`;
    case 'ABORT':
      return `Fuel ${n(f, 'fuelPct')}%, damage ${n(f, 'damagePct')}%. Too risky; head home.`;
    case 'REROUTE':
      return `Direct route crosses missile cover. The ${route} side is safer.`;
    case 'CONTINUE':
      return `Fuel ${n(f, 'fuelPct')}%, damage ${n(f, 'damagePct')}%. You are fine; press on.`;
  }
}

export interface RecapFacts {
  [k: string]: number | string;
  outcome: string;
  mission: string;
  stars: number;
  score: number;
  kills: number;
  damagePct: number;
  durationS: number;
  missilesLeft: number;
  strikeLeft: number;
}

/** Three-line mission recap from game facts. */
export function templateRecap(f: RecapFacts): string[] {
  const min = Math.floor(f.durationS / 60);
  const sec = f.durationS % 60;
  const time = `${min}:${String(sec).padStart(2, '0')}`;
  const first =
    f.outcome === 'won' ? `${f.mission} complete in ${time}: ${f.stars} ${f.stars === 1 ? 'star' : 'stars'}, ${f.score} points.`
    : f.outcome === 'aborted' ? `Mission aborted after ${time}; partial score ${f.score}.`
    : `Shot down after ${time}. Score ${f.score}.`;
  const second = f.kills > 0
    ? `${f.kills} ${f.kills === 1 ? 'kill' : 'kills'}, airframe ${100 - f.damagePct}% intact.`
    : `No kills, airframe ${100 - f.damagePct}% intact.`;
  let third: string;
  if (f.outcome === 'lost') third = 'Tip: fire flares at red wedges and turn hard.';
  else if (f.damagePct > 35) third = 'Tip: fly low behind hills to dodge missile sites.';
  else if (f.durationS > 360) third = 'Tip: autopilot and boost get you there faster.';
  else third = 'Tip: try a harder difficulty for a bigger multiplier.';
  return [first, second, third];
}
