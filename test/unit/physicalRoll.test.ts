/**
 * physicalRoll — real dice landing on a real table, turned into the roll the
 * rest of Mappadux already understands. The hardware is elsewhere; the rules
 * are here, so they can be tested without any.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  RollCollector, formulaFor, outcomeFor, sidesForDieType, QUIET_MS, MAX_MS,
  type PhysicalFace,
} from '../../src/dice/physicalRoll.ts';

const face = (dieId: string, sides: number | 'F', value: number) => ({ dieId, sides, value });

describe('a handful of real dice', () => {
  it('reads the way a person would say it', () => {
    expect(formulaFor([face('a', 20, 17)])).toBe('1d20');
    expect(formulaFor([face('a', 6, 3), face('b', 6, 5)])).toBe('2d6');
    // Biggest first, so "1d20+2d6" rather than "2d6+1d20".
    expect(formulaFor([face('a', 6, 3), face('b', 20, 11), face('c', 6, 5)])).toBe('1d20+2d6');
    expect(formulaFor([face('a', 'F', -1), face('b', 'F', 1)])).toBe('2dF');
  });

  it('becomes the same shape a tapped chip produces', () => {
    const outcome = outcomeFor([face('a', 6, 3), face('b', 6, 5)])!;
    expect(outcome.formula).toBe('2d6');
    expect(outcome.total).toBe(8);
    expect(outcome.modifier).toBe(0);
    expect(outcome.dice).toEqual([{ sides: 6, value: 3 }, { sides: 6, value: 5 }]);
    expect(outcomeFor([])).toBeNull();
  });

  it('knows what kind of die reported', () => {
    expect(sidesForDieType('d20', 20)).toBe(20);
    expect(sidesForDieType('d6fudge', 6)).toBe('F');
    expect(sidesForDieType('d00', 10)).toBe(100);      // the percentile tens die
    expect(sidesForDieType(undefined, 8)).toBe(8);     // trust the face count
    expect(sidesForDieType('d12', undefined)).toBe(12);
    expect(sidesForDieType(undefined, undefined)).toBe(6);
  });
});

describe('collecting a thrown set', () => {
  let done: ReturnType<typeof vi.fn<(faces: PhysicalFace[]) => void>>;
  let collector: RollCollector;

  beforeEach(() => {
    vi.useFakeTimers();
    done = vi.fn<(faces: PhysicalFace[]) => void>();
    collector = new RollCollector({ onComplete: done });
  });
  afterEach(() => vi.useRealTimers());

  it('waits for the table to go quiet, then reports the whole handful', () => {
    collector.add(face('a', 6, 3));
    vi.advanceTimersByTime(QUIET_MS - 400);
    collector.add(face('b', 6, 5));          // a second die still rolling
    vi.advanceTimersByTime(QUIET_MS - 400);
    expect(done).not.toHaveBeenCalled();     // the window extended
    vi.advanceTimersByTime(500);
    expect(done).toHaveBeenCalledTimes(1);
    expect(done.mock.calls[0]![0]).toEqual([face('a', 6, 3), face('b', 6, 5)]);
  });

  it('a die nudged twice keeps its last face rather than counting twice', () => {
    collector.add(face('a', 20, 4));
    vi.advanceTimersByTime(300);
    collector.add(face('a', 20, 17));        // picked up and dropped again
    vi.advanceTimersByTime(QUIET_MS + 100);
    expect(done.mock.calls[0]![0]).toEqual([face('a', 20, 17)]);
  });

  it('reports eventually even if the table never settles', () => {
    collector.add(face('a', 6, 1));
    // Something keeps knocking a die every second: the quiet window would never
    // close on its own.
    for (let t = 0; t < MAX_MS + 1000; t += 1000) {
      vi.advanceTimersByTime(1000);
      if (!done.mock.calls.length) collector.add(face('a', 6, (t % 6) + 1));
    }
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('can be called off, and starts clean afterwards', () => {
    collector.add(face('a', 6, 3));
    collector.cancel();
    vi.advanceTimersByTime(MAX_MS + 1000);
    expect(done).not.toHaveBeenCalled();
    expect(collector.isCollecting).toBe(false);
    collector.add(face('b', 6, 2));
    vi.advanceTimersByTime(QUIET_MS + 100);
    expect(done.mock.calls[0]![0]).toEqual([face('b', 6, 2)]);
  });

  it('reports progress while the dice are still landing', () => {
    const progress = vi.fn<(faces: PhysicalFace[]) => void>();
    const c = new RollCollector({ onComplete: done, onProgress: progress });
    c.add(face('a', 6, 3));
    c.add(face('b', 6, 5));
    expect(progress).toHaveBeenCalledTimes(2);
    expect(progress.mock.calls[1]![0]).toHaveLength(2);
  });
});
