// ─── Transition Parameter Types ───────────────────────────────────────────────

export interface TransitionSliderParam {
  type: 'slider';
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
}

export interface TransitionSelectParam {
  type: 'select';
  id: string;
  label: string;
  options: { value: string; label: string }[];
  default: string;
}

export type TransitionParam = TransitionSliderParam | TransitionSelectParam;

// ─── Runtime Context ──────────────────────────────────────────────────────────

/**
 * Passed to each transition's play() function.
 *
 * overlay   — full-screen canvas sitting above the Three.js renderer.
 *             Draw on this to cover / animate the old frame.
 * snapshot  — captured frame of the old map (before the map change).
 * params    — resolved param values for this transition instance.
 * triggerChange — call this when the new map should be applied to the
 *             renderer (i.e. when the old frame has been fully hidden).
 *             For most transitions this is called immediately so the
 *             texture decode runs during the animation.  CRT collapse
 *             calls it at the midpoint (dot moment).
 */
export interface TransitionContext {
  overlay: HTMLCanvasElement;
  snapshot: ImageBitmap;
  params: Record<string, number | string>;
  triggerChange: () => void;
}

// ─── Transition Definition ────────────────────────────────────────────────────

export interface TransitionDefinition {
  id: string;
  label: string;
  params: TransitionParam[];
  /**
   * Runs the full transition animation on the overlay canvas.
   * Must return a Promise that resolves when the transition is complete.
   * The engine will clear the overlay canvas after resolution.
   */
  play(ctx: TransitionContext): Promise<void>;
}
