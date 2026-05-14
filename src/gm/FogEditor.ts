import type { FogPolygon, FogState, FogVertex } from '../types.ts';
import { generateId } from '../utils/id.ts';
import type { Renderer } from '../rendering/Renderer.ts';
import { BrushController, type BrushSettings } from '../mapfx/BrushController.ts';

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

export class FogEditor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private onChange: FogChangeCallback;
  private onModeChangeFn: ModeChangeCallback | null = null;

  private polygons: FogPolygon[] = [];
  private currentVertices: FogVertex[] = [];
  private selectedId: string | null = null;
  private activeColor = '#000000';
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
      onStart:    (p, s) => this.brushLive?.(s, [p]),
      onContinue: (p, s) => this.brushLive?.(s, [p]),
      onEnd:      (pts, s) => this.brushEnd?.(s, pts),
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
    const poly: FogPolygon = {
      id: generateId(),
      vertices: [...this.currentVertices],
      color: this.activeColor,
    };
    this.polygons.push(poly);
    this.currentVertices = [];
    this.setSelection(poly.id);
    this.updateMarchState();
    this.emit();
    // Auto-exit draw mode — disable() redraws and emits the updated mode,
    // so the Draw button deactivates and Delete appears for the new polygon.
    this.disable();
  }

  private trySelect(pos: FogVertex): void {
    // Interior hit test
    for (let i = this.polygons.length - 1; i >= 0; i--) {
      const poly = this.polygons[i]!;
      if (this.pointInPolygon(pos, poly.vertices)) {
        this.setSelection(poly.id);
        this.redraw();
        this.emitMode();
        return;
      }
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
      this.drawPolygon(poly.vertices, poly.color, poly.id === this.selectedId);
    }

    if (this.currentVertices.length > 0) {
      this.drawInProgress(this.currentVertices);
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

  /** External callers (MapFXEditor via GMApp) drive the brush-size preview
   *  outline through this method so the cursor renders on the same fog
   *  canvas — no new DOM layer needed. Pass null to clear. */
  setExternalBrushPreview(preview: { pos: FogVertex; radius: number; color: string; mode: 'paint' | 'erase' } | null): void {
    this.externalBrushPreview = preview ? { ...preview } : null;
    this.redraw();
  }

  /** Draw the brush-size circle outline at the cursor. Two strokes — a
   *  bright fill and a dark inner outline — so the ring reads against
   *  any map background. The colour cue (paint vs erase) is the fill:
   *  brush colour when painting, white when erasing (reveal). */
  private _drawBrushCursor(pos: FogVertex, radius: number, color: string, mode: 'paint' | 'erase'): void {
    const ctx = this.ctx;
    const b = this.getMapBounds(this.drawW, this.drawH);
    const cx = b.x + pos.x * b.w;
    const cy = b.y + pos.y * b.h;
    const rad = Math.max(2, radius * b.w);
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

  private drawPolygon(vertices: FogVertex[], color: string, selected: boolean): void {
    if (vertices.length < 2) return;
    const b = this.getMapBounds(this.drawW, this.drawH);
    const ctx = this.ctx;
    const vx = (v: FogVertex) => b.x + v.x * b.w;
    const vy = (v: FogVertex) => b.y + v.y * b.h;

    ctx.beginPath();
    ctx.moveTo(vx(vertices[0]!), vy(vertices[0]!));
    for (let i = 1; i < vertices.length; i++) {
      ctx.lineTo(vx(vertices[i]!), vy(vertices[i]!));
    }
    ctx.closePath();

    // Semi-transparent fill
    ctx.fillStyle = color + '40';
    ctx.fill();

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
