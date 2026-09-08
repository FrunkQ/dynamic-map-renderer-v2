/**
 * DiceLayer — the tumble's timing rules. Both cases here bit in real use: a
 * lane reused mid-roll, and a browser throttling timers in a hidden tab.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DiceLayer } from '../../src/rendering/DiceLayer.ts';
import type { RollOutcome } from '../../src/dice/roll.ts';

const roll = (total: number, ...values: number[]): RollOutcome => ({
  formula: `${values.length}d6`,
  dice: values.map((value) => ({ sides: 6 as const, value })),
  modifier: 0,
  total,
});
const show = (o: RollOutcome, key = 'sam') => ({
  rollId: `r${o.total}`, label: 'Test', outcome: o,
  rollerKey: key, rollerName: 'Sam', rollerColor: '#22d3ee',
});

describe('DiceLayer tumble', () => {
  let root: HTMLElement;
  let layer: DiceLayer;
  const lane = () => root.querySelector('.dice-lane')!;
  const faces = () => [...root.querySelectorAll('text')].map((t) => t.textContent);

  beforeEach(() => {
    vi.useFakeTimers();
    root = document.createElement('div');
    layer = new DiceLayer(root, 'viewer');
  });
  afterEach(() => { layer.destroy(); vi.useRealTimers(); });

  it('tumbles, then lands on the faces it was given', () => {
    layer.showFull(show(roll(7, 3, 4)));
    expect(lane().classList.contains('is-settled')).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(lane().classList.contains('is-settled')).toBe(true);
    expect(faces()).toEqual(['3', '4']);           // never re-rolled locally
    expect(root.querySelector('.dice-lane-total')!.textContent).toBe('7');
  });

  it('a lane reused mid-tumble belongs to the NEW roll', () => {
    layer.showFull(show(roll(7, 3, 4)));
    vi.advanceTimersByTime(120);                   // interrupt before it lands
    layer.showFull(show(roll(12, 6, 6)));
    vi.advanceTimersByTime(2000);
    // The old tumble must not have marked this settled early, nor left its dice
    expect(faces()).toEqual(['6', '6']);
    expect(root.querySelector('.dice-lane-total')!.textContent).toBe('12');
    expect(lane().classList.contains('is-settled')).toBe(true);
    expect(root.querySelectorAll('.dice-lane')).toHaveLength(1);
  });

  it('lands on the first tick after a throttled tab wakes up', () => {
    // A hidden tab is throttled to roughly ONE timer tick a second. Counting
    // ticks would need ten of them — nine seconds of tumbling for a roll that
    // was over before the player looked away. Simulate it: the clock jumps,
    // and only one tick fires.
    const real = performance.now.bind(performance);
    let jumped = false;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => (jumped ? real() + 5000 : real()));
    layer.showFull(show(roll(9, 4, 5)));
    jumped = true;
    vi.advanceTimersByTime(60);                    // exactly one tick
    expect(lane().classList.contains('is-settled')).toBe(true);
    expect(faces()).toEqual(['4', '5']);
    spy.mockRestore();
  });

  it('fades the dice away, leaving the record to the feed', () => {
    layer.showFull(show(roll(7, 3, 4)));
    vi.advanceTimersByTime(1000);
    expect(lane().classList.contains('is-settled')).toBe(true);
    vi.advanceTimersByTime(7100);                                 // 7s after LANDING
    expect(lane().classList.contains('is-leaving')).toBe(true);   // on its way out
    vi.advanceTimersByTime(1000);
    expect(root.querySelector('.dice-lane')).toBeNull();          // gone
  });

  it('rolling again catches a fading hand and keeps it', () => {
    layer.showFull(show(roll(7, 3, 4)));
    vi.advanceTimersByTime(8000);                 // landed, and fading
    expect(lane().classList.contains('is-leaving')).toBe(true);
    layer.showFull(show(roll(12, 6, 6)));         // ...rolled into again
    expect(lane().classList.contains('is-leaving')).toBe(false);
    vi.advanceTimersByTime(2000);
    // The old fade must not sweep away the hand that replaced it.
    expect(root.querySelector('.dice-lane')).not.toBeNull();
    expect(faces()).toEqual(['6', '6']);
  });

  it('marks a good and a bad face only once the die has landed on it', () => {
    layer.showFull(show({ formula: '2d20', dice: [{ sides: 20, value: 20 }, { sides: 20, value: 1 }], modifier: 0, total: 21 }));
    // Mid-tumble the faces are still flickering: nothing may flare yet.
    expect(root.querySelector('.die--good')).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(root.querySelectorAll('.die--good')).toHaveLength(1);
    expect(root.querySelectorAll('.die--bad')).toHaveLength(1);
    expect(lane().classList.contains('is-allgood')).toBe(false);   // not ALL of them
  });

  it('says so differently when every die came up best', () => {
    layer.showFull(show({ formula: '2d6', dice: [{ sides: 6, value: 6 }, { sides: 6, value: 6 }], modifier: 0, total: 12 }));
    vi.advanceTimersByTime(1000);
    expect(lane().classList.contains('is-allgood')).toBe(true);
    expect(lane().classList.contains('is-allbad')).toBe(false);
  });

  it('turns the whole thing round when the game wants low rolls', () => {
    const roll = { formula: '2d20', dice: [{ sides: 20, value: 20 }, { sides: 20, value: 1 }], modifier: 0, total: 21 };
    layer.showFull({ ...show(roll), celebrate: 'low' as const });
    vi.advanceTimersByTime(1000);
    // The 1 is now the triumph and the 20 the disaster.
    const good = root.querySelector('.die--good')!;
    expect(good.querySelector('text')!.textContent).toBe('1');
    const bad = root.querySelector('.die--bad')!;
    expect(bad.querySelector('text')!.textContent).toBe('20');
  });

  it('celebrates nothing at all when the table has turned it off', () => {
    const roll = { formula: '2d6', dice: [{ sides: 6, value: 6 }, { sides: 6, value: 6 }], modifier: 0, total: 12 };
    layer.showFull({ ...show(roll), celebrate: 'off' as const });
    vi.advanceTimersByTime(1000);
    expect(root.querySelector('.die--good')).toBeNull();
    expect(lane().classList.contains('is-allgood')).toBe(false);
  });

  it('gives each roller their own lane, oldest retired when crowded', () => {
    for (const who of ['a', 'b', 'c', 'd', 'e']) layer.showFull(show(roll(3, 3), who));
    expect(root.querySelectorAll('.dice-lane')).toHaveLength(4);
    vi.advanceTimersByTime(2000);
  });
});
