import type { Threat } from '@crewstrike/shared';

/** "left", "right", "behind" or "ahead" from a relative bearing. */
export function side(bearing: number): 'left' | 'right' | 'behind' | 'ahead' {
  const a = Math.abs(bearing);
  if (a <= 30) return 'ahead';
  if (a >= 140) return 'behind';
  return bearing < 0 ? 'left' : 'right';
}

export function clockOf(bearing: number): string {
  let h = Math.round(bearing / 30);
  if (h <= 0) h += 12;
  return `${h} o'clock`;
}

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
export function fromCompass(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8] ?? 'north';
}

const NUM = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
export function countWord(n: number): string {
  return NUM[n] ?? String(n);
}

export const plural = (n: number, w: string): string => (n === 1 ? w : `${w}s`);

/** Console lines are at most eight words. */
export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function clampWords(text: string, max = 8): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= max) return text.trim();
  return words.slice(0, max).join(' ').replace(/[,;:]$/, '') + '.';
}

export function nearest(threats: Threat[], pred: (t: Threat) => boolean): Threat | undefined {
  let best: Threat | undefined;
  for (const t of threats) if (pred(t) && (!best || t.km < best.km)) best = t;
  return best;
}
