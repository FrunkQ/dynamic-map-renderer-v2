/**
 * dieShapes — the silhouette a die is cut from, and the facets it is shaded
 * with. The one rule worth pinning: outline and facets come from the SAME
 * table, so a die can never be clipped to one shape and shaded as another.
 */
import { describe, it, expect } from 'vitest';
import { buildDie, clipPathFor, shapeFor, shapeNameFor } from '../../src/rendering/dieShapes.ts';

describe('die shapes', () => {
  it('gives each die type its own silhouette', () => {
    expect(shapeNameFor(4)).toBe('d4');
    expect(shapeNameFor(6)).toBe('d6');
    expect(shapeNameFor(20)).toBe('d20');
    // Fate dice are cubes, and anything unusual reads as one too.
    expect(shapeNameFor('F')).toBe('dF');
    expect(shapeNameFor(100)).toBe('generic');
    expect(shapeFor(100)).toBe(shapeFor(6));
  });

  it('clips to the same outline it shades', () => {
    for (const sides of [4, 6, 8, 10, 12, 20] as const) {
      const shape = shapeFor(sides);
      const clip = clipPathFor(sides);
      expect(clip.startsWith('polygon(')).toBe(true);
      // Every outline vertex appears in the clip-path, in order.
      expect(clip.split(',')).toHaveLength(shape.outline.length);
      for (const [x, y] of shape.outline) expect(clip).toContain(`${x}% ${y}%`);
    }
  });

  it('has a face you read first, then facets turning away from the light', () => {
    for (const sides of [4, 6, 8, 10, 12, 20] as const) {
      const facets = shapeFor(sides).facets;
      expect(facets.length).toBeGreaterThanOrEqual(3);   // enough to shade
      expect(facets[0]!.tone).toBe('hi');                // the reading face
      expect(facets.some((f) => f.tone === 'lo')).toBe(true);
    }
  });

  it('builds a die that carries its value and can be re-faced mid-tumble', () => {
    const die = buildDie(20, '17');
    expect(die.el.classList.contains('die')).toBe(true);
    expect(die.el.dataset.shape).toBe('d20');
    expect(die.el.style.clipPath).toBe(clipPathFor(20));
    const text = die.el.querySelector('text')!;
    expect(text.textContent).toBe('17');
    expect(die.el.querySelectorAll('polygon')).toHaveLength(shapeFor(20).facets.length);
    die.setValue('3');
    expect(text.textContent).toBe('3');
  });

  it('shrinks the numeral so a three-digit face still fits the die', () => {
    const size = (face: string) => Number(buildDie(100, face).el.querySelector('text')!.getAttribute('font-size'));
    expect(size('7')).toBeGreaterThan(size('17'));
    expect(size('17')).toBeGreaterThan(size('100'));
  });

  it('strikes a dropped die through rather than hiding it', () => {
    const die = buildDie(20, '3', true);
    expect(die.el.classList.contains('die--dropped')).toBe(true);
    expect(die.el.querySelector('line.die-slash')).not.toBeNull();
    // Still readable: seeing what you beat is half the pleasure of advantage.
    expect(die.el.querySelector('text')!.textContent).toBe('3');
  });
});
