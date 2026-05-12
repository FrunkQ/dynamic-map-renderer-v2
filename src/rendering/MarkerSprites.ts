import * as THREE from 'three';
import type { Marker } from '../types.ts';
import { drawMarkerShape, getMarkerAspect } from './MarkerLayer.ts';

/**
 * MarkerSprites — per-marker Three.js mesh group for the player + projector
 * marker layer.
 *
 * Replaces the previous design of "all markers into one shared 2048×2048
 * OffscreenCanvas". The shared-texture approach starved each marker of
 * pixel budget: a default-sized marker only got ~51 texture px, then the
 * GPU stretched that region onto whatever browser zoom / projector
 * resolution the receiver was actually displaying, and the result looked
 * like a magnified thumbnail.
 *
 * Each marker now owns its own OffscreenCanvas + THREE.CanvasTexture +
 * THREE.Mesh. Canvas size scales with the marker's `size` and the device
 * pixel ratio, so large markers automatically get more pixels and player
 * browser zoom (which moves DPR) triggers a re-render. Memory is bounded
 * per-marker rather than a fixed global cap — typical scenes use far less
 * total texture memory than the old shared texture.
 *
 * Motion overlay (return blobs, scan rings) stays in the legacy
 * MarkerTexture, which now renders motion-only.
 */

/**
 * Canvas padding factor — the canvas extends beyond the icon body so the
 * selection ring (currently GM-only), the label, and the corner badges
 * have somewhere to draw without getting cropped.
 */
const PAD_FACTOR = 1.6;

/** Canvas long-side pixel cap to avoid memory blowup at extreme size × DPR. */
const MAX_PX = 1024;
const MIN_PX = 64;
/** Base pixel density per `m.size` unit at DPR=1. size=8 fills the cap. */
const BASE_PX_PER_SIZE = 128;

interface MarkerEntry {
  mesh:     THREE.Mesh;
  texture:  THREE.CanvasTexture;
  canvas:   OffscreenCanvas;
  /** Canvas dimensions — kept rectangular so the icon's aspect is honoured
   *  without the texture needing to stretch onto a non-matching plane. */
  pxW:      number;
  pxH:      number;
  /** Hash of marker state — used to skip redraws when nothing visible changed. */
  digest:   string;
}

export class MarkerSprites {
  /** Add this to the Three.js scene; one child per visible marker. */
  readonly group: THREE.Group;
  private entries  = new Map<string, MarkerEntry>();
  private mapAspect = 1;
  private lastDpr   = 1;

  constructor() {
    this.group = new THREE.Group();
  }

  setAspectRatio(ar: number): void {
    this.mapAspect = Math.max(0.0001, ar);
  }

  /**
   * Render or update marker meshes. Removes meshes for markers that
   * vanished. Hidden markers are excluded for non-GM views. Designed to
   * be called whenever the marker list, view, or DPR changes — internal
   * digesting means stable markers don't redraw their canvas.
   */
  render(
    markers: Marker[],
    iconCache?: Map<string, ImageBitmap>,
    isGM: boolean = false,
  ): void {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const dprChanged = Math.abs(dpr - this.lastDpr) > 0.01;
    this.lastDpr = dpr;

    const seen = new Set<string>();

    for (const m of markers) {
      // Player view: skip hidden. GM view (if ever wired): show with badge.
      if (!isGM && m.hidden) continue;
      seen.add(m.id);

      const aspect = getMarkerAspect(m, iconCache);

      // World-space plane footprint. halfH_world = 0.025 × m.size matches
      // the legacy formula H × 0.025 × m.size on the aspect:1 plane. Apply
      // PAD_FACTOR so the plane covers the badges / label / selection ring,
      // not just the icon body. halfW scales with the ICON aspect so a wide
      // dragon icon renders into a wide plane (and a wide canvas, below) —
      // no texture stretching needed.
      const halfH_world = 0.025 * m.size * PAD_FACTOR;
      const halfW_world = halfH_world * aspect;
      const planeW = halfW_world * 2;
      const planeH = halfH_world * 2;

      // Canvas matches the plane aspect so texture sampling is 1:1 with no
      // horizontal stretching. The longer side is bucketed for memory
      // sanity; the shorter side falls out of aspect.
      const longPx = Math.min(MAX_PX, Math.max(
        MIN_PX,
        Math.ceil(m.size * BASE_PX_PER_SIZE * dpr),
      ));
      const canvasW = aspect >= 1
        ? longPx
        : Math.max(1, Math.round(longPx * aspect));
      const canvasH = aspect >= 1
        ? Math.max(1, Math.round(longPx / aspect))
        : longPx;

      let entry = this.entries.get(m.id);

      // Create or resize. Texture is recreated whenever canvas dims change;
      // the geometry is rebuilt whenever the plane dims change (cheap).
      if (!entry || entry.pxW !== canvasW || entry.pxH !== canvasH) {
        if (entry) this._disposeEntry(entry);
        const canvas  = new OffscreenCanvas(canvasW, canvasH);
        const texture = new THREE.CanvasTexture(canvas as unknown as HTMLCanvasElement);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter  = THREE.LinearFilter;
        const geo = new THREE.PlaneGeometry(planeW, planeH);
        const mat = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.z = 0.02;
        this.group.add(mesh);
        entry = { mesh, texture, canvas, pxW: canvasW, pxH: canvasH, digest: '' };
        this.entries.set(m.id, entry);
      } else {
        // Same canvas dims, possibly different plane size (size changed in a
        // way that didn't push us into a new pxW/H bucket).
        const g = entry.mesh.geometry as THREE.PlaneGeometry;
        const params = g.parameters;
        if (params.width !== planeW || params.height !== planeH) {
          entry.mesh.geometry.dispose();
          entry.mesh.geometry = new THREE.PlaneGeometry(planeW, planeH);
        }
      }

      const digest = [
        m.icon, m.color, m.size.toFixed(3),
        m.label ?? '', m.showLabel ? 1 : 0,
        m.hidden ? 1 : 0, m.locked ? 1 : 0,
        m.audioMuted ? 1 : 0, m.motionMuted ? 1 : 0,
        m.roles.audio ?? '', m.roles.motion ?? '',
        isGM ? 1 : 0,
        canvasW, canvasH,
      ].join('|');

      if (entry.digest !== digest || dprChanged) {
        entry.digest = digest;
        this._redraw(entry, m, isGM, iconCache);
        entry.texture.needsUpdate = true;
      }

      // Convert normalised map coords (0..1) to scene world coords.
      // Map plane is aspect × 1, centered at origin.
      const wx =  (m.position.x - 0.5) * this.mapAspect;
      const wy = -(m.position.y - 0.5);
      entry.mesh.position.set(wx, wy, 0.02);
    }

    // Cull markers that no longer exist (or became hidden on player view).
    for (const [id, entry] of this.entries) {
      if (!seen.has(id)) {
        this._disposeEntry(entry);
        this.entries.delete(id);
      }
    }
  }

  /**
   * Re-render every marker on next call regardless of digest. Call when
   * something OUTSIDE the marker model invalidates the cached canvases
   * (e.g. iconCache repopulated, theme change).
   */
  invalidateAll(): void {
    for (const entry of this.entries.values()) entry.digest = '';
  }

  dispose(): void {
    for (const entry of this.entries.values()) this._disposeEntry(entry);
    this.entries.clear();
  }

  private _disposeEntry(entry: MarkerEntry): void {
    this.group.remove(entry.mesh);
    entry.texture.dispose();
    (entry.mesh.material as THREE.Material).dispose();
    entry.mesh.geometry.dispose();
  }

  /**
   * Draw the marker centered in its own canvas. `r` is the icon-body
   * half-height in canvas pixels — driven by the canvas's shorter side
   * so a wide-aspect rectangular canvas still fits the icon comfortably
   * (PAD_FACTOR margin reserved for badges / label / ring).
   */
  private _redraw(
    entry: MarkerEntry,
    m: Marker,
    isGM: boolean,
    iconCache: Map<string, ImageBitmap> | undefined,
  ): void {
    const { canvas, pxW, pxH } = entry;
    const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, pxW, pxH);

    const shortSide = Math.min(pxW, pxH);
    const r = shortSide / (2 * PAD_FACTOR);
    // selection is always false here — selection rings only render on the
    // GM HTML canvas (MarkerLayer), never on the broadcast textures.
    drawMarkerShape(ctx, m, pxW / 2, pxH / 2, r, false, isGM, iconCache);
  }
}
