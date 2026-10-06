/** Canvas colors mirror the CSS tokens so colorblind palettes apply to radar and overlay too. */
export interface PaletteColors {
  green: string;
  amber: string;
  red: string;
  cyan: string;
  magenta: string;
  purple: string;
  white: string;
}

export function readPalette(): PaletteColors {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, d: string): string => cs.getPropertyValue(n).trim() || d;
  return {
    green: v('--green', '#3dff8a'),
    amber: v('--amber', '#ffb627'),
    red: v('--red', '#ff3b3b'),
    cyan: v('--cyan', '#35e0ff'),
    magenta: v('--magenta', '#ff3cf0'),
    purple: v('--purple', '#b07bff'),
    white: v('--white', '#f2f6fa'),
  };
}
