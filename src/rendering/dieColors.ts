/**
 * dieColors (v2.19.4) — what a die is MADE of: a base colour, the facet tones
 * derived from it, and an ink that stays readable on top.
 *
 * A player's dice are their own colour, because at a real table you know whose
 * dice those are before you read them. The GM's are black with gold numerals,
 * which is a different thing entirely and meant to be.
 *
 * PURE: hex in, hex out. The ink follows the same YIQ brightness test the
 * initiative cards use, so a pale player colour gets dark numerals and a deep
 * one gets light — nobody ends up with a die they cannot read because they
 * picked yellow.
 */

export interface DieSkin {
  /** The body colour, as chosen. */
  base: string;
  /** The facet that faces the light, the body, and the facet turning away. */
  hi: string;
  mid: string;
  lo: string;
  /** The numerals. */
  ink: string;
}

/** The GM's dice: black, with gold. Overridable — see DicePolicy. */
export const GM_DIE_BASE = '#15171e';
export const GM_DIE_INK  = '#e3c26a';

/** Used when a colour cannot be parsed at all. */
const FALLBACK = '#dde3f1';

type Rgb = { r: number; g: number; b: number };

/** #rgb, #rrggbb, with or without the hash. Null for anything else. */
export function parseHex(input: string | undefined | null): Rgb | null {
  const s = (input ?? '').trim().replace(/^#/, '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

const toHex = ({ r, g, b }: Rgb): string =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/** Mix towards white (amount > 0) or black (amount < 0). */
function shade(rgb: Rgb, amount: number): Rgb {
  const target = amount >= 0 ? 255 : 0;
  const t = Math.abs(amount);
  return {
    r: rgb.r + (target - rgb.r) * t,
    g: rgb.g + (target - rgb.g) * t,
    b: rgb.b + (target - rgb.b) * t,
  };
}

/** The same brightness test the initiative cards use to pick a foreground. */
export function isLightColor(input: string): boolean {
  const rgb = parseHex(input);
  if (!rgb) return true;
  return (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000 > 150;
}

/**
 * Build a die's colours from its base. `ink` overrides the automatic choice —
 * that is how the GM's dice get gold numerals on black rather than white ones.
 */
export function skinFor(base: string | undefined | null, ink?: string | null): DieSkin {
  const rgb = parseHex(base) ?? parseHex(FALLBACK)!;
  const body = toHex(rgb);
  return {
    base: body,
    // A lit facet, the body, and one turned away. Enough separation to read as
    // a solid object, not so much that the die stops being its own colour.
    hi:  toHex(shade(rgb, 0.30)),
    mid: body,
    lo:  toHex(shade(rgb, -0.32)),
    ink: (ink && parseHex(ink) ? ink : null) ?? (isLightColor(body) ? '#141821' : '#f8fafc'),
  };
}

/** The GM's own dice, with whatever the pack has customised them to. */
export function gmSkin(base?: string | null, ink?: string | null): DieSkin {
  return skinFor(base || GM_DIE_BASE, ink || GM_DIE_INK);
}
