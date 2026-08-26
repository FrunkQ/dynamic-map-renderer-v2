/**
 * Dice engine (v2.19) — parse a formula, roll it, describe it.
 *
 * PURE: no DOM, no network, no storage. Every surface (player tray, GM panel,
 * projector) agrees on what a formula means, and a result travels as DATA —
 * which is what lets one device decide the faces and every other device show
 * the same ones. Nothing anywhere re-rolls a roll it was told about.
 *
 * The grammar is deliberately small, because a GM authors the set and players
 * only tap it:
 *   2d6          N dice of M sides (N optional, so `d20` is `1d20`)
 *   1d20+5       a flat modifier, + or -
 *   1d8+1d6+2    several terms
 *   4dF          Fate / Fudge dice, each -1, 0 or +1
 *   1d20 adv     roll it twice and keep the higher ("dis" keeps the lower)
 * Anything else is rejected when the GM writes the set, not when a player taps
 * it at the table.
 */

/** One die's outcome. `sides: 'F'` is a Fate die (-1 | 0 | +1). */
export interface DieResult {
  sides: number | 'F';
  value: number;
  /** Set on the die adv/dis threw away — shown struck through, never counted. */
  dropped?: boolean;
}

export interface RollOutcome {
  /** The formula as authored, so a viewer can see what was asked for. */
  formula: string;
  dice: DieResult[];
  modifier: number;
  total: number;
  mode?: 'adv' | 'dis';
}

export interface ParsedFormula {
  terms: { count: number; sides: number | 'F' }[];
  modifier: number;
  mode?: 'adv' | 'dis';
}

/** Guard rails, so a fat-fingered set entry cannot hang a phone at the table. */
export const MAX_DICE = 100;
export const MAX_SIDES = 1000;

const TERM_RE = /^(\d*)d(\d+|f)$/i;

/**
 * Parse a formula, or null if it is not one. Total dice and side counts are
 * capped here, so an impossible formula fails in the editor where the GM can
 * see it rather than mid-session.
 */
export function parseFormula(input: string): ParsedFormula | null {
  let src = (input ?? '').trim().toLowerCase();
  if (!src) return null;

  let mode: 'adv' | 'dis' | undefined;
  const modeMatch = src.match(/\s+(adv|dis|advantage|disadvantage)$/);
  if (modeMatch) {
    mode = modeMatch[1]!.startsWith('adv') ? 'adv' : 'dis';
    src = src.slice(0, modeMatch.index).trim();
  }

  // Split on +/- while keeping the sign with the term that follows it.
  const parts = src.replace(/\s+/g, '').split(/(?=[+-])/);
  if (parts.length === 0 || parts.length > 10) return null;

  const terms: ParsedFormula['terms'] = [];
  let modifier = 0;
  let diceTotal = 0;

  for (const raw of parts) {
    if (!raw) return null;
    const negative = raw.startsWith('-');
    const body = raw.replace(/^[+-]/, '');
    if (!body) return null;

    const m = body.match(TERM_RE);
    if (m) {
      // A negative dice term ("-1d6") is not a thing this grammar offers.
      if (negative) return null;
      const count = m[1] ? Number(m[1]) : 1;
      const sides: number | 'F' = m[2]!.toLowerCase() === 'f' ? 'F' : Number(m[2]);
      if (count < 1) return null;
      if (sides !== 'F' && (sides < 2 || sides > MAX_SIDES)) return null;
      diceTotal += count;
      if (diceTotal > MAX_DICE) return null;
      terms.push({ count, sides });
      continue;
    }

    if (!/^\d+$/.test(body)) return null;
    modifier += negative ? -Number(body) : Number(body);
  }

  if (terms.length === 0) return null;
  // adv/dis is a d20 idiom: it only means anything on a single die.
  if (mode && (terms.length !== 1 || terms[0]!.count !== 1)) return null;
  return { terms, modifier, ...(mode ? { mode } : {}) };
}

/** True when the string is a formula this engine can roll. */
export function isValidFormula(input: string): boolean {
  return parseFormula(input) !== null;
}

/** Unbiased integer in [1, sides] from a source of uniform floats in [0, 1). */
function dieValue(sides: number, rng: () => number): number {
  return Math.floor(rng() * sides) + 1;
}

/** Uniform floats from the platform CSPRNG, rejecting the biased tail. */
export function cryptoRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! / 4294967296;
}

/**
 * Roll a formula. Returns null for a formula that will not parse — callers at
 * the table should never see that, because the set editor validates on entry.
 * `rng` is injectable so tests are deterministic; production uses the CSPRNG.
 */
export function rollFormula(input: string, rng: () => number = cryptoRandom): RollOutcome | null {
  const parsed = parseFormula(input);
  if (!parsed) return null;

  const dice: DieResult[] = [];
  for (const term of parsed.terms) {
    for (let i = 0; i < term.count; i++) {
      const value = term.sides === 'F' ? dieValue(3, rng) - 2 : dieValue(term.sides, rng);
      dice.push({ sides: term.sides, value });
    }
  }

  // Advantage rolls the same die a second time and keeps one; both are carried
  // so a viewer can see what was beaten.
  if (parsed.mode) {
    const first = dice[0]!;
    const second: DieResult = {
      sides: first.sides,
      value: first.sides === 'F' ? dieValue(3, rng) - 2 : dieValue(first.sides as number, rng),
    };
    dice.push(second);
    const keepHigher = parsed.mode === 'adv';
    const loserIsFirst = keepHigher ? first.value < second.value : first.value > second.value;
    (loserIsFirst ? first : second).dropped = true;
  }

  const total = dice.reduce((sum, d) => (d.dropped ? sum : sum + d.value), 0) + parsed.modifier;
  return {
    formula: input.trim(),
    dice,
    modifier: parsed.modifier,
    total,
    ...(parsed.mode ? { mode: parsed.mode } : {}),
  };
}

/** One-line breakdown for a feed: "[17] [3] + 5 = 22". Dropped dice are shown
 *  in brackets with a strike marker the renderers style. */
export function describeRoll(r: RollOutcome): string {
  const faces = r.dice.map((d) => {
    const face = d.sides === 'F' ? (d.value > 0 ? '+' : d.value < 0 ? '-' : '0') : String(d.value);
    return d.dropped ? `(${face})` : `[${face}]`;
  }).join(' ');
  const mod = r.modifier === 0 ? '' : r.modifier > 0 ? ` + ${r.modifier}` : ` - ${Math.abs(r.modifier)}`;
  return `${faces}${mod} = ${r.total}`;
}

/**
 * What a formula COULD come to, low and high. A result means little without it:
 * a 5 is a triumph on 3d6-with-a-penalty and a disaster on 3d6+10, and the feed
 * line says so — "5 (on 3d6 [3-18])".
 */
export function rangeOf(input: string): { min: number; max: number } | null {
  const p = parseFormula(input);
  if (!p) return null;
  let min = p.modifier, max = p.modifier;
  for (const t of p.terms) {
    // adv/dis rolls the die twice and keeps one, so the RANGE is unchanged.
    min += t.sides === 'F' ? -t.count : t.count;
    max += t.sides === 'F' ? t.count : t.count * t.sides;
  }
  return { min, max };
}

/**
 * The sentence a roll leaves behind: "1+2+2=5 (on 3d6 [3-18])". This is the
 * evidence — dice fade off the screen after a few seconds, and this is what
 * remains in the GM's feed afterwards. Dropped dice are shown in brackets
 * before the sum they did not join.
 */
export function describeRollSentence(r: RollOutcome): string {
  const kept = r.dice.filter((d) => !d.dropped);
  const beaten = r.dice.filter((d) => d.dropped)
    .map((d) => `(${faceOf(d)})`).join(' ');
  const sum = kept.map((d) => faceOf(d)).join('+')
    + (r.modifier === 0 ? '' : r.modifier > 0 ? `+${r.modifier}` : `-${Math.abs(r.modifier)}`);
  const range = rangeOf(r.formula);
  const bounds = range ? ` [${range.min}-${range.max}]` : '';
  return `${beaten ? beaten + ' ' : ''}${sum}=${r.total} (on ${r.formula}${bounds})`;
}

/** A die's face as it reads: Fate dice as +/-/0, everything else as its number. */
function faceOf(d: DieResult): string {
  if (d.sides !== 'F') return String(d.value);
  return d.value > 0 ? '+' : d.value < 0 ? '-' : '0';
}

/**
 * Did this die land on its best or worst face? Used for the flare on a natural
 * 20 and the thud on a 1 — per DIE, since that is what a table cares about,
 * not whether the total happened to hit its ceiling.
 */
export function critOf(d: DieResult): 'max' | 'min' | null {
  if (d.dropped) return null;
  if (d.sides === 'F') return d.value > 0 ? 'max' : d.value < 0 ? 'min' : null;
  if (d.sides < 4) return null;            // a coin has no natural 20
  if (d.value === d.sides) return 'max';
  if (d.value === 1) return 'min';
  return null;
}

/** How many dice a formula throws — the renderers size their tray with this. */
export function diceCount(input: string): number {
  const p = parseFormula(input);
  if (!p) return 0;
  return p.terms.reduce((n, t) => n + t.count, 0) + (p.mode ? 1 : 0);
}
