/**
 * CanvasTransform — pure 2D pan/zoom math.
 *
 * Models an affine transform from "world" coordinates to "output" coordinates:
 *
 *   output = scale × (world − offset)
 *   world  = output / scale + offset
 *
 * The controller is intentionally DOM-free. Consumers wire it however they
 * like:
 *   - Three.js camera: drive camera.position.x/y from offsetX/Y, camera.zoom
 *     from scale.
 *   - Canvas overlays: get a pointer's `(clientX − canvasLeft − canvasW/2)`
 *     as the output coord, call `outputToWorld()` for hit-testing.
 *   - SVG, WebGL, anything 2D: same shape.
 *
 * What "world" and "output" actually mean is the consumer's choice. Typical
 * setups:
 *   - World = normalised map space (0..1) or world units (e.g. THREE plane
 *     coordinates centred on origin).
 *   - Output = screen-pixel offset from the canvas centre, so identity
 *     (`scale=1, offset=0,0`) keeps the world origin under the canvas centre.
 *
 * The class is the basis for v2.11 Stream A: A4 wires it to the Three.js
 * camera, A5 routes editor hit-tests through `outputToWorld`, A6 binds
 * wheel/pinch/drag gestures into `zoomAround` and `panByOutputPx`.
 */
export interface TransformState {
  scale:   number;
  offsetX: number;
  offsetY: number;
}

export class CanvasTransform {
  private _scale   = 1;
  private _offsetX = 0;
  private _offsetY = 0;
  private readonly minScale: number;
  private readonly maxScale: number;

  constructor(opts: { minScale?: number; maxScale?: number } = {}) {
    this.minScale = opts.minScale ?? 0.25;
    this.maxScale = opts.maxScale ?? 50;
  }

  // ─── Read-only state ──────────────────────────────────────────────────────

  get scale():   number { return this._scale; }
  get offsetX(): number { return this._offsetX; }
  get offsetY(): number { return this._offsetY; }

  /** True when the transform is the identity (scale=1, no offset). */
  get isIdentity(): boolean {
    return this._scale === 1 && this._offsetX === 0 && this._offsetY === 0;
  }

  // ─── Mutation ─────────────────────────────────────────────────────────────

  /** Reset to the identity transform. */
  reset(): void {
    this._scale   = 1;
    this._offsetX = 0;
    this._offsetY = 0;
  }

  /** Replace scale + offsets directly. Scale is clamped to [minScale, maxScale]. */
  set(scale: number, offsetX: number, offsetY: number): void {
    this._scale   = Math.max(this.minScale, Math.min(this.maxScale, scale));
    this._offsetX = offsetX;
    this._offsetY = offsetY;
  }

  /**
   * Zoom by `factor` while keeping the world point (worldX, worldY) fixed
   * at its current output position. `factor > 1` zooms in, `factor < 1`
   * zooms out. Hits the scale clamp gracefully — when the new scale would
   * cross a clamp, the offsets are left untouched and the call is a no-op.
   */
  zoomAround(factor: number, worldX: number, worldY: number): void {
    const newScale = Math.max(this.minScale, Math.min(this.maxScale, this._scale * factor));
    if (newScale === this._scale) return;
    // Solve `newScale * (world - newOffset) = oldScale * (world - oldOffset)`
    // for newOffset:
    //   newOffset = world - (oldScale / newScale) * (world - oldOffset)
    const ratio = this._scale / newScale;
    this._offsetX = worldX - ratio * (worldX - this._offsetX);
    this._offsetY = worldY - ratio * (worldY - this._offsetY);
    this._scale   = newScale;
  }

  /**
   * Pan by an output-pixel delta — convenient for drag handlers that
   * receive raw screen deltas. The conversion to world units uses the
   * current scale.
   */
  panByOutputPx(dxOutput: number, dyOutput: number): void {
    this._offsetX -= dxOutput / this._scale;
    this._offsetY -= dyOutput / this._scale;
  }

  /** Pan by a delta expressed directly in world units. */
  panByWorld(dxWorld: number, dyWorld: number): void {
    this._offsetX += dxWorld;
    this._offsetY += dyWorld;
  }

  // ─── Coordinate conversion ────────────────────────────────────────────────

  /** World coord → output coord. */
  worldToOutput(worldX: number, worldY: number): { x: number; y: number } {
    return {
      x: this._scale * (worldX - this._offsetX),
      y: this._scale * (worldY - this._offsetY),
    };
  }

  /** Output coord → world coord. */
  outputToWorld(outputX: number, outputY: number): { x: number; y: number } {
    return {
      x: outputX / this._scale + this._offsetX,
      y: outputY / this._scale + this._offsetY,
    };
  }

  // ─── Snapshot / restore ──────────────────────────────────────────────────

  /**
   * Capture the full state — for the snapshot-and-restore pan pattern used
   * by drag handlers (record at gesture start; on each move, restore then
   * apply the cumulative output-pixel delta).
   */
  snapshot(): TransformState {
    return { scale: this._scale, offsetX: this._offsetX, offsetY: this._offsetY };
  }

  /** Restore a previously captured state. */
  restore(snap: TransformState): void {
    this.set(snap.scale, snap.offsetX, snap.offsetY);
  }
}
