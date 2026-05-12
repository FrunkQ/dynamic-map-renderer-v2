import { describe, it, expect } from 'vitest';
import { CanvasTransform } from '../../src/utils/CanvasTransform.ts';

describe('CanvasTransform', () => {
  describe('identity', () => {
    it('starts at scale=1 with no offset', () => {
      const t = new CanvasTransform();
      expect(t.scale).toBe(1);
      expect(t.offsetX).toBe(0);
      expect(t.offsetY).toBe(0);
      expect(t.isIdentity).toBe(true);
    });

    it('worldToOutput and outputToWorld are identity at default state', () => {
      const t = new CanvasTransform();
      expect(t.worldToOutput(3, -7)).toEqual({ x: 3, y: -7 });
      expect(t.outputToWorld(3, -7)).toEqual({ x: 3, y: -7 });
    });
  });

  describe('round-trip', () => {
    it('outputToWorld(worldToOutput(p)) === p for any state', () => {
      const t = new CanvasTransform();
      t.set(2.5, 1.3, -0.7);
      const p = { x: 4.2, y: -8.1 };
      const out = t.worldToOutput(p.x, p.y);
      const back = t.outputToWorld(out.x, out.y);
      expect(back.x).toBeCloseTo(p.x);
      expect(back.y).toBeCloseTo(p.y);
    });
  });

  describe('zoomAround', () => {
    it('keeps the anchor point fixed in output space', () => {
      const t = new CanvasTransform();
      // Pick a non-zero anchor so the test isn't trivially satisfied by the origin.
      const anchor = { x: 5, y: 3 };
      const outputBefore = t.worldToOutput(anchor.x, anchor.y);
      t.zoomAround(1.5, anchor.x, anchor.y);
      const outputAfter = t.worldToOutput(anchor.x, anchor.y);
      expect(outputAfter.x).toBeCloseTo(outputBefore.x);
      expect(outputAfter.y).toBeCloseTo(outputBefore.y);
    });

    it('actually scales — other points move away from the anchor', () => {
      const t = new CanvasTransform();
      const anchor = { x: 0, y: 0 };
      const other  = { x: 10, y: 0 };
      const outBefore = t.worldToOutput(other.x, other.y);
      t.zoomAround(2, anchor.x, anchor.y);
      const outAfter = t.worldToOutput(other.x, other.y);
      // Other point should now be 2× farther from anchor.
      expect(outAfter.x).toBeCloseTo(outBefore.x * 2);
    });

    it('respects min/max scale clamps', () => {
      const t = new CanvasTransform({ minScale: 0.5, maxScale: 4 });
      // Try to zoom way past the max
      t.zoomAround(100, 0, 0);
      expect(t.scale).toBe(4);
      // Try to zoom past the min
      t.set(1, 0, 0);
      t.zoomAround(0.001, 0, 0);
      expect(t.scale).toBe(0.5);
    });

    it('is a no-op when the new scale would equal the current one', () => {
      const t = new CanvasTransform({ minScale: 0.5, maxScale: 4 });
      t.set(4, 1, 1); // at the cap
      t.zoomAround(2, 5, 5); // would push past cap → newScale stays at 4 → no-op
      expect(t.offsetX).toBe(1);
      expect(t.offsetY).toBe(1);
      expect(t.scale).toBe(4);
    });
  });

  describe('panByOutputPx', () => {
    it('moves an arbitrary world point by the correct output delta', () => {
      const t = new CanvasTransform();
      t.set(3, 0, 0);
      const probe = { x: 2, y: 5 };
      const outBefore = t.worldToOutput(probe.x, probe.y);
      t.panByOutputPx(15, -9);
      const outAfter = t.worldToOutput(probe.x, probe.y);
      expect(outAfter.x).toBeCloseTo(outBefore.x + 15);
      expect(outAfter.y).toBeCloseTo(outBefore.y - 9);
    });

    it('snapshot + panByOutputPx is the canonical drag pattern', () => {
      const t = new CanvasTransform();
      t.set(2, 3, 4);
      const snap = t.snapshot();
      t.panByOutputPx(10, 20);
      t.panByOutputPx(-5, -7);
      // Restore + apply cumulative delta should match the running result.
      const running = { offsetX: t.offsetX, offsetY: t.offsetY };
      t.restore(snap);
      t.panByOutputPx(5, 13); // cumulative 10-5=5, 20-7=13
      expect(t.offsetX).toBeCloseTo(running.offsetX);
      expect(t.offsetY).toBeCloseTo(running.offsetY);
    });
  });
});
