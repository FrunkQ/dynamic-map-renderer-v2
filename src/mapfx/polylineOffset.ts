/**
 * Polyline offset / "buffer" — inflates a polyline at a radius to a closed
 * polygon with rounded end-caps and rounded joints. Used by the v2.12
 * unified overlay system (brush strokes → polygons).
 *
 * For each segment we emit two offset vertices (perpendicular ± radius).
 * At joints between segments we fan an arc of `arcSegments` vertices so
 * sharp angles read as round corners. End-caps are a half-disc fan at
 * each terminus.
 *
 * Single-point input (a tap) yields a regular polygon approximating the
 * disc — handy because the user might tap-to-spot rather than drag.
 *
 * Coords are in any consistent space (normalised 0..1 map coords is what
 * the rest of the overlay system uses).
 */

export interface XY { x: number; y: number }

const TAU = Math.PI * 2;
/** Half-arcs at joints + caps are tessellated this finely. 12 segments per
 *  full circle = ~30° steps — smooth enough for visual use, cheap enough
 *  the polygon doesn't bloat with hundreds of vertices on a long stroke. */
const ARC_SEGMENTS_FULL = 12;

/** Inflate a polyline to a polygon ribbon. Returns a closed loop of vertices
 *  (the last vertex does NOT repeat the first — caller knows it's closed).
 *  Empty / one-point input → a regular polygon disc at that point. */
export function offsetPolyline(points: XY[], radius: number): XY[] {
  if (radius <= 0) return [];
  if (points.length === 0) return [];
  if (points.length === 1) return _disc(points[0]!, radius);

  // De-duplicate consecutive points so degenerate "stayed still" frames
  // don't produce zero-length segments that crash the normal math.
  const pts = _dedupe(points);
  if (pts.length === 1) return _disc(pts[0]!, radius);

  // Build left + right offset chains, then walk them around end-cap → right
  // (along the path) → end-cap → left (reverse) to form one closed loop.
  const left:  XY[] = [];
  const right: XY[] = [];

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const prev = i > 0              ? pts[i - 1]! : null;
    const next = i < pts.length - 1 ? pts[i + 1]! : null;

    if (i === 0) {
      // Start: perpendicular offset to the first segment.
      const n = _perp(prev ?? p, next ?? p);
      right.push({ x: p.x + n.x * radius, y: p.y + n.y * radius });
      left.push ({ x: p.x - n.x * radius, y: p.y - n.y * radius });
    } else if (i === pts.length - 1) {
      // End: perpendicular offset to the last segment.
      const n = _perp(prev!, p);
      right.push({ x: p.x + n.x * radius, y: p.y + n.y * radius });
      left.push ({ x: p.x - n.x * radius, y: p.y - n.y * radius });
    } else {
      // Mid-joint: emit arc fans on the outside of the turn, single point on
      // the inside. Simpler approximation: emit BOTH sides as the bisector
      // offset — works fine at the polygon-rendering resolution we care
      // about and avoids the cross-over math at sharp inside corners.
      const n1 = _perp(prev!, p);
      const n2 = _perp(p, next!);
      // Bisector of the two normals (with a clamp so very sharp angles
      // don't extend miters off to infinity).
      const bx = n1.x + n2.x;
      const by = n1.y + n2.y;
      const blen = Math.hypot(bx, by);
      if (blen < 1e-6) {
        // 180° flip — fall back to the single normal.
        right.push({ x: p.x + n1.x * radius, y: p.y + n1.y * radius });
        left.push ({ x: p.x - n1.x * radius, y: p.y - n1.y * radius });
      } else {
        // Miter-limited length to avoid spikes at very acute joins.
        const miterScale = Math.min(2.0, 1.0 / Math.max(0.1, (n1.x * bx + n1.y * by) / blen));
        const nx = (bx / blen) * radius * miterScale;
        const ny = (by / blen) * radius * miterScale;
        right.push({ x: p.x + nx, y: p.y + ny });
        left.push ({ x: p.x - nx, y: p.y - ny });
      }
    }
  }

  // End-cap at the LAST point: half-disc fan from right-side offset to
  // left-side offset, going around the end of the path.
  const last     = pts[pts.length - 1]!;
  const lastPrev = pts[pts.length - 2]!;
  const endCap   = _cap(last, lastPrev, radius);

  // Start-cap at the FIRST point: half-disc fan from left-side offset back
  // to right-side offset, going around the start of the path.
  const first     = pts[0]!;
  const firstNext = pts[1]!;
  const startCap  = _cap(first, firstNext, radius, /* reverse */ true);

  // Walk the loop:
  //   right-chain forward → endCap → left-chain reverse → startCap
  // Note: right[0] is the start of the right chain (which the startCap
  // already ends at), so we drop right[0] to avoid a duplicate.
  const loop: XY[] = [];
  for (let i = 1; i < right.length; i++) loop.push(right[i]!);
  for (const v of endCap) loop.push(v);
  for (let i = left.length - 2; i >= 0; i--) loop.push(left[i]!);
  for (const v of startCap) loop.push(v);
  return loop;
}

/** Regular n-gon approximating a circle — used for a single-tap stroke. */
function _disc(c: XY, radius: number): XY[] {
  const out: XY[] = [];
  for (let i = 0; i < ARC_SEGMENTS_FULL; i++) {
    const t = (i / ARC_SEGMENTS_FULL) * TAU;
    out.push({ x: c.x + Math.cos(t) * radius, y: c.y + Math.sin(t) * radius });
  }
  return out;
}

function _dedupe(points: XY[]): XY[] {
  const out: XY[] = [];
  let last: XY | null = null;
  for (const p of points) {
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-7) {
      out.push(p);
      last = p;
    }
  }
  return out;
}

/** Right-handed unit normal to the segment from a to b. */
function _perp(a: XY, b: XY): XY {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return { x: 0, y: 1 };
  dx /= len; dy /= len;
  return { x: -dy, y: dx };
}

/** Half-circle fan around `centre`, perpendicular to the direction toward
 *  `neighbour`. Generates ARC_SEGMENTS_FULL/2 + 1 vertices. */
function _cap(centre: XY, neighbour: XY, radius: number, reverse: boolean = false): XY[] {
  // Tangent direction from the neighbour toward the centre — the cap arcs
  // around the centre on the FAR side of this direction.
  let dx = centre.x - neighbour.x;
  let dy = centre.y - neighbour.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) { dx = 1; dy = 0; } else { dx /= len; dy /= len; }
  // Start angle = perpendicular to the direction, on the right side.
  // Sweep over π radians.
  const baseAngle = Math.atan2(dy, dx);
  const steps = ARC_SEGMENTS_FULL / 2; // half-circle
  const out: XY[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = reverse
      ? baseAngle + Math.PI / 2 - (i / steps) * Math.PI
      : baseAngle - Math.PI / 2 + (i / steps) * Math.PI;
    out.push({ x: centre.x + Math.cos(t) * radius, y: centre.y + Math.sin(t) * radius });
  }
  return out;
}
