/**
 * dicePath (v2.19.8) — where a thrown die travels, and where it stops.
 *
 * FAKE, and unashamed about it. There is no physics here: the result was
 * decided before anything moved (see roll.ts), so all this has to do is look
 * like a throw. A die enters from an edge, crosses the surface, bounces off the
 * sides a couple of times, and slows to a stop somewhere sensible.
 *
 * PURE: numbers in, waypoints out. That means the awkward parts — dice landing
 * off-screen, landing under the tray, or all landing in a heap — are testable
 * without a browser.
 */

export interface Point { x: number; y: number; rot: number }

export interface ThrowOptions {
  /** The surface the dice are thrown across. */
  width: number;
  height: number;
  /** How big one die is, so nothing lands half off the edge. */
  dieSize: number;
  /** Same throw for the same seed: dice keep their path if anything re-renders. */
  seed: number;
  /** Keep clear of chrome — the tray along the bottom, mostly. */
  inset?: { top?: number; right?: number; bottom?: number; left?: number };
  /** How many times it may bounce before it settles. */
  bounces?: number;
}

const DEFAULT_BOUNCES = 3;

/** Deterministic, so a die does not change its mind mid-throw. */
function lcg(seed: number): () => number {
  let s = (seed * 1103515245 + 12345) >>> 0;
  return () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
}

/**
 * The waypoints of one throw. The FIRST is off the edge (where the die comes
 * from) and the LAST is where it comes to rest; everything between is a bounce.
 * Rotation accumulates and then stops turning, because a die that is still
 * spinning has not landed.
 */
export function bouncePath(opts: ThrowOptions): Point[] {
  const rand = lcg(opts.seed);
  const bounces = Math.max(1, opts.bounces ?? DEFAULT_BOUNCES);

  const inset = {
    top: opts.inset?.top ?? 0,
    right: opts.inset?.right ?? 0,
    bottom: opts.inset?.bottom ?? 0,
    left: opts.inset?.left ?? 0,
  };
  // The box a die may come to rest in, with room for the die itself.
  const minX = inset.left;
  const minY = inset.top;
  const maxX = Math.max(minX, opts.width - inset.right - opts.dieSize);
  const maxY = Math.max(minY, opts.height - inset.bottom - opts.dieSize);
  const span = { x: Math.max(1, maxX - minX), y: Math.max(1, maxY - minY) };

  // In from the left or the right, aimed across and down the surface.
  const fromLeft = rand() > 0.5;
  const start: Point = {
    x: fromLeft ? minX - opts.dieSize * 1.5 : maxX + opts.dieSize * 1.5,
    y: minY + span.y * (0.15 + rand() * 0.35),
    rot: 0,
  };

  const points: Point[] = [start];
  let x = start.x;
  let y = start.y;
  // A decent first stride across the surface, shortening each bounce so the
  // die visibly runs out of energy rather than stopping dead.
  let stepX = (fromLeft ? 1 : -1) * span.x * (0.45 + rand() * 0.3);
  let stepY = span.y * (0.2 + rand() * 0.3);
  let rot = 0;

  for (let i = 0; i <= bounces; i++) {
    x += stepX;
    y += stepY;

    // Reflect off the sides, which is the whole trick: it reads as a bounce and
    // it is what keeps a die on the surface.
    if (x < minX) { x = minX + (minX - x); stepX = Math.abs(stepX); }
    else if (x > maxX) { x = maxX - (x - maxX); stepX = -Math.abs(stepX); }
    if (y < minY) { y = minY + (minY - y); stepY = Math.abs(stepY); }
    else if (y > maxY) { y = maxY - (y - maxY); stepY = -Math.abs(stepY); }

    // Clamp too, for the case where a reflection overshoots the far side on a
    // very small surface — a phone in portrait, for instance.
    x = Math.min(maxX, Math.max(minX, x));
    y = Math.min(maxY, Math.max(minY, y));

    stepX *= 0.55;
    stepY *= 0.55;
    // Spin hard at first, then hardly at all; the last leg barely turns.
    rot += (fromLeft ? 1 : -1) * (140 - i * 35) * (0.6 + rand() * 0.8);
    points.push({ x, y, rot });
  }

  return points;
}

/**
 * Where a caption belongs for a handful: under the middle of where they landed,
 * kept inside the surface. The dice scatter, so the total has to find them
 * rather than sitting in a fixed corner.
 */
export function captionSpot(
  rests: Point[],
  opts: { width: number; height: number; dieSize: number; captionWidth: number; bottomInset?: number },
): { x: number; y: number } {
  if (rests.length === 0) return { x: 0, y: 0 };
  const midX = rests.reduce((sum, p) => sum + p.x, 0) / rests.length + opts.dieSize / 2;
  const lowest = rests.reduce((low, p) => Math.max(low, p.y), 0) + opts.dieSize;
  const half = opts.captionWidth / 2;
  return {
    x: Math.min(opts.width - half - 4, Math.max(half + 4, midX)),
    // Under the dice, unless that would put it off the bottom — then above.
    y: Math.min(lowest + 6, opts.height - (opts.bottomInset ?? 0) - 26),
  };
}
