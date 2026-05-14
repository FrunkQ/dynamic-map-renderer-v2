import type { FogPolygon, FogState, FogVertex, OverlayKind } from '../types.ts';
import { generateId } from '../utils/id.ts';
import type { Renderer } from '../rendering/Renderer.ts';
import { BrushController, type BrushSettings } from '../mapfx/BrushController.ts';
import { offsetPolyline } from '../mapfx/polylineOffset.ts';
import { cleanRibbonToBlobs } from '../mapfx/polygonOps.ts';

export interface FogEditorMode {
  drawing: boolean;
  hasSelection: boolean;
  hasPolygons: boolean;
  /** v2.12/M3 — true when the FoW brush is active (polygon draw is off). */
  brushing?: boolean;
}

type FogChangeCallback = (fog: FogState) => void;
type ModeChangeCallback = (mode: FogEditorMode) => void;

/** Live brush callback — fires per point during the stroke so the GM
 *  renderer can paint in real time. End-of-stroke is reported separately
 *  via `setBrushEndHandler` so the GM can broadcast + persist a single
 *  consolidated delta. */
export interface FogBrushLiveHandler {
  (settings: BrushSettings, points: FogVertex[]): void;
}
export interface FogBrushEndHandler {
  (settings: BrushSettings, points: FogVertex[]): void;
}

/** v2.12 — Polygon mode now supports a paint/erase action like brush.
 *  The action is set by the GM via setPolygonAction() before vertex-click
 *  begins; on close, FogEditor fires this handler (instead of mutating
 *  its own polygons list + emitting). GMApp interprets the vertices
 *  according to the action — paint adds a polygon, erase carves via
 *  polygon-difference. */
export interface FogPolygonCompleteHandler {
  (action: 'paint' | 'erase', vertices: FogVertex[]): void;
}

export class FogEditor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private onChange: FogChangeCallback;
  private onModeChangeFn: ModeChangeCallback | null = null;

  private polygons: FogPolygon[] = [];
  private currentVertices: FogVertex[] = [];
  private selectedId: string | null = null;
  private activeColor = '#000000';
  /** v2.12 — kind tagged on new polygon-mode polygons. */
  private activeKind: OverlayKind = 'fog';
  /** v2.12 — action for the next polygon close: paint adds, erase carves. */
  private polygonAction: 'paint' | 'erase' = 'paint';
  /** v2.12 — caller (GMApp) handles the polygon close; FogEditor doesn't
   *  mutate its own polygons list directly anymore. */
  private polygonCompleteHandler: FogPolygonCompleteHandler | null = null;
  private enabled = false;

  private lastPointer: { x: number; y: number } | null = null;

  private drawW = 1;
  private drawH = 1;
  private mapAspect = 1;
  /**
   * Optional Renderer reference — when set, getMapBounds + canvasPxToMapNorm
   * route their math through the live camera (worldToScreen / screenToWorld)
   * so the fog overlay tracks GM workspace pan/zoom. Identity transform
   * matches the original letterbox math, so existing behaviour is preserved
   * for any caller that never wires a renderer.
   */
  private renderer: Renderer | null = null;

  private dashOffset = 0;
  private marchAnimId: number | null = null;
  private cursorPos: FogVertex | null = null;
  /** GM-canvas-only crosshatch pattern. Lazy-built on first use; reused
   *  across all polygon fills so the GM can see shapes regardless of
   *  the fog colour (e.g. when fog colour matches map background). */
  private hatchPattern: CanvasPattern | null = null;

  /** Screen-space delete handle — red trashcan that pops up at the bottom-
   *  left-most vertex of the selected polygon. Lives in the marker-overlay
   *  layer so it stacks above the fog canvas; managed entirely from here
   *  so position tracks selection + camera (FogEditor.redraw is called on
   *  every camera change via GMApp). Null until setOverlayHost wires a host. */
  private deleteHandleEl: HTMLButtonElement | null = null;

  /** v2.12/M3 — FoW brush mode. When `brushActive` is true, polygon draw
   *  + selection are suspended and pointer events route into the
   *  BrushController which produces strokes. */
  private brushActive = false;
  private brushController: BrushController;
  private brushLive: FogBrushLiveHandler | null = null;
  private brushEnd:  FogBrushEndHandler  | null = null;
  /** Latest cursor position in map-norm coords for the brush-size outline. */
  private brushCursor: FogVertex | null = null;
  /** Points being collected during an in-progress brush drag, in map-norm
   *  coords. Empty between strokes. Rendered as a dashed offset-polygon
   *  outline so the user sees the shape they're laying down. */
  private brushDragPoints: FogVertex[] = [];
  /** External brush preview (e.g. MapFX). When set, the cursor outline
   *  renders with these settings instead of FogEditor's own brush. Allows
   *  the fog canvas to host the preview for ANY brush-using editor. */
  private externalBrushPreview: { pos: FogVertex | null; radius: number; color: string; mode: 'paint' | 'erase' } | null = null;

  constructor(canvas: HTMLCanvasElement, onChange: FogChangeCallback) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('FogEditor: canvas 2D context unavailable');
    this.ctx = ctx;
    this.onChange = onChange;

    this.brushController = new BrushController((cx, cy) => this._clientToMapNorm(cx, cy));
    this.brushController.setHandlers({
      onStart: (p, s) => {
        this.brushDragPoints = [p];
        this.brushLive?.(s, [p]);
        this.redraw();
      },
      onContinue: (p, s) => {
        this.brushDragPoints.push(p);
        this.brushLive?.(s, [p]);
        this.redraw();
      },
      onEnd: (pts, s) => {
        this.brushDragPoints = [];
        this.brushEnd?.(s, pts);
        this.redraw();
      },
    });

    this.syncSize();
    this.bindEvents();
    window.addEventListener('resize', () => { this.syncSize(); this.redraw(); });
  }

  /** Wire the live-stroke + end-stroke handlers. GMApp passes:
   *   • live: paint each new point into the renderer for instant feedback
   *   • end: broadcast the final smoothed stroke + persist the snapshot */
  setBrushHandlers(live: FogBrushLiveHandler, end: FogBrushEndHandler): void {
    this.brushLive = live;
    this.brushEnd  = end;
  }

  /** Toggle FoW brush mode. When `on`, polygon draw is suspended; pointer
   *  events on the fog canvas route into the brush controller. */
  setBrushActive(on: boolean): void {
    if (this.brushActive === on) return;
    this.brushActive = on;
    if (on) {
      // Brush takes the canvas — suspend polygon draw + selection.
      this.enabled = false;
      this.setSelection(null);
      this.canvas.classList.add('fog-active', 'fog-brush');
      this.canvas.classList.remove('fog-draw');
    } else {
      this.brushController.cancel();
      this.canvas.classList.remove('fog-brush');
    }
    this.redraw();
    this.emitMode();
  }

  setBrushSettings(patch: Partial<BrushSettings>): void {
    this.brushController.setSettings(patch);
  }

  getBrushSettings(): BrushSettings {
    return this.brushController.getSettings();
  }

  /** Convert a client (clientX, clientY) into map-norm coords. Mirrors the
   *  eventToNorm path but routed through getBoundingClientRect / renderer
   *  camera the same way. */
  private _clientToMapNorm(cx: number, cy: number): FogVertex | null {
    const rect = this.canvas.getBoundingClientRect();
    return this.canvasPxToMapNorm(cx - rect.left, cy - rect.top, rect.width, rect.height);
  }

  setOnModeChange(fn: ModeChangeCallback): void {
    this.onModeChangeFn = fn;
  }

  enable(): void {
    this.enabled = true;
    this.setSelection(null);
    this.canvas.classList.add('fog-active', 'fog-draw');
    this.redraw();
    this.emitMode();
  }

  disable(): void {
    this.enabled = false;
    this.canvas.classList.add('fog-active');
    this.canvas.classList.remove('fog-draw');
    this.redraw();
    this.emitMode();
  }

  deactivate(): void {
    this.enabled = false;
    this.canvas.classList.remove('fog-active', 'fog-draw');
    this.redraw();
    this.emitMode();
  }

  setColor(color: string): void {
    this.activeColor = color;
  }

  /** v2.12 — what kind to tag on new polygon-mode polygons. */
  setActiveKind(kind: OverlayKind): void {
    this.activeKind = kind;
  }

  /** v2.12 — set the action a polygon close should produce. Paint adds a
   *  new polygon; erase carves via polygon-difference. */
  setPolygonAction(action: 'paint' | 'erase'): void {
    this.polygonAction = action;
  }

  /** v2.12 — caller (GMApp) commits the polygon. If unset, FogEditor falls
   *  back to its legacy "push to local polygons + emit" behaviour for
   *  backward compat. */
  setPolygonCompleteHandler(handler: FogPolygonCompleteHandler | null): void {
    this.polygonCompleteHandler = handler;
  }

  setMapAspect(ratio: number): void {
    this.mapAspect = ratio;
    this.redraw();
  }

  /** Wire a Renderer so coord conversions ride the live camera transform. */
  setRenderer(renderer: Renderer): void {
    this.renderer = renderer;
  }

  /**
   * Mount a per-selection delete handle inside the given screen-space host
   * (typically the marker-overlay element). The handle pops up at the
   * polygon's lowest-leftest vertex while selected, mirroring the marker /
   * text-map editor delete affordance so the selection chrome stays
   * consistent across all three editors. Idempotent — calling again with
   * a different host moves the element.
   */
  setOverlayHost(host: HTMLElement): void {
    if (!this.deleteHandleEl) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'fog-delete-handle';
      btn.title = 'Delete this fog area';
      btn.hidden = true;
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 6h18"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          <line x1="10" y1="11" x2="10" y2="17"/>
          <line x1="14" y1="11" x2="14" y2="17"/>
        </svg>
      `;
      btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteSelected();
      });
      this.deleteHandleEl = btn;
    }
    host.appendChild(this.deleteHandleEl);
  }

  loadState(fog: FogState): void {
    this.polygons = fog.polygons.map((p) => ({ ...p, vertices: [...p.vertices] }));
    this.currentVertices = [];
    this.setSelection(null);
    this.updateMarchState();
    this.redraw();
    this.emitMode();
  }

  /** Lighter alternative to loadState — refresh the polygon list without
   *  wiping in-progress draw / selection state. Used when external code
   *  (e.g. GMApp brush commit) mutates state.fog and FogEditor needs to
   *  pick up the new polygons for marching ants + interior-click selection.
   *  Selection survives if the selected id is still in the new list. */
  syncPolygons(polygons: FogPolygon[]): void {
    this.polygons = polygons.map((p) => ({ ...p, vertices: [...p.vertices] }));
    if (this.selectedId && !this.polygons.some((p) => p.id === this.selectedId)) {
      this.setSelection(null);
    }
    this.updateMarchState();
    this.redraw();
    this.emitMode();
  }

  /**
   * Public entry point for fog polygon selection — called by MarkerEditor when a
   * click misses all markers, so both layers share the same pointer stream.
   */
  trySelectAt(pos: { x: number; y: number }): void {
    if (!this.enabled) this.trySelect(pos);
  }

  deleteSelected(): void {
    if (!this.selectedId) return;
    this.polygons = this.polygons.filter((p) => p.id !== this.selectedId);
    this.setSelection(null);
    this.updateMarchState();
    this.redraw();
    this.emit();
    this.emitMode();
  }

  cancelCurrent(): void {
    this.currentVertices = [];
    this.updateMarchState();
    this.redraw();
  }

  clearAll(): void {
    this.polygons = [];
    this.currentVertices = [];
    this.setSelection(null);
    this.updateMarchState();
    this.redraw();
    this.emit();
    this.emitMode();
  }

  getSelectedId(): string | null {
    return this.selectedId;
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private emitMode(): void {
    this.onModeChangeFn?.({
      drawing: this.enabled,
      hasSelection: this.selectedId !== null,
      hasPolygons: this.polygons.length > 0,
      brushing: this.brushActive,
    });
  }

  private updateMarchState(): void {
    if (this.polygons.length > 0 || this.currentVertices.length > 0) {
      this.startMarch();
    } else {
      this.stopMarch();
    }
  }

  private bindEvents(): void {
    this.canvas.addEventListener('click',       (e) => {
      if (this.brushActive) return; // brush owns the canvas — no polygon taps
      this.handlePointerTap(this.eventToNorm(e));
    });
    this.canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); this.cancelCurrent(); });

    this.canvas.addEventListener('mousemove', (e) => {
      if (this.enabled) {
        this.cursorPos = this.eventToNorm(e);
      }
    });
    this.canvas.addEventListener('mouseleave', () => { this.cursorPos = null; });

    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.touches[0];
      if (t) this.lastPointer = this.touchToNorm(t);
    }, { passive: false });

    this.canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (this.brushActive) return; // brush ignores tap-to-add-poly
      const t = e.changedTouches[0];
      if (t) {
        const pos = this.touchToNorm(t);
        if (this.lastPointer) {
          const dx = pos.x - this.lastPointer.x;
          const dy = pos.y - this.lastPointer.y;
          if (Math.sqrt(dx * dx + dy * dy) < 0.02) {
            this.handlePointerTap(pos);
          }
        }
      }
    }, { passive: false });

    // v2.12/M3 — Pointer events for brush mode. Captured here so the same
    // fog canvas hosts both polygon clicks (when brush off) and stroke
    // painting (when brush on). pointerdown→pointerup spans the whole stroke;
    // pointer capture keeps us receiving events even if the cursor leaves
    // the canvas mid-stroke.
    // stopPropagation prevents the canvas-wrapper's drag-pan handler from
    // firing simultaneously — without it, mouse drags during a brush stroke
    // also scrolled the camera, which made painting unusable.
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.brushActive) return;
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      e.stopPropagation();
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not supported */ }
      this.brushController.begin(e.clientX, e.clientY);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.brushActive) return;
      // Track cursor for the brush-size outline (drawn in redraw).
      this.brushCursor = this._clientToMapNorm(e.clientX, e.clientY);
      this.redraw();
      if (this.brushController.isActive()) {
        e.stopPropagation();
        this.brushController.continue(e.clientX, e.clientY);
      }
    });
    this.canvas.addEventListener('pointerleave', () => {
      // Hide the brush cursor outline when the pointer leaves the canvas.
      if (this.brushActive) { this.brushCursor = null; this.redraw(); }
    });
    const endBrush = (e: PointerEvent) => {
      if (!this.brushActive) return;
      try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* ok */ }
      e.stopPropagation();
      this.brushController.end();
    };
    this.canvas.addEventListener('pointerup',     endBrush);
    this.canvas.addEventListener('pointercancel', endBrush);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.cancelCurrent();
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedId) {
        this.deleteSelected();
      }
    });
  }

  private handlePointerTap(pos: FogVertex): void {
    if (!this.enabled) {
      this.trySelect(pos);
      return;
    }

    if (this.currentVertices.length >= 3) {
      const first = this.currentVertices[0]!;
      const dx = pos.x - first.x;
      const dy = pos.y - first.y;
      if (Math.sqrt(dx * dx + dy * dy) < 0.025) {
        this.closePolygon();
        return;
      }
    }

    this.currentVertices.push(pos);
    if (this.currentVertices.length === 1) this.updateMarchState();
    this.redraw();
  }

  private closePolygon(): void {
    if (this.currentVertices.length < 3) return;
    const vertices = [...this.currentVertices];
    this.currentVertices = [];
    if (this.polygonCompleteHandler) {
      // GMApp interprets the vertices according to the current action —
      // paint adds, erase carves. State sync brings the new polygons back
      // into FogEditor.polygons via syncPolygons.
      this.polygonCompleteHandler(this.polygonAction, vertices);
    } else {
      // Legacy fallback: push directly to local polygons + emit.
      const poly: FogPolygon = {
        id:        generateId(),
        kind:      this.activeKind,
        vertices,
        color:     this.activeColor,
        createdAt: Date.now(),
      };
      this.polygons.push(poly);
      this.setSelection(poly.id);
      this.updateMarchState();
      this.emit();
    }
    // Auto-exit draw mode — disable() redraws and emits the updated mode,
    // so the action button deactivates and selection is restored.
    this.disable();
  }

  private trySelect(pos: FogVertex): void {
    // Interior hit test — a point is "in" a polygon if it's inside the
    // outer ring AND not inside any of its holes.
    for (let i = this.polygons.length - 1; i >= 0; i--) {
      const poly = this.polygons[i]!;
      if (!this.pointInPolygon(pos, poly.vertices)) continue;
      let inHole = false;
      if (poly.holes) {
        for (const h of poly.holes) {
          if (this.pointInPolygon(pos, h)) { inHole = true; break; }
        }
      }
      if (inHole) continue;
      this.setSelection(poly.id);
      this.redraw();
      this.emitMode();
      return;
    }

    this.setSelection(null);
    this.redraw();
    this.emitMode();
  }

  private setSelection(id: string | null): void {
    this.selectedId = id;
    // Do not call emitMode here — callers handle that after any additional work
  }

  private startMarch(): void {
    if (this.marchAnimId !== null) return;
    const tick = () => {
      this.dashOffset = (this.dashOffset + 0.4) % 16;
      this.redraw();
      this.marchAnimId = requestAnimationFrame(tick);
    };
    this.marchAnimId = requestAnimationFrame(tick);
  }

  private stopMarch(): void {
    if (this.marchAnimId !== null) {
      cancelAnimationFrame(this.marchAnimId);
      this.marchAnimId = null;
    }
    this.dashOffset = 0;
  }

  private pointInPolygon(point: FogVertex, vertices: FogVertex[]): boolean {
    let inside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
      const vi = vertices[i]!;
      const vj = vertices[j]!;
      if (
        ((vi.y > point.y) !== (vj.y > point.y)) &&
        point.x < ((vj.x - vi.x) * (point.y - vi.y)) / (vj.y - vi.y) + vi.x
      ) {
        inside = !inside;
      }
    }
    return inside;
  }


  private syncSize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    this.drawW = w;
    this.drawH = h;
    this.canvas.width  = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  redraw(): void {
    this.ctx.clearRect(0, 0, this.drawW, this.drawH);

    for (const poly of this.polygons) {
      // Polygons now carry a kind; fall back to activeColor when the
      // colour override isn't set (keeps backward compat with pre-kind
      // saves migrated forward).
      const colour = poly.color ?? this.activeColor;
      this.drawPolygon(poly.vertices, colour, poly.id === this.selectedId, poly.holes);
    }

    if (this.currentVertices.length > 0) {
      this.drawInProgress(this.currentVertices);
    }

    if (this.brushActive && this.brushDragPoints.length > 0) {
      const s = this.brushController.getSettings();
      this._drawInProgressBrush(this.brushDragPoints, s);
    }

    if (this.brushActive && this.brushCursor) {
      const s = this.brushController.getSettings();
      this._drawBrushCursor(this.brushCursor, s.radius, s.color, s.mode);
    } else if (this.externalBrushPreview?.pos) {
      const p = this.externalBrushPreview;
      this._drawBrushCursor(p.pos!, p.radius, p.color, p.mode);
    }

    this._updateDeleteHandle();
  }

  /** Convert a brush radius in CSS pixels into normalised map coords using
   *  the current camera transform. Used by the live preview + by GMApp at
   *  brush-commit time so the polygon offset matches what the GM sees. */
  radiusScreenPxToMapNorm(radiusPx: number): number {
    const b = this.getMapBounds(this.drawW, this.drawH);
    if (b.w <= 0) return 0;
    return radiusPx / b.w;
  }

  /** Lazy-builds an 8×8 black/white diagonal crosshatch pattern used as
   *  the GM-canvas polygon fill. Visible regardless of fog colour so the
   *  GM can always see shapes (helpful when fog colour matches the map
   *  background). Translucent so the underlying map still shows through. */
  private _getHatchPattern(): CanvasPattern | null {
    if (this.hatchPattern) return this.hatchPattern;
    const tile = document.createElement('canvas');
    tile.width = 8;
    tile.height = 8;
    const tctx = tile.getContext('2d');
    if (!tctx) return null;
    tctx.clearRect(0, 0, 8, 8);
    tctx.lineWidth = 1.2;
    // Black diagonal one way
    tctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    tctx.beginPath();
    tctx.moveTo(-1, 1); tctx.lineTo(9, 11);
    tctx.moveTo(-1, -7); tctx.lineTo(9, 3);
    tctx.stroke();
    // White diagonal the other way
    tctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    tctx.beginPath();
    tctx.moveTo(-1, 7); tctx.lineTo(9, -3);
    tctx.moveTo(-1, 15); tctx.lineTo(9, 5);
    tctx.stroke();
    this.hatchPattern = this.ctx.createPattern(tile, 'repeat');
    return this.hatchPattern;
  }

  /** Draw the in-progress brush polygon outline as a dashed shape so the GM
   *  sees the result of their drag before committing. The ribbon is run
   *  through `cleanRibbonToBlobs` so self-crossings collapse to a single
   *  "blob" outline live, matching what the commit will produce. */
  private _drawInProgressBrush(points: FogVertex[], settings: BrushSettings): void {
    const radMapNorm = this.radiusScreenPxToMapNorm(settings.radius);
    if (radMapNorm <= 0) return;
    const ribbon = offsetPolyline(points, radMapNorm);
    if (ribbon.length < 3) return;
    const blobs = cleanRibbonToBlobs(ribbon);
    if (blobs.length === 0) return;
    const ctx = this.ctx;
    const b = this.getMapBounds(this.drawW, this.drawH);
    const stroke = settings.mode === 'erase' ? '#ffffff' : (settings.color || '#000000');
    ctx.save();
    for (const blob of blobs) {
      ctx.beginPath();
      ctx.moveTo(b.x + blob.outer[0]!.x * b.w, b.y + blob.outer[0]!.y * b.h);
      for (let i = 1; i < blob.outer.length; i++) {
        ctx.lineTo(b.x + blob.outer[i]!.x * b.w, b.y + blob.outer[i]!.y * b.h);
      }
      ctx.closePath();
      for (const h of blob.holes) {
        if (h.length < 3) continue;
        ctx.moveTo(b.x + h[0]!.x * b.w, b.y + h[0]!.y * b.h);
        for (let i = 1; i < h.length; i++) {
          ctx.lineTo(b.x + h[i]!.x * b.w, b.y + h[i]!.y * b.h);
        }
        ctx.closePath();
      }
      ctx.fillStyle = stroke + '40';
      ctx.fill('evenodd');
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = -this.dashOffset;
      ctx.lineWidth = 2;
      ctx.strokeStyle = stroke;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }
    ctx.restore();
  }

  /** External callers can drive the brush-size preview
   *  outline through this method so the cursor renders on the same fog
   *  canvas — no new DOM layer needed. Pass null to clear. */
  setExternalBrushPreview(preview: { pos: FogVertex; radius: number; color: string; mode: 'paint' | 'erase' } | null): void {
    this.externalBrushPreview = preview ? { ...preview } : null;
    this.redraw();
  }

  /** Draw the brush-size circle outline at the cursor. Radius is now in
   *  CSS pixels directly (v2.12 unified system) — so the brush stays
   *  visually constant as the GM zooms, giving fine-detail painting via
   *  zoom-in. The actual map polygon shrinks at higher zoom. */
  private _drawBrushCursor(pos: FogVertex, radius: number, color: string, mode: 'paint' | 'erase'): void {
    const ctx = this.ctx;
    const b = this.getMapBounds(this.drawW, this.drawH);
    const cx = b.x + pos.x * b.w;
    const cy = b.y + pos.y * b.h;
    const rad = Math.max(2, radius);
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = mode === 'erase' ? '#ffffff' : (color || '#000000');
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.beginPath();
    ctx.arc(cx, cy, rad + 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1, rad - 1), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** Position the delete-handle screen-space button at the selected
   *  polygon's lowest-leftest vertex (or hide it if no selection / draw
   *  mode / no host). "Lowest-leftest" maximises `(y - x)` in normalised
   *  coords — y grows downward and x rightward, so a high (y - x) is
   *  bottom-left. */
  private _updateDeleteHandle(): void {
    const btn = this.deleteHandleEl;
    if (!btn) return;
    if (!this.selectedId || this.enabled) { btn.hidden = true; return; }

    const poly = this.polygons.find((p) => p.id === this.selectedId);
    if (!poly || poly.vertices.length === 0) { btn.hidden = true; return; }

    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < poly.vertices.length; i++) {
      const v = poly.vertices[i]!;
      const score = v.y - v.x;
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    const apex = poly.vertices[bestIdx]!;

    let screenX: number;
    let screenY: number;
    if (this.renderer) {
      const p = this.renderer.mapNormToCanvasCss(apex.x, apex.y);
      if (!p) { btn.hidden = true; return; }
      screenX = p.x;
      screenY = p.y;
    } else {
      const b = this.getMapBounds(this.drawW, this.drawH);
      screenX = b.x + apex.x * b.w;
      screenY = b.y + apex.y * b.h;
    }
    btn.style.left = `${screenX}px`;
    btn.style.top  = `${screenY}px`;
    btn.hidden = false;
  }

  private drawPolygon(vertices: FogVertex[], color: string, selected: boolean, holes?: FogVertex[][]): void {
    if (vertices.length < 2) return;
    const b = this.getMapBounds(this.drawW, this.drawH);
    const ctx = this.ctx;
    const vx = (v: FogVertex) => b.x + v.x * b.w;
    const vy = (v: FogVertex) => b.y + v.y * b.h;

    // Outer ring path + each hole as its own subpath. fill('evenodd')
    // punches the holes out; the subsequent stroke draws every subpath
    // including the holes — so holes get marching ants too.
    ctx.beginPath();
    ctx.moveTo(vx(vertices[0]!), vy(vertices[0]!));
    for (let i = 1; i < vertices.length; i++) {
      ctx.lineTo(vx(vertices[i]!), vy(vertices[i]!));
    }
    ctx.closePath();
    if (holes) {
      for (const h of holes) {
        if (h.length < 3) continue;
        ctx.moveTo(vx(h[0]!), vy(h[0]!));
        for (let i = 1; i < h.length; i++) ctx.lineTo(vx(h[i]!), vy(h[i]!));
        ctx.closePath();
      }
    }

    // Two-pass fill on the GM canvas: the kind colour at low alpha (so the
    // user can see what kind / colour it is) and a black/white crosshatch
    // on top (so the shape is always visible regardless of how closely
    // the fog colour matches the map background). Player view stays clean —
    // crosshatch is GM-canvas-only; the compositor renders the solid fill.
    ctx.fillStyle = color + '40';
    ctx.fill('evenodd');
    const hatch = this._getHatchPattern();
    if (hatch) {
      ctx.fillStyle = hatch;
      ctx.fill('evenodd');
    }

    // Always draw marching ants around every polygon.
    // Selected: bright white/black ants (high contrast).
    // Unselected: subtle muted ants so the boundary is always visible.
    const period = 8;
    if (selected) {
      ctx.lineWidth = 2;
      ctx.setLineDash([period / 2, period / 2]);
      ctx.lineDashOffset = -this.dashOffset;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.lineDashOffset = -(this.dashOffset + period / 2);
      ctx.strokeStyle = '#000000';
      ctx.stroke();
    } else {
      ctx.lineWidth = 1.5;
      ctx.setLineDash([period / 2, period / 2]);
      ctx.lineDashOffset = -this.dashOffset;
      ctx.strokeStyle = 'rgba(200, 216, 232, 0.55)';
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }

  private drawInProgress(vertices: FogVertex[]): void {
    const b = this.getMapBounds(this.drawW, this.drawH);
    const ctx = this.ctx;
    const vx = (v: FogVertex) => b.x + v.x * b.w;
    const vy = (v: FogVertex) => b.y + v.y * b.h;

    ctx.beginPath();
    ctx.moveTo(vx(vertices[0]!), vy(vertices[0]!));
    for (let i = 1; i < vertices.length; i++) {
      ctx.lineTo(vx(vertices[i]!), vy(vertices[i]!));
    }

    const period = 8;
    ctx.lineWidth = 2;
    ctx.setLineDash([period / 2, period / 2]);

    ctx.lineDashOffset = -this.dashOffset;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    ctx.lineDashOffset = -(this.dashOffset + period / 2);
    ctx.strokeStyle = '#000000';
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    for (const v of vertices) {
      ctx.beginPath();
      ctx.arc(vx(v), vy(v), 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if (vertices.length >= 3) {
      ctx.beginPath();
      ctx.arc(vx(vertices[0]!), vy(vertices[0]!), 9, 0, Math.PI * 2);
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth   = 2;
      ctx.stroke();
    }

    if (this.cursorPos) {
      const last = vertices[vertices.length - 1]!;
      ctx.beginPath();
      ctx.moveTo(vx(last), vy(last));
      ctx.lineTo(vx(this.cursorPos), vy(this.cursorPos));

      ctx.lineWidth = 1.5;
      ctx.setLineDash([period / 2, period / 2]);
      ctx.lineDashOffset = -this.dashOffset;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.lineDashOffset = -(this.dashOffset + period / 2);
      ctx.strokeStyle = '#000000';
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }
  }

  private eventToNorm(e: MouseEvent): FogVertex {
    const rect = this.canvas.getBoundingClientRect();
    return this.canvasPxToMapNorm(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
  }

  private touchToNorm(t: Touch): FogVertex {
    const rect = this.canvas.getBoundingClientRect();
    return this.canvasPxToMapNorm(t.clientX - rect.left, t.clientY - rect.top, rect.width, rect.height);
  }

  private canvasPxToMapNorm(px: number, py: number, canvasW: number, canvasH: number): FogVertex {
    // When a Renderer is wired we route through its camera projection so
    // pan/zoom is honoured automatically. Otherwise fall back to the
    // legacy letterbox math (identity transform — what's always been
    // there pre-v2.11/A4).
    if (this.renderer) {
      const m = this.renderer.canvasCssToMapNorm(px, py);
      if (m) return { x: Math.max(0, Math.min(1, m.x)), y: Math.max(0, Math.min(1, m.y)) };
    }
    const b = this.getMapBounds(canvasW, canvasH);
    return {
      x: Math.max(0, Math.min(1, (px - b.x) / b.w)),
      y: Math.max(0, Math.min(1, (py - b.y) / b.h)),
    };
  }

  /**
   * Returns the rectangle (in canvas CSS px) that the rendered map occupies
   * right now. When a Renderer is wired, the rectangle reflects the live
   * camera pan/zoom (so it pans / scales with the workspace). Otherwise
   * falls back to the static letterbox derived from canvas + map aspect.
   */
  private getMapBounds(canvasW: number, canvasH: number): { x: number; y: number; w: number; h: number } {
    if (this.renderer) {
      const tl = this.renderer.mapNormToCanvasCss(0, 0);
      const br = this.renderer.mapNormToCanvasCss(1, 1);
      if (tl && br) {
        return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
      }
    }
    const screenAspect = canvasW / Math.max(canvasH, 1);
    if (screenAspect > this.mapAspect) {
      const mapW = canvasH * this.mapAspect;
      return { x: (canvasW - mapW) / 2, y: 0, w: mapW, h: canvasH };
    } else {
      const mapH = canvasW / this.mapAspect;
      return { x: 0, y: (canvasH - mapH) / 2, w: canvasW, h: mapH };
    }
  }

  private emit(): void {
    this.onChange({ polygons: this.polygons });
  }
}
