import { describe, it, expect } from 'vitest';
import {
  parseFormula, isValidFormula, rollFormula, describeRoll, diceCount, MAX_DICE,
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
