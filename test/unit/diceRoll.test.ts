import { describe, it, expect } from 'vitest';
import {
  parseFormula, isValidFormula, rollFormula, describeRoll, diceCount, MAX_DICE,
  rangeOf, describeRollSentence, critOf, MAX_BURST,
} from '../../src/dice/roll.ts';

/** Deterministic RNG: replays the given uniforms, then repeats the last one. */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
};

describe('dice formula parsing', () => {
  it('accepts the shapes a GM writes in a set', () => {
    expect(parseFormula('d20')).toEqual({ terms: [{ count: 1, sides: 20 }], modifier: 0 });
    expect(parseFormula('2d6+3')).toEqual({ terms: [{ count: 2, sides: 6 }], modifier: 3 });
    expect(parseFormula('1d8+1d6-2')).toEqual({
      terms: [{ count: 1, sides: 8 }, { count: 1, sides: 6 }], modifier: -2,
    });
    expect(parseFormula('4dF')).toEqual({ terms: [{ count: 4, sides: 'F' }], modifier: 0 });
    expect(parseFormula('1d20+5 adv')).toEqual({ terms: [{ count: 1, sides: 20 }], modifier: 5, mode: 'adv' });
    expect(parseFormula('D20 DIS')?.mode).toBe('dis');
  });

  it('rejects what it cannot roll, at authoring time', () => {
    for (const bad of ['', 'twenty', 'd', 'd1', '5', '-1d6', '1d20 sideways', '2d6++3']) {
      expect(isValidFormula(bad), bad).toBe(false);
    }
    // adv/dis is a single-die idiom
    expect(isValidFormula('2d20 adv')).toBe(false);
    // guard rails, so a typo cannot hang a phone
    expect(isValidFormula(`${MAX_DICE + 1}d6`)).toBe(false);
    expect(isValidFormula('1d10000')).toBe(false);
  });
});

describe('rolling', () => {
  it('sums dice and modifier', () => {
    const r = rollFormula('2d6+3', seq(0.99, 0.0))!;   // 6, then 1
    expect(r.dice.map((d) => d.value)).toEqual([6, 1]);
    expect(r.total).toBe(10);
    expect(describeRoll(r)).toBe('[6] [1] + 3 = 10');
  });

  it('keeps both dice on advantage and drops the loser', () => {
    const r = rollFormula('1d20+5 adv', seq(0.1, 0.9))!;  // 3, then 19
    expect(r.dice).toHaveLength(2);
    expect(r.dice[0]!.dropped).toBe(true);
    expect(r.dice[1]!.dropped).toBeUndefined();
    expect(r.total).toBe(24);
    expect(describeRoll(r)).toBe('(3) [19] + 5 = 24');
  });

  it('keeps the lower on disadvantage', () => {
    const r = rollFormula('1d20 dis', seq(0.1, 0.9))!;
    expect(r.total).toBe(3);
    expect(r.dice[1]!.dropped).toBe(true);
  });

  it('rolls Fate dice as -1, 0, +1', () => {
    const r = rollFormula('4dF', seq(0.0, 0.5, 0.99, 0.0))!;
    expect(r.dice.map((d) => d.value)).toEqual([-1, 0, 1, -1]);
    expect(r.total).toBe(-1);
    expect(describeRoll(r)).toBe('[-] [0] [+] [-] = -1');
  });

  it('stays in range across the whole face set', () => {
    for (let i = 0; i < 200; i++) {
      const r = rollFormula('1d6')!;
      expect(r.total).toBeGreaterThanOrEqual(1);
      expect(r.total).toBeLessThanOrEqual(6);
    }
  });

  it('reports how many dice will land, so a tray can size itself', () => {
    expect(diceCount('2d6+3')).toBe(2);
    expect(diceCount('1d20 adv')).toBe(2);   // both dice are shown
    expect(diceCount('nonsense')).toBe(0);
  });

  it('returns null rather than throwing on junk', () => {
    expect(rollFormula('nonsense')).toBeNull();
  });
});

describe('what a roll leaves behind', () => {
  it('knows what a formula COULD come to', () => {
    expect(rangeOf('3d6')).toEqual({ min: 3, max: 18 });
    expect(rangeOf('1d20+5')).toEqual({ min: 6, max: 25 });
    expect(rangeOf('2d6-2')).toEqual({ min: 0, max: 10 });
    expect(rangeOf('4dF')).toEqual({ min: -4, max: 4 });
    // adv rolls twice and keeps one, so the range is a single d20's.
    expect(rangeOf('1d20 adv')).toEqual({ min: 1, max: 20 });
    expect(rangeOf('nonsense')).toBeNull();
  });

  it('writes the sentence the feed keeps after the dice have faded', () => {
    const r = rollFormula('3d6', seq(0.0, 0.25, 0.25))!;      // 1, 2, 2
    expect(describeRollSentence(r)).toBe('1+2+2=5 (on 3d6 [3-18])');
  });

  it('carries the modifier, and shows the die advantage beat', () => {
    const flat = rollFormula('1d20+5', seq(0.6))!;            // 13
    expect(describeRollSentence(flat)).toBe('13+5=18 (on 1d20+5 [6-25])');
    const adv = rollFormula('1d20 adv', seq(0.1, 0.9))!;      // 3 beaten by 19
    expect(describeRollSentence(adv)).toBe('(3) 19=19 (on 1d20 adv [1-20])');
  });
});

describe('mechanics, written as words', () => {
  it('bursts a die at its maximum, adding into that die', () => {
    // d6: 6 (burst) -> 6 (burst again) -> 2. One die reading 14.
    const r = rollFormula('1d6 burst', seq(0.99, 0.99, 0.25))!;
    expect(r.dice).toHaveLength(1);
    expect(r.dice[0]!.value).toBe(14);
    expect(r.dice[0]!.burst).toBe(2);
    expect(r.total).toBe(14);
  });

  it('stops a burst before it can hang a phone', () => {
    // An rng that always rolls maximum would explode for ever.
    const r = rollFormula('1d6 burst', () => 0.999)!;
    expect(r.dice[0]!.burst).toBe(MAX_BURST);
    expect(r.total).toBe(6 * (MAX_BURST + 1));
  });

  it('refuses a burst that could never settle', () => {
    expect(isValidFormula('1d2 burst')).toBe(false);
    expect(isValidFormula('4dF burst')).toBe(false);
  });

  it('keeps the best dice and strikes the rest, without hiding them', () => {
    const r = rollFormula('4d6 keep 3', seq(0.0, 0.99, 0.5, 0.99))!;   // 1, 6, 4, 6
    expect(r.dice.map((d) => d.value)).toEqual([1, 6, 4, 6]);
    expect(r.dice.filter((d) => d.dropped).map((d) => d.value)).toEqual([1]);
    expect(r.total).toBe(16);
  });

  it('keeps the worst when asked to', () => {
    const r = rollFormula('4d6 keep low 1', seq(0.0, 0.99, 0.5, 0.99))!;
    expect(r.total).toBe(1);
    expect(r.dice.filter((d) => !d.dropped)).toHaveLength(1);
  });

  it('rolls and keeps the L5R way, said out loud', () => {
    // 5d10, one of them bursting, keeping the best 3.
    const r = rollFormula('5d10 burst keep 3', seq(0.99, 0.3, 0.1, 0.5, 0.7, 0.2))!;
    expect(r.formula).toBe('5d10 burst keep 3');
    expect(r.dice).toHaveLength(5);
    expect(r.dice.filter((d) => !d.dropped)).toHaveLength(3);
    // The burst die carried its explosion into its own value.
    expect(r.dice[0]!.value).toBeGreaterThan(10);
  });

  it('counts a success pool instead of summing it', () => {
    // 6d6 needing 5s: 6, 5, 4, 1, 1, 2 -> two hits.
    const r = rollFormula('6d6 target 5', seq(0.99, 0.8, 0.6, 0.0, 0.0, 0.25))!;
    expect(r.total).toBe(2);
    expect(r.pool?.target).toBe(5);
    expect(r.pool?.ones).toBe(2);
    expect(r.pool?.glitch).toBe(false);
    expect(r.modifier).toBe(0);
  });

  it('spots a glitch when most of the pool came up ones', () => {
    const r = rollFormula('4d6 target 5', seq(0.0, 0.0, 0.0, 0.99))!;   // 1,1,1,6
    expect(r.total).toBe(1);
    expect(r.pool?.glitch).toBe(true);
    expect(describeRollSentence(r)).toContain('glitch');
    // ...and a glitch with nothing to show for it is the critical one.
    const worse = rollFormula('4d6 target 5', seq(0.0, 0.0, 0.0, 0.5))!;
    expect(worse.total).toBe(0);
    expect(describeRollSentence(worse)).toContain('critical glitch');
  });

  it('says a pool in hits rather than as a sum', () => {
    const r = rollFormula('4d6 target 5', seq(0.99, 0.99, 0.0, 0.0))!;
    expect(describeRollSentence(r)).toBe('6 6 1 1 = 2 hits (on 4d6 target 5 [0-4])');
  });

  it('refuses a modifier on a pool, because it would be adding apples', () => {
    expect(isValidFormula('6d6+2 target 5')).toBe(false);
  });

  it('reads mechanics in any order, and rejects words it does not know', () => {
    expect(isValidFormula('5d10 keep 3 burst')).toBe(true);
    expect(isValidFormula('4d6 keep best 3')).toBe(true);
    expect(isValidFormula('12d6 hits 5')).toBe(true);
    expect(isValidFormula('1d20 sideways')).toBe(false);
    expect(isValidFormula('4d6 keep')).toBe(false);
    expect(isValidFormula('4d6 keep 9')).toBe(false);      // more than were rolled
    expect(isValidFormula('4d6 target')).toBe(false);
  });

  it('bounds a roll by what is kept, and admits a burst has no ceiling', () => {
    expect(rangeOf('4d6 keep 3')).toEqual({ min: 3, max: 18 });
    expect(rangeOf('12d6 target 5')).toEqual({ min: 0, max: 12 });
    expect(rangeOf('1d6 burst')).toEqual({ min: 1, max: 6, open: true });
    expect(describeRollSentence(rollFormula('1d6 burst', seq(0.5))!)).toContain('[1-6+]');
  });
});

describe('which way is up', () => {
  const die = (sides: number, value: number) => ({ sides, value });

  it('celebrates a maximum by default', () => {
    expect(critOf(die(20, 20))).toBe('good');
    expect(critOf(die(20, 1))).toBe('bad');
    expect(critOf(die(20, 11))).toBeNull();
  });

  it('celebrates a 1 when low is what you want', () => {
    // Roll-under systems: the 1 is the triumph and the 20 is the disaster.
    expect(critOf(die(20, 1), 'low')).toBe('good');
    expect(critOf(die(20, 20), 'low')).toBe('bad');
    expect(critOf(die(20, 11), 'low')).toBeNull();
  });

  it('can be turned off entirely', () => {
    expect(critOf(die(20, 20), 'off')).toBeNull();
    expect(critOf(die(20, 1), 'off')).toBeNull();
  });

  it('treats a burst die as the high end, since it went past its own maximum', () => {
    expect(critOf({ sides: 6, value: 14, burst: 2 })).toBe('good');
    expect(critOf({ sides: 6, value: 14, burst: 2 }, 'low')).toBe('bad');
  });

  it('reads a Fate die by its sign, and both ways round', () => {
    expect(critOf({ sides: 'F', value: 1 })).toBe('good');
    expect(critOf({ sides: 'F', value: -1 })).toBe('bad');
    expect(critOf({ sides: 'F', value: -1 }, 'low')).toBe('good');
    expect(critOf({ sides: 'F', value: 0 })).toBeNull();
  });

  it('never celebrates a die that was thrown away', () => {
    expect(critOf({ sides: 20, value: 20, dropped: true })).toBeNull();
  });
});
