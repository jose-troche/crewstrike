/** Built-in help cards: one line, plus the button and gauge to highlight on screen. */
export interface HelpCard {
  id: string;
  keywords: RegExp;
  answer: string;
  /** data-help ids of controls and zones to highlight. */
  highlight: string[];
}

export const HELP_CARDS: HelpCard[] = [
  { id: 'strike-missile', keywords: /strike/, answer: 'Fly into the magenta strike zone, press G to lock, press again to fire.', highlight: ['weapon-strike', 'objective', 'key-strike'] },
  { id: 'flares', keywords: /flares?|countermeasure|dodge|missile.*(?:avoid|beat|lose)/, answer: 'When a red wedge appears, press E for flares and turn hard.', highlight: ['flares', 'threat-ring', 'key-flare'] },
  { id: 'heat-seeker', keywords: /lock|heat|missiles?|fighters?/, answer: 'Hold a fighter in the ring until the tone, then press F.', highlight: ['weapon-missile', 'key-missile'] },
  { id: 'cannon', keywords: /cannon|shoot|fire|drones?/, answer: 'Hold Space or click to fire; aim at the lead marker.', highlight: ['weapon-cannon', 'key-cannon'] },
  { id: 'autopilot', keywords: /autopilot|auto ?pilot|fly (?:for|itself)/, answer: 'Press R: the jet flies the route; any stick input takes over.', highlight: ['key-autopilot', 'objective'] },
  { id: 'boost', keywords: /boost|afterburner|faster/, answer: 'Hold Shift to boost; it burns fuel fast and recharges.', highlight: ['speed', 'key-boost'] },
  { id: 'throttle', keywords: /throttle|slow|speed/, answer: 'W and S set slow, cruise or fast. Slower turns tighter.', highlight: ['speed', 'key-throttle'] },
  { id: 'radar', keywords: /radar|map|enemies|threat/, answer: 'Radar is top-down: red icons are enemies, domes are missile sites.', highlight: ['radar', 'threat-ring'] },
  { id: 'fuel', keywords: /fuel|home line|gas/, answer: 'Keep the fuel bar above the white line to make it home.', highlight: ['fuel'] },
  { id: 'storm', keywords: /storm|weather|lightning|cloud/, answer: 'Purple storms hide you from radar but shake you and strike lightning.', highlight: ['weather', 'radar'] },
  { id: 'abort', keywords: /abort|give up|retreat|exit|home/, answer: 'Reach the green exit before striking for a partial score.', highlight: ['objective'] },
  { id: 'voice', keywords: /voice|talk|speak|mic|ask/, answer: 'Hold V to talk or press / to type. M switches voice modes.', highlight: ['key-ptt', 'console'] },
  { id: 'steer', keywords: /steer|turn|fly|control|stick|climb|dive/, answer: 'Steer with mouse or arrows; the jet banks into turns by itself.', highlight: ['key-stick'] },
  { id: 'targets', keywords: /next target|switch target|tab|target/, answer: 'Press Tab to cycle targets, or tap one on radar.', highlight: ['radar', 'key-target'] },
];

export const HOWTO_RE = /^(?:how (?:do|can|should) (?:i|you|we)|how does|how do|how to|what does|what is (?:a|the)|what are|explain|help(?: me)? with|teach me)\b/;

export function matchHowTo(t: string): HelpCard | null {
  if (!HOWTO_RE.test(t) && !/^help\b/.test(t)) return null;
  for (const card of HELP_CARDS) if (card.keywords.test(t)) return card;
  return null;
}
