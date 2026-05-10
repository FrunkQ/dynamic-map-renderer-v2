import type { ProjectorConnection, ProjectorViewport } from '../types.ts';
import { defaultProjectorViewport } from '../types.ts';

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

  private editMode = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('ProjectorViewportEditor: 2D context unavailable');
    this.ctx = ctx;

    this.syncSize();
    window.addEventListener('resize', () => { this.syncSize(); this.redraw(); });

    // Standard pointer handlers on the canvas itself. The canvas is
    // pointer-events: none in CSS by default, so these never fire — they
    // only become live when setEditMode(true) flips pointer-events to auto.
    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.canvas.addEventListener('pointerup',   (e) => this.onPointerUp(e));
    this.canvas.addEventListener('pointercancel', (e) => this.onPointerUp(e));
  }

  setEditMode(on: boolean): void {
    this.editMode = on;
    this.canvas.style.pointerEvents = on ? 'auto' : 'none';
    this.canvas.style.cursor = on ? 'grab' : '';
    this.redraw();
  }

  setMapAspect(aspect: number, hasMap: boolean): void {
    this.mapAspect = aspect;
    this.hasMap = hasMap;
    this.redraw();
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

  /** Whether all the inputs needed to draw the rectangle are available. */
  isActive(): boolean {
    return this.hasMap
      && !!this.connection
      && this.mapPixelsPerSquare !== null
      && this.mapPixelsPerSquare > 0;
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
    const mb = mapBounds(this.drawW, this.drawH, this.mapAspect);
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
      this.stopAnimation();
      return;
    }

    ctx.save();

    if (this.editMode) {
      // Faint green tint fill so the rect is easy to spot on busy maps.
      // Green keeps it visually distinct from the player viewport's orange tint.
      ctx.fillStyle = 'rgba(34, 197, 94, 0.10)';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }

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
  }

  // ─── Pointer interaction ─────────────────────────────────────────────────

  private onPointerDown(e: PointerEvent): void {
    if (!this.editMode || !this.isActive()) return;
    const rect = this.rectInCanvas();
    if (!rect) return;
    const r = this.canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    // Drag from anywhere inside the canvas during edit mode — easier to find
    // and matches the player viewport editor's "drag the rect" feel.
    if (px < rect.x || px > rect.x + rect.w || py < rect.y || py > rect.y + rect.h) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.style.cursor = 'grabbing';
    this.dragging = true;
    this.dragStart = { x: px, y: py };
    this.dragStartCenter = { x: this.viewport.centerX, y: this.viewport.centerY };
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.dragging || !this.dragStart || !this.dragStartCenter) return;
    const r = this.canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const mb = mapBounds(this.drawW, this.drawH, this.mapAspect);
    const dx = (px - this.dragStart.x) / mb.w;
    const dy = (py - this.dragStart.y) / mb.h;
    this.viewport = {
      ...this.viewport,
      centerX: Math.max(0, Math.min(1, this.dragStartCenter.x + dx)),
      centerY: Math.max(0, Math.min(1, this.dragStartCenter.y + dy)),
    };
    this._redrawNoAnim();
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.dragging) return;
    this.canvas.releasePointerCapture(e.pointerId);
    this.canvas.style.cursor = this.editMode ? 'grab' : '';
    this.dragging = false;
    this.dragStart = null;
    this.dragStartCenter = null;
    if (this.onChangeFn) this.onChangeFn(this.viewport);
  }
}
