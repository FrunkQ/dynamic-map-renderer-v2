import { describe, it, expect } from 'vitest';
import {
  parseFormula, isValidFormula, rollFormula, describeRoll, diceCount, MAX_DICE,
  rangeOf, describeRollSentence, critOf,
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

  it('spots a die at its best or worst, and nothing in between', () => {
    expect(critOf({ sides: 20, value: 20 })).toBe('max');
    expect(critOf({ sides: 20, value: 1 })).toBe('min');
    expect(critOf({ sides: 20, value: 11 })).toBeNull();
    expect(critOf({ sides: 6, value: 6 })).toBe('max');
    expect(critOf({ sides: 'F', value: 1 })).toBe('max');
    expect(critOf({ sides: 'F', value: 0 })).toBeNull();
    // A die that was thrown away did not land on anything worth flaring.
    expect(critOf({ sides: 20, value: 20, dropped: true })).toBeNull();
    // A coin has no natural 20.
    expect(critOf({ sides: 2, value: 2 })).toBeNull();
  });
});
