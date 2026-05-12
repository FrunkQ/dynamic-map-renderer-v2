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

  private ctxMenuEl:  HTMLElement;
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
    // (Hover tooltip removed in v2.11/A3b2 — badge titles are now native
    // `title` attributes on the HTML buttons in MarkerOverlay.)
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

    // Marker bodies are non-interactive (v2.11/A3b3) — selection and
    // movement happen through the overlay handles. A canvas click is
    // treated as "miss everything marker-related": deselect any current
    // marker and offer the spot to the fog editor for polygon selection.
    this.selectedId = null;
    this._onSelect(null);
    this._fogSelectCb?.(this.layer.unproject(x, y, null));
    this._redraw();
  }

  private _onMove(_e: PointerEvent): void {
    // Body drag removed in v2.11/A3b3 — overlay move handle is the only
    // path to reposition a marker. Method kept as a no-op so the canvas
    // pointermove listener doesn't error.
  }

  private _onUp(_e: PointerEvent): void {
    // Body drag removed in v2.11/A3b3 — see _onMove.
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

  /** Same conversion as _toCanvas but for raw clientX/Y (used by overlay
   *  handles since they don't have access to a PointerEvent in canvas space). */
  private _clientToCanvas(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.layer.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (this.layer.canvas.width  / rect.width),
      y: (clientY - rect.top)  * (this.layer.canvas.height / rect.height),
    };
  }

  // ── Overlay-driven drag (move handle on each marker) ─────────────────────

  /** State for the active drag started from an overlay move handle. */
  private _overlayDrag: { id: string; offsetX: number; offsetY: number } | null = null;

  /**
   * Begin a marker move-drag initiated from the screen-space move handle.
   * Records the offset between the cursor and the marker centre so the
   * marker stays glued to the cursor at that offset for the rest of the
   * drag — instead of snapping its centre under the cursor (which would
   * feel jumpy when the user grabbed the corner handle).
   */
  beginOverlayDrag(markerId: string, clientX: number, clientY: number): void {
    const marker = this.markers.find((m) => m.id === markerId);
    if (!marker || marker.locked) return;
    const { x, y }   = this._clientToCanvas(clientX, clientY);
    const cursorNorm = this.layer.unproject(x, y, null);
    this._overlayDrag = {
      id:      markerId,
      offsetX: marker.position.x - cursorNorm.x,
      offsetY: marker.position.y - cursorNorm.y,
    };
    if (this.selectedId !== markerId) {
      this.selectedId = markerId;
      this._onSelect(marker);
    }
    this._redraw();
  }

  /** Drive the in-flight overlay drag from a pointer move on the handle. */
  updateOverlayDrag(clientX: number, clientY: number): void {
    if (!this._overlayDrag) return;
    const { x, y }   = this._clientToCanvas(clientX, clientY);
    const cursorNorm = this.layer.unproject(x, y, null);
    const newX = Math.max(0, Math.min(1, cursorNorm.x + this._overlayDrag.offsetX));
    const newY = Math.max(0, Math.min(1, cursorNorm.y + this._overlayDrag.offsetY));
    const id   = this._overlayDrag.id;
    this.markers = this.markers.map((m) =>
      m.id !== id ? m : { ...m, position: { x: newX, y: newY } },
    );
    this._redraw();
  }

  /** End the overlay drag and broadcast the final position. */
  endOverlayDrag(): void {
    if (!this._overlayDrag) return;
    this._overlayDrag = null;
    this._onChange([...this.markers]);
  }

  /**
   * Tap an overlay action badge — toggles its state AND selects the marker
   * (matches the v2.11/A3b spec: every badge tap is both an action and a
   * selection so the side panel surfaces relevant settings without an
   * extra step). Maps the badge kind to the legacy _handleBadge target.
   */
  toggleOverlayBadge(markerId: string, kind: import('../rendering/MarkerOverlay.ts').BadgeKind): void {
    const marker = this.markers.find((m) => m.id === markerId);
    if (!marker || marker.locked) return;
    if (this.selectedId !== markerId) {
      this.selectedId = markerId;
      this._onSelect(marker);
    }
    const target: 'hidden' | 'audio' | 'motion' =
      kind === 'visibility' ? 'hidden' :
      (kind === 'audio-source' || kind === 'audio-listener') ? 'audio' :
      'motion';
    this._handleBadge(marker, target);
  }
}
