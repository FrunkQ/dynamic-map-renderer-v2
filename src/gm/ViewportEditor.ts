import type { ViewState } from '../types.ts';
import type { Renderer } from '../rendering/Renderer.ts';

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewChangeCallback = (view: ViewState) => void;
type EditModeCallback   = (editing: boolean) => void;
type DragType = 'move' | 'nw' | 'ne' | 'sw' | 'se' | null;

interface MapBounds { x: number; y: number; w: number; h: number }
interface Rect      { x: number; y: number; w: number; h: number }

// ─── Constants ────────────────────────────────────────────────────────────────

const HANDLE_RADIUS = 7;
const HANDLE_HIT    = 12;   // hit-test radius (slightly larger than drawn)
const MIN_RECT_PX   = 80;   // minimum rect size in CSS pixels
const DASH_LEN      = 6;
const DASH_GAP      = 4;
const DASH_SPEED    = 0.4;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns the pixel rect occupied by the map image inside a canvas of size cw×ch. */
function mapBounds(cw: number, ch: number, mapAspect: number): MapBounds {
  const sa = cw / Math.max(ch, 1);
  if (sa > mapAspect) {
    const w = ch * mapAspect;
    return { x: (cw - w) / 2, y: 0, w, h: ch };
  }
  const h = cw / mapAspect;
  return { x: 0, y: (ch - h) / 2, w: cw, h };
}

// ─── ViewportEditor ───────────────────────────────────────────────────────────

/**
 * Draws a persistent orange marching-ants rectangle on a 2D canvas overlay
 * showing what the player currently sees.  In edit mode the rect gains drag
 * handles so the GM can reposition / resize the player view directly.
 *
 * The class owns its canvas (`#viewport-canvas`).  The canvas sits above the
 * fog canvas in z-order.  pointer-events are set to 'none' in passive mode and
 * 'auto' in edit mode so fog interactions pass through when not editing.
 *
 * Coordinate system: all internal positions are in CSS pixels.  The map-
 * normalised ViewState (centerX/Y ∈ [0,1], scale) is converted via mapBounds().
 */
export class ViewportEditor {
  private canvas: HTMLCanvasElement;
  private ctx:    CanvasRenderingContext2D;

  private mapAspect = 1;
  private hasMap    = false;
  private view: ViewState = { centerX: 0.5, centerY: 0.5, viewNW: 1.0, viewNH: 1.0, backgroundColor: '#000000' };

  private editMode     = false;
  private preEditView: ViewState | null = null;

  private drawW = 1;
  private drawH = 1;

  private dashOffset  = 0;
  private marchAnimId: number | null = null;

  // Drag state
  private dragType:       DragType = null;
  private dragStartPx:    { x: number; y: number } | null = null;
  private dragStartRect:  Rect | null = null;
  private dragFixedPx:    { x: number; y: number } | null = null;   // fixed corner during resize

  private onChangeFn:   ViewChangeCallback | null = null;
  private onEditModeFn: EditModeCallback   | null = null;

  /** Optional Renderer reference — when wired, mapBounds rides the live
   *  camera (pan/zoom) instead of falling back to the static letterbox. */
  private renderer: Renderer | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('ViewportEditor: 2D context unavailable');
    this.ctx = ctx;

    this.syncSize();
    this.bindEvents();
    window.addEventListener('resize', () => { this.syncSize(); this.redraw(); });
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  onChange(fn: ViewChangeCallback):   void { this.onChangeFn   = fn; }
  onEditMode(fn: EditModeCallback):   void { this.onEditModeFn = fn; }

  setMapAspect(ratio: number): void {
    this.mapAspect = ratio;
    this.hasMap    = true;
    this.startMarch();   // always animate once a map is loaded
    this.redraw();
  }

  /** Wire a Renderer so mapBounds tracks the live GM camera transform. */
  setRenderer(renderer: Renderer): void {
    this.renderer = renderer;
  }

  /** Re-render — call when an external state change (camera pan/zoom)
   *  needs the rectangle re-positioned without altering ViewState. */
  redrawExternal(): void {
    this.redraw();
  }

  setView(view: ViewState): void {
    this.view = { ...view };
    this.redraw();
  }

  startEdit(): void {
    if (!this.hasMap) return;
    this.preEditView = { ...this.view };
    this.editMode    = true;
    this.canvas.style.pointerEvents = 'auto';
    this.onEditModeFn?.(true);
    this.redraw();
  }

  commitEdit(): void {
    this.preEditView = null;
    this._exitEdit();
  }

  cancelEdit(): void {
    if (this.preEditView) {
      this.view = { ...this.preEditView };
      this.onChangeFn?.(this.view);
    }
    this.preEditView = null;
    this._exitEdit();
  }

  get isEditing(): boolean { return this.editMode; }

  /** Snap the view back to showing the whole map, centred. */
  resetToFullMap(): void {
    this.view = { centerX: 0.5, centerY: 0.5, viewNW: 1.0, viewNH: 1.0, backgroundColor: this.view.backgroundColor };
    this.onChangeFn?.(this.view);
    this.redraw();
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private _exitEdit(): void {
    this.editMode = false;
    this.dragType = null;
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.cursor = '';
    this.onEditModeFn?.(false);
    this.redraw();
  }

  private syncSize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w   = this.canvas.clientWidth;
    const h   = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    this.drawW          = w;
    this.drawH          = h;
    this.canvas.width   = Math.round(w * dpr);
    this.canvas.height  = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private startMarch(): void {
    if (this.marchAnimId !== null) return;
    const tick = () => {
      this.dashOffset = (this.dashOffset + DASH_SPEED) % ((DASH_LEN + DASH_GAP) * 2);
      this.redraw();
      this.marchAnimId = requestAnimationFrame(tick);
    };
    this.marchAnimId = requestAnimationFrame(tick);
  }

  // ─── Drawing ────────────────────────────────────────────────────────────────

  private redraw(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.drawW, this.drawH);
    if (!this.hasMap) return;

    const rect    = this.viewToRect();
    const editing = this.editMode;

    ctx.save();

    if (editing) {
      // Faint tinted fill so the GM can see the edit region
      ctx.fillStyle = 'rgba(255, 140, 0, 0.07)';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

      // Bright marching ants — two-colour (orange + light gold)
      ctx.setLineDash([DASH_LEN, DASH_GAP]);
      ctx.lineWidth = 2;

      ctx.lineDashOffset = -this.dashOffset;
      ctx.strokeStyle    = '#ff8c00';
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

      ctx.lineDashOffset = -(this.dashOffset + DASH_LEN + DASH_GAP);
      ctx.strokeStyle    = 'rgba(255, 220, 130, 0.85)';
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;

      this.drawHandles(ctx, rect);
    } else {
      // Passive: single faint dashed outline
      ctx.setLineDash([DASH_LEN, DASH_GAP]);
      ctx.lineWidth      = 1.5;
      ctx.lineDashOffset = -this.dashOffset;
      ctx.strokeStyle    = 'rgba(255, 140, 0, 0.65)';
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }

    ctx.restore();
  }

  private drawHandles(ctx: CanvasRenderingContext2D, rect: Rect): void {
    const corners = [
      { x: rect.x,           y: rect.y           },   // NW
      { x: rect.x + rect.w,  y: rect.y           },   // NE
      { x: rect.x,           y: rect.y + rect.h  },   // SW
      { x: rect.x + rect.w,  y: rect.y + rect.h  },   // SE
    ];
    for (const c of corners) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle   = '#ff8c00';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = 1.5;
      ctx.stroke();
    }
  }

  // ─── Coordinate conversion ───────────────────────────────────────────────────

  /**
   * Returns the rendered-map rectangle (CSS px) on this canvas. Uses the
   * Renderer's live camera (worldToScreen) when wired, falling back to
   * the static letterbox math otherwise — so the editor tracks GM
   * workspace pan/zoom from v2.11/A4 onward without breaking pre-A4 paths.
   */
  private liveMapBounds(): MapBounds {
    if (this.renderer) {
      const tl = this.renderer.mapNormToCanvasCss(0, 0);
      const br = this.renderer.mapNormToCanvasCss(1, 1);
      if (tl && br) return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
    }
    return mapBounds(this.drawW, this.drawH, this.mapAspect);
  }

  /** ViewState → rectangle in CSS pixels on this canvas. */
  private viewToRect(): Rect {
    const b  = this.liveMapBounds();
    const rw = this.view.viewNW * b.w;
    const rh = this.view.viewNH * b.h;
    const rx = b.x + this.view.centerX * b.w - rw / 2;
    const ry = b.y + this.view.centerY * b.h - rh / 2;
    return { x: rx, y: ry, w: rw, h: rh };
  }

  /** Rectangle in CSS pixels → ViewState. */
  private rectToView(rect: Rect): ViewState {
    const b     = this.liveMapBounds();
    const viewNW  = rect.w / b.w;
    const viewNH  = rect.h / b.h;
    const centerX = (rect.x - b.x + rect.w / 2) / b.w;
    const centerY = (rect.y - b.y + rect.h / 2) / b.h;
    return {
      centerX:         Math.max(0, Math.min(1, centerX)),
      centerY:         Math.max(0, Math.min(1, centerY)),
      viewNW:          Math.max(0.01, viewNW),
      viewNH:          Math.max(0.01, viewNH),
      backgroundColor: this.view.backgroundColor,
    };
  }

  // ─── Events ─────────────────────────────────────────────────────────────────

  private eventPx(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private hitTest(px: number, py: number, rect: Rect): DragType {
    type Corner = { x: number; y: number; t: DragType };
    const corners: Corner[] = [
      { x: rect.x,          y: rect.y,          t: 'nw' },
      { x: rect.x + rect.w, y: rect.y,          t: 'ne' },
      { x: rect.x,          y: rect.y + rect.h, t: 'sw' },
      { x: rect.x + rect.w, y: rect.y + rect.h, t: 'se' },
    ];
    for (const c of corners) {
      const dx = px - c.x, dy = py - c.y;
      if (Math.sqrt(dx * dx + dy * dy) <= HANDLE_HIT) return c.t;
    }
    if (px >= rect.x && px <= rect.x + rect.w &&
        py >= rect.y && py <= rect.y + rect.h) return 'move';
    return null;
  }

  private updateCursor(hit: DragType): void {
    const map: Partial<Record<NonNullable<DragType>, string>> = {
      nw: 'nw-resize', ne: 'ne-resize', sw: 'sw-resize', se: 'se-resize', move: 'move',
    };
    this.canvas.style.cursor = hit ? (map[hit] ?? 'default') : 'default';
  }

  private bindEvents(): void {
    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.editMode) return;
      e.preventDefault();
      const p    = this.eventPx(e);
      const rect = this.viewToRect();
      const hit  = this.hitTest(p.x, p.y, rect);
      if (!hit) return;

      this.dragType      = hit;
      this.dragStartPx   = p;
      this.dragStartRect = { ...rect };

      // Store the fixed (opposite) corner for resize drags
      if (hit === 'se') this.dragFixedPx = { x: rect.x,          y: rect.y          };
      if (hit === 'sw') this.dragFixedPx = { x: rect.x + rect.w, y: rect.y          };
      if (hit === 'ne') this.dragFixedPx = { x: rect.x,          y: rect.y + rect.h };
      if (hit === 'nw') this.dragFixedPx = { x: rect.x + rect.w, y: rect.y + rect.h };
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.editMode) return;
      const p = this.eventPx(e);

      if (this.dragType) {
        this.handleDrag(p);
        return;
      }

      // Hover cursors when not dragging
      const rect = this.viewToRect();
      this.updateCursor(this.hitTest(p.x, p.y, rect));
    });

    window.addEventListener('mouseup', () => {
      if (!this.editMode || !this.dragType) return;
      this.dragType      = null;
      this.dragStartPx   = null;
      this.dragStartRect = null;
      this.dragFixedPx   = null;
    });
  }

  private handleDrag(p: { x: number; y: number }): void {
    if (this.dragType === 'move') {
      const b   = this.liveMapBounds();
      const sr  = this.dragStartRect!;
      const sp  = this.dragStartPx!;
      const dx  = p.x - sp.x;
      const dy  = p.y - sp.y;

      // Clamp so the whole rect stays within the map area
      const nx = Math.max(b.x, Math.min(b.x + b.w - sr.w, sr.x + dx));
      const ny = Math.max(b.y, Math.min(b.y + b.h - sr.h, sr.y + dy));

      const newRect: Rect = { x: nx, y: ny, w: sr.w, h: sr.h };
      this.view = this.rectToView(newRect);
      this.onChangeFn?.(this.view);
      this.redraw();
      return;
    }

    // Resize: free-form — width and height are independent.
    // scale is derived from the rectangle HEIGHT in rectToView(), so the GM
    // can drag to any shape; the player's actual visible width is determined by
    // their own screen aspect ratio (which we can't know in advance).
    const fixed = this.dragFixedPx!;
    const newW  = Math.max(MIN_RECT_PX, Math.abs(p.x - fixed.x));
    const newH  = Math.max(MIN_RECT_PX, Math.abs(p.y - fixed.y));

    let newRect: Rect;
    switch (this.dragType) {
      case 'se': newRect = { x: fixed.x,        y: fixed.y,        w: newW, h: newH }; break;
      case 'sw': newRect = { x: fixed.x - newW, y: fixed.y,        w: newW, h: newH }; break;
      case 'ne': newRect = { x: fixed.x,        y: fixed.y - newH, w: newW, h: newH }; break;
      case 'nw': newRect = { x: fixed.x - newW, y: fixed.y - newH, w: newW, h: newH }; break;
      default:   return;
    }

    this.view = this.rectToView(newRect);
    this.onChangeFn?.(this.view);
    this.redraw();
  }
}
