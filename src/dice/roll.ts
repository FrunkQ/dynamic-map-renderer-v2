/**
 * Dice engine (v2.19) — parse a formula, roll it, describe it.
 *
 * PURE: no DOM, no network, no storage. Every surface (player tray, GM panel,
 * projector) agrees on what a formula means, and a result travels as DATA —
 * which is what lets one device decide the faces and every other device show
 * the same ones. Nothing anywhere re-rolls a roll it was told about.
 *
 * The grammar is a dice expression followed by plain-word mechanics, because a
 * GM has to be able to read their own set back a month later:
 *
 *   2d6              N dice of M sides (N optional, so `d20` is `1d20`)
 *   1d20+5           a flat modifier, + or -
 *   1d8+1d6+2        several terms
 *   4dF              Fate / Fudge dice, each -1, 0 or +1
 *   1d20 adv         roll twice, keep the higher ("dis" keeps the lower)
 *   1d6 burst        a die at its maximum rolls again and ADDS, and keeps
 *                    going — exploding dice: Savage Worlds, L5R, wild dice
 *   4d6 keep 3       keep the best 3, strike the rest ("keep low 3" for worst)
 *   5d10 burst keep 3    L5R roll-and-keep, said out loud
 *   12d6 target 5    a SUCCESS POOL: the result is how many dice reached 5,
 *                    not their sum — Shadowrun, World of Darkness, Storyteller
 *
 * Mechanics may be written in any order and apply to the whole roll. Anything
 * else is rejected when the GM writes the set, not when a player taps it.
 */

/** One die's outcome. `sides: 'F'` is a Fate die (-1 | 0 | +1). */
export interface DieResult {
  sides: number | 'F';
  /** What the die came to. With a BURST this is the running total, which is how
   *  a table reads it — "a seventeen on that d10" — so keeping the best dice
   *  still compares like with like. */
  value: number;
  /** Thrown away by adv/dis or by a keep: shown struck through, never counted. */
  dropped?: boolean;
  /** How many times this die went off, if it burst. */
  burst?: number;
}

export interface RollOutcome {
  /** The formula as authored, so a viewer can see what was asked for. */
  formula: string;
  dice: DieResult[];
  modifier: number;
  /** The sum — or, in a success pool, how many dice reached the target. */
  total: number;
  mode?: 'adv' | 'dis';
  /** Present on a success pool, and what makes `total` a COUNT. */
  pool?: {
    /** What each die had to reach. */
    target: number;
    /** Dice showing a natural 1 — what glitch and botch rules key off. */
    ones: number;
    /** More than half the pool came up 1: a glitch, in Shadowrun's sense. */
    glitch: boolean;
  };
}

export interface TermSpec {
  count: number;
  sides: number | 'F';
}

export interface ParsedFormula {
  terms: TermSpec[];
  modifier: number;
  mode?: 'adv' | 'dis';
  /** A die at its maximum rolls again and adds. */
  burst?: boolean;
  /** Keep only this many dice, best or worst. */
  keep?: { n: number; from: 'high' | 'low' };
  /** Count dice reaching this instead of summing them. */
  target?: number;
}

/** Guard rails, so a fat-fingered set entry cannot hang a phone at the table. */
export const MAX_DICE = 100;
export const MAX_SIDES = 1000;
/** A burst has to stop somewhere, or a d3 eventually will not. */
export const MAX_BURST = 20;

const TERM_RE = /^(\d*)d(\d+|f)$/i;

/**
 * Parse a formula, or null if it is not one. Every limit is checked here, so an
 * impossible formula fails in the editor where the GM can see it rather than
 * mid-session.
 */
export function parseFormula(input: string): ParsedFormula | null {
  // Tighten up the dice expression so the mechanics can be read off as words:
  // "4d6 + 2 keep 3" and "4d6+2 keep 3" are the same thing.
  const src = (input ?? '').trim().toLowerCase().replace(/\s*([+-])\s*/g, '$1');
  if (!src) return null;

  const [expression, ...words] = src.split(/\s+/);
  if (!expression) return null;

  const spec: ParsedFormula = { terms: [], modifier: 0 };

  // ── the mechanics, in words, in any order ───────────────────────────────
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (word === 'adv' || word === 'advantage') { spec.mode = 'adv'; continue; }
    if (word === 'dis' || word === 'disadvantage') { spec.mode = 'dis'; continue; }
    if (word === 'burst' || word === 'exploding' || word === 'explode') { spec.burst = true; continue; }
    if (word === 'keep') {
      let from: 'high' | 'low' = 'high';
      let next = words[++i];
      if (next === 'low' || next === 'lowest' || next === 'worst') { from = 'low'; next = words[++i]; }
      else if (next === 'high' || next === 'highest' || next === 'best') { next = words[++i]; }
      const n = Number(next);
      if (!Number.isInteger(n) || n < 1) return null;
      spec.keep = { n, from };
      continue;
    }
    if (word === 'target' || word === 'hits' || word === 'successes') {
      const n = Number(words[++i]);
      if (!Number.isInteger(n) || n < 1) return null;
      spec.target = n;
      continue;
    }
    return null; // a word nobody here understands
  }

  // ── the dice themselves ─────────────────────────────────────────────────
  const parts = expression.split(/(?=[+-])/);
  if (parts.length === 0 || parts.length > 10) return null;
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
      spec.terms.push({ count, sides });
      continue;
    }

    if (!/^\d+$/.test(body)) return null;
    spec.modifier += negative ? -Number(body) : Number(body);
  }

  if (spec.terms.length === 0) return null;
  // adv/dis is a d20 idiom: it only means anything on a single die.
  if (spec.mode && (spec.terms.length !== 1 || spec.terms[0]!.count !== 1)) return null;
  // Nothing to keep from a hand smaller than the keep.
  if (spec.keep && spec.keep.n > diceTotal) return null;
  // A Fate die has no maximum worth exploding, and a d2 that bursts on every
  // other roll is a hang waiting to happen.
  if (spec.burst && spec.terms.some((t) => t.sides === 'F' || (t.sides as number) < 3)) return null;
  // A pool COUNTS dice, so a flat modifier on it would be adding apples.
  if (spec.target !== undefined && spec.modifier !== 0) return null;
  return spec;
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
      dice.push(rollOneDie(term.sides, parsed.burst === true, rng));
    }
  }

  // Advantage rolls the same die a second time and keeps one; both are carried
  // so a viewer can see what was beaten.
  if (parsed.mode) {
    const first = dice[0]!;
    const second = rollOneDie(first.sides, parsed.burst === true, rng);
    dice.push(second);
    const keepHigher = parsed.mode === 'adv';
    const loserIsFirst = keepHigher ? first.value < second.value : first.value > second.value;
    (loserIsFirst ? first : second).dropped = true;
  }

  // Keep the best (or worst) few; the rest stay on screen, struck through.
  if (parsed.keep) {
    const order = [...dice.keys()].sort((a, b) => (parsed.keep!.from === 'high'
      ? dice[b]!.value - dice[a]!.value
      : dice[a]!.value - dice[b]!.value));
    for (const idx of order.slice(parsed.keep.n)) dice[idx]!.dropped = true;
  }

  const counted = dice.filter((d) => !d.dropped);

  if (parsed.target !== undefined) {
    const ones = counted.filter((d) => d.value === 1).length;
    return {
      formula: input.trim(),
      dice,
      modifier: 0,
      total: counted.filter((d) => d.value >= parsed.target!).length,
      ...(parsed.mode ? { mode: parsed.mode } : {}),
      pool: {
        target: parsed.target,
        ones,
        // Shadowrun's rule, and the one most pool systems recognise.
        glitch: counted.length > 0 && ones * 2 > counted.length,
      },
    };
  }

  return {
    formula: input.trim(),
    dice,
    modifier: parsed.modifier,
    total: counted.reduce((sum, d) => sum + d.value, 0) + parsed.modifier,
    ...(parsed.mode ? { mode: parsed.mode } : {}),
  };
}

/** One die, exploding into itself while it keeps coming up maximum. */
function rollOneDie(sides: number | 'F', burst: boolean, rng: () => number): DieResult {
  if (sides === 'F') return { sides, value: dieValue(3, rng) - 2 };
  let value = dieValue(sides, rng);
  if (!burst || value !== sides) return { sides, value };
  let bursts = 0;
  let last = value;
  while (last === sides && bursts < MAX_BURST) {
    last = dieValue(sides, rng);
    value += last;
    bursts++;
  }
  return { sides, value, burst: bursts };
}

/** One-line breakdown for a feed: "[17] [3] + 5 = 22". Dropped dice are shown
 *  in brackets with a strike marker the renderers style. */
export function describeRoll(r: RollOutcome): string {
  const faces = r.dice.map((d) => {
    const face = faceOf(d);
    return d.dropped ? `(${face})` : `[${face}]`;
  }).join(' ');
  const mod = r.modifier === 0 ? '' : r.modifier > 0 ? ` + ${r.modifier}` : ` - ${Math.abs(r.modifier)}`;
  return `${faces}${mod} = ${r.total}`;
}

/**
 * What a formula COULD come to, low and high. A result means little without it:
 * a 5 is a triumph on 3d6-with-a-penalty and a disaster on 3d6+10, and the feed
 * line says so — "5 (on 3d6 [3-18])". A burst has no ceiling, so it is marked
 * open rather than guessed at.
 */
export function rangeOf(input: string): { min: number; max: number; open?: boolean } | null {
  const p = parseFormula(input);
  if (!p) return null;

  const counts = p.terms.reduce((n, t) => n + t.count, 0);
  const kept = p.keep ? Math.min(p.keep.n, counts) : counts;

  // A pool counts dice, so its range is 0..however many are kept.
  if (p.target !== undefined) return { min: 0, max: kept };

  // Every die's smallest and largest face, taking the kept ones. Mixed dice
  // make an exact bound fiddly for no benefit, so with one kind of die it is
  // exact and with several it is the honest outer edge.
  let min = p.modifier, max = p.modifier;
  const perDie = p.terms.map((t) => ({
    lo: t.sides === 'F' ? -1 : 1,
    hi: t.sides === 'F' ? 1 : (t.sides as number),
    count: t.count,
  }));
  const lows = perDie.flatMap((t) => Array<number>(t.count).fill(t.lo)).sort((a, b) => a - b);
  const highs = perDie.flatMap((t) => Array<number>(t.count).fill(t.hi)).sort((a, b) => b - a);
  min += lows.slice(0, kept).reduce((s, v) => s + v, 0);
  max += highs.slice(0, kept).reduce((s, v) => s + v, 0);
  return { min, max, ...(p.burst ? { open: true } : {}) };
}

/**
 * The sentence a roll leaves behind: "1+2+2=5 (on 3d6 [3-18])". This is the
 * evidence — dice fade off the screen after a few seconds, and this is what
 * remains in the GM's feed afterwards. Dropped dice are shown in brackets
 * before the sum they did not join.
 */
export function describeRollSentence(r: RollOutcome): string {
  const kept = r.dice.filter((d) => !d.dropped);
  const beaten = r.dice.filter((d) => d.dropped).map((d) => `(${faceOf(d)})`).join(' ');
  const range = rangeOf(r.formula);
  const bounds = range ? ` [${range.min}-${range.max}${range.open ? '+' : ''}]` : '';
  const lead = beaten ? beaten + ' ' : '';

  // A pool is counted, not summed, so it does not read as an addition.
  if (r.pool) {
    const faces = kept.map((d) => faceOf(d)).join(' ');
    const hits = `${r.total} ${r.total === 1 ? 'hit' : 'hits'}`;
    const glitch = r.pool.glitch ? (r.total === 0 ? ', critical glitch' : ', glitch') : '';
    return `${lead}${faces} = ${hits}${glitch} (on ${r.formula}${bounds})`;
  }

  const sum = kept.map((d) => faceOf(d)).join('+')
    + (r.modifier === 0 ? '' : r.modifier > 0 ? `+${r.modifier}` : `-${Math.abs(r.modifier)}`);
  return `${lead}${sum}=${r.total} (on ${r.formula}${bounds})`;
}

/** A die's face as it reads: Fate dice as +/-/0, everything else as its number. */
function faceOf(d: DieResult): string {
  if (d.sides !== 'F') return String(d.value);
  return d.value > 0 ? '+' : d.value < 0 ? '-' : '0';
}

/** Which way is up for celebration: some systems want you to roll LOW. */
export type CelebrateDirection = 'off' | 'high' | 'low';

/**
 * Did this die land somewhere worth remarking on? `good` gets the flare and
 * `bad` the cold rim — and which face is which depends on the game: in a
 * roll-under system a 1 is the triumph and the maximum is the disaster.
 *
 * Per DIE, because that is what a table reacts to, rather than whether the
 * total happened to hit its ceiling.
 */
export function critOf(d: DieResult, direction: CelebrateDirection = 'high'): 'good' | 'bad' | null {
  if (direction === 'off' || d.dropped) return null;
  if (d.sides === 'F') {
    if (d.value === 0) return null;
    const high = d.value > 0;
    return (direction === 'high') === high ? 'good' : 'bad';
  }
  if (d.sides < 4) return null;            // a coin has no natural 20
  // A burst die is past its own maximum, and is certainly at the high end.
  const isHigh = d.value >= d.sides;
  const isLow = d.value === 1;
  if (!isHigh && !isLow) return null;
  if (direction === 'high') return isHigh ? 'good' : 'bad';
  return isLow ? 'good' : 'bad';
}

/** How many dice a formula throws — the renderers size their tray with this. */
export function diceCount(input: string): number {
  const p = parseFormula(input);
  if (!p) return 0;
  return p.terms.reduce((n, t) => n + t.count, 0) + (p.mode ? 1 : 0);
}
