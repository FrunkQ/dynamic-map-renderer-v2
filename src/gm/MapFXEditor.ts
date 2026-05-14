/**
 * MapFXEditor (v2.12/M4) — creates and selects MapFX entities (painted areas
 * or polygons). Reuses the BrushController for paint mode and a simple
 * vertex-click flow for polygon mode.
 *
 * Lifecycle:
 *   • Mode 'off'   — pointer events ignored; markers + fog free to claim them.
 *   • Mode 'paint' — pointerdown→pointerup = one stroke = one new entity
 *                    (paint patch + anchor at the stroke's centroid).
 *   • Mode 'poly'  — clicks add vertices; click near first vertex (or hit
 *                    Done) to close + commit as a new entity.
 *
 * The active "kind" determines the default colour/radius used by paint mode.
 * The editor doesn't own state — it asks GMApp for the current kind and
 * publishes new entities back via the `onCommit` callback.
 */

import type { FogVertex, MapFXEntity, MapFXKind } from '../types.ts';
import { mapfxKind } from '../mapfx/mapfxKindRegistry.ts';
import { BrushController, type BrushSettings } from '../mapfx/BrushController.ts';
import { makeStrokeBitmap, applyStroke, exportPng, smoothPoints, strokeBounds } from '../mapfx/strokeEngine.ts';
import { generateId } from '../utils/id.ts';

export type MapFXMode = 'off' | 'paint' | 'poly';

export interface MapFXEditorHandlers {
  /** A new entity is ready to add to state + broadcast. */
  onCommit?: (entity: MapFXEntity) => void;
  /** Mode changed — UI can reflect it. */
  onModeChange?: (mode: MapFXMode) => void;
  /** Live preview points for paint mode — used by the GM to draw the
   *  in-progress stroke before the entity is committed. */
  onLivePaint?: (kind: MapFXKind, points: FogVertex[], radius: number) => void;
  /** Paint mode finished a stroke — caller should clear any live preview. */
  onLivePaintEnd?: () => void;
  /** Cursor moved over the canvas while in a MapFX mode. Caller draws the
   *  brush-size outline at the given client coords. Pass null when the
   *  cursor leaves the canvas to hide the preview. */
  onCursor?: (clientX: number | null, clientY: number | null) => void;
}

export class MapFXEditor {
  private canvas: HTMLCanvasElement;
  private mode: MapFXMode = 'off';
  private activeKind: MapFXKind = 'fire';
  private handlers: MapFXEditorHandlers = {};
  private brushController: BrushController;

  // Polygon-mode state
  private polyVertices: FogVertex[] = [];
  /** Cached last point of the in-progress paint stroke — used so each
   *  onContinue can emit a (prev, current) segment for the renderer. */
  private lastLivePoint: FogVertex | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    clientToMapNorm: (clientX: number, clientY: number) => FogVertex | null,
  ) {
    this.canvas = canvas;
    this.brushController = new BrushController(clientToMapNorm);
    this.brushController.setHandlers({
      onStart: (p, s) => {
        // Live preview — single point disc.
        this.handlers.onLivePaint?.(this.activeKind, [p], s.radius);
      },
      onContinue: (p, s) => {
        // Append a fresh segment so the renderer can extend the live stroke
        // without re-painting prior points. Passing two points (prev, current)
        // makes the rasteriser stroke a line between them with a rounded cap
        // at each end — bridges any inter-frame gaps cleanly.
        const prev = this.lastLivePoint ?? p;
        this.lastLivePoint = p;
        this.handlers.onLivePaint?.(this.activeKind, [prev, p], s.radius);
      },
      onEnd: (points, settings) => {
        this.lastLivePoint = null;
        void this._commitPaintStroke(points, settings);
        this.handlers.onLivePaintEnd?.();
      },
    });

    this._bindEvents();
  }

  setHandlers(h: MapFXEditorHandlers): void {
    this.handlers = h;
  }

  setMode(mode: MapFXMode): void {
    if (this.mode === mode) return;
    // Cancel anything in flight on the way out.
    if (this.mode === 'paint') this.brushController.cancel();
    if (this.mode === 'poly')  this.polyVertices = [];
    this.mode = mode;
    this.canvas.classList.toggle('mapfx-paint', mode === 'paint');
    this.canvas.classList.toggle('mapfx-poly',  mode === 'poly');
    this.handlers.onModeChange?.(mode);
  }

  getMode(): MapFXMode { return this.mode; }

  setActiveKind(kind: MapFXKind): void {
    this.activeKind = kind;
    // Push the kind's defaults into the brush controller so paint mode
    // picks up colour + radius automatically.
    const k = mapfxKind(kind);
    this.brushController.setSettings({ color: k.defaultColor, radius: k.defaultRadius, mode: 'paint' });
  }
  getActiveKind(): MapFXKind { return this.activeKind; }

  setBrushSize(radius: number): void {
    this.brushController.setSettings({ radius });
  }

  /** Polygon-mode click — adds a vertex, or commits if near the first one. */
  polyClick(p: FogVertex): void {
    if (this.mode !== 'poly') return;
    if (this.polyVertices.length >= 3) {
      const first = this.polyVertices[0]!;
      const d = Math.hypot(p.x - first.x, p.y - first.y);
      if (d < 0.025) { this._commitPolygon(); return; }
    }
    this.polyVertices.push(p);
  }

  /** Force-commit the current polygon (Done button). */
  finishPolygon(): void { this._commitPolygon(); }

  /** Discard the in-progress polygon (Esc). */
  cancelPolygon(): void { this.polyVertices = []; }

  /** Current in-progress polygon vertices — UI uses this to preview the
   *  shape as the user clicks. */
  getPolyPreview(): FogVertex[] { return this.polyVertices.slice(); }

  // ─── Private ──────────────────────────────────────────────────────────────

  private _bindEvents(): void {
    // stopPropagation prevents the canvas-wrapper's drag-pan from running
    // simultaneously with the brush stroke (without it, mouse drags during
    // paint also scrolled the camera).
    this.canvas.addEventListener('pointerdown', (e) => {
      if (this.mode === 'off') return;
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (this.mode === 'paint') {
        e.preventDefault();
        e.stopPropagation();
        try { this.canvas.setPointerCapture(e.pointerId); } catch { /* ok */ }
        this.brushController.begin(e.clientX, e.clientY);
      } else if (this.mode === 'poly') {
        e.stopPropagation();
      }
      // Polygon clicks (vertex placement) are still handled via the 'click'
      // event below so single-taps register cleanly.
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.mode === 'off') return;
      if (this.mode === 'paint' && this.brushController.isActive()) {
        e.stopPropagation();
        this.brushController.continue(e.clientX, e.clientY);
      }
      // Live cursor outline (drawn by the GMApp via handlers.onCursor).
      this.handlers.onCursor?.(e.clientX, e.clientY);
    });
    this.canvas.addEventListener('pointerleave', () => {
      if (this.mode === 'off') return;
      this.handlers.onCursor?.(null, null);
    });
    const endPaint = (e: PointerEvent) => {
      if (this.mode !== 'paint') return;
      try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* ok */ }
      e.stopPropagation();
      this.brushController.end();
    };
    this.canvas.addEventListener('pointerup',     endPaint);
    this.canvas.addEventListener('pointercancel', endPaint);
  }

  private async _commitPaintStroke(points: FogVertex[], settings: BrushSettings): Promise<void> {
    if (points.length === 0) return;
    // Map the stroke to a patch sized to its bbox.
    const padded = strokeBounds(points, settings.radius);
    const w = Math.max(64, Math.round(padded.w * 1024));
    const h = Math.max(64, Math.round(padded.h * 1024));
    const bm = makeStrokeBitmap(w, h);

    // Translate stroke points into the patch's local 0..1 space.
    const localPoints = points.map((p) => ({
      x: padded.w > 0 ? (p.x - padded.x) / padded.w : 0.5,
      y: padded.h > 0 ? (p.y - padded.y) / padded.h : 0.5,
    }));
    // Smooth once more so the patch reads cleanly.
    const smoothed = smoothPoints(localPoints, 1);
    applyStroke(bm, {
      points: smoothed,
      // Convert radius from "fraction of map width" to "fraction of patch
      // width" so the rasteriser draws the right size relative to the patch.
      radius: padded.w > 0 ? settings.radius / padded.w : settings.radius,
      mode:   settings.mode,
      color:  settings.color,
    });
    const png = await exportPng(bm);

    // Centroid of the stroke = anchor for the selector icon.
    const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
    const cy = points.reduce((s, p) => s + p.y, 0) / points.length;

    const entity: MapFXEntity = {
      id:        generateId(),
      kind:      this.activeKind,
      paint:     { png, bounds: padded },
      anchor:    { x: cx, y: cy },
      createdAt: Date.now(),
    };
    this.handlers.onCommit?.(entity);
  }

  private _commitPolygon(): void {
    if (this.polyVertices.length < 3) return;
    const cx = this.polyVertices.reduce((s, p) => s + p.x, 0) / this.polyVertices.length;
    const cy = this.polyVertices.reduce((s, p) => s + p.y, 0) / this.polyVertices.length;
    const entity: MapFXEntity = {
      id:        generateId(),
      kind:      this.activeKind,
      vertices:  this.polyVertices.slice(),
      anchor:    { x: cx, y: cy },
      createdAt: Date.now(),
    };
    this.polyVertices = [];
    this.handlers.onCommit?.(entity);
  }
}
