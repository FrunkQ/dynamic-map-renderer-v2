import type { Marker } from '../types.ts';
import type { MotionOverlay } from './MarkerLayer.ts';

/**
 * MarkerTexture — motion overlay layer for the player + projector.
 *
 * Historical note: prior to v2.10.29 this class also rendered the markers
 * themselves into a shared 2048² OffscreenCanvas. Per-marker sprites
 * (`MarkerSprites`) replaced that for the marker icons because the shared
 * texture starved each marker of pixel budget at moderate zooms. This
 * class now only draws the motion-tracker overlay (return blobs + scan
 * rings) — those are coloured blobs and transparent strokes that don't
 * benefit from per-marker resolution and fit comfortably in a single
 * shared canvas. Reduced to 1024² accordingly.
 *
 * The canvas is wired to the renderer via `setMarkerCanvas()` and the
 * caller must invoke `renderer.markMarkersDirty()` after each `render()`
 * so the new pixels are uploaded to the GPU.
 *
 * The 1/aspect horizontal pre-squash compensates for the texture being
 * stretched onto the aspect:1 plane — rings stay circular on screen.
 */
export class MarkerTexture {
  readonly canvas: OffscreenCanvas;
  private aspect = 1;

  constructor() {
    this.canvas = new OffscreenCanvas(1024, 1024);
  }

  setAspectRatio(ar: number): void {
    this.aspect = Math.max(0.0001, ar);
  }

  render(
    markers: Marker[],
    _iconCache?: Map<string, ImageBitmap>,
    motion?: MotionOverlay | null,
  ): void {
    const { width: W, height: H } = this.canvas;
    const ctx = this.canvas.getContext('2d')! as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, W, H);
    // Markers themselves are rendered by MarkerSprites as individual meshes.
    // The marker list is still needed here to colour return blobs from the
    // tracker — each blob carries a sourceId we look up in the list.
    if (motion) this._drawMotionOverlay(ctx, motion, W, H, markers);
  }

  private _drawMotionOverlay(ctx: CanvasRenderingContext2D, m: MotionOverlay, W: number, H: number, markers: Marker[]): void {
    const aspect = this.aspect;
    const yScale = H; // the texture spans 0–1 in y over its full pixel height

    // Active scan rings — each radius animates 0 → range over speedSecs, alpha fades out
    for (const scan of m.scans) {
      const elapsedSecs = (m.now - scan.startTime) / 1000;
      const t           = Math.min(1, Math.max(0, elapsedSecs / scan.speedSecs));
      const radiusPx    = t * scan.range * yScale;
      const cx          = scan.centre.x * W;
      const cy          = scan.centre.y * H;
      if (radiusPx <= 1) continue;
      // Hold near-full alpha through most of the scan; the fade compresses into the last ~15%.
      const alpha = (1 - Math.pow(t, 4)) * 0.7;
      ctx.save();
      ctx.lineWidth   = 4;
      ctx.strokeStyle = _hexA(scan.colour, alpha);
      ctx.beginPath();
      ctx.ellipse(cx, cy, radiusPx / aspect, radiusPx, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth   = 12;
      ctx.strokeStyle = _hexA(scan.colour, alpha * 0.25);
      ctx.beginPath();
      ctx.ellipse(cx, cy, radiusPx / aspect, radiusPx, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Return blobs — fade alpha over fadeMs
    for (const b of m.blobs) {
      const elapsed = m.now - b.startTime;
      const alpha   = Math.max(0, 1 - elapsed / b.fadeMs) * 0.85;
      if (alpha <= 0) continue;
      const cx = b.position.x * W;
      const cy = b.position.y * H;
      // Match the source marker's icon footprint so blobs cover the same area.
      // Use the live size from the player's marker list (broadcast keeps it current).
      const src = markers.find((mm) => mm.id === b.sourceId);
      const sizeMul = src?.size ?? 1;
      const r = H * 0.025 * sizeMul;
      ctx.save();
      ctx.fillStyle = _hexA(b.colour, alpha);
      if (b.mode === 'multi-few' || b.mode === 'multi-many') {
        const rng      = _seeded(_blobSeed(b.startTime, b.sourceId));
        const isMany   = b.mode === 'multi-many';
        const count    = isMany ? (7  + Math.floor(rng() * 7)) : (3 + Math.floor(rng() * 3));
        const sizeBase = isMany ? 0.16 : 0.28;
        const sizeVar  = isMany ? 0.10 : 0.18;
        for (let i = 0; i < count; i++) {
          const ang   = rng() * Math.PI * 2;
          const dist  = rng() * r * 0.85;
          const blobR = r * (sizeBase + rng() * sizeVar);
          ctx.beginPath();
          ctx.ellipse(
            cx + (Math.cos(ang) * dist) / aspect,
            cy +  Math.sin(ang) * dist,
            blobR / aspect, blobR, 0, 0, Math.PI * 2,
          );
          ctx.fill();
        }
      } else {
        ctx.beginPath();
        ctx.ellipse(cx, cy, r / aspect, r, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
}

// ── Local copies of MarkerLayer's helpers (kept private to avoid expanding its API) ──

function _hexA(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return `rgba(248, 158, 11, ${alpha})`;
  const r = parseInt(m[1]!, 16);
  const g = parseInt(m[2]!, 16);
  const b = parseInt(m[3]!, 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function _seeded(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function _blobSeed(startTime: number, sourceId: string): number {
  let h = 0;
  for (let i = 0; i < sourceId.length; i++) h = (h * 31 + sourceId.charCodeAt(i)) | 0;
  return (Math.floor(startTime) ^ h) >>> 0;
}
