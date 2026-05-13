import * as THREE from 'three';
import type { FogState } from '../types.ts';
import { applyStroke } from '../mapfx/strokeEngine.ts';

/**
 * FogCompositor
 *
 * Maintains an OffscreenCanvas that represents the fog-of-war layer.
 * Drawn polygons are opaque (in their declared colour); everything else is transparent.
 * The result is a Three.js CanvasTexture applied to the fog mesh plane.
 *
 * On fog change: re-draws the canvas and marks the texture for GPU upload.
 * On map change: resizes the canvas to match the new map dimensions.
 *
 * v2.12/M2 — also consumes the FoW brush layer (alpha-only PNG patch stored
 * in FogState.brush). The brush layer is loaded into a sibling canvas and
 * composited on top of the polygons each frame, so paint + polys compose
 * the same picture. Live brush strokes call `applyBrushStroke()` to
 * paint directly into the brush canvas without re-decoding the PNG.
 */
export class FogCompositor {
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  /** Sibling canvas holding the persistent FoW brush layer. Composited
   *  onto the main fog canvas after the polygons each redraw. */
  private brushCanvas: OffscreenCanvas;
  private brushCtx:    OffscreenCanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;

  constructor(width = 1024, height = 1024) {
    this.canvas = new OffscreenCanvas(width, height);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('FogCompositor: OffscreenCanvas 2D context unavailable');
    this.ctx = ctx;
    this.brushCanvas = new OffscreenCanvas(width, height);
    const bctx = this.brushCanvas.getContext('2d');
    if (!bctx) throw new Error('FogCompositor: brush 2D context unavailable');
    this.brushCtx = bctx;
    this.texture = new THREE.CanvasTexture(this.canvas as unknown as HTMLCanvasElement);
    // Canvas 2D always draws in sRGB.  Marking the texture SRGBColorSpace tells
    // Three.js to decode it to linear before rendering, so OutputPass can
    // re-encode to sRGB on the way out — preserving the exact picked colour.
    // Without this, the raw sRGB value is treated as linear and OutputPass
    // over-brightens it (e.g. #CBCBCB → #E6E6E6).
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.needsUpdate = true;
  }

  /** Re-composite the fog layer from the current state. The brush canvas is
   *  NOT reloaded here — it's loaded once via `setBrushSnapshot` on map
   *  change and updated incrementally via `applyBrushStroke` thereafter. */
  redraw(fog: FogState): void {
    const { width, height } = this.canvas;
    this.ctx.clearRect(0, 0, width, height);

    for (const poly of fog.polygons) {
      if (poly.vertices.length < 3) continue;

      this.ctx.beginPath();
      const first = poly.vertices[0]!;
      this.ctx.moveTo(first.x * width, first.y * height);

      for (let i = 1; i < poly.vertices.length; i++) {
        const v = poly.vertices[i]!;
        this.ctx.lineTo(v.x * width, v.y * height);
      }

      this.ctx.closePath();
      this.ctx.fillStyle = poly.color;
      this.ctx.fill();
      // Stroke with same colour to eliminate the sub-pixel antialiased fringe
      this.ctx.strokeStyle = poly.color;
      this.ctx.lineWidth = 1;
      this.ctx.stroke();
    }

    // Composite the FoW brush layer on top of the polygons (brush adds to
    // the obscured area; polygon mode and brush mode stack together).
    this.ctx.drawImage(this.brushCanvas as unknown as CanvasImageSource, 0, 0);

    // Signal Three.js to re-upload the canvas to GPU on next render
    this.texture.needsUpdate = true;
  }

  /** Replace the FoW brush canvas with a decoded PNG bitmap. Called when a
   *  map loads or a full resync arrives. */
  setBrushSnapshot(bitmap: CanvasImageSource | null): void {
    const { width, height } = this.brushCanvas;
    this.brushCtx.clearRect(0, 0, width, height);
    if (bitmap) this.brushCtx.drawImage(bitmap, 0, 0, width, height);
  }

  /** Wipe the brush layer entirely — used by the FoW panel's "clear" action. */
  clearBrush(): void {
    this.brushCtx.clearRect(0, 0, this.brushCanvas.width, this.brushCanvas.height);
  }

  /** Apply a single brush stroke to the persistent brush canvas. Mode 'erase'
   *  removes alpha (FoW "reveal" path); mode 'paint' adds to the obscured
   *  area. Caller is responsible for triggering the subsequent redraw. */
  applyBrushStroke(stroke: { points: { x: number; y: number }[]; radius: number; mode: 'paint' | 'erase'; color: string }): void {
    applyStroke({ canvas: this.brushCanvas, ctx: this.brushCtx }, stroke);
  }

  /** Export the brush layer as base64 PNG (no `data:` prefix). */
  async exportBrushPng(): Promise<string | null> {
    try {
      const blob = await this.brushCanvas.convertToBlob({ type: 'image/png' });
      const buf  = await blob.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
      }
      return btoa(binary);
    } catch {
      return null;
    }
  }

  dispose(): void {
    this.texture.dispose();
  }
}
