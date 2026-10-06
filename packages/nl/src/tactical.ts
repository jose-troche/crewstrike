import type { AgentId, GameSnapshot, HudZone, Threat } from '@crewstrike/shared';

export interface Answer {
  re: RegExp;
  say: (s: GameSnapshot) => string;
  glow: HudZone[];
  agent: AgentId;
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const km = (v: number): string => `${v.toFixed(1)} km`;
export function clock(bearing: number): string {
  let h = Math.round(bearing / 30);
  if (h <= 0) h += 12;
  return `${h} o'clock`;
}

const NAMES: Record<Threat['kind'], string> = {
  fighter: 'fighter', drone: 'drone swarm', sam: 'SAM site', aaa: 'flak guns', ship: 'warship', missile: 'missile',
};

function describeThreat(t: Threat): string {
  const what = t.kind === 'drone' ? `${t.count ?? ''} drones`.trim() : NAMES[t.kind];
  const state = t.state === 'inbound' ? ', inbound' : t.state === 'locked' ? ', locking you' : t.state === 'tracking' ? ', tracking you' : '';
  return `${what[0]!.toUpperCase()}${what.slice(1)} ${km(t.km)}, ${clock(t.bearing)}${state}.`;
}

function worstSection(s: GameSnapshot): string {
  const entries = Object.entries(s.sections) as [string, number][];
  entries.sort((a, b) => b[1] - a[1]);
  const [name, v] = entries[0] ?? ['body', 0];
  if (v < 0.05) return 'No damage.';
  const label = name === 'leftWing' ? 'Left wing' : name === 'rightWing' ? 'Right wing' : name[0]!.toUpperCase() + name.slice(1);
  return `${label} worst.`;
}

const PHASE_HINT: Record<GameSnapshot['phase'], string> = {
  ingress: 'Ingress: follow the arrow to the target.',
  fight: 'Fight through: survive and keep heading for target.',
  strike: 'Strike: lock the target with G, then fire.',
  egress: 'Egress: get to the green exit zone.',
};

/** Questions about your jet, answered instantly from game state. */
export const tactical: Answer[] = [
  { re: /\bfuel\b|\bgas\b|\bbingo\b/, say: s => `Fuel ${pct(s.fuel.fraction)}, ${Math.round(s.nav.minutesToExit)} min to exit.`, glow: ['fuel'], agent: 'flight' },
  { re: /\bammo\b|\brounds\b|\bcannon\b/, say: s => `Cannon ${s.weapons.rounds} rounds.`, glow: ['weapons'], agent: 'weapons' },
  { re: /\bmissiles?\b|\bstrikes?\b/, say: s => `${s.weapons.missiles} missiles, ${s.weapons.strike} strike.`, glow: ['weapons'], agent: 'weapons' },
  { re: /\bflares?\b/, say: s => `${s.weapons.flares} flares left.`, glow: ['flares'], agent: 'weapons' },
  { re: /\bdamage\b|\bhurt\b|\bhow bad\b|\bhealth\b|\bhull\b/, say: s => `Damage ${pct(s.damage)}. ${worstSection(s)}`, glow: ['damage'], agent: 'flight' },
  { re: /where.*\btarget\b|\btarget\b.*(?:where|distance|far)|how far.*target|\btarget\?$/, say: s => s.target.alive ? `Target ${km(s.nav.kmToTarget)}, ${clock(s.nav.targetBearing)}.` : `Target destroyed. Exit ${km(s.nav.kmToExit)}.`, glow: ['objective'], agent: 'mission' },
  { re: /where.*\b(?:exit|home)\b|how far.*\b(?:exit|home)\b|\bexit\?$/, say: s => `Exit ${km(s.nav.kmToExit)}, ${clock(s.nav.exitBearing)}.`, glow: ['objective'], agent: 'mission' },
  { re: /\bspeed\b|how fast/, say: s => `Speed ${Math.round(s.own.speed * 1.944)} knots, throttle ${['slow', 'cruise', 'fast'][s.own.throttle]}.`, glow: ['speed'], agent: 'flight' },
  { re: /\baltitude\b|\bheight\b|how high|how low/, say: s => `Altitude ${s.own.agl} m above ground.`, glow: ['altitude'], agent: 'flight' },
  {
    re: /what'?s that|\bthreats?\b|\benemy\b|what'?s (?:around|out there|near)|anything (?:near|around)|\bradar\b/,
    say: s => {
      const t = s.threats.find(x => x.kind !== 'sam' || x.state !== 'idle') ?? s.threats[0];
      if (!t) return 'Radar clear. Nothing near you.';
      return describeThreat(t);
    },
    glow: ['radar', 'threat-ring'],
    agent: 'radar',
  },
  { re: /\bweather\b|\bstorm\b|\bwind\b/, say: s => s.weather.inStorm ? 'Inside a storm: hidden, but lightning risk.' : s.weather.stormKm !== null ? `Storm ${km(s.weather.stormKm)}, ${clock(s.weather.stormBearing ?? 0)}. Wind ${s.weather.windKt} kt.` : `No storms. Wind ${s.weather.windKt} kt.`, glow: ['weather'], agent: 'weather' },
  { re: /\bscore\b|how am i doing|\bstars?\b|\btime\b/, say: s => `Score ${s.score.score}, ${s.score.kills} kills, ${s.score.elapsedS} s.`, glow: ['mission-bar'], agent: 'mission' },
  { re: /what now|what do i do|what'?s next|\bphase\b|\bobjective\b|\bmission\b/, say: s => PHASE_HINT[s.phase], glow: ['objective'], agent: 'mission' },
];

export function matchTactical(t: string, s: GameSnapshot): { text: string; glow: HudZone[]; agent: AgentId } | null {
  for (const a of tactical) if (a.re.test(t)) return { text: a.say(s), glow: a.glow, agent: a.agent };
  return null;
}
