/**
 * Polygon ops for the v2.12 unified overlay system.
 *
 * Wraps `polygon-clipping` (Martinez-Rueda) with the FogVertex[] / FogPolygon
 * shape used everywhere else. Handles the GeoJSON-style nesting conversion
 * in / out, INCLUDING holes — outer ring + N inner rings per polygon.
 *
 * The library represents polygons as `Polygon[]`, where each `Polygon` is
 * `[outerRing, hole0, hole1, ...]`. We preserve both — erasing the centre
 * of a polygon punches a hole rather than collapsing to a single ring.
 */

import * as pc from 'polygon-clipping';
import type { FogVertex, FogPolygon } from '../types.ts';
import { generateId } from '../utils/id.ts';

/** Close a ring (last point = first point) — polygon-clipping requires
 *  this for valid input. Skipped if the ring is already closed. */
function closedRing(ring: FogVertex[]): pc.Pair[] {
  if (ring.length < 3) return [];
  const out: pc.Pair[] = ring.map((v) => [v.x, v.y]);
  const first = out[0]!;
  const last  = out[out.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) out.push([first[0], first[1]]);
  return out;
}

/** Build the polygon-clipping nested form for a polygon with optional holes. */
function toPCPolygon(outer: FogVertex[], holes: FogVertex[][] = []): pc.Polygon {
  const rings: pc.Ring[] = [closedRing(outer)];
  for (const h of holes) {
    const closed = closedRing(h);
    if (closed.length >= 4) rings.push(closed); // need 3 distinct points + closing repeat
  }
  return rings;
}

/** Strip the trailing closing duplicate from a polygon-clipping ring and
 *  return it as a FogVertex[]. */
function ringFromPC(ring: pc.Ring): FogVertex[] {
  if (!ring || ring.length < 4) return [];
  const out: FogVertex[] = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const xy = ring[i]!;
    out.push({ x: xy[0], y: xy[1] });
  }
  return out;
}

/** Pull outer + holes out of one polygon-clipping polygon. */
function outerAndHolesFromPC(p: pc.Polygon): { outer: FogVertex[]; holes: FogVertex[][] } {
  const outer = ringFromPC(p[0] ?? []);
  const holes: FogVertex[][] = [];
  for (let i = 1; i < p.length; i++) {
    const h = ringFromPC(p[i]!);
    if (h.length >= 3) holes.push(h);
  }
  return { outer, holes };
}

/**
 * Clean a self-intersecting ribbon polygon (from offsetPolyline) into one or
 * more non-self-intersecting "blob" outlines, preserving any holes the
 * union produces (e.g. a donut scribble).
 *
 * A wiggly stroke that crosses itself collapses to the outline of the swept
 * area, not the ribbon path — matching the GM's intuition that "scribbling
 * in a circle should fill it in". Disconnected components become separate
 * polygons.
 */
export function cleanRibbonToBlobs(ring: FogVertex[]): Array<{ outer: FogVertex[]; holes: FogVertex[][] }> {
  if (ring.length < 3) return [];
  let cleaned: pc.MultiPolygon;
  try {
    cleaned = pc.union(toPCPolygon(ring) as pc.Geom);
  } catch {
    return [{ outer: ring, holes: [] }];
  }
  const result: Array<{ outer: FogVertex[]; holes: FogVertex[][] }> = [];
  for (const poly of cleaned) {
    const oh = outerAndHolesFromPC(poly);
    if (oh.outer.length >= 3) result.push(oh);
  }
  return result;
}

/**
 * Subtract the eraser polygon from every overlapping polygon in `polygons`.
 * Returns the new polygon list with any clipped polygon replaced by 0..N
 * fragments. Non-overlapping polygons pass through unchanged.
 *
 * Holes ARE preserved: erasing the centre of a polygon adds a hole rather
 * than collapsing to a single ring. Erasing through an existing hole's
 * edge can split / merge holes — polygon-clipping handles all topology
 * edge cases. Each fragment inherits kind / color / label / createdAt
 * from its parent; split fragments get fresh ids.
 */
export function subtractFromAll(polygons: FogPolygon[], eraser: FogVertex[]): FogPolygon[] {
  if (eraser.length < 3) return polygons;
  const eraserPC = toPCPolygon(eraser);
  const result: FogPolygon[] = [];

  for (const poly of polygons) {
    if (poly.vertices.length < 3) { result.push(poly); continue; }
    let diff: pc.MultiPolygon;
    try {
      const targetPC = toPCPolygon(poly.vertices, poly.holes ?? []);
      diff = pc.difference(targetPC as pc.Geom, eraserPC as pc.Geom);
    } catch {
      result.push(poly);
      continue;
    }
    if (diff.length === 0) continue;  // entirely engulfed
    if (diff.length === 1) {
      const oh = outerAndHolesFromPC(diff[0]!);
      if (oh.outer.length >= 3) {
        // Replace in place (same id) when one result — feels like a clip,
        // not a replace. Reassign without the parent's old holes; pick up
        // whatever the diff produced (could be zero, could be split).
        const { holes: _drop, ...rest } = poly;
        void _drop;
        const next: FogPolygon = { ...rest, vertices: oh.outer };
        if (oh.holes.length > 0) next.holes = oh.holes;
        result.push(next);
      }
      continue;
    }
    // Multiple fragments — each gets a fresh id.
    for (const piece of diff) {
      const oh = outerAndHolesFromPC(piece);
      if (oh.outer.length >= 3) {
        const { holes: _drop, ...rest } = poly;
        void _drop;
        const next: FogPolygon = { ...rest, id: generateId(), vertices: oh.outer };
        if (oh.holes.length > 0) next.holes = oh.holes;
        result.push(next);
      }
    }
  }

  return result;
}
