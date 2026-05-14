/**
 * Slider-tooltip utility — wire a range input so the slider's
 * `title` attribute live-updates with its current value. The browser
 * tooltip on hover gives GMs an exact value for screenshotting /
 * sharing setups without burning permanent UI space on a number.
 *
 * v2.12 design call: sliders are "feel" controls (intensity, scale,
 * opacity, duration, etc.). Visible numbers and editable number
 * inputs add visual noise and tempt users to think the numeric
 * value is meaningful when really only the resulting LOOK matters.
 * Strip the numbers, keep the value reachable on hover for the rare
 * "what value worked best?" question.
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
 * Wire a range input so its tooltip (`title` attribute) updates live
 * to show the current value. Pass an optional `baseTitle` to keep a
 * human-readable label alongside the number — e.g. baseTitle =
 * "Intensity" produces "Intensity — 0.85" on hover.
 *
 * Returns nothing — purely side-effecting wiring on the input.
 */
export function wireSliderTooltip(slider: HTMLInputElement, baseTitle?: string): void {
  const update = () => {
    const v = parseFloat(slider.value);
    const formatted = formatSliderValue(v, slider.step);
    slider.title = baseTitle ? `${baseTitle} — ${formatted}` : formatted;
  };
  slider.addEventListener('input', update);
  update();
}
