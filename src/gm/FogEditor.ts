import type { FogPolygon, FogState, FogVertex } from '../types.ts';
import { generateId } from '../utils/id.ts';

export interface FogEditorMode {
  drawing: boolean;
  hasSelection: boolean;
  hasPolygons: boolean;
}

type FogChangeCallback = (fog: FogState) => void;
type ModeChangeCallback = (mode: FogEditorMode) => void;

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

  private dashOffset = 0;
  private marchAnimId: number | null = null;
  private cursorPos: FogVertex | null = null;

  constructor(canvas: HTMLCanvasElement, onChange: FogChangeCallback) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('FogEditor: canvas 2D context unavailable');
    this.ctx = ctx;
    this.onChange = onChange;

    this.syncSize();
    this.bindEvents();
    window.addEventListener('resize', () => { this.syncSize(); this.redraw(); });
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
    this.canvas.addEventListener('click',       (e) => this.handlePointerTap(this.eventToNorm(e)));
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

  private redraw(): void {
    this.ctx.clearRect(0, 0, this.drawW, this.drawH);

    for (const poly of this.polygons) {
      this.drawPolygon(poly.vertices, poly.color, poly.id === this.selectedId);
    }

    if (this.currentVertices.length > 0) {
      this.drawInProgress(this.currentVertices);
    }
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
    const b = this.getMapBounds(canvasW, canvasH);
    return {
      x: Math.max(0, Math.min(1, (px - b.x) / b.w)),
      y: Math.max(0, Math.min(1, (py - b.y) / b.h)),
    };
  }

  private getMapBounds(canvasW: number, canvasH: number): { x: number; y: number; w: number; h: number } {
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
