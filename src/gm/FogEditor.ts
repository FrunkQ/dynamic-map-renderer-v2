import type { FogPolygon, FogState, FogVertex } from '../types.ts';

type FogChangeCallback = (fog: FogState) => void;

function generateId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

/**
 * FogEditor
 *
 * Handles all fog-of-war drawing interactions on the GM map preview canvas.
 * Supports mouse and touch (stylus-friendly).
 *
 * - Click canvas to start a polygon
 * - Click existing vertices to close it
 * - Right-click or press Escape to cancel current polygon
 * - Click inside a completed polygon to select it
 * - Delete key or toolbar button to remove selected polygon
 *
 * Coordinates are always stored as 0–1 normalised values relative to canvas.
 */
export class FogEditor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private onChange: FogChangeCallback;

  private polygons: FogPolygon[] = [];
  private currentVertices: FogVertex[] = [];
  private selectedId: string | null = null;
  private activeColor = '#000000';
  private enabled = false;

  // Pointer state for touch
  private lastPointer: { x: number; y: number } | null = null;

  constructor(canvas: HTMLCanvasElement, onChange: FogChangeCallback) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('FogEditor: canvas 2D context unavailable');
    this.ctx = ctx;
    this.onChange = onChange;

    this.bindEvents();
  }

  enable(): void  { this.enabled = true;  this.redraw(); }
  disable(): void { this.enabled = false; this.redraw(); }

  setColor(color: string): void {
    this.activeColor = color;
  }

  /** Load polygons from saved state */
  loadState(fog: FogState): void {
    this.polygons = fog.polygons.map((p) => ({ ...p, vertices: [...p.vertices] }));
    this.currentVertices = [];
    this.selectedId = null;
    this.redraw();
  }

  /** Delete the currently selected polygon */
  deleteSelected(): void {
    if (!this.selectedId) return;
    this.polygons = this.polygons.filter((p) => p.id !== this.selectedId);
    this.selectedId = null;
    this.redraw();
    this.emit();
  }

  /** Cancel the polygon currently being drawn */
  cancelCurrent(): void {
    this.currentVertices = [];
    this.redraw();
  }

  /** Clear all polygons */
  clearAll(): void {
    this.polygons = [];
    this.currentVertices = [];
    this.selectedId = null;
    this.redraw();
    this.emit();
  }

  getSelectedId(): string | null {
    return this.selectedId;
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private bindEvents(): void {
    this.canvas.addEventListener('click',        (e) => this.handlePointerTap(this.eventToNorm(e)));
    this.canvas.addEventListener('contextmenu',  (e) => { e.preventDefault(); this.cancelCurrent(); });

    // Touch support
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.touches[0];
      if (t) this.lastPointer = this.touchToNorm(t);
    }, { passive: false });

    this.canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      if (t) {
        const pos = this.touchToNorm(t);
        // Only register as tap if pointer didn't move much (not a scroll)
        if (this.lastPointer) {
          const dx = pos.x - this.lastPointer.x;
          const dy = pos.y - this.lastPointer.y;
          if (Math.sqrt(dx * dx + dy * dy) < 0.02) {
            this.handlePointerTap(pos);
          }
        }
      }
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.cancelCurrent();
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedId) {
        this.deleteSelected();
      }
    });
  }

  private handlePointerTap(pos: FogVertex): void {
    if (!this.enabled) {
      // Selection mode when editor is disabled
      this.trySelect(pos);
      return;
    }

    // If drawing: check if clicking near first vertex to close polygon
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
    this.selectedId = poly.id;
    this.redraw();
    this.emit();
  }

  private trySelect(pos: FogVertex): void {
    // Hit-test polygons in reverse order (topmost first)
    for (let i = this.polygons.length - 1; i >= 0; i--) {
      const poly = this.polygons[i]!;
      if (this.pointInPolygon(pos, poly.vertices)) {
        this.selectedId = poly.id;
        this.redraw();
        return;
      }
    }
    this.selectedId = null;
    this.redraw();
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

  private redraw(): void {
    const { width, height } = this.canvas;
    this.ctx.clearRect(0, 0, width, height);

    // Draw completed polygons
    for (const poly of this.polygons) {
      this.drawPolygon(poly.vertices, poly.color, poly.id === this.selectedId);
    }

    // Draw in-progress polygon
    if (this.currentVertices.length > 0) {
      this.drawInProgress(this.currentVertices);
    }
  }

  private drawPolygon(vertices: FogVertex[], color: string, selected: boolean): void {
    if (vertices.length < 2) return;
    const { width, height } = this.canvas;
    const ctx = this.ctx;

    ctx.beginPath();
    ctx.moveTo(vertices[0]!.x * width, vertices[0]!.y * height);
    for (let i = 1; i < vertices.length; i++) {
      ctx.lineTo(vertices[i]!.x * width, vertices[i]!.y * height);
    }
    ctx.closePath();

    ctx.fillStyle = color + 'cc'; // Semi-transparent in GM view
    ctx.fill();

    if (selected) {
      ctx.strokeStyle = '#00d4ff';
      ctx.lineWidth   = 2;
      ctx.setLineDash([6, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawInProgress(vertices: FogVertex[]): void {
    const { width, height } = this.canvas;
    const ctx = this.ctx;

    ctx.beginPath();
    ctx.moveTo(vertices[0]!.x * width, vertices[0]!.y * height);
    for (let i = 1; i < vertices.length; i++) {
      ctx.lineTo(vertices[i]!.x * width, vertices[i]!.y * height);
    }

    ctx.strokeStyle = this.activeColor;
    ctx.lineWidth   = 2;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw vertex dots
    for (const v of vertices) {
      ctx.beginPath();
      ctx.arc(v.x * width, v.y * height, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = this.activeColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Highlight closing vertex when close enough to snap
    if (vertices.length >= 3) {
      const first = vertices[0]!;
      ctx.beginPath();
      ctx.arc(first.x * width, first.y * height, 9, 0, Math.PI * 2);
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth   = 2;
      ctx.stroke();
    }
  }

  private eventToNorm(e: MouseEvent): FogVertex {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  private touchToNorm(t: Touch): FogVertex {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (t.clientX - rect.left) / rect.width,
      y: (t.clientY - rect.top) / rect.height,
    };
  }

  private emit(): void {
    this.onChange({ polygons: this.polygons });
  }
}
