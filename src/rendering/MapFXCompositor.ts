import * as THREE from 'three';
import type { MapFXEntity, FogVertex } from '../types.ts';
import { mapfxKind } from '../mapfx/mapfxKindRegistry.ts';
import { applyStroke } from '../mapfx/strokeEngine.ts';

/**
 * MapFXCompositor (v2.12/M4) — sibling to FogCompositor. Maintains an
 * OffscreenCanvas representing the painted MapFX layer for the active map.
 * Each entity is drawn:
 *
 *   • Polygon mode → filled with the kind's colour
 *   • Paint mode   → its base64 PNG patch is decoded and drawn at the
 *                    entity's recorded bounds, then tinted with the kind
 *                    colour via globalCompositeOperation
 *
 * Unselected entities render at low opacity (~30%) so they sit calmly under
 * the map; selecting one pops it back to full opacity. The pulse / flicker
 * effects for animated kinds (fire, smoke, electric, fear) get layered as
 * additional shader passes in a follow-up — first cut is static raster.
 */
export class MapFXCompositor {
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;

  /** Decoded paint PNGs cached by entity.id so we don't re-decode each
   *  frame. Cleared on full state push or entity removal. */
  private patchCache = new Map<string, ImageBitmap>();

  constructor(width = 1024, height = 1024) {
    this.canvas = new OffscreenCanvas(width, height);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('MapFXCompositor: 2D context unavailable');
    this.ctx = ctx;
    this.texture = new THREE.CanvasTexture(this.canvas as unknown as HTMLCanvasElement);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.needsUpdate = true;
  }

  /** Discard cached patches for entities no longer in state, and schedule
   *  decode for any entities whose patches we haven't loaded yet. */
  async syncPatches(entities: MapFXEntity[]): Promise<void> {
    const seen = new Set<string>();
    for (const e of entities) {
      seen.add(e.id);
      if (e.paint && !this.patchCache.has(e.id)) {
        try {
          const bmp = await decodePng(e.paint.png);
          this.patchCache.set(e.id, bmp);
        } catch { /* malformed — skip */ }
      }
    }
    for (const cached of this.patchCache.keys()) {
      if (!seen.has(cached)) this.patchCache.delete(cached);
    }
  }

  /** Composite all entities to the canvas + flag the texture for upload. */
  redraw(entities: MapFXEntity[], selectedId: string | null): void {
    const { ctx, canvas } = this;
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    // Sort by createdAt so newer entities render on top (matches the GM's
    // intuition that "the thing I just painted is on top").
    const sorted = entities.slice().sort((a, b) => a.createdAt - b.createdAt);

    for (const e of sorted) {
      const kind = mapfxKind(e.kind);
      const selected = e.id === selectedId;
      const opacity = selected ? 1.0 : 0.3;

      ctx.save();
      ctx.globalAlpha = opacity;
      // Each kind picks its own blend mode so the layer composites naturally
      // (screen for light/fire, multiply for shadow, normal otherwise).
      switch (kind.blend) {
        case 'screen':   ctx.globalCompositeOperation = 'screen';   break;
        case 'multiply': ctx.globalCompositeOperation = 'multiply'; break;
        default:         ctx.globalCompositeOperation = 'source-over';
      }

      if (e.vertices && e.vertices.length >= 3) {
        ctx.fillStyle = kind.defaultColor;
        ctx.beginPath();
        const v0 = e.vertices[0]!;
        ctx.moveTo(v0.x * width, v0.y * height);
        for (let i = 1; i < e.vertices.length; i++) {
          const v = e.vertices[i]!;
          ctx.lineTo(v.x * width, v.y * height);
        }
        ctx.closePath();
        ctx.fill();
      } else if (e.paint) {
        const bmp = this.patchCache.get(e.id);
        if (bmp) {
          const b = e.paint.bounds;
          // Draw the cached patch at its recorded bounds. The patch already
          // carries the kind colour in its pixels (the GM painted with the
          // kind's colour); the kind's blend mode handles compositing.
          ctx.drawImage(bmp, b.x * width, b.y * height, b.w * width, b.h * height);
        }
      }
      ctx.restore();
    }

    this.texture.needsUpdate = true;
  }

  /** Wipe the compositor — used on map_change before the new state lands. */
  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.patchCache.clear();
    this.texture.needsUpdate = true;
  }

  /** Paint a live in-progress stroke directly onto the compositor canvas
   *  for instant feedback while the GM is dragging. The next `redraw` call
   *  will replace this with the committed entity's cached patch — strokes
   *  are short enough that the swap is invisible. */
  applyLiveStroke(stroke: { points: FogVertex[]; radius: number; mode: 'paint' | 'erase'; color: string }): void {
    applyStroke({ canvas: this.canvas, ctx: this.ctx }, stroke);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.patchCache.clear();
  }
}

function decodePng(base64Png: string): Promise<ImageBitmap> {
  const url = base64Png.startsWith('data:') ? base64Png : `data:image/png;base64,${base64Png}`;
  return fetch(url).then((r) => r.blob()).then(createImageBitmap);
}
