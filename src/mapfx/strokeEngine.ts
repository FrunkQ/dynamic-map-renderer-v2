/**
 * Stroke engine (v2.12/M2) — pure rasteriser. Takes a polyline + brush
 * settings, paints it into an OffscreenCanvas (or HTMLCanvasElement) at
 * map-pixel scale, with smoothing + soft-edged disks.
 *
 * No DOM listeners here — those live in BrushEditor. This module is
 * deterministic so the GM, player, and projector all reproduce the same
 * pixels from the same stroke delta.
 */

import type { FogVertex, MsgBrushStroke } from '../types.ts';

export interface StrokeBitmap {
  /** Canvas the stroke renders into. Caller decides whether this is an
   *  Offscreen (worker / no DOM) or HTMLCanvas (for paths that need to
   *  read back via toBlob / toDataURL). */
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx:    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}

/** Pick the most appropriate canvas type for the runtime. */
export function makeStrokeBitmap(width: number, height: number): StrokeBitmap {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(width, height);
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable');
    return { canvas: c, ctx };
  }
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  return { canvas: c, ctx };
}

/**
 * Paint a single stroke onto the bitmap. Points are normalised 0..1 map
 * coords; radius is also normalised (1 = map width). Mode 'paint' uses
 * source-over; 'erase' uses destination-out so the alpha channel is
 * actually carved out (needed for the FoW reveal use case).
 */
export function applyStroke(
  bm: StrokeBitmap,
  stroke: Pick<MsgBrushStroke, 'points' | 'radius' | 'mode' | 'color'>,
): void {
  const { ctx, canvas } = bm;
  const w = canvas.width;
  const h = canvas.height;
  if (stroke.points.length === 0) return;

  const radiusPx = Math.max(1, stroke.radius * w);

  ctx.save();
  ctx.globalCompositeOperation = stroke.mode === 'erase' ? 'destination-out' : 'source-over';
  ctx.fillStyle   = stroke.color;
  ctx.strokeStyle = stroke.color;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.lineWidth   = radiusPx * 2;

  if (stroke.points.length === 1) {
    // Single tap — disk only.
    const p = stroke.points[0]!;
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, radiusPx, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Polyline — draw the path as a thick rounded line. This effectively
    // smears a disc along the path so the result is a continuous stroke
    // without seams between samples.
    ctx.beginPath();
    const first = stroke.points[0]!;
    ctx.moveTo(first.x * w, first.y * h);
    for (let i = 1; i < stroke.points.length; i++) {
      const p = stroke.points[i]!;
      ctx.lineTo(p.x * w, p.y * h);
    }
    ctx.stroke();
    // Also drop a disc at each endpoint so very-short strokes still render.
    ctx.beginPath();
    ctx.arc(first.x * w,                          first.y * h,                          radiusPx, 0, Math.PI * 2);
    const last = stroke.points[stroke.points.length - 1]!;
    ctx.moveTo(last.x * w + radiusPx, last.y * h);
    ctx.arc(last.x * w,                           last.y * h,                           radiusPx, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Lightweight Chaikin smoothing pass — softens pointer-event jitter without
 *  changing the stroke's overall shape. Run once on the raw points before
 *  applying / broadcasting the stroke. */
export function smoothPoints(points: FogVertex[], iterations: number = 1): FogVertex[] {
  let pts = points.slice();
  for (let it = 0; it < iterations; it++) {
    if (pts.length < 3) return pts;
    const next: FogVertex[] = [];
    next.push(pts[0]!);
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i]!;
      const p1 = pts[i + 1]!;
      next.push({ x: 0.75 * p0.x + 0.25 * p1.x, y: 0.75 * p0.y + 0.25 * p1.y });
      next.push({ x: 0.25 * p0.x + 0.75 * p1.x, y: 0.25 * p0.y + 0.75 * p1.y });
    }
    next.push(pts[pts.length - 1]!);
    pts = next;
  }
  return pts;
}

/** Compute the bounding box of a stroke in normalised coords, padded by the
 *  brush radius so the rasterised area is fully enclosed. Used by MapFX to
 *  know where the painted patch lives on the map. */
export function strokeBounds(
  points: FogVertex[],
  radius: number,
): { x: number; y: number; w: number; h: number } {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = points[0]!.x, maxX = minX, minY = points[0]!.y, maxY = minY;
  for (const p of points) {
    if (p.x < minX) minX = p.x; else if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; else if (p.y > maxY) maxY = p.y;
  }
  const r = radius;
  return {
    x: Math.max(0, minX - r),
    y: Math.max(0, minY - r),
    w: Math.min(1, maxX - minX + 2 * r),
    h: Math.min(1, maxY - minY + 2 * r),
  };
}

/**
 * Load a base64 PNG into the bitmap (replacing its current contents). Used to
 * restore a layer from a persisted snapshot.
 */
export async function loadPng(bm: StrokeBitmap, base64Png: string): Promise<void> {
  const img = await loadImage(base64Png);
  const { ctx, canvas } = bm;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img as CanvasImageSource, 0, 0, canvas.width, canvas.height);
}

/** Export the bitmap as base64 PNG (no `data:` prefix). */
export async function exportPng(bm: StrokeBitmap): Promise<string> {
  const blob = await canvasToBlob(bm);
  return arrayBufferToBase64(await blob.arrayBuffer());
}

// ─── Internal helpers ───────────────────────────────────────────────────────

function loadImage(base64Png: string): Promise<HTMLImageElement | ImageBitmap> {
  const dataUrl = base64Png.startsWith('data:') ? base64Png : `data:image/png;base64,${base64Png}`;
  if (typeof Image !== 'undefined') {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }
  // Worker context — use fetch + createImageBitmap.
  return fetch(dataUrl).then((r) => r.blob()).then(createImageBitmap);
}

function canvasToBlob(bm: StrokeBitmap): Promise<Blob> {
  if (bm.canvas instanceof OffscreenCanvas) return bm.canvas.convertToBlob({ type: 'image/png' });
  return new Promise((resolve, reject) => {
    (bm.canvas as HTMLCanvasElement).toBlob((b) => {
      if (b) resolve(b); else reject(new Error('Canvas toBlob returned null'));
    }, 'image/png');
  });
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}
