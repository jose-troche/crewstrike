import type { StrategicKind } from '@crewstrike/shared';

const STRATEGIC_MARKER = /\b(?:should|shall|do i|better|best|worth|which|recommend|advice|advise|plan|or)\b|\?$/;

const RULES: [StrategicKind, RegExp][] = [
  ['abort', /\babort\b|give up|call it|turn back|bail|go home|head home|retreat|\bquit\b|keep going|press on|carry on/],
  ['escape', /\bescape\b|run away|\brun\b|get away|bug out|disengage|\bevade\b|lose them|shake (?:them|him|it)|get out/],
  ['route_choice', /\broute\b|which way|\bpath\b|this way|that way|north or south|south or north|\bvalley\b|go around|which side/],
  ['attack_plan', /best way to (?:hit|attack|strike|destroy|kill)|how should i (?:hit|attack|strike)|attack plan|strike plan|plan of attack|approach the target|hit the target/],
  ['engage_or_avoid', /dogfight|\bfight\b|\bengage\b|\bavoid\b|take (?:them|him) on|attack (?:them|him|the fighters?)|go after|shoot them/],
];

/** Keyword rules map a strategic question to one of five kinds; null if it is not strategic. */
export function classify(t: string): StrategicKind | null {
  if (!STRATEGIC_MARKER.test(t)) return null;
  for (const [kind, re] of RULES) if (re.test(t)) return kind;
  return null;
}
