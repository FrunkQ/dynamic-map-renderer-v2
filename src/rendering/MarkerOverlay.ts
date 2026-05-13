/**
 * MarkerOverlay — HTML screen-space layer for GM canvas chrome.
 *
 * NAMING NOTE: the file is called MarkerOverlay for historical reasons (it
 * started life in v2.11/A3a as labels-only, then grew the marker handle
 * stack), but as of v2.11/A8 it ALSO hosts the player + projector viewport
 * rectangle handles. Same screen-space layer, same handle CSS, same pointer
 * juggling — markers and rectangles share infrastructure deliberately so
 * the design language stays consistent. The class name is left alone to
 * avoid a churny rename across many callers; mental model is "all
 * screen-space GM chrome lives here."
 *
 * Layout: one root `<div>` per item (marker OR viewport rectangle) that's
 * present in the current update list. Sub-elements (label, move handle,
 * badges, selection handles, resize / aspect / maximise buttons) sit
 * inside that root and are positioned in CSS px so they stay
 * screen-fixed regardless of map zoom. The whole stack lives above every
 * canvas (z-index 5 in main.css) and most of it is pointer-events:none —
 * only interactive handles opt back in via their own CSS rules.
 *
 * Event handlers are set once via setHandlers() and dispatched by the
 * overlay when the user interacts with a handle. The overlay does the
 * pointer-event juggling (setPointerCapture, window-level move/up); the
 * consumer (MarkerEditor / ViewportEditor / ProjectorViewportEditor via
 * GMApp) handles the state mutation given the item id + raw client coords.
 *
 * Update API:
 *   - update(markerItems)          — full sync of per-marker chrome
 *   - updateRect(kind, rectItem)   — single viewport rectangle's chrome
 *                                     (kind: 'player' | 'projector')
 *
 * Both update paths are idempotent — DOM mutations only happen when
 * something actually changed, critical for performance during motion-
 * tracker animation and camera pan/zoom where redraws fire ~60 Hz.
 */

export type BadgeKind =
  | 'visibility'
  | 'audio-source'  | 'audio-listener'
  | 'motion-source' | 'motion-tracker';

export interface OverlayBadge {
  /** Which badge this is; drives the icon + the click-action target. */
  kind: BadgeKind;
  /** Whether the badge is in its "active" state (visible / unmuted). */
  on:   boolean;
  /** Tooltip text (native title attribute). */
  title: string;
}

export interface OverlayItem {
  id: string;
  /** Icon centre in CSS px relative to the overlay container. */
  anchorX: number;
  anchorY: number;
  /** Icon body half-extents in CSS px — for placing handles at edges. */
  iconHalfWidthPx:  number;
  iconHalfHeightPx: number;

  /** Name label below the icon. Hidden when text is empty. */
  label?: { text: string; visible: boolean };

  /**
   * GM-only move handle centred above the icon. Omit on player / projector.
   * When `interactive` is false (e.g. locked-marker placeholder preview)
   * the handle is shown but doesn't accept pointer events.
   */
  moveHandle?: { visible: boolean; interactive: boolean };

  /**
   * GM-only action badges shown in a row above the move handle. Order is
   * caller-controlled (typically: visibility, then audio variant, then
   * motion variant). 1–3 badges depending on the marker's roles.
   */
  badges?: OverlayBadge[];

  /**
   * Locked markers: render in display-only mode (no move handle; badges
   * shift down to where the move handle would have been and become
   * non-interactive). The CSS rules under `.marker-overlay-item--locked`
   * handle the layout shift.
   */
  locked?: boolean;

  /**
   * When true, render the selection ring around the icon and show the
   * selection-only handles (resize now; rotate in A3b5) below it.
   */
  selected?: boolean;
}

export type MoveDragHandler = (
  markerId: string,
  clientX:  number,
  clientY:  number,
  phase:    'start' | 'move' | 'end',
) => void;

export type ResizeDragHandler = (
  markerId: string,
  clientX:  number,
  clientY:  number,
  phase:    'start' | 'move' | 'end',
) => void;

export type RotateDragHandler = (
  markerId: string,
  clientX:  number,
  clientY:  number,
  phase:    'start' | 'move' | 'end',
) => void;

export type RectKind = 'player' | 'projector';

export interface RectOverlayItem {
  /** Rect bounds in CSS px, relative to overlay container. */
  x: number; y: number; w: number; h: number;
  /** Move-handle and selection-ring colour (matches the rect's stroke). */
  color: string;
  /** Whether the rect is currently selected. Controls visibility of the
   *  player-only resize handle + maximise / aspect-lock buttons. */
  selected: boolean;
  /** Player-only: show resize handle (bottom-right). */
  showResize?: boolean;
  /** Show maximise / restore toggle. State drives the icon swap. */
  maximise?: 'normal' | 'maximised';
  /** Player-only: show aspect-lock button. `pendingUndo` swaps the icon
   *  to "undo" so a second click reverts to the pre-snap bounds. */
  aspectLock?: 'apply' | 'undo';
}

export type RectMoveHandler   = (kind: RectKind, clientX: number, clientY: number, phase: 'start' | 'move' | 'end') => void;
export type RectResizeHandler = (kind: RectKind, clientX: number, clientY: number, phase: 'start' | 'move' | 'end') => void;
export type RectClickHandler  = (kind: RectKind) => void;

export interface OverlayHandlers {
  /** Move handle drag — fires for the entire pointerdown → pointerup arc. */
  onMoveDrag?: MoveDragHandler;
  /** Single tap on an action badge — should toggle its state and select. */
  onBadgeClick?: (markerId: string, kind: BadgeKind) => void;
  /** Resize handle drag — distance-based scaling of the selected marker. */
  onResizeDrag?: ResizeDragHandler;
  /** Rotate handle drag — angle-based rotation of the selected marker. */
  onRotateDrag?: RotateDragHandler;
  /** Delete handle click — remove the selected marker. */
  onDeleteClick?: (markerId: string) => void;

  /** Viewport rectangle move-handle drag. */
  onRectMoveDrag?:    RectMoveHandler;
  /** Player viewport resize-handle drag. */
  onRectResizeDrag?:  RectResizeHandler;
  /** Click on a rectangle's maximise / restore button. */
  onRectMaximise?:    RectClickHandler;
  /** Click on the aspect-lock button (player only). */
  onRectAspectLock?:  RectClickHandler;
}

// ── Badge icon SVG fragments (Lucide-inspired strokes) ───────────────────────

const SVG_HEAD = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
const SVG_TAIL = '</svg>';
const SVG_SLASH = '<line x1="2" y1="2" x2="22" y2="22"/>';

const ICON_EYE          = '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>';
const ICON_EYE_OFF      = '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/>' + SVG_SLASH;
const ICON_SPEAKER      = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>';
const ICON_EAR          = '<path d="M6 8.5a6.5 6.5 0 1 1 13 0c0 6-6 6-6 10a3.5 3.5 0 1 1-7 0"/><path d="M15 8.5a2.5 2.5 0 0 0-5 0v1a2 2 0 0 1-2 2"/>';
const ICON_MOTION_ARROW = '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>';
const ICON_RADAR        = '<circle cx="12" cy="12" r="2"/><path d="M14 12a2 2 0 1 0-2-2"/><path d="M16 12a4 4 0 1 0-4-4"/>';

function badgeIconSvg(kind: BadgeKind, on: boolean): string {
  let inner: string;
  switch (kind) {
    case 'visibility':       inner = on ? ICON_EYE          : ICON_EYE_OFF;   break;
    case 'audio-source':     inner = on ? ICON_SPEAKER      : ICON_SPEAKER + SVG_SLASH; break;
    case 'audio-listener':   inner = on ? ICON_EAR          : ICON_EAR     + SVG_SLASH; break;
    case 'motion-source':    inner = on ? ICON_MOTION_ARROW : ICON_MOTION_ARROW + SVG_SLASH; break;
    case 'motion-tracker':   inner = on ? ICON_RADAR        : ICON_RADAR   + SVG_SLASH; break;
  }
  return SVG_HEAD + inner + SVG_TAIL;
}

// Colour scheme mirrors the old canvas badges from MarkerLayer:
//   source emitter → blue (on) / purple (muted)
//   listener / tracker / visibility → green (on) / red (off)
function badgeColor(kind: BadgeKind, on: boolean): string {
  if (kind === 'audio-source' || kind === 'motion-source') {
    return on ? '#3b82f6' : '#a855f7';
  }
  return on ? '#22c55e' : '#dc2626';
}

interface MarkerElements {
  root:          HTMLDivElement;
  label:         HTMLDivElement | null;
  moveHandle:    HTMLDivElement | null;
  badgesRow:     HTMLDivElement | null;
  /** Map of badge kind → button element so we can reuse / restyle each. */
  badges:        Map<BadgeKind, HTMLButtonElement>;
  selectionRing: HTMLDivElement | null;
  resizeHandle:  HTMLDivElement | null;
  rotateHandle:  HTMLDivElement | null;
  deleteHandle:  HTMLDivElement | null;
  lockGlyph:     HTMLDivElement | null;
}

interface RectElements {
  root:        HTMLDivElement;
  moveHandle:  HTMLDivElement;
  resizeHandle:  HTMLDivElement | null;
  maximiseBtn:   HTMLDivElement | null;
  aspectBtn:     HTMLDivElement | null;
  /** Cached state strings for idempotent DOM updates. */
  lastMaximise: 'normal' | 'maximised' | null;
  lastAspect:   'apply'  | 'undo'      | null;
}

export class MarkerOverlay {
  private container: HTMLElement;
  private items     = new Map<string, MarkerElements>();
  private rects     = new Map<RectKind, RectElements>();
  private handlers: OverlayHandlers = {};

  constructor(container: HTMLElement) {
    this.container = container;
  }

  setHandlers(h: OverlayHandlers): void {
    this.handlers = h;
  }

  /**
   * Sync the overlay to the given marker list. New entries get their
   * root + sub-elements created; existing ones have positions / text /
   * visibility updated in place; removed entries are torn down.
   */
  update(items: OverlayItem[]): void {
    const seen = new Set<string>();
    for (const item of items) {
      seen.add(item.id);
      let el = this.items.get(item.id);
      if (!el) {
        el = this._create(item.id);
        this.items.set(item.id, el);
      }
      this._applyItem(el, item);
    }
    for (const [id, el] of this.items) {
      if (!seen.has(id)) {
        el.root.remove();
        this.items.delete(id);
      }
    }
  }

  /** Remove every marker + rect element — used on hard resets. */
  clear(): void {
    for (const el of this.items.values()) el.root.remove();
    this.items.clear();
    for (const r of this.rects.values()) r.root.remove();
    this.rects.clear();
  }

  /**
   * Sync the screen-space chrome for one viewport rectangle. Pass `null`
   * to remove (e.g. projector disconnected). The move handle is always
   * present when the rect is visible; selection-gated handles (resize,
   * maximise, aspect-lock) appear / disappear based on `item.selected`.
   */
  updateRect(kind: RectKind, item: RectOverlayItem | null): void {
    let r = this.rects.get(kind);
    if (!item) {
      if (r) { r.root.remove(); this.rects.delete(kind); }
      return;
    }
    if (!r) {
      r = this._createRect(kind);
      this.rects.set(kind, r);
    }
    this._applyRect(r, kind, item);
  }

  private _createRect(kind: RectKind): RectElements {
    const root = document.createElement('div');
    root.className = `marker-overlay-rect marker-overlay-rect--${kind}`;
    root.dataset['rectKind'] = kind;
    const moveHandle = document.createElement('div');
    moveHandle.className = 'marker-handle marker-handle--rect-move';
    moveHandle.title = 'Drag to move';
    moveHandle.innerHTML = `
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
    this._bindRectHandle(moveHandle, kind, 'move');
    root.appendChild(moveHandle);
    this.container.appendChild(root);
    return {
      root, moveHandle,
      resizeHandle: null, maximiseBtn: null, aspectBtn: null,
      lastMaximise: null, lastAspect: null,
    };
  }

  private _applyRect(r: RectElements, kind: RectKind, item: RectOverlayItem): void {
    r.root.style.left   = `${item.x}px`;
    r.root.style.top    = `${item.y}px`;
    r.root.style.width  = `${item.w}px`;
    r.root.style.height = `${item.h}px`;
    r.root.style.setProperty('--rect-color', item.color);
    r.root.classList.toggle('marker-overlay-rect--selected', item.selected);

    this._toggleRectAux(r, 'resizeHandle', !!item.showResize, () => {
      const el = document.createElement('div');
      el.className = 'marker-handle marker-handle--rect-resize';
      el.title = 'Drag to resize';
      el.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="15 3 21 3 21 9"/>
          <polyline points="9 21 3 21 3 15"/>
          <line x1="21" y1="3"  x2="14" y2="10"/>
          <line x1="3"  y1="21" x2="10" y2="14"/>
        </svg>
      `;
      this._bindRectHandle(el, kind, 'resize');
      return el;
    });

    const wantMax = item.maximise !== undefined;
    this._toggleRectAux(r, 'maximiseBtn', wantMax, () => {
      const el = document.createElement('div');
      el.className = 'marker-handle marker-handle--rect-maximise';
      this._bindRectClick(el, kind, 'maximise');
      return el;
    });
    if (r.maximiseBtn && wantMax && item.maximise !== r.lastMaximise) {
      r.lastMaximise = item.maximise!;
      r.maximiseBtn.title = item.maximise === 'maximised' ? 'Restore' : 'Maximise (fill the map)';
      r.maximiseBtn.innerHTML = item.maximise === 'maximised'
        ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
             <rect x="7" y="3"  width="14" height="14" rx="1"/>
             <rect x="3" y="7"  width="14" height="14" rx="1" fill="rgba(20, 24, 36, 0.85)"/>
           </svg>`
        : `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
             <rect x="4" y="4" width="16" height="16" rx="1"/>
           </svg>`;
    }

    const wantAspect = item.aspectLock !== undefined;
    this._toggleRectAux(r, 'aspectBtn', wantAspect, () => {
      const el = document.createElement('div');
      el.className = 'marker-handle marker-handle--rect-aspect';
      this._bindRectClick(el, kind, 'aspect');
      return el;
    });
    if (r.aspectBtn && wantAspect && item.aspectLock !== r.lastAspect) {
      r.lastAspect = item.aspectLock!;
      r.aspectBtn.title = item.aspectLock === 'undo'
        ? 'Restore previous size'
        : 'Snap to 16:9 (short edge defines)';
      r.aspectBtn.innerHTML = item.aspectLock === 'undo'
        ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
             <path d="M3 12a9 9 0 1 0 3-6.7"/>
             <polyline points="3 4 3 9 8 9"/>
           </svg>`
        : `<span style="font: 700 8px/1 system-ui,sans-serif; letter-spacing:-0.5px;">16:9</span>`;
    }
  }

  private _toggleRectAux(
    r: RectElements,
    key: 'resizeHandle' | 'maximiseBtn' | 'aspectBtn',
    want: boolean,
    factory: () => HTMLDivElement,
  ): void {
    if (want && !r[key]) {
      const el = factory();
      r.root.appendChild(el);
      r[key] = el;
    } else if (!want && r[key]) {
      r[key]!.remove();
      r[key] = null;
      if (key === 'maximiseBtn') r.lastMaximise = null;
      if (key === 'aspectBtn')   r.lastAspect   = null;
    }
  }

  private _bindRectHandle(handle: HTMLDivElement, kind: RectKind, action: 'move' | 'resize'): void {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      e.stopPropagation();
      try { handle.setPointerCapture(e.pointerId); } catch { /* not supported */ }
      const fire = (phase: 'start' | 'move' | 'end', clientX: number, clientY: number) => {
        if (action === 'move')   this.handlers.onRectMoveDrag?.(kind, clientX, clientY, phase);
        if (action === 'resize') this.handlers.onRectResizeDrag?.(kind, clientX, clientY, phase);
      };
      fire('start', e.clientX, e.clientY);
      const onMove = (ev: PointerEvent) => fire('move', ev.clientX, ev.clientY);
      const onEnd  = (ev: PointerEvent) => {
        fire('end', ev.clientX, ev.clientY);
        handle.removeEventListener('pointermove',   onMove);
        handle.removeEventListener('pointerup',     onEnd);
        handle.removeEventListener('pointercancel', onEnd);
      };
      handle.addEventListener('pointermove',   onMove);
      handle.addEventListener('pointerup',     onEnd);
      handle.addEventListener('pointercancel', onEnd);
    });
  }

  private _bindRectClick(btn: HTMLDivElement, kind: RectKind, action: 'maximise' | 'aspect'): void {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (action === 'maximise') this.handlers.onRectMaximise?.(kind);
      if (action === 'aspect')   this.handlers.onRectAspectLock?.(kind);
    });
    btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
  }

  private _create(id: string): MarkerElements {
    const root = document.createElement('div');
    root.className = 'marker-overlay-item';
    root.dataset['markerId'] = id;
    this.container.appendChild(root);
    return {
      root, label: null, moveHandle: null, badgesRow: null,
      badges: new Map(), selectionRing: null, resizeHandle: null, rotateHandle: null,
      deleteHandle: null, lockGlyph: null,
    };
  }

  private _applyItem(el: MarkerElements, item: OverlayItem): void {
    // Root is anchored at the icon centre via top/left; sub-elements offset
    // from there using CSS variables so resizing one marker doesn't cascade.
    el.root.style.left = `${item.anchorX}px`;
    el.root.style.top  = `${item.anchorY}px`;
    el.root.style.setProperty('--icon-half-w', `${item.iconHalfWidthPx}px`);
    el.root.style.setProperty('--icon-half-h', `${item.iconHalfHeightPx}px`);
    el.root.classList.toggle('marker-overlay-item--locked',   !!item.locked);
    el.root.classList.toggle('marker-overlay-item--selected', !!item.selected);

    this._applyLabel(el, item);
    this._applyMoveHandle(el, item);
    this._applyLockGlyph(el, item);
    this._applyBadges(el, item);
    this._applySelectionAffordances(el, item);
  }

  /** Locked-marker padlock — sits where the move handle would be. Purely
   *  visual; clicks pass through (pointer-events:none in CSS). */
  private _applyLockGlyph(el: MarkerElements, item: OverlayItem): void {
    const want = !!item.locked;
    if (!want) {
      if (el.lockGlyph) { el.lockGlyph.remove(); el.lockGlyph = null; }
      return;
    }
    if (!el.lockGlyph) {
      el.lockGlyph = document.createElement('div');
      el.lockGlyph.className = 'marker-handle marker-handle--lock';
      el.lockGlyph.title = 'Locked — unlock from the side panel to edit';
      el.lockGlyph.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      `;
      el.root.appendChild(el.lockGlyph);
    }
  }

  /** Selection-only chrome: dashed ring around the icon + resize handle below it. */
  private _applySelectionAffordances(el: MarkerElements, item: OverlayItem): void {
    const want = !!item.selected && !item.locked;

    // Selection ring — purely visual, no interaction.
    if (want && !el.selectionRing) {
      el.selectionRing = document.createElement('div');
      el.selectionRing.className = 'marker-selection-ring';
      el.root.appendChild(el.selectionRing);
    } else if (!want && el.selectionRing) {
      el.selectionRing.remove();
      el.selectionRing = null;
    }

    // Resize handle — press-and-drag to scale the marker by cursor distance
    // from its centre. Below the icon so it stays out of the badge / move
    // handle stack above.
    if (want && !el.resizeHandle) {
      el.resizeHandle = document.createElement('div');
      el.resizeHandle.className = 'marker-handle marker-handle--resize';
      el.resizeHandle.title = 'Drag away from / toward the marker to resize';
      el.resizeHandle.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="15 3 21 3 21 9"/>
          <polyline points="9 21 3 21 3 15"/>
          <line x1="21" y1="3"  x2="14" y2="10"/>
          <line x1="3"  y1="21" x2="10" y2="14"/>
        </svg>
      `;
      this._bindResizeHandle(el.resizeHandle, item.id);
      el.root.appendChild(el.resizeHandle);
    } else if (!want && el.resizeHandle) {
      el.resizeHandle.remove();
      el.resizeHandle = null;
    }

    // Rotate handle (v2.11/A3b5) — sits to the right of the resize handle.
    // Press + drag around the marker centre to rotate the icon body.
    if (want && !el.rotateHandle) {
      el.rotateHandle = document.createElement('div');
      el.rotateHandle.className = 'marker-handle marker-handle--rotate';
      el.rotateHandle.title = 'Drag in a circle around the marker to rotate';
      el.rotateHandle.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-3-6.7"/>
          <polyline points="21 4 21 9 16 9"/>
        </svg>
      `;
      this._bindRotateHandle(el.rotateHandle, item.id);
      el.root.appendChild(el.rotateHandle);
    } else if (!want && el.rotateHandle) {
      el.rotateHandle.remove();
      el.rotateHandle = null;
    }

    // Delete handle — red trashcan at the icon's bottom-left, mirroring the
    // text-map editor's per-element delete affordance so markers and text
    // boxes share the same selection chrome.
    if (want && !el.deleteHandle) {
      el.deleteHandle = document.createElement('div');
      el.deleteHandle.className = 'marker-handle marker-handle--delete';
      el.deleteHandle.title = 'Delete this marker';
      el.deleteHandle.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 6h18"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          <line x1="10" y1="11" x2="10" y2="17"/>
          <line x1="14" y1="11" x2="14" y2="17"/>
        </svg>
      `;
      this._bindDeleteHandle(el.deleteHandle, item.id);
      el.root.appendChild(el.deleteHandle);
    } else if (!want && el.deleteHandle) {
      el.deleteHandle.remove();
      el.deleteHandle = null;
    }
  }

  private _bindDeleteHandle(handle: HTMLDivElement, markerId: string): void {
    // pointerdown swallows the event so a press on the trashcan doesn't
    // also start a marker drag or deselect; the click handler does the work.
    handle.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
    handle.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handlers.onDeleteClick?.(markerId);
    });
  }

  private _bindResizeHandle(handle: HTMLDivElement, markerId: string): void {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      e.stopPropagation();
      try { handle.setPointerCapture(e.pointerId); } catch { /* not supported */ }
      this.handlers.onResizeDrag?.(markerId, e.clientX, e.clientY, 'start');
      const onMove = (ev: PointerEvent) => this.handlers.onResizeDrag?.(markerId, ev.clientX, ev.clientY, 'move');
      const onEnd  = (ev: PointerEvent) => {
        this.handlers.onResizeDrag?.(markerId, ev.clientX, ev.clientY, 'end');
        handle.removeEventListener('pointermove',   onMove);
        handle.removeEventListener('pointerup',     onEnd);
        handle.removeEventListener('pointercancel', onEnd);
      };
      handle.addEventListener('pointermove',   onMove);
      handle.addEventListener('pointerup',     onEnd);
      handle.addEventListener('pointercancel', onEnd);
    });
  }

  private _bindRotateHandle(handle: HTMLDivElement, markerId: string): void {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      e.stopPropagation();
      try { handle.setPointerCapture(e.pointerId); } catch { /* not supported */ }
      this.handlers.onRotateDrag?.(markerId, e.clientX, e.clientY, 'start');
      const onMove = (ev: PointerEvent) => this.handlers.onRotateDrag?.(markerId, ev.clientX, ev.clientY, 'move');
      const onEnd  = (ev: PointerEvent) => {
        this.handlers.onRotateDrag?.(markerId, ev.clientX, ev.clientY, 'end');
        handle.removeEventListener('pointermove',   onMove);
        handle.removeEventListener('pointerup',     onEnd);
        handle.removeEventListener('pointercancel', onEnd);
      };
      handle.addEventListener('pointermove',   onMove);
      handle.addEventListener('pointerup',     onEnd);
      handle.addEventListener('pointercancel', onEnd);
    });
  }

  private _applyLabel(el: MarkerElements, item: OverlayItem): void {
    const want = !!item.label && item.label.visible && !!item.label.text;
    if (!want) {
      if (el.label) { el.label.remove(); el.label = null; }
      return;
    }
    if (!el.label) {
      el.label = document.createElement('div');
      el.label.className = 'marker-label';
      el.root.appendChild(el.label);
    }
    if (el.label.textContent !== item.label!.text) {
      el.label.textContent = item.label!.text;
    }
  }

  private _applyMoveHandle(el: MarkerElements, item: OverlayItem): void {
    const want = !!item.moveHandle && item.moveHandle.visible;
    if (!want) {
      if (el.moveHandle) { el.moveHandle.remove(); el.moveHandle = null; }
      return;
    }
    if (!el.moveHandle) {
      el.moveHandle = document.createElement('div');
      el.moveHandle.className = 'marker-handle marker-handle--move';
      el.moveHandle.title = 'Drag to move marker';
      // Drag glyph — four arrows.
      el.moveHandle.innerHTML = `
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
      this._bindMoveHandle(el.moveHandle, item.id);
      el.root.appendChild(el.moveHandle);
    }
    el.moveHandle.style.pointerEvents = item.moveHandle!.interactive ? 'auto' : 'none';
    el.moveHandle.style.opacity = item.moveHandle!.interactive ? '1' : '0.4';
  }

  private _applyBadges(el: MarkerElements, item: OverlayItem): void {
    const wantList = item.badges ?? [];
    if (wantList.length === 0) {
      if (el.badgesRow) {
        el.badgesRow.remove();
        el.badgesRow = null;
        el.badges.clear();
      }
      return;
    }
    if (!el.badgesRow) {
      el.badgesRow = document.createElement('div');
      el.badgesRow.className = 'marker-badges';
      el.root.appendChild(el.badgesRow);
    }
    const wantKinds = new Set(wantList.map((b) => b.kind));
    // Remove badges no longer needed (e.g. role dropped from marker).
    for (const [kind, btn] of el.badges) {
      if (!wantKinds.has(kind)) { btn.remove(); el.badges.delete(kind); }
    }
    // Add / update each badge in caller-provided order (DOM order = visual
    // order). The update is idempotent — DOM mutations only happen when
    // something actually changed. Critical during motion-tracker animation:
    // the marker layer redraws ~60 Hz and unconditionally clobbering
    // innerHTML on every frame replaced the SVG between pointerdown and
    // pointerup, killing badge clicks. Now the SVG is only rebuilt when
    // the on/off state flips.
    for (const badge of wantList) {
      let btn = el.badges.get(badge.kind);
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'marker-badge';
        btn.dataset['kind'] = badge.kind;
        this._bindBadge(btn, item.id, badge.kind);
        el.badges.set(badge.kind, btn);
      }
      // Re-append only if order shifted (appendChild on a same-parent
      // existing child is technically a "move to end" — cheap but not free).
      if (btn.parentElement !== el.badgesRow) el.badgesRow.appendChild(btn);
      const stateKey = badge.on ? 'on' : 'off';
      if (btn.dataset['state'] !== stateKey) {
        btn.innerHTML        = badgeIconSvg(badge.kind, badge.on);
        btn.style.background = badgeColor(badge.kind, badge.on);
        btn.dataset['state'] = stateKey;
      }
      if (btn.title !== badge.title) btn.title = badge.title;
    }
  }

  private _bindBadge(btn: HTMLButtonElement, markerId: string, kind: BadgeKind): void {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.handlers.onBadgeClick?.(markerId, kind);
    });
    // Stop pointerdown from bubbling to anything underneath; we never want
    // a badge click to also kick off a body / fog / map drag.
    btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
  }

  private _bindMoveHandle(handle: HTMLDivElement, markerId: string): void {
    handle.addEventListener('pointerdown', (e) => {
      // Only primary button / single-finger drag for now — multi-touch
      // gestures on canvas are handled by the canvas itself in A6.
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      e.stopPropagation();
      try { handle.setPointerCapture(e.pointerId); } catch { /* not supported */ }
      this.handlers.onMoveDrag?.(markerId, e.clientX, e.clientY, 'start');

      const onMove = (ev: PointerEvent) => {
        this.handlers.onMoveDrag?.(markerId, ev.clientX, ev.clientY, 'move');
      };
      const onEnd = (ev: PointerEvent) => {
        this.handlers.onMoveDrag?.(markerId, ev.clientX, ev.clientY, 'end');
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onEnd);
        handle.removeEventListener('pointercancel', onEnd);
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onEnd);
      handle.addEventListener('pointercancel', onEnd);
    });
  }
}
