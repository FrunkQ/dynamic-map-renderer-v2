import type { Marker } from '../types.ts';
import { defaultMarker } from '../types.ts';
import { MarkerLayer } from '../rendering/MarkerLayer.ts';

/**
 * MarkerEditor — GM-side canvas interaction for markers.
 *
 * Handles:
 *   - Click to select a marker
 *   - Badge clicks (toggle hidden / audioMuted / trackerEnabled)
 *   - Pointer drag to move selected marker (broadcasts on pointerup)
 *   - Right-click context menu ("Add marker here")
 *   - "Add Marker" button (centres on map)
 *
 * Delegates all rendering to MarkerLayer.
 * Pointer-capture can be suspended externally (e.g. when fog-draw is active).
 */
export class MarkerEditor {
  readonly layer: MarkerLayer;

  private markers:    Marker[] = [];
  private selectedId: string | null = null;
  private dragging    = false;

  private ctxMenuEl: HTMLElement;
  private _ctxPos = { x: 0.5, y: 0.5 }; // normalised map position of last right-click

  private readonly _onChange:     (markers: Marker[]) => void;
  private readonly _onSelect:     (marker: Marker | null) => void;
  private readonly _getIconCache: () => Map<string, ImageBitmap>;
  private _fogSelectCb: ((pos: { x: number; y: number }) => void) | null = null;

  constructor(
    canvas:       HTMLCanvasElement,
    ctxMenuEl:    HTMLElement,
    onChange:     (markers: Marker[]) => void,
    onSelect:     (marker: Marker | null) => void,
    getIconCache: () => Map<string, ImageBitmap> = () => new Map(),
  ) {
    this.layer          = new MarkerLayer(canvas);
    this.ctxMenuEl      = ctxMenuEl;
    this._onChange      = onChange;
    this._onSelect      = onSelect;
    this._getIconCache  = getIconCache;

    this._bindEvents(canvas);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Called by GMApp whenever the markers array or aspect ratio changes. */
  update(markers: Marker[], aspectRatio: number): void {
    this.markers = markers;
    this.layer.setAspectRatio(aspectRatio);
    this._redraw();
  }

  /** Programmatically select a marker by ID (e.g. from the sidebar dropdown). */
  selectById(id: string | null): void {
    this.selectedId = id;
    this._redraw();
  }

  /** Called when a click misses all markers — routes to fog polygon selection. */
  setFogSelectCallback(fn: (pos: { x: number; y: number }) => void): void {
    this._fogSelectCb = fn;
  }

  /** Disable / re-enable pointer capture — called when fog or viewport editors activate. */
  setPointerCapture(enabled: boolean): void {
    this.layer.canvas.style.pointerEvents = enabled ? 'auto' : 'none';
    if (!enabled) {
      this.selectedId = null;
      this.dragging   = false;
      this.ctxMenuEl.hidden = true;
      this._redraw();
    }
  }

  /** Create a new marker at normalised map position (x, y). */
  addMarker(x = 0.5, y = 0.5): Marker {
    const id = crypto.randomUUID();
    const m  = defaultMarker(id,
      Math.max(0, Math.min(1, x)),
      Math.max(0, Math.min(1, y)),
    );
    this.markers    = [...this.markers, m];
    this.selectedId = id;
    // Notify GMApp so it sets selectedMarkerId before onChange fires
    this._onSelect(m);
    this._onChange([...this.markers]);
    return m;
  }

  /** Last normalised map position of a right-click (for context-menu "add here"). */
  get ctxPos(): { x: number; y: number } { return { ...this._ctxPos }; }

  // ── Event binding ──────────────────────────────────────────────────────────

  private _bindEvents(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', (e) => this._onDown(e));
    canvas.addEventListener('pointermove', (e) => this._onMove(e));
    canvas.addEventListener('pointerup',   (e) => this._onUp(e));
    canvas.addEventListener('contextmenu', (e) => this._onCtxMenu(e));

    // Dismiss context menu when clicking anywhere else
    document.addEventListener('pointerdown', (e) => {
      if (!this.ctxMenuEl.contains(e.target as Node)) {
        this.ctxMenuEl.hidden = true;
      }
    }, { capture: true });
  }

  private _onDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    this.ctxMenuEl.hidden = true;

    const { x, y } = this._toCanvas(e);

    // Badge-click on the currently selected marker takes priority
    if (this.selectedId) {
      const sel = this.markers.find((m) => m.id === this.selectedId);
      if (sel) {
        const badge = this.layer.hitTestBadge(x, y, sel, null);
        if (badge) { this._handleBadge(sel, badge); return; }
      }
    }

    const hit = this.layer.hitTestMarker(x, y, this.markers, null);

    if (hit) {
      this.selectedId = hit.id;
      this._onSelect(hit);
      this.dragging   = true;
      (e.target as Element).setPointerCapture(e.pointerId);
    } else {
      this.selectedId = null;
      this._onSelect(null);
      // Missed all markers — let fog editor try to select a polygon at this position
      this._fogSelectCb?.(this.layer.unproject(x, y, null));
    }

    this._redraw();
  }

  private _onMove(e: PointerEvent): void {
    if (!this.dragging || !this.selectedId) return;
    const { x, y } = this._toCanvas(e);
    const norm = this.layer.unproject(x, y, null);

    this.markers = this.markers.map((m) =>
      m.id !== this.selectedId ? m : {
        ...m,
        position: {
          x: Math.max(0, Math.min(1, norm.x)),
          y: Math.max(0, Math.min(1, norm.y)),
        },
      }
    );

    this._redraw();
  }

  private _onUp(_e: PointerEvent): void {
    if (!this.dragging) return;
    this.dragging = false;
    // Broadcast final position after drag ends
    this._onChange([...this.markers]);
  }

  private _onCtxMenu(e: PointerEvent): void {
    e.preventDefault();
    const { x, y } = this._toCanvas(e);
    this._ctxPos    = this.layer.unproject(x, y, null);

    const mainArea  = document.getElementById('main-area')!;
    const areaRect  = mainArea.getBoundingClientRect();
    this.ctxMenuEl.style.left = `${e.clientX - areaRect.left}px`;
    this.ctxMenuEl.style.top  = `${e.clientY - areaRect.top}px`;
    this.ctxMenuEl.hidden     = false;
  }

  private _handleBadge(marker: Marker, badge: 'hidden' | 'audio' | 'tracker'): void {
    let updated: Marker;
    if      (badge === 'hidden')  updated = { ...marker, hidden:         !marker.hidden         };
    else if (badge === 'audio')   updated = { ...marker, audioMuted:     !marker.audioMuted     };
    else                          updated = { ...marker, trackerEnabled: !marker.trackerEnabled };

    this.markers = this.markers.map((m) => m.id === marker.id ? updated : m);
    this._onChange([...this.markers]);
    if (this.selectedId === marker.id) this._onSelect(updated);
    this._redraw();
  }


  // ── Helpers ────────────────────────────────────────────────────────────────

  private _redraw(): void {
    this.layer.render(this.markers, null, this.selectedId, true, this._getIconCache());
  }

  /** Convert a PointerEvent's client coords to canvas-buffer pixel coords. */
  private _toCanvas(e: PointerEvent): { x: number; y: number } {
    const rect = this.layer.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (this.layer.canvas.width  / rect.width),
      y: (e.clientY - rect.top)  * (this.layer.canvas.height / rect.height),
    };
  }
}
