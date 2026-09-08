/**
 * dicePath — the throw is faked, so the things that can go wrong are geometric:
 * a die landing off the surface, landing under the tray, or the whole handful
 * landing in one heap. All checkable without a browser.
 */
import { describe, it, expect } from 'vitest';
import { bouncePath, captionSpot } from '../../src/rendering/dicePath.ts';

const SURFACE = { width: 900, height: 600, dieSize: 30 };

describe('a thrown die', () => {
  it('comes in from off the surface and ends on it', () => {
    for (let seed = 0; seed < 40; seed++) {
      const path = bouncePath({ ...SURFACE, seed });
      const first = path[0]!;
      const last = path.at(-1)!;
      // It starts outside, which is what makes it read as thrown IN.
      expect(first.x < 0 || first.x > SURFACE.width - SURFACE.dieSize).toBe(true);
      // ...and it stops somewhere it can actually be seen.
      expect(last.x).toBeGreaterThanOrEqual(0);
      expect(last.y).toBeGreaterThanOrEqual(0);
      expect(last.x).toBeLessThanOrEqual(SURFACE.width - SURFACE.dieSize);
      expect(last.y).toBeLessThanOrEqual(SURFACE.height - SURFACE.dieSize);
    }
  });

  it('bounces the number of times it was asked to', () => {
    expect(bouncePath({ ...SURFACE, seed: 1, bounces: 3 })).toHaveLength(5);  // start + 4
    expect(bouncePath({ ...SURFACE, seed: 1, bounces: 1 })).toHaveLength(3);
  });

  it('keeps clear of the chrome it was told about', () => {
    const inset = { bottom: 90, top: 20, left: 10, right: 10 };
    for (let seed = 0; seed < 40; seed++) {
      const last = bouncePath({ ...SURFACE, seed, inset }).at(-1)!;
      // The tray lives along the bottom; a die under it may as well not exist.
      expect(last.y).toBeLessThanOrEqual(SURFACE.height - inset.bottom - SURFACE.dieSize);
      expect(last.y).toBeGreaterThanOrEqual(inset.top);
      expect(last.x).toBeGreaterThanOrEqual(inset.left);
    }
  });

  it('stays on a surface far too small for the throw it wanted', () => {
    // A phone in portrait, with a big die.
    const tiny = { width: 220, height: 300, dieSize: 44 };
    for (let seed = 0; seed < 20; seed++) {
      for (const p of bouncePath({ ...tiny, seed, inset: { bottom: 70 } }).slice(1)) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(tiny.width - tiny.dieSize);
        expect(p.y).toBeLessThanOrEqual(tiny.height - 70 - tiny.dieSize);
      }
    }
  });

  it('runs out of energy: each leg is shorter than the one before', () => {
    const path = bouncePath({ ...SURFACE, seed: 7 });
    const legs = path.slice(1).map((p, i) => Math.hypot(p.x - path[i]!.x, p.y - path[i]!.y));
    // The first leg crosses the surface; the last is a nudge.
    expect(legs[0]!).toBeGreaterThan(legs.at(-1)!);
  });

  it('stops turning as it settles — a spinning die has not landed', () => {
    const path = bouncePath({ ...SURFACE, seed: 3 });
    const turns = path.slice(1).map((p, i) => Math.abs(p.rot - path[i]!.rot));
    expect(turns[0]!).toBeGreaterThan(turns.at(-1)!);
  });

  it('throws the same way for the same seed, and differently for another', () => {
    expect(bouncePath({ ...SURFACE, seed: 5 })).toEqual(bouncePath({ ...SURFACE, seed: 5 }));
    expect(bouncePath({ ...SURFACE, seed: 5 })).not.toEqual(bouncePath({ ...SURFACE, seed: 6 }));
  });

  it('scatters a handful rather than stacking it', () => {
    // Five dice from one throw, each with its own seed offset.
    const rests = [0, 1, 2, 3, 4].map((i) => bouncePath({ ...SURFACE, seed: 100 + i }).at(-1)!);
    const spread = Math.max(...rests.map((p) => p.x)) - Math.min(...rests.map((p) => p.x));
    expect(spread).toBeGreaterThan(SURFACE.dieSize);
  });
});

describe('where the total goes', () => {
  it('finds the dice rather than sitting in a corner', () => {
    const rests = [{ x: 400, y: 300, rot: 0 }, { x: 460, y: 320, rot: 0 }];
    const spot = captionSpot(rests, { ...SURFACE, captionWidth: 120 });
    expect(spot.x).toBeGreaterThan(400);
    expect(spot.x).toBeLessThan(520);
    expect(spot.y).toBeGreaterThan(320);      // under the lowest die
  });

  it('stays on the surface when the dice land at an edge', () => {
    const spot = captionSpot([{ x: 880, y: 580, rot: 0 }], { ...SURFACE, captionWidth: 160, bottomInset: 80 });
    expect(spot.x).toBeLessThanOrEqual(SURFACE.width - 80 - 4);
    expect(spot.y).toBeLessThanOrEqual(SURFACE.height - 80 - 26);
  });

  it('has an answer for no dice at all', () => {
    expect(captionSpot([], { ...SURFACE, captionWidth: 100 })).toEqual({ x: 0, y: 0 });
  });
});
