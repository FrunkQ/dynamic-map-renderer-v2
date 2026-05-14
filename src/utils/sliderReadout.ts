/**
 * Slider-readout utility — appends a live value display next to a
 * range input so the GM can see what they're dragging to. One shared
 * helper across MapFX, Filter, Transitions panels keeps formatting
 * consistent.
 *
 * Number of decimal places is derived from the slider's `step`
 * attribute: step 0.01 → 2 dp; step 0.1 → 1 dp; step 1 (or absent)
 * → integer. Toggle-style sliders (min=0, max=1, step=1) skip the
 * readout entirely since the on/off state is already visually
 * obvious from the slider position.
 */

/** Format a numeric value for display using the step's precision. */
export function formatSliderValue(value: number, step: number | string): string {
  const s = typeof step === 'string' ? parseFloat(step) : step;
  if (!Number.isFinite(value)) return '';
  if (!Number.isFinite(s) || s >= 1) return String(Math.round(value));
  // Decimal places: -log10(step) rounded up, clamped 0..4.
  const dp = Math.min(4, Math.max(0, Math.ceil(-Math.log10(s))));
  return value.toFixed(dp);
}

/**
 * Wire a live-value readout to an existing range input. Returns the
 * created <span> so the caller can insert it wherever fits the row
 * layout (usually as the next sibling of the slider).
 *
 * Skip-toggle: integer 0..1 sliders aren't wired (they're true/false
 * pretending to be sliders, and a "0"/"1" readout reads as noise).
 * Callers that actually want a value on those should pass {force:
 * true}.
 */
export function attachSliderReadout(
  slider: HTMLInputElement,
  opts: { force?: boolean } = {},
): HTMLSpanElement | null {
  const min  = parseFloat(slider.min);
  const max  = parseFloat(slider.max);
  const step = parseFloat(slider.step);
  if (!opts.force && min === 0 && max === 1 && step === 1) return null;

  const span = document.createElement('span');
  span.className = 'slider-value';
  const update = () => {
    const v = parseFloat(slider.value);
    span.textContent = formatSliderValue(v, slider.step);
  };
  slider.addEventListener('input', update);
  update();
  return span;
}
