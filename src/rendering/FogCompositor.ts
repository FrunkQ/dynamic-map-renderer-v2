import * as THREE from 'three';
import type { FogState } from '../types.ts';

/**
 * FogCompositor
 *
 * Maintains an OffscreenCanvas that represents the fog-of-war layer.
 * Drawn polygons are opaque (in their declared colour); everything else is transparent.
 * The result is a Three.js CanvasTexture applied to the fog mesh plane.
 *
 * On fog change: re-draws the canvas and marks the texture for GPU upload.
 * On map change: resizes the canvas to match the new map dimensions.
 */
export class FogCompositor {
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;

  constructor(width = 1024, height = 1024) {
    this.canvas = new OffscreenCanvas(width, height);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('FogCompositor: OffscreenCanvas 2D context unavailable');
    this.ctx = ctx;
    this.texture = new THREE.CanvasTexture(this.canvas as unknown as HTMLCanvasElement);
    // Canvas 2D always draws in sRGB.  Marking the texture SRGBColorSpace tells
    // Three.js to decode it to linear before rendering, so OutputPass can
    // re-encode to sRGB on the way out — preserving the exact picked colour.
    // Without this, the raw sRGB value is treated as linear and OutputPass
    // over-brightens it (e.g. #CBCBCB → #E6E6E6).
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.needsUpdate = true;
  }

  /** Re-composite the fog layer from the current state */
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

    // Signal Three.js to re-upload the canvas to GPU on next render
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
