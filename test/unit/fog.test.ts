import { describe, it, expect } from 'vitest';
import type { FogPolygon, FogVertex } from '../../src/types.ts';

// Extract the point-in-polygon algorithm from FogEditor for standalone testing
function pointInPolygon(point: FogVertex, vertices: FogVertex[]): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const vi = vertices[i]!;
    const vj = vertices[j]!;
    if (
      ((vi.y > point.y) !== (vj.y > point.y)) &&
      point.x < ((vj.x - vi.x) * (point.y - vi.y)) / (vj.y - vi.y) + vi.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

describe('Fog polygon point-in-polygon', () => {
  const square: FogVertex[] = [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.9 },
    { x: 0.1, y: 0.9 },
  ];

  it('detects a point inside the polygon', () => {
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, square)).toBe(true);
  });

  it('detects a point outside the polygon', () => {
    expect(pointInPolygon({ x: 0.0, y: 0.0 }, square)).toBe(false);
    expect(pointInPolygon({ x: 0.95, y: 0.5 }, square)).toBe(false);
  });

  it('handles a triangular polygon', () => {
    const tri: FogVertex[] = [
      { x: 0.5, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ];
    expect(pointInPolygon({ x: 0.5, y: 0.7 }, tri)).toBe(true);
    expect(pointInPolygon({ x: 0.1, y: 0.1 }, tri)).toBe(false);
  });
});

describe('FogState structure', () => {
  it('polygon has required fields', () => {
    const poly: FogPolygon = {
      id: 'test-id',
      vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }],
      color: '#000000',
    };
    expect(poly.vertices.length).toBeGreaterThanOrEqual(3);
    expect(poly.color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});
