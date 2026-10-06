const NUMBERS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
};

const FILLER = [
  'um', 'uh', 'erm', 'hey', 'ok', 'okay', 'please', 'wingman', 'crew', 'copy', 'roger', 'so', 'just', 'now',
];
const FILLER_PHRASES = [
  /^(?:can|could|would) you\s+/, /^i want to\s+/, /^i wanna\s+/, /^let'?s\s+/, /^lets\s+/, /^go ahead and\s+/, /^tell me\s+/,
];

const SYNONYMS: [RegExp, string][] = [
  [/\b(?:bogeys?|bandits?|hostiles?|enemies)\b/g, 'enemy'],
  [/\bchaff\b/g, 'flares'],
  [/\bafterburners?\b/g, 'boost'],
  [/\b(?:rtb|return to base|base)\b/g, 'home'],
  [/\b(?:guns?|bullets?)\b/g, 'cannon'],
  [/\bfox ?(?:two|2)\b/g, 'fire missile'],
  [/\bsams?\b/g, 'sam'],
  [/\bheat ?seekers?\b/g, 'missiles'],
  [/\bjet\b/g, 'plane'],
];

/** Lowercase, spoken numbers to digits, strip filler, map synonyms. */
export function normalize(text: string): string {
  let t = text.toLowerCase().trim();
  t = t.replace(/[’']/g, "'").replace(/[^a-z0-9'?\s.-]/g, ' ');
  t = t.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, m => NUMBERS[m] ?? m);
  t = t.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) {
    for (const re of FILLER_PHRASES) t = t.replace(re, '');
    const words = t.split(' ');
    while (words.length > 1 && FILLER.includes(words[0]!.replace(/[?.,]/g, ''))) words.shift();
    while (words.length > 1 && FILLER.includes(words[words.length - 1]!.replace(/[?.,]/g, ''))) words.pop();
    t = words.join(' ');
  }
  for (const [re, rep] of SYNONYMS) t = t.replace(re, rep);
  return t.replace(/\s+/g, ' ').trim();
}

/** Text without trailing punctuation, for anchored command matching. */
export function bare(t: string): string {
  return t.replace(/[?.!]+$/g, '').trim();
}
