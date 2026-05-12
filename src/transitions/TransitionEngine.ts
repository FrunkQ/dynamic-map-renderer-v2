import type { TransitionDefinition } from './schema.ts';

/**
 * TransitionEngine
 *
 * Manages map-change transition animations on the player screen.
 *
 * A full-screen overlay canvas sits above the Three.js renderer canvas.
 * During a transition:
 *   1. The current Three.js frame is captured as a snapshot.
 *   2. The snapshot is drawn on the overlay, hiding the Three.js canvas.
 *   3. The transition animates the overlay away, revealing the new frame underneath.
 *   4. When complete, the overlay is cleared completely (transparent).
 *
 * The Three.js renderer must be created with `preserveDrawingBuffer: true`
 * so createImageBitmap() can read the canvas outside the rAF loop.
 */
export class TransitionEngine {
  private overlay: HTMLCanvasElement;
  /** AbortController for the currently-running transition, if any.
   *  cancel() aborts it so the in-flight animation can bail; the next
   *  run() opens a fresh one. */
  private _abort: AbortController | null = null;

  /** Abort any in-flight transition. Tells the rAF loop in animate()
   *  to exit on its next tick, and clears the overlay so the receiver
   *  jumps to whatever's already loaded underneath (typically the
   *  final frame, which the caller will have just decoded). */
  cancel(): void {
    this._abort?.abort();
    this._abort = null;
    const ctx = this.overlay.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  constructor(overlayCanvas: HTMLCanvasElement) {
    this.overlay = overlayCanvas;

    // Keep overlay canvas pixel dimensions in sync with the window.
    // Position/size is handled by CSS (position: fixed; inset: 0).
    const sync = () => {
      this.overlay.width  = window.innerWidth;
      this.overlay.height = window.innerHeight;
    };
    new ResizeObserver(sync).observe(overlayCanvas);
    sync();
  }

  /**
   * Runs a transition, then clears the overlay.
   *
   * Flow:
   *   1. Capture the current frame as a static snapshot.
   *   2. Paint the snapshot onto the overlay — canvas beneath is now covered.
   *   3. Await applyChange() — new map, filter, and view load underneath.
   *   4. Wait one rAF so Three.js renders the new frame to the canvas.
   *   5. Run the animation — animates the snapshot away to reveal the new frame.
   *
   * Because the new content is fully rendered before any animation pixel is
   * removed, wipe/dissolve/scanline transitions work correctly without needing
   * a second buffer.
   *
   * @param def          The transition definition to run.
   * @param params       Resolved param values for this run.
   * @param sourceCanvas The Three.js renderer canvas (snapshot source).
   * @param applyChange  Async function that loads the new map and applies state.
   *                     Awaited before the animation starts.
   */
  async run(
    def: TransitionDefinition,
    params: Record<string, number | string>,
    sourceCanvas: HTMLCanvasElement,
    applyChange: () => Promise<void>,
  ): Promise<void> {
    // 'none' skips the overlay entirely — just apply immediately
    if (def.id === 'none') {
      // Also abort any in-flight transition so a cancel (which
      // arrives as a 'none' transition) actually stops the prior one.
      this.cancel();
      await applyChange();
      return;
    }

    // Cancel any previous in-flight transition before starting this one.
    this._abort?.abort();
    this._abort = new AbortController();
    const signal = this._abort.signal;

    // Sync overlay dimensions to the source canvas CSS size before capturing
    this.overlay.width  = sourceCanvas.clientWidth  || window.innerWidth;
    this.overlay.height = sourceCanvas.clientHeight || window.innerHeight;

    // Capture the current frame as a bitmap
    let snapshot: ImageBitmap;
    try {
      snapshot = await createImageBitmap(sourceCanvas);
    } catch {
      // If capture fails (e.g. canvas tainted), fall through to a plain cut
      await applyChange();
      return;
    }

    // Cover the canvas with the snapshot so texture decode is invisible
    const ctx = this.overlay.getContext('2d')!;
    ctx.drawImage(snapshot, 0, 0, this.overlay.width, this.overlay.height);

    // Load new map, filter, and view underneath the snapshot
    await applyChange();

    // Wait for Three.js to render the new frame before the animation reveals it
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

    try {
      await def.play({ overlay: this.overlay, snapshot, params, signal });
    } finally {
      // Always clear the overlay when done, even if the transition threw
      const ctx2 = this.overlay.getContext('2d');
      if (ctx2) ctx2.clearRect(0, 0, this.overlay.width, this.overlay.height);
      snapshot.close();
      // Clear the controller reference if this is the run that owns it.
      if (this._abort?.signal === signal) this._abort = null;
    }
  }
}
