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
   * GM-only move handle at the icon's top-right corner. Omit on player /
   * projector. When `interactive` is false (e.g. locked marker placeholder
   * preview in A3b6) the handle is shown but doesn't accept pointer events.
   */
  moveHandle?: { visible: boolean; interactive: boolean };
}

export type MoveDragHandler = (
  markerId: string,
  clientX:  number,
  clientY:  number,
  phase:    'start' | 'move' | 'end',
) => void;

export interface OverlayHandlers {
  /** Move handle drag — fires for the entire pointerdown → pointerup arc. */
  onMoveDrag?: MoveDragHandler;
}

interface MarkerElements {
  root:        HTMLDivElement;
  label:       HTMLDivElement | null;
  moveHandle:  HTMLDivElement | null;
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
      if (!el) el = this._create(item.id);
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
    return { root, label: null, moveHandle: null };
  }

  private _applyItem(el: MarkerElements, item: OverlayItem): void {
    // Root is anchored at the icon centre via top/left; sub-elements offset
    // from there using CSS variables so resizing one marker doesn't cascade.
    el.root.style.left = `${item.anchorX}px`;
    el.root.style.top  = `${item.anchorY}px`;
    el.root.style.setProperty('--icon-half-w', `${item.iconHalfWidthPx}px`);
    el.root.style.setProperty('--icon-half-h', `${item.iconHalfHeightPx}px`);

    this._applyLabel(el, item);
    this._applyMoveHandle(el, item);
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
