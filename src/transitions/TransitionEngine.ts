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
      await applyChange();
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
      await def.play({ overlay: this.overlay, snapshot, params });
    } finally {
      // Always clear the overlay when done, even if the transition threw
      const ctx2 = this.overlay.getContext('2d');
      if (ctx2) ctx2.clearRect(0, 0, this.overlay.width, this.overlay.height);
      snapshot.close();
    }
  }
}
