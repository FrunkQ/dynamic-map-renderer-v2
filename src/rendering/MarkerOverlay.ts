/**
 * MarkerOverlay — HTML screen-space layer that holds per-marker UI elements
 * positioned over the canvas.
 *
 * One root `<div>` per marker that's present in the current update list.
 * Sub-elements (label, move handle, badges, selection handles) sit inside
 * that root and are positioned in CSS px so they stay screen-fixed
 * regardless of map zoom. The whole stack lives above every canvas (z-index
 * 5 in main.css) and most of it is pointer-events:none — only interactive
 * handles opt back in via their own CSS rules.
 *
 * Event handlers are set once via setHandlers() and dispatched by the
 * overlay when the user interacts with a handle. The overlay does the
 * pointer-event juggling (setPointerCapture, window-level move/up); the
 * consumer (MarkerEditor via GMApp) handles the marker-state mutation
 * given the marker id + raw client coords.
 *
 * A3a introduced the overlay with labels only. A3b extends it with the
 * GM marker UX rebuild — A3b1 (this revision): adds the move handle.
 * Later A3b sub-steps fold in badges, selection handles, rotation, and
 * lock enforcement.
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

export interface OverlayHandlers {
  /** Move handle drag — fires for the entire pointerdown → pointerup arc. */
  onMoveDrag?: MoveDragHandler;
  /** Single tap on an action badge — should toggle its state and select. */
  onBadgeClick?: (markerId: string, kind: BadgeKind) => void;
  /** Resize handle drag — distance-based scaling of the selected marker. */
  onResizeDrag?: ResizeDragHandler;
  /** Rotate handle drag — angle-based rotation of the selected marker. */
  onRotateDrag?: RotateDragHandler;
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
  lockGlyph:     HTMLDivElement | null;
}

export class MarkerOverlay {
  private container: HTMLElement;
  private items     = new Map<string, MarkerElements>();
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

  /** Remove every marker element. */
  clear(): void {
    for (const el of this.items.values()) el.root.remove();
    this.items.clear();
  }

  private _create(id: string): MarkerElements {
    const root = document.createElement('div');
    root.className = 'marker-overlay-item';
    root.dataset['markerId'] = id;
    this.container.appendChild(root);
    return {
      root, label: null, moveHandle: null, badgesRow: null,
      badges: new Map(), selectionRing: null, resizeHandle: null, rotateHandle: null,
      lockGlyph: null,
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
