/**
 * Reusable pointer/wheel gesture detection for pan/zoom canvases.
 *
 * Tracks raw pointer events and emits semantic callbacks for single-pointer
 * drag, two-pointer pinch+pan, and wheel zoom. The helper handles the
 * cross-browser quirks (touch-action, pointer capture across the window,
 * pointer promotion when a second finger lands) so consumers can focus on
 * applying transforms.
 *
 * All coordinates are in CLIENT pixels — the consumer is responsible for
 * mapping them into whatever world/canvas space it uses (SVG CTM, Three.js
 * camera, manual frustum, etc.). `scale` is cumulative since the gesture
 * started (1.0 = no change); consumers that want per-frame deltas can
 * remember the previous value and divide.
 */

export interface GestureDragEvent {
  clientX: number;
  clientY: number;
  /** Delta since the gesture started, in client pixels. */
  dx: number;
  dy: number;
  phase: 'start' | 'move' | 'end';
  /** Pointer source — 'mouse', 'touch', 'pen'. Consumers can filter
   *  (e.g. accept mouse-only drag and let single-touch fall through to
   *  other handlers). Set from the originating pointerdown event. */
  pointerType: string;
}

export interface GestureTwoFingerEvent {
  /** Current midpoint between the two pointers, in client pixels. */
  midX: number;
  midY: number;
  /** Midpoint delta since the gesture started, in client pixels. */
  panDx: number;
  panDy: number;
  /** current_distance / start_distance — 1.0 at start, >1 fingers spread, <1 fingers pinch. */
  scale: number;
  phase: 'start' | 'move' | 'end';
}

export interface GestureWheelEvent {
  clientX: number;
  clientY: number;
  /** Multiplier on current zoom level: <1 zooms in, >1 zooms out (matches deltaY>0 convention). */
  factor: number;
}

export interface GestureHandlers {
  onDrag?: (e: GestureDragEvent) => void;
  onTwoFinger?: (e: GestureTwoFingerEvent) => void;
  onWheel?: (e: GestureWheelEvent) => void;
  /**
   * Optional gate run on pointerdown. Return false to ignore the pointer
   * (e.g. a draggable handle on top of the canvas wants the event instead).
   */
  shouldStart?: (e: PointerEvent) => boolean;
}

/**
 * Bind gesture handlers to an element. Returns a detach function.
 *
 * Pointer-mode rules:
 * - 1 pointer  → emits onDrag (start / move / end)
 * - 2 pointers → emits onTwoFinger (start / move / end); the in-flight drag
 *                receives an 'end' phase when the second pointer lands.
 * - 3+ pointers → ignored; the first two retain control.
 *
 * The element gets `touch-action: none` for the lifetime of the binding so
 * native pinch-zoom / scroll doesn't intercept multi-touch gestures.
 */
export function attachGestures(
  el: HTMLElement | SVGElement,
  handlers: GestureHandlers,
): () => void {
  const prevTouchAction = el.style.touchAction;
  el.style.touchAction = 'none';

  interface TrackedPointer { x: number; y: number; type: string }
  const pointers = new Map<number, TrackedPointer>();

  let mode: 'idle' | 'drag' | 'two-finger' = 'idle';
  let dragStart = { x: 0, y: 0, type: 'mouse' };
  let twoStartMid = { x: 0, y: 0 };
  let twoStartDist = 1;

  const dispatchDragEnd = (clientX: number, clientY: number) => {
    handlers.onDrag?.({
      clientX, clientY,
      dx: clientX - dragStart.x,
      dy: clientY - dragStart.y,
      phase: 'end',
      pointerType: dragStart.type,
    });
  };

  const startTwoFinger = () => {
    const [p1, p2] = [...pointers.values()];
    twoStartMid  = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    twoStartDist = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
    handlers.onTwoFinger?.({
      midX: twoStartMid.x, midY: twoStartMid.y,
      panDx: 0, panDy: 0, scale: 1,
      phase: 'start',
    });
  };

  const onPointerDown = (e: PointerEvent) => {
    if (handlers.shouldStart && !handlers.shouldStart(e)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });

    if (pointers.size === 1) {
      mode = 'drag';
      dragStart = { x: e.clientX, y: e.clientY, type: e.pointerType };
      handlers.onDrag?.({
        clientX: e.clientX, clientY: e.clientY,
        dx: 0, dy: 0, phase: 'start',
        pointerType: e.pointerType,
      });
    } else if (pointers.size === 2) {
      if (mode === 'drag') dispatchDragEnd(e.clientX, e.clientY);
      mode = 'two-finger';
      startTwoFinger();
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;

    if (mode === 'drag') {
      handlers.onDrag?.({
        clientX: e.clientX, clientY: e.clientY,
        dx: e.clientX - dragStart.x,
        dy: e.clientY - dragStart.y,
        phase: 'move',
        pointerType: dragStart.type,
      });
    } else if (mode === 'two-finger' && pointers.size >= 2) {
      const [p1, p2] = [...pointers.values()];
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
      handlers.onTwoFinger?.({
        midX, midY,
        panDx: midX - twoStartMid.x,
        panDy: midY - twoStartMid.y,
        scale: dist / twoStartDist,
        phase: 'move',
      });
    }
  };

  const onPointerEnd = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);

    if (mode === 'drag') {
      dispatchDragEnd(e.clientX, e.clientY);
      mode = 'idle';
    } else if (mode === 'two-finger') {
      handlers.onTwoFinger?.({
        midX: e.clientX, midY: e.clientY,
        panDx: 0, panDy: 0, scale: 1,
        phase: 'end',
      });
      // A finger came off but one remains — convert back into a single-finger drag
      // so the user can keep panning without re-lifting.
      if (pointers.size === 1) {
        const [remaining] = [...pointers.values()];
        mode = 'drag';
        dragStart = { x: remaining.x, y: remaining.y, type: remaining.type };
        handlers.onDrag?.({
          clientX: remaining.x, clientY: remaining.y,
          dx: 0, dy: 0, phase: 'start',
          pointerType: remaining.type,
        });
      } else {
        mode = 'idle';
      }
    }
  };

  const onWheel = (e: WheelEvent) => {
    if (!handlers.onWheel) return;
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.25 : 1 / 1.25;
    handlers.onWheel({ clientX: e.clientX, clientY: e.clientY, factor });
  };

  el.addEventListener('pointerdown', onPointerDown as EventListener);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerEnd);
  window.addEventListener('pointercancel', onPointerEnd);
  el.addEventListener('wheel', onWheel as EventListener, { passive: false });

  return () => {
    el.removeEventListener('pointerdown', onPointerDown as EventListener);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerEnd);
    window.removeEventListener('pointercancel', onPointerEnd);
    el.removeEventListener('wheel', onWheel as EventListener);
    el.style.touchAction = prevTouchAction;
  };
}
