import type { Marker } from '../types.ts';
import { drawMarkerShape, type MotionOverlay } from './MarkerLayer.ts';

/**
 * MarkerTexture — manages an OffscreenCanvas used as Plane 2 in the Three.js
 * scene so player markers (and the motion-tracker overlay) pass through the
 * active GLSL filter.
 *
 * The canvas is passed to Renderer.setMarkerCanvas() which creates its own
 * THREE.CanvasTexture from it. After each render() call the caller should
 * invoke renderer.markMarkersDirty() to upload the new pixels to the GPU.
 *
 * The texture is square (1024×1024) but the plane it's mapped onto is
 * `aspect × 1` world units. To keep circles looking like circles after that
 * stretch, the overlay drawing uses an X-radius scaled by 1/aspect.
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
    iconCache?: Map<string, ImageBitmap>,
    motion?: MotionOverlay | null,
  ): void {
    const { width: W, height: H } = this.canvas;
    const aspect = this.aspect;
    const ctx = this.canvas.getContext('2d')! as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, W, H);
    for (const m of markers) {
      if (m.hidden) continue; // players never see hidden markers
      const cx = m.position.x * W;
      const cy = m.position.y * H;
      // Map-fixed sizing: marker stays at 2.5% of map height regardless of
      // how zoomed the viewport is. This matches the projector (always
      // calibrated) and the GM canvas — a marker is a token on the map.
      const r  = H * 0.025 * m.size;
      // Pre-squash horizontally so the marker comes out as a true visual circle
      // after the texture is stretched onto the aspect:1 plane.
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1 / aspect, 1);
      drawMarkerShape(ctx, m, 0, 0, r, false, false, iconCache);
      ctx.restore();
    }
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
