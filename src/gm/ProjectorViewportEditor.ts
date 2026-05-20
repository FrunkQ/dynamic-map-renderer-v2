import type { ProjectorConnection, ProjectorViewport } from '../types.ts';
import { defaultProjectorViewport } from '../types.ts';
import type { Renderer } from '../rendering/Renderer.ts';

type ChangeCallback = (vp: ProjectorViewport) => void;

interface MapBounds { x: number; y: number; w: number; h: number }

const DASH_LEN   = 10;
const DASH_GAP   = 6;
const DASH_SPEED = 0.35;

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

/**
 * GM-side overlay drawing the projector viewport rectangle. The rectangle's
 * SIZE is locked — derived from the connected projector's reported canvas
 * size + its pixels-per-square, scaled by the active map's pixels-per-square.
 * The user only ever drags it around (centre position).
 *
 * Visual: orange base with white marching ants overlaid — distinct from the
 * player viewport's plain orange ants so the GM can tell them apart.
 *
 * Hidden when no projector is connected, or when the active map has not been
 * calibrated yet (we don't know how big the rectangle should be).
 */
export class ProjectorViewportEditor {
  private canvas: HTMLCanvasElement;
  private ctx:    CanvasRenderingContext2D;

  private mapAspect = 1;
  private hasMap = false;
  /** Map pixels per 1"/25mm square. Asset-level. */
  private mapPixelsPerSquare: number | null = null;

  private connection: ProjectorConnection | null = null;
  private viewport:   ProjectorViewport = defaultProjectorViewport();

  private drawW = 1;
  private drawH = 1;
  private dashOffset = 0;
  private animId: number | null = null;

  private dragging = false;
  private dragStart: { x: number; y: number } | null = null;
  private dragStartCenter: { x: number; y: number } | null = null;

  private onChangeFn: ChangeCallback | null = null;

  /** Optional Renderer reference — when wired, mapBounds tracks the live
   *  GM camera transform (so the projector rectangle pans/zooms with the
   *  workspace). Identity-equivalent without a renderer. */
  private renderer: Renderer | null = null;

  /** v2.14.3 — screen-space move handle. The rect outline lives on the
   *  canvas (pointer-events:none) so other GM canvas interactions stay
   *  unaffected; only this handle is pointer-events:auto. Always present
   *  when the rect is active; no edit-mode toggle. */
  private moveHandle: HTMLButtonElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('ProjectorViewportEditor: 2D context unavailable');
    this.ctx = ctx;

    this.syncSize();
    window.addEventListener('resize', () => { this.syncSize(); this.redraw(); });

    this.moveHandle = document.createElement('button');
    this.moveHandle.type = 'button';
    this.moveHandle.className = 'projector-rect-handle';
    this.moveHandle.title = 'Drag to move the Scaled View across the map';
    this.moveHandle.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="5 9 2 12 5 15"/>
        <polyline points="9 5 12 2 15 5"/>
        <polyline points="15 19 12 22 9 19"/>
        <polyline points="19 9 22 12 19 15"/>
        <line x1="2" y1="12" x2="22" y2="12"/>
        <line x1="12" y1="2" x2="12" y2="22"/>
      </svg>
    `;
    this.moveHandle.hidden = true;
    canvas.parentElement?.insertBefore(this.moveHandle, canvas.nextSibling);
    this.moveHandle.addEventListener('pointerdown', (e) => this.onHandlePointerDown(e));
  }

  setMapAspect(aspect: number, hasMap: boolean): void {
    this.mapAspect = aspect;
    this.hasMap = hasMap;
    this.redraw();
  }

  /** Wire a Renderer so mapBounds tracks the live GM camera transform. */
  setRenderer(renderer: Renderer): void {
    this.renderer = renderer;
  }

  /** Force a redraw — for camera-transform changes that don't involve
   *  the projector viewport state itself. */
  redrawExternal(): void {
    this.redraw();
  }

  /** Current projector rectangle in canvas CSS pixels — null when no
   *  projector connected or map not yet calibrated. */
  getRectBounds(): { x: number; y: number; w: number; h: number } | null {
    return this.rectInCanvas();
  }

  /** Current projector viewport snapshot. */
  getViewport(): ProjectorViewport { return { ...this.viewport }; }

  private liveMapBounds(): MapBounds {
    if (this.renderer) {
      const tl = this.renderer.mapNormToCanvasCss(0, 0);
      const br = this.renderer.mapNormToCanvasCss(1, 1);
      if (tl && br) return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
    }
    return mapBounds(this.drawW, this.drawH, this.mapAspect);
  }

  setMapPixelsPerSquare(pps: number | null): void {
    this.mapPixelsPerSquare = pps;
    this.redraw();
  }

  setConnection(conn: ProjectorConnection | null): void {
    this.connection = conn;
    this.redraw();
  }

  setViewport(vp: ProjectorViewport): void {
    this.viewport = vp;
    this.redraw();
  }

  onChange(fn: ChangeCallback): void {
    this.onChangeFn = fn;
  }

  /** Whether all the inputs needed to draw the rectangle are available.
   *  v2.14.6 — in 'full' mode the projector renders the entire map
   *  fit-to-window (the default for uncalibrated maps), so the rect
   *  is the whole map outline and we don't need mapPixelsPerSquare.
   *  Calibrated 'scaled' mode still requires it. */
  isActive(): boolean {
    if (!this.hasMap || !this.connection) return false;
    if (this.viewport.mode === 'full') return true;
    return this.mapPixelsPerSquare !== null && this.mapPixelsPerSquare > 0;
  }

  private syncSize(): void {
    const dpr = window.devicePixelRatio || 1;
    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;
    this.canvas.width  = Math.max(1, Math.round(cssW * dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawW = cssW;
    this.drawH = cssH;
  }

  /**
   * Compute the projector viewport's bounding rect in canvas CSS pixels.
   * Returns null if any of the inputs are missing.
   */
  private rectInCanvas(): { x: number; y: number; w: number; h: number } | null {
    if (!this.isActive()) return null;
    const conn = this.connection!;
    const mb = this.liveMapBounds();
    // v2.14.6 — full-map mode: the projector renders the entire map
    // fit-to-window. The GM-side rect is therefore the full map outline,
    // no calibration arithmetic needed.
    if (this.viewport.mode === 'full') {
      return { x: mb.x, y: mb.y, w: mb.w, h: mb.h };
    }
    // Compute projector viewport size in MAP pixels.
    //   feet-per-projector-canvas-w = canvasW / projector-px-per-square
    //   map-pixels = feet-per-projector-canvas-w * map-px-per-square
    //   => mapPx = canvasW * (mapPxPerSq / projectorPxPerSq)
    const ratio = this.mapPixelsPerSquare! / Math.max(0.01, conn.pixelsPerSquare);
    const wMap = conn.canvasWidth  * ratio;
    const hMap = conn.canvasHeight * ratio;
    // Map-px → canvas-CSS-px scaling. The map fills mb.w × mb.h CSS pixels.
    // We need the projector rect's size in those CSS pixels. The map's
    // intrinsic pixel dimensions (mapPxPerSq * total squares) — we don't
    // have that directly; but mb.w corresponds to the full image width in
    // map pixels, so canvasCSSpx-per-mapPx = mb.w / (asset.imageWidth or
    // implied). We can dodge that: compute aspect-aware via the map's
    // pixels-per-square directly relative to mb.w if we know image width.
    // Simpler: assume the asset's imageWidth was stored (it always is, via
    // getBlob backfill). But the editor doesn't know it directly.
    //
    // Instead use this identity: mb.w = imageWidthInPx * (mb.w / imageWidthInPx).
    // We'll receive mapWidthInPx via setMapAspect's caller. For now derive
    // through mapPixelsPerSquare and a width-in-squares: NOT enough info.
    //
    // Pragmatic fix: the caller sets `setMapPixelsPerSquare` AND will set a
    // separate `setMapImageWidth` (added below) so we know the conversion.
    // Until then, we approximate using mapAspect — works as long as the
    // caller passes the actual map image width too.
    //
    // To keep this method robust, require mapImageWidthPx to be set:
    if (this.mapImageWidthPx <= 0) return null;
    const cssPerMapPx = mb.w / this.mapImageWidthPx;
    const wCss = wMap * cssPerMapPx;
    const hCss = hMap * cssPerMapPx;
    const cx   = mb.x + this.viewport.centerX * mb.w;
    const cy   = mb.y + this.viewport.centerY * mb.h;
    return {
      x: cx - wCss / 2,
      y: cy - hCss / 2,
      w: wCss,
      h: hCss,
    };
  }

  /** Map image's intrinsic width in pixels — needed for css/map-px conversion. */
  private mapImageWidthPx = 0;
  setMapImageWidth(widthPx: number): void {
    this.mapImageWidthPx = widthPx;
    this.redraw();
  }

  private redraw(): void {
    this._redrawNoAnim();
    this.startAnimation();
  }

  private startAnimation(): void {
    if (this.animId !== null) return;
    const tick = () => {
      this.dashOffset = (this.dashOffset + DASH_SPEED) % (DASH_LEN + DASH_GAP);
      this.animId = requestAnimationFrame(tick);
      // Light redraw — only the dashed white pass needs re-stroking but we
      // just clear and redraw the whole rect for simplicity. Cost is ~one
      // strokeRect per frame for a single rectangle.
      this._redrawNoAnim();
    };
    this.animId = requestAnimationFrame(tick);
  }

  private stopAnimation(): void {
    if (this.animId !== null) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
  }

  private _redrawNoAnim(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.drawW, this.drawH);
    const rect = this.rectInCanvas();
    if (!rect) {
      this.moveHandle.hidden = true;
      this.stopAnimation();
      return;
    }

    ctx.save();

    // Orange base ring (always drawn)
    ctx.lineWidth      = 2;
    ctx.setLineDash([DASH_LEN, DASH_GAP]);
    ctx.lineDashOffset = -this.dashOffset;
    ctx.strokeStyle    = '#ff8c00';
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

    // Green offset ants on top — phase-shifted so the two colours interleave
    // visually like a barber pole crawl.
    ctx.lineDashOffset = -(this.dashOffset + DASH_LEN + DASH_GAP);
    ctx.strokeStyle    = 'rgba(34, 197, 94, 0.95)';
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    ctx.restore();

    // v2.14.3 — keep the move handle parked at the rect's top-left
    // corner. translate(rect.x, rect.y) gives a clean alignment; the
    // CSS margin shifts it half-overlapping the corner for easy grab.
    this.moveHandle.hidden = false;
    this.moveHandle.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
  }

  // ─── Pointer interaction ─────────────────────────────────────────────────

  private onHandlePointerDown(e: PointerEvent): void {
    if (!this.isActive()) return;
    e.preventDefault();
    e.stopPropagation();
    this.moveHandle.setPointerCapture(e.pointerId);
    this.moveHandle.style.cursor = 'grabbing';
    this.dragging = true;
    const r = this.canvas.getBoundingClientRect();
    this.dragStart = { x: e.clientX - r.left, y: e.clientY - r.top };
    this.dragStartCenter = { x: this.viewport.centerX, y: this.viewport.centerY };
    const move = (ev: PointerEvent) => this.onHandlePointerMove(ev);
    const up = (ev: PointerEvent) => {
      this.moveHandle.removeEventListener('pointermove', move);
      this.moveHandle.removeEventListener('pointerup',     up);
      this.moveHandle.removeEventListener('pointercancel', up);
      this.onHandlePointerUp(ev);
    };
    this.moveHandle.addEventListener('pointermove', move);
    this.moveHandle.addEventListener('pointerup',     up);
    this.moveHandle.addEventListener('pointercancel', up);
  }

  private onHandlePointerMove(e: PointerEvent): void {
    if (!this.dragging || !this.dragStart || !this.dragStartCenter) return;
    const r = this.canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const mb = this.liveMapBounds();
    const dx = (px - this.dragStart.x) / mb.w;
    const dy = (py - this.dragStart.y) / mb.h;
    this.viewport = {
      ...this.viewport,
      centerX: Math.max(0, Math.min(1, this.dragStartCenter.x + dx)),
      centerY: Math.max(0, Math.min(1, this.dragStartCenter.y + dy)),
    };
    this._redrawNoAnim();
    if (this.onChangeFn) this.onChangeFn(this.viewport);
  }

  private onHandlePointerUp(e: PointerEvent): void {
    if (!this.dragging) return;
    try { this.moveHandle.releasePointerCapture(e.pointerId); } catch { /* no-op */ }
    this.moveHandle.style.cursor = '';
    this.dragging = false;
    this.dragStart = null;
    this.dragStartCenter = null;
    if (this.onChangeFn) this.onChangeFn(this.viewport);
  }
}
