/**
 * Magic-wand polygon extraction (v2.12).
 *
 * Given an image and a seed pixel, flood-fills outward while the colour
 * stays within `tolerance` of the seed, traces the contour of the
 * filled region into a polygon, and simplifies the polygon to a
 * reasonable vertex count.
 *
 * Pure functions — no DOM, no Three. The GMApp owns the click pipeline
 * (find map ImageData → call this → convert pixel-space vertices to
 * map-norm).
 *
 * Performance: scanline flood-fill + Moore-neighbour contour trace
 * runs in roughly O(filled-pixel-count) plus O(perimeter), which for
 * a typical 1024² map and a moderate fill is well under 50ms — fast
 * enough for a live tolerance slider.
 */

export interface FloodResult {
  /** Polygon vertices in image pixel space (x, y, both integers). */
  pixels: { x: number; y: number }[];
  /** Bounding-box of the filled region (image-pixel coords). Useful
   *  for sanity checks and minimum-fill thresholds. */
  bbox:   { x: number; y: number; w: number; h: number };
  /** Pixel count of the filled region. Caller can reject tiny fills. */
  area:   number;
}

export interface FloodOptions {
  /** Colour distance threshold, 0..1. Multiplied internally by the
   *  max possible RGB distance (~442 in standard 0..255 space). */
  tolerance:  number;
  /** Maximum vertex count after simplification. Default 80. The
   *  Douglas-Peucker step iteratively raises the simplification
   *  epsilon until the output is below this cap. */
  maxVertices?: number;
}

/**
 * Flood-fill from the seed pixel, trace the contour, simplify, and
 * return the polygon in image-pixel coords. Returns null if the seed
 * is out of bounds or the fill produces fewer than 12 pixels (likely
 * an erroneous click).
 */
export function floodFillToPolygon(
  img: ImageData,
  seedX: number,
  seedY: number,
  opts: FloodOptions,
): FloodResult | null {
  const { width, height, data } = img;
  if (seedX < 0 || seedX >= width || seedY < 0 || seedY >= height) return null;

  const mask = _floodFillScanline(img, seedX, seedY, opts.tolerance);
  if (!mask) return null;

  let area = 0;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] !== 1) continue;
      area++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (area < 12) return null;

  const contour = _traceContour(mask, width, height);
  if (contour.length < 4) return null;

  const cap = opts.maxVertices ?? 80;
  const simplified = _simplifyToCap(contour, cap);
  void data; // silence unused-variable lint; data is read by the helpers
  return {
    pixels: simplified,
    bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
    area,
  };
}

// ─── Scanline flood-fill ─────────────────────────────────────────────────

function _floodFillScanline(
  img: ImageData,
  seedX: number,
  seedY: number,
  toleranceFrac: number,
): Uint8Array | null {
  const { width, height, data } = img;
  const seedIdx = (seedY * width + seedX) * 4;
  const sr = data[seedIdx]!;
  const sg = data[seedIdx + 1]!;
  const sb = data[seedIdx + 2]!;
  // Max colour distance in 0..255 RGB space ≈ 442 (sqrt of 3 * 255²).
  // Multiply by tolerance fraction to get the live threshold.
  const threshold = Math.max(0, Math.min(1, toleranceFrac)) * 442.0;
  const thresholdSq = threshold * threshold;

  const mask = new Uint8Array(width * height);
  const matches = (x: number, y: number): boolean => {
    const idx = (y * width + x) * 4;
    const dr = data[idx]! - sr;
    const dg = data[idx + 1]! - sg;
    const db = data[idx + 2]! - sb;
    return (dr * dr + dg * dg + db * db) <= thresholdSq;
  };
  if (!matches(seedX, seedY)) return null;

  // Stack-based scanline flood. Each entry is [x, y]. We expand each
  // pixel into a horizontal span, mark it, then enqueue start points
  // for the rows above and below where new spans begin.
  const stack: number[] = [seedX, seedY];
  while (stack.length > 0) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    if (mask[y * width + x] === 1) continue;
    if (!matches(x, y)) continue;

    // Walk left as far as the span goes.
    let lx = x;
    while (lx > 0 && mask[y * width + (lx - 1)] !== 1 && matches(lx - 1, y)) lx--;
    // Walk right.
    let rx = x;
    while (rx < width - 1 && mask[y * width + (rx + 1)] !== 1 && matches(rx + 1, y)) rx++;
    // Mark the span.
    const rowOff = y * width;
    for (let i = lx; i <= rx; i++) mask[rowOff + i] = 1;

    // Enqueue spans on rows above and below.
    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= height) continue;
      const offNy = ny * width;
      let inSpan = false;
      for (let i = lx; i <= rx; i++) {
        const m = mask[offNy + i] !== 1 && matches(i, ny);
        if (m && !inSpan) {
          stack.push(i, ny);
          inSpan = true;
        } else if (!m) {
          inSpan = false;
        }
      }
    }
  }

  return mask;
}

// ─── Contour trace (Moore neighbourhood) ─────────────────────────────────

const _MOORE_DX = [ 1,  1,  0, -1, -1, -1,  0,  1];
const _MOORE_DY = [ 0,  1,  1,  1,  0, -1, -1, -1];

function _traceContour(mask: Uint8Array, width: number, height: number): { x: number; y: number }[] {
  // Find a starting pixel: top-most leftmost filled pixel.
  let sx = -1, sy = -1;
  outer: for (let y = 0; y < height; y++) {
    const off = y * width;
    for (let x = 0; x < width; x++) {
      if (mask[off + x] === 1) { sx = x; sy = y; break outer; }
    }
  }
  if (sx < 0) return [];

  const path: { x: number; y: number }[] = [{ x: sx, y: sy }];
  let cx = sx, cy = sy;
  let prevDir = 4; // came in from the left (look around clockwise from up-left)
  const maxSteps = width * height * 4;
  for (let step = 0; step < maxSteps; step++) {
    // Search 8 neighbours clockwise starting from prevDir+2 (just past
    // the direction we came from). First filled neighbour becomes the
    // next contour point.
    let found = false;
    for (let i = 0; i < 8; i++) {
      const dir = (prevDir + 2 + i) % 8;
      const nx = cx + _MOORE_DX[dir]!;
      const ny = cy + _MOORE_DY[dir]!;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      if (mask[ny * width + nx] !== 1) continue;
      // Found next contour pixel.
      cx = nx; cy = ny;
      // Direction we came FROM is the opposite of dir.
      prevDir = (dir + 4) % 8;
      if (cx === sx && cy === sy) return path; // closed loop
      path.push({ x: cx, y: cy });
      found = true;
      break;
    }
    if (!found) break; // isolated pixel — shouldn't happen with area >= 12
  }
  return path;
}

// ─── Douglas-Peucker, with vertex-count cap ──────────────────────────────

function _simplifyToCap(points: { x: number; y: number }[], cap: number): { x: number; y: number }[] {
  if (points.length <= cap) return points;
  // Binary search the epsilon that yields ~cap vertices. Start with a
  // small epsilon and grow until the simplified polygon is below cap.
  let lo = 0.5;
  let hi = Math.max(points.length / cap, 4);
  let best = points;
  for (let iter = 0; iter < 12; iter++) {
    const mid = (lo + hi) / 2;
    const simp = _douglasPeucker(points, mid);
    if (simp.length <= cap) {
      best = simp;
      hi = mid;
    } else {
      lo = mid;
    }
    if (Math.abs(simp.length - cap) <= 4) { best = simp; break; }
  }
  return best.length >= 3 ? best : points.slice(0, Math.max(3, cap));
}

function _douglasPeucker(points: { x: number; y: number }[], epsilon: number): { x: number; y: number }[] {
  if (points.length < 3) return points.slice();
  // Closed contour — keep first and last (which may coincide).
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack: number[] = [0, points.length - 1];
  while (stack.length > 0) {
    const end = stack.pop()!;
    const start = stack.pop()!;
    let maxD = -1;
    let maxI = -1;
    const a = points[start]!;
    const b = points[end]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const segLenSq = dx * dx + dy * dy;
    for (let i = start + 1; i < end; i++) {
      const p = points[i]!;
      let d: number;
      if (segLenSq === 0) {
        const ex = p.x - a.x, ey = p.y - a.y;
        d = Math.sqrt(ex * ex + ey * ey);
      } else {
        const num = Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x);
        d = num / Math.sqrt(segLenSq);
      }
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > epsilon && maxI > 0) {
      keep[maxI] = 1;
      stack.push(start, maxI, maxI, end);
    }
  }
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i] === 1) out.push(points[i]!);
  return out;
}
