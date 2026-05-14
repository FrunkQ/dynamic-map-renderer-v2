import * as THREE from 'three';
import type { FogPolygon } from '../types.ts';
import { overlayKind } from '../mapfx/overlayKindRegistry.ts';

/**
 * PolygonMaskCompositor (v2.12) — one alpha mask per shader-driven
 * polygon, sized to the polygon's bounding box.
 *
 * Each shader-driven polygon (fire, electric, etc.) gets its own plane
 * positioned at its bbox centre so the shader's procedural effect
 * (curling flames, crackling lightning, …) appears centred on the
 * polygon, not on the centre of the map. This compositor owns the
 * per-polygon alpha mask each plane samples to clip its output to the
 * polygon's actual shape (the plane geometry covers the bbox, but the
 * polygon may be any concave shape inside).
 *
 * Mask canvas dimensions track the polygon's footprint on the map so
 * tiny polys don't waste memory and big ones don't lose edge detail.
 * Polygon colour does NOT live in the mask — it travels as a per-plane
 * uniform (uColor), which means a fire-poly recolour is a single
 * uniform update with no rasterisation.
 *
 * Backwards-compatibility note: the file kept its old name through this
 * refactor to minimise import churn; the exported class is now named
 * PolygonMaskCompositor and `KindMaskCompositor` is re-exported as an
 * alias so the Renderer keeps working without a sweep.
 */
export interface PolygonMaskEntry {
  /** Polygon id this mask belongs to. */
  id:       string;
  /** Bounding box in map-normalised coords (x, y top-left; w, h size). */
  bbox:     { x: number; y: number; w: number; h: number };
  /** Canvas backing the texture; sized to bbox aspect. */
  canvas:   OffscreenCanvas;
  ctx:      OffscreenCanvasRenderingContext2D;
  texture:  THREE.CanvasTexture;
}

/** Target mask longest-axis size in pixels for an entry. Scales with
 *  polygon bbox so tiny polys are cheap and big ones keep detail. */
const MASK_MAX = 512;
const MASK_MIN = 64;

export class PolygonMaskCompositor {
  /** Per-polygon mask entries. Keyed by polygon id. */
  private entries = new Map<string, PolygonMaskEntry>();

  /** Snapshot of the polygons this compositor last knew about — exposed
   *  so callers can iterate the same set without re-deriving it. */
  private lastPolygons: FogPolygon[] = [];

  /** Returns the mask entry for a polygon id, or undefined if no entry
   *  has been rasterised yet (e.g. polygon is too small to need one or
   *  its kind has no shader). */
  entryFor(polyId: string): PolygonMaskEntry | undefined {
    return this.entries.get(polyId);
  }

  /** Iterate all current entries — used by the Renderer when spinning
   *  up matching shader planes. */
  *allEntries(): IterableIterator<PolygonMaskEntry> {
    yield* this.entries.values();
  }

  /** Rebuild masks for every shader-driven polygon. Cheap when the
   *  polygon set hasn't changed (we re-rasterise on every update to
   *  keep the mask exactly in sync, but for small polys this is
   *  microseconds). */
  redraw(polygons: FogPolygon[]): void {
    this.lastPolygons = polygons;

    // Build the set of polygon ids that should have masks this round.
    const wantedIds = new Set<string>();
    for (const p of polygons) {
      if (overlayKind(p.kind).shader) wantedIds.add(p.id);
    }

    // Drop entries for polygons that no longer exist (or whose kind no
    // longer has a shader — kind reassignment is rare but possible).
    for (const [id, entry] of this.entries) {
      if (wantedIds.has(id)) continue;
      entry.texture.dispose();
      this.entries.delete(id);
    }

    // Rebuild / create entries for current shader-driven polygons.
    for (const poly of polygons) {
      if (!wantedIds.has(poly.id)) continue;
      this._rebuildPoly(poly);
    }
  }

  /** Set of shader-driven polygons known to this compositor. The
   *  Renderer uses these to decide which shader planes need to exist. */
  activePolygons(): FogPolygon[] {
    return this.lastPolygons.filter((p) => overlayKind(p.kind).shader);
  }

  dispose(): void {
    for (const e of this.entries.values()) e.texture.dispose();
    this.entries.clear();
  }

  private _rebuildPoly(poly: FogPolygon): void {
    const bbox = polygonBounds(poly);
    if (bbox.w <= 0 || bbox.h <= 0) {
      // Degenerate; drop any existing entry.
      const existing = this.entries.get(poly.id);
      if (existing) {
        existing.texture.dispose();
        this.entries.delete(poly.id);
      }
      return;
    }

    // Choose mask dimensions in pixels: long axis hits MASK_MAX when the
    // polygon covers a full map side, scales down to MASK_MIN for small
    // polys so tiny shapes still get readable edges.
    const longSide = Math.max(bbox.w, bbox.h);
    const pixels   = Math.max(MASK_MIN, Math.min(MASK_MAX, Math.round(longSide * MASK_MAX)));
    const aspect   = bbox.w / bbox.h;
    const maskW    = aspect >= 1 ? pixels : Math.max(MASK_MIN, Math.round(pixels * aspect));
    const maskH    = aspect >= 1 ? Math.max(MASK_MIN, Math.round(pixels / aspect)) : pixels;

    let entry = this.entries.get(poly.id);
    if (!entry || entry.canvas.width !== maskW || entry.canvas.height !== maskH) {
      // First time, or bbox aspect changed enough to need a fresh canvas.
      // Disposing the old texture is critical or the GPU side keeps the
      // stale dimensions and copySubTexture asserts.
      if (entry) entry.texture.dispose();
      const canvas = new OffscreenCanvas(maskW, maskH);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error(`PolygonMaskCompositor: 2D context unavailable for ${poly.id}`);
      const texture = new THREE.CanvasTexture(canvas as unknown as HTMLCanvasElement);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      entry = { id: poly.id, bbox, canvas, ctx, texture };
      this.entries.set(poly.id, entry);
    } else {
      // Update bbox in place; the canvas size already matches.
      entry.bbox = bbox;
    }

    this._rasterise(entry, poly);
  }

  private _rasterise(entry: PolygonMaskEntry, poly: FogPolygon): void {
    const { ctx, canvas, bbox } = entry;
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    // Project a map-norm vertex into mask-pixel coords (bbox-local).
    const toX = (x: number) => ((x - bbox.x) / bbox.w) * width;
    const toY = (y: number) => ((y - bbox.y) / bbox.h) * height;

    // Edge fade (v2.12) — apply a Gaussian blur to the mask alpha so
    // the polygon's edges soften organically. Blur radius scales with
    // the mask's shorter dimension so the fade looks similar across
    // polygons of any size. 0 = hard edge (existing behaviour),
    // 1 = ~15% of mask shorter side blurred. Fades inward from the
    // original polygon outline because the canvas is sized to the
    // bbox exactly (no padding) -- visually reads as a soft edge.
    const fade = Math.max(0, Math.min(1, poly.edgeFade ?? 0));
    if (fade > 0) {
      const blurPx = fade * Math.min(width, height) * 0.15;
      ctx.filter = `blur(${blurPx}px)`;
    } else {
      ctx.filter = 'none';
    }

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    const v0 = poly.vertices[0]!;
    ctx.moveTo(toX(v0.x), toY(v0.y));
    for (let i = 1; i < poly.vertices.length; i++) {
      const v = poly.vertices[i]!;
      ctx.lineTo(toX(v.x), toY(v.y));
    }
    ctx.closePath();
    if (poly.holes) {
      for (const hole of poly.holes) {
        if (hole.length < 3) continue;
        const h0 = hole[0]!;
        ctx.moveTo(toX(h0.x), toY(h0.y));
        for (let i = 1; i < hole.length; i++) {
          const h = hole[i]!;
          ctx.lineTo(toX(h.x), toY(h.y));
        }
        ctx.closePath();
      }
    }
    ctx.fill('evenodd');
    ctx.filter = 'none';
    entry.texture.needsUpdate = true;
  }
}

/** Outer-ring bounding box in map-norm coords. Holes don't extend the
 *  bbox by definition (they punch out of the outer ring). */
function polygonBounds(poly: FogPolygon): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const v of poly.vertices) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Alias for the old class name so Renderer imports stay working
 *  through this refactor — TODO sweep + delete in a follow-up. */
export { PolygonMaskCompositor as KindMaskCompositor };
