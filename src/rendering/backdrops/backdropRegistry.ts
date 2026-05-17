/**
 * Animated backdrops — rendered in the letterbox / pillarbox area of the
 * GM canvas (the bars left empty around the map rectangle). Each entry
 * provides a GLSL snippet that the Renderer's clip-pass injects into its
 * "outside the viewport" branch. Inside the viewport the clip pass
 * continues to pass the composed scene through untouched, so the map
 * itself is never overlaid by the backdrop — only dead bars are dressed.
 *
 * Snippet contract:
 *   • Receives the same fragment uniforms as the clip pass:
 *       uBgColor (vec3, linear),
 *       time     (float, seconds since renderer start),
 *       uSpeed   (float, GM-tuned scalar; defaults to 1.0),
 *       vUv      (varying, full-canvas 0..1 UV).
 *   • Must end with `gl_FragColor = vec4(<color>, 1.0);` — opaque output.
 *   • Should never `discard` (would leave a hole in the bars).
 *
 * Adding a new backdrop: create a sibling file exporting `id`, `label`,
 * and `fragment` strings, register it in BACKDROPS.
 */

import { STARFIELD_BACKDROP } from './starfield.ts';
import { AURORA_BACKDROP }    from './aurora.ts';
import { EMBERS_BACKDROP }    from './embers.ts';

export interface BackdropEntry {
  /** Stable id stored on the pack's ThemeConfig.backdrop.kind. */
  id:       string;
  /** Human-readable name for the dropdown. */
  label:    string;
  /** GLSL body for the "outside uRect" branch of the clip-pass shader. */
  fragment: string;
}

export const BACKDROPS: BackdropEntry[] = [
  { id: 'none', label: 'None (solid colour)', fragment: 'gl_FragColor = vec4(uBgColor, 1.0);' },
  STARFIELD_BACKDROP,
  AURORA_BACKDROP,
  EMBERS_BACKDROP,
];

export function backdropById(id: string): BackdropEntry {
  return BACKDROPS.find((b) => b.id === id) ?? BACKDROPS[0]!;
}
