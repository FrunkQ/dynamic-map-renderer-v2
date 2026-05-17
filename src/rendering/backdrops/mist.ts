/**
 * Mist / Smoke backdrop — derived from the MapFX 'mist' kind. One
 * source (src/mapfx/shaders/mist/fragment.glsl) drives both
 * subsystems via the backdrop wrapper.
 *
 * This entry replaces the previous standalone 'smooth_fog' backdrop,
 * which was a near-duplicate of the MapFX 'mist' shader with
 * different hardcoded colours and a slightly different param set.
 * The old 'smooth_fog' id is mapped to 'mist' in backdropById so
 * saved packs that referenced it still resolve.
 *
 * Adapted from deusnovus's "Smooth Fog Shader" — see
 * ACKNOWLEDGEMENTS.md.
 */

import { buildBackdropFromMapFx } from './fromMapFx.ts';
import { OVERLAY_KIND_REGISTRY } from '../../mapfx/overlayKindRegistry.ts';
import shaderText from '../../mapfx/shaders/mist/fragment.glsl?raw';

export const MIST_BACKDROP = buildBackdropFromMapFx({
  kindId:      'mist',
  kind:        OVERLAY_KIND_REGISTRY.mist,
  shaderText,
  label:       'Mist / Smoke',
  colourLabel: 'Mist Colour',
});
