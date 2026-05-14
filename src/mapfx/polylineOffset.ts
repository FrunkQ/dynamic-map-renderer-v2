/**
 * Polyline offset / "buffer" — inflates a polyline at a radius into the
 * geometry of the swept area. Used by the v2.12 unified overlay system
 * (brush strokes → polygons).
 *
 * Returns up to THREE polygons: a flat-ended ribbon along the path, plus
 * a full-circle disc at each endpoint. The caller runs `polygon-clipping.
 * union` on all three to produce the final swept-area outline. This is
 * crucial when the stroke loops back on itself: the end-point disc lands
 * inside the existing ribbon, the union absorbs it cleanly, and the
 * resulting outline has no surprise semi-circular dents (which is what
 * an inline half-circle end-cap produced before).
 *
 * Coords are in any consistent space (normalised 0..1 map coords is what
 * the rest of the overlay system uses).
 */

export interface XY { x: number; y: number }

const TAU = Math.PI * 2;
/** Full-disc tessellation density. 12 segments / circle = ~30° steps —
 *  smooth enough visually, cheap enough not to bloat the polygon. */
const DISC_SEGMENTS = 16;

/** Inflate a polyline at a radius. Returns a list of polygons (flat
 *  vertex lists, no closing duplicate). The caller unions them together
 *  to get the final shape — so a self-crossing path's endpoint discs
 *  merge with overlapping ribbon area naturally.
 *
 *  - Empty input → no polygons.
 *  - Single point → one disc.
 *  - Multi-point → ribbon + start disc + end disc. */
export function offsetPolyline(points: XY[], radius: number): XY[][] {
  if (radius <= 0 || points.length === 0) return [];
  if (points.length === 1) return [_disc(points[0]!, radius)];

  const pts = _dedupe(points);
  if (pts.length === 1) return [_disc(pts[0]!, radius)];

  // Build left + right offset chains — NO inline end caps. The endpoint
  // discs handle rounded termination via union.
  const left:  XY[] = [];
  const right: XY[] = [];

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const prev = i > 0              ? pts[i - 1]! : null;
    const next = i < pts.length - 1 ? pts[i + 1]! : null;

    if (i === 0) {
      const n = _perp(prev ?? p, next ?? p);
      right.push({ x: p.x + n.x * radius, y: p.y + n.y * radius });
      left.push ({ x: p.x - n.x * radius, y: p.y - n.y * radius });
    } else if (i === pts.length - 1) {
      const n = _perp(prev!, p);
      right.push({ x: p.x + n.x * radius, y: p.y + n.y * radius });
      left.push ({ x: p.x - n.x * radius, y: p.y - n.y * radius });
    } else {
      const n1 = _perp(prev!, p);
      const n2 = _perp(p, next!);
      const bx = n1.x + n2.x;
      const by = n1.y + n2.y;
      const blen = Math.hypot(bx, by);
      if (blen < 1e-6) {
        right.push({ x: p.x + n1.x * radius, y: p.y + n1.y * radius });
        left.push ({ x: p.x - n1.x * radius, y: p.y - n1.y * radius });
      } else {
        const miterScale = Math.min(2.0, 1.0 / Math.max(0.1, (n1.x * bx + n1.y * by) / blen));
        const nx = (bx / blen) * radius * miterScale;
        const ny = (by / blen) * radius * miterScale;
        right.push({ x: p.x + nx, y: p.y + ny });
        left.push ({ x: p.x - nx, y: p.y - ny });
      }
    }
  }

  // Flat-ended ribbon: right chain forward + left chain reversed. The
  // endpoints terminate as flat segments here; the discs round them out.
  const ribbon: XY[] = [];
  for (const v of right) ribbon.push(v);
  for (let i = left.length - 1; i >= 0; i--) ribbon.push(left[i]!);

  const startDisc = _disc(pts[0]!, radius);
  const endDisc   = _disc(pts[pts.length - 1]!, radius);

  return [ribbon, startDisc, endDisc];
}

/** Regular n-gon approximating a circle at `c` with the given radius. */
function _disc(c: XY, radius: number): XY[] {
  const out: XY[] = [];
  for (let i = 0; i < DISC_SEGMENTS; i++) {
    const t = (i / DISC_SEGMENTS) * TAU;
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
