import * as THREE from 'three';
import type { FogState, FogPolygon } from '../types.ts';
import { overlayKind } from '../mapfx/overlayKindRegistry.ts';

/**
 * FogCompositor — v2.12 unified overlay system.
 *
 * Renders a single texture for ALL overlay polygons (fog, fire, water,
 * smoke, light, blood, …). One per-kind branch in the draw loop handles
 * fill / blend / animation differences; everything else (texture lifecycle,
 * UV mapping, Three integration) is shared.
 *
 * Each polygon is filled with its own colour (or its kind's default), with
 * the kind's blend mode. Polygons sort by `kind.z` so fog renders on top
 * of MapFX effects beneath, and within the same z by `createdAt` so newer
 * paint covers older paint of the same kind.
 *
 * Animation: when any visible polygon has kind.animated = true, the
 * Renderer's animation loop calls `tickAnimation(time)` so the opacity
 * wobble can drive a per-frame redraw.
 */
export class FogCompositor {
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;

  /** Last polygon list passed to redraw — kept so tickAnimation can
   *  re-composite without the caller re-passing it. */
  private lastPolygons: FogPolygon[] = [];

  constructor(width = 1024, height = 1024) {
    this.canvas = new OffscreenCanvas(width, height);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('FogCompositor: OffscreenCanvas 2D context unavailable');
    this.ctx = ctx;
    this.texture = new THREE.CanvasTexture(this.canvas as unknown as HTMLCanvasElement);
    // Canvas 2D draws in sRGB. Tag the texture so Three decodes to linear
    // before render; OutputPass re-encodes to sRGB on the way out and the
    // GM's picked colours land exactly as picked.
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.needsUpdate = true;
  }

  /** Re-composite the overlay layer from the current state. Optional `time`
   *  parameter drives animated kinds; pass 0 for static composites.
   *  `includeShaderKinds = true` makes shader-driven kinds render as flat
   *  fills here too — the GM view uses this so they don't have to look
   *  at the player's animated effects while editing. */
  redraw(fog: FogState, time: number = 0, includeShaderKinds: boolean = false): void {
    this.lastPolygons = fog.polygons;
    const { width, height } = this.canvas;
    this.ctx.clearRect(0, 0, width, height);

    // Stable z + createdAt sort so the same polygon list always paints the
    // same picture (sort key is total ordering — no flicker between frames).
    const sorted = fog.polygons.slice().sort((a, b) => {
      const za = overlayKind(a.kind).z;
      const zb = overlayKind(b.kind).z;
      if (za !== zb) return za - zb;
      return a.createdAt - b.createdAt;
    });

    for (const poly of sorted) {
      if (poly.vertices.length < 3) continue;
      const kind = overlayKind(poly.kind);
      // Shader-driven kinds render via their own Three.js plane + custom
      // GLSL on the player/projector. The GM view passes
      // includeShaderKinds=true so those kinds render as flat fills here
      // instead — the GM gets a simple, perf-friendly view while editing.
      if (kind.shader && !includeShaderKinds) continue;

      // Per-kind blend mode.
      this.ctx.save();
      switch (kind.blend) {
        case 'screen':   this.ctx.globalCompositeOperation = 'screen';   break;
        case 'multiply': this.ctx.globalCompositeOperation = 'multiply'; break;
        default:         this.ctx.globalCompositeOperation = 'source-over';
      }

      // Animated kinds: small opacity wobble. Phase from id hash so siblings
      // don't pulse in lockstep. Idle (time = 0) skips the wobble entirely.
      let alpha = 1.0;
      if (kind.animated && time > 0) {
        const phase = _hashIdToPhase(poly.id);
        // GM-side flat-fill wobble (player view uses the proper shader).
        // Per-kind speed so fire flickers faster than river ripples.
        let wobble: number;
        if      (kind.id === 'fire')         wobble = Math.sin(time *  8.0 + phase) * 0.30 + Math.sin(time * 17.0 + phase * 1.7) * 0.15;
        else if (kind.id === 'river')        wobble = Math.sin(time *  3.0 + phase) * 0.18;
        else if (kind.id === 'ocean')        wobble = Math.sin(time *  2.5 + phase) * 0.20;
        else if (kind.id === 'light')        wobble = Math.sin(time *  4.0 + phase) * 0.22;
        else if (kind.id === 'portal')       wobble = Math.sin(time *  5.0 + phase) * 0.25;
        else if (kind.id === 'starfield')    wobble = Math.sin(time *  1.2 + phase) * 0.12;
        else if (kind.id === 'thundercloud') wobble = Math.sin(time *  2.8 + phase) * 0.20 + Math.sin(time *  6.1 + phase * 1.4) * 0.10;
        else if (kind.id === 'mist')         wobble = Math.sin(time *  1.5 + phase) * 0.16;
        else                                 wobble = Math.sin(time *  3.5 + phase) * 0.18;
        alpha = Math.max(0.55, Math.min(1.0, 1.0 + wobble * 0.25));
      }
      this.ctx.globalAlpha = alpha;

      const fill = poly.color || kind.defaultColor;
      this.ctx.fillStyle   = fill;
      this.ctx.strokeStyle = fill;
      this.ctx.lineWidth   = 1;

      // Path = outer ring + every hole as its own subpath. fill('evenodd')
      // punches the holes out of the fill; stroke draws every subpath so
      // the holes outline too.
      this.ctx.beginPath();
      const v0 = poly.vertices[0]!;
      this.ctx.moveTo(v0.x * width, v0.y * height);
      for (let i = 1; i < poly.vertices.length; i++) {
        const v = poly.vertices[i]!;
        this.ctx.lineTo(v.x * width, v.y * height);
      }
      this.ctx.closePath();
      if (poly.holes) {
        for (const hole of poly.holes) {
          if (hole.length < 3) continue;
          const h0 = hole[0]!;
          this.ctx.moveTo(h0.x * width, h0.y * height);
          for (let i = 1; i < hole.length; i++) {
            const h = hole[i]!;
            this.ctx.lineTo(h.x * width, h.y * height);
          }
          this.ctx.closePath();
        }
      }
      this.ctx.fill('evenodd');
      this.ctx.stroke();
      this.ctx.restore();
    }

    this.texture.needsUpdate = true;
  }

  /** True if the current polygon set contains any animated kinds. The
   *  Renderer uses this to decide whether to run a per-frame redraw. */
  hasAnimatedPolygons(): boolean {
    for (const p of this.lastPolygons) {
      if (overlayKind(p.kind).animated) return true;
    }
    return false;
  }

  /** Per-frame redraw with a fresh time value. Cheap relative to the
   *  rasterise cost on map-load because no PNG decoding is involved —
   *  it's all polygon path ops. */
  tickAnimation(time: number): void {
    if (this.lastPolygons.length === 0) return;
    this.redraw({ polygons: this.lastPolygons }, time);
  }

  dispose(): void {
    this.texture.dispose();
  }
}

/** Stable id → phase in 0..2π so animated polygons don't pulse in sync. */
function _hashIdToPhase(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) / 0xffffffff) * Math.PI * 2;
}
