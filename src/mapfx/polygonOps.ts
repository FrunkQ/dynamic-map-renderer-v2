/**
 * Polygon ops for the v2.12 unified overlay system.
 *
 * Wraps `polygon-clipping` (Martinez-Rueda) with the FogVertex[] shape used
 * everywhere else. Handles the GeoJSON-style nesting conversion in / out.
 *
 * The library represents polygons as `Polygon[]`, where each `Polygon` is
 * `[[ring0, ring1, ...]]` — ring0 is the outer ring, the rest are holes.
 * For our simple non-holed strokes we always emit `[[ring]]`.
 *
 * Difference returns 0 / 1 / N polygons depending on the split shape — the
 * caller replaces the original target with these in the polygons array.
 */

import * as pc from 'polygon-clipping';
import type { FogVertex, FogPolygon } from '../types.ts';
import { generateId } from '../utils/id.ts';

/** Convert a flat ring of vertices into the polygon-clipping nested form.
 *  Closes the ring by repeating the first point (the library expects that). */
function toPCPolygon(ring: FogVertex[]): pc.Polygon {
  if (ring.length < 3) return [[]];
  const closed: pc.Pair[] = ring.map((v) => [v.x, v.y]);
  const first = closed[0]!;
  const last  = closed[closed.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) closed.push([first[0], first[1]]);
  return [closed];
}

/** Pull a flat FogVertex ring out of one polygon-clipping polygon. Drops
 *  holes — our overlay polygons are always simple closed shapes for now;
 *  a hole would be rendered fine by canvas2D fill with even-odd rule but
 *  isn't useful at the current visual scale. */
function fromPCPolygon(p: pc.Polygon): FogVertex[] {
  const ring = p[0];
  if (!ring || ring.length < 3) return [];
  // Drop the trailing closing point — internal model is "vertex list" not
  // "GeoJSON ring".
  const out: FogVertex[] = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const xy = ring[i]!;
    out.push({ x: xy[0], y: xy[1] });
  }
  return out;
}

/**
 * Clean a self-intersecting ribbon polygon (from offsetPolyline) into one or
 * more non-self-intersecting "blob" outlines. A wiggly stroke that crosses
 * itself collapses to the outline of the swept area, not the ribbon path —
 * matching the GM's intuition that "scribbling in a circle should fill it
 * in, not leave a wiggly line".
 *
 * Holes in the result are dropped (we render outer rings only — keeps the
 * polygon mental model simple). Disconnected components become separate
 * polygons (each is its own blob).
 */
export function cleanRibbonToBlobs(ring: FogVertex[]): FogVertex[][] {
  if (ring.length < 3) return [];
  let cleaned: pc.MultiPolygon;
  try {
    cleaned = pc.union(toPCPolygon(ring) as pc.Geom);
  } catch {
    // Library balks on certain self-intersection edge cases — fall back to
    // the raw ribbon so the stroke isn't lost entirely.
    return [ring];
  }
  const result: FogVertex[][] = [];
  for (const poly of cleaned) {
    const outer = poly[0];
    if (!outer || outer.length < 3) continue;
    const verts: FogVertex[] = [];
    for (let i = 0; i < outer.length - 1; i++) {
      verts.push({ x: outer[i]![0], y: outer[i]![1] });
    }
    if (verts.length >= 3) result.push(verts);
  }
  return result;
}

/**
 * Subtract the eraser polygon from every overlapping polygon in `polygons`.
 * Returns the new polygon list with any clipped polygon replaced by 0..N
 * fragments. Non-overlapping polygons pass through unchanged.
 *
 * Each fragment inherits kind / color / label / createdAt from its parent
 * but gets a fresh id (split fragments are independent thereafter).
 */
export function subtractFromAll(polygons: FogPolygon[], eraser: FogVertex[]): FogPolygon[] {
  if (eraser.length < 3) return polygons;
  const eraserPC = toPCPolygon(eraser);
  const result: FogPolygon[] = [];

  for (const poly of polygons) {
    if (poly.vertices.length < 3) { result.push(poly); continue; }
    let diff: pc.MultiPolygon;
    try {
      diff = pc.difference(toPCPolygon(poly.vertices) as pc.Geom, eraserPC as pc.Geom);
    } catch {
      // Library throws on certain self-intersection cases; treat as
      // no-overlap so we don't lose the polygon to a numerical edge case.
      result.push(poly);
      continue;
    }
    if (diff.length === 0) continue;  // entirely engulfed
    if (diff.length === 1) {
      const ring = fromPCPolygon(diff[0]!);
      if (ring.length >= 3) {
        // Replace in place (same id) when the result is a single piece —
        // visually feels like the polygon was just clipped, not replaced.
        result.push({ ...poly, vertices: ring });
      }
      continue;
    }
    // Multiple fragments — each gets a fresh id.
    for (const piece of diff) {
      const ring = fromPCPolygon(piece);
      if (ring.length >= 3) {
        result.push({ ...poly, id: generateId(), vertices: ring });
      }
    }
  }

  return result;
}
