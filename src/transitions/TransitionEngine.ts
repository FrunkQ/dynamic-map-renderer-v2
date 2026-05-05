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
   * @param def            The transition definition to run.
   * @param params         Resolved param values for this run.
   * @param sourceCanvas   The Three.js renderer canvas (snapshot source).
   * @param triggerChange  Called by the transition when the new map should load.
   *                       For most transitions this is called immediately; for
   *                       CRT Collapse it fires at the midpoint (dot moment).
   */
  async run(
    def: TransitionDefinition,
    params: Record<string, number | string>,
    sourceCanvas: HTMLCanvasElement,
    triggerChange: () => void,
  ): Promise<void> {
    // 'none' skips the overlay entirely — no capture needed
    if (def.id === 'none') {
      triggerChange();
      return;
    }

    // Sync overlay dimensions to the source canvas CSS size before capturing
    this.overlay.width  = sourceCanvas.clientWidth  || window.innerWidth;
    this.overlay.height = sourceCanvas.clientHeight || window.innerHeight;

    // Capture the current frame as a bitmap
    let snapshot: ImageBitmap;
    try {
      snapshot = await createImageBitmap(sourceCanvas);
    } catch {
      // If capture fails (e.g. canvas tainted), fall through to a plain cut
      triggerChange();
      return;
    }

    try {
      await def.play({
        overlay: this.overlay,
        snapshot,
        params,
        triggerChange,
      });
    } finally {
      // Always clear the overlay when done, even if the transition threw
      const ctx = this.overlay.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
      snapshot.close();
    }
  }
}
