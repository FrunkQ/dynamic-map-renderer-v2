import type { Marker } from '../types.ts';
import { defaultMarker } from '../types.ts';
import { MarkerLayer } from '../rendering/MarkerLayer.ts';
import { generateId } from '../utils/id.ts';

/**
 * MarkerEditor — GM-side canvas interaction for markers.
 *
 * Handles:
 *   - Click to select a marker
 *   - Badge clicks (toggle hidden / audioMuted; motion badge wired in B1)
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

  private ctxMenuEl:  HTMLElement;
  private _tooltip:   HTMLDivElement;
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

    this._tooltip = document.createElement('div');
    this._tooltip.className = 'marker-badge-tooltip';
    this._tooltip.hidden = true;
    document.body.appendChild(this._tooltip);

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
    const id = generateId();
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
    canvas.addEventListener('pointerdown',  (e) => this._onDown(e));
    canvas.addEventListener('pointermove',  (e) => this._onMove(e));
    canvas.addEventListener('pointerup',    (e) => this._onUp(e));
    canvas.addEventListener('pointerleave', ()  => { this._tooltip.hidden = true; });
    canvas.addEventListener('contextmenu',  (e) => this._onCtxMenu(e));

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
      if (sel && !sel.locked) {
        const badge = this.layer.hitTestBadge(x, y, sel, null);
        if (badge) { this._handleBadge(sel, badge); return; }
      }
    }

    const hit = this.layer.hitTestMarker(x, y, this.markers.filter(m => !m.locked), null);

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
    const { x, y } = this._toCanvas(e);

    if (this.dragging && this.selectedId) {
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
      this._tooltip.hidden = true;
      return;
    }

    // Badge tooltip hover
    const hit = this.layer.hitTestBadgeAny(x, y, this.markers, null);
    if (hit) {
      this._tooltip.textContent = this._badgeLabel(hit.marker, hit.badge);
      this._tooltip.hidden = false;
      const TW = this._tooltip.offsetWidth;
      const TH = this._tooltip.offsetHeight;
      const left = Math.min(e.clientX + 12, window.innerWidth  - TW - 6);
      const top  = Math.max(e.clientY - TH - 8, 6);
      this._tooltip.style.left = `${left}px`;
      this._tooltip.style.top  = `${top}px`;
    } else {
      this._tooltip.hidden = true;
    }
  }

  private _badgeLabel(m: Marker, badge: 'hidden' | 'audio' | 'motion'): string {
    if (badge === 'hidden') return m.hidden ? 'Hidden' : 'Visible';
    if (badge === 'audio') {
      if (m.roles.audio === 'source')   return m.audioMuted ? 'Muted Sound Source' : 'Sound Source';
      if (m.roles.audio === 'listener') return m.audioMuted ? 'Deaf Listener'      : 'Listener';
      return '';
    }
    if (m.roles.motion === 'source')  return m.motionMuted ? 'Muted Motion Source' : 'Motion Source';
    if (m.roles.motion === 'tracker') return m.motionMuted ? 'Motion Tracker Off' : 'Motion Tracker';
    return '';
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

  private _handleBadge(marker: Marker, badge: 'hidden' | 'audio' | 'motion'): void {
    if (marker.locked) return; // locked markers: badges are display-only

    let updated: Marker;
    if (badge === 'hidden')      updated = { ...marker, hidden:      !marker.hidden      };
    else if (badge === 'audio')  updated = { ...marker, audioMuted:  !marker.audioMuted  };
    else                         updated = { ...marker, motionMuted: !marker.motionMuted };

    this.markers = this.markers.map((m) => m.id === marker.id ? updated : m);
    this._onChange([...this.markers]);
    if (this.selectedId === marker.id) this._onSelect(updated);
    this._redraw();
  }


  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Optional motion-tracker overlay state pushed in by GMApp; redraw uses it on each frame. */
  motionOverlay: import('../rendering/MarkerLayer.ts').MotionOverlay | null = null;

  /** Force a redraw — call from a RAF loop while a scan/blobs are animating. */
  redraw(): void { this._redraw(); }

  private _redraw(): void {
    this.layer.render(this.markers, null, this.selectedId, true, this._getIconCache(), this.motionOverlay);
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
