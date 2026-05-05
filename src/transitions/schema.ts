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
 * overlay  — full-screen canvas sitting above the Three.js renderer.
 *            Draw on this to animate the old frame away.
 * snapshot — captured frame of the old map (before the map change).
 *            The engine has already applied the new map to the Three.js
 *            canvas underneath before play() is called, so animating the
 *            snapshot away will reveal the fully-loaded new content.
 * params   — resolved param values for this transition instance.
 */
export interface TransitionContext {
  overlay: HTMLCanvasElement;
  snapshot: ImageBitmap;
  params: Record<string, number | string>;
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
