/**
 * Embers backdrop — now derived from the MapFX 'embers' kind via the
 * shared backdrop wrapper. The shader GLSL + the tunable params all
 * come from a single source
 * (src/mapfx/shaders/embers/fragment.glsl) so MapFX embers and the
 * backdrop can never drift apart.
 *
 * The previous incarnation of this file held its own copy of the
 * ember math + a distinct param id ('tint' → uTint). The unified
 * version uses 'color' → uColor matching the MapFX kind. Backdrop
 * configs saved against the old id won't restore their tint and
 * will fall back to the default — acceptable pre-ship since no
 * production users have saved state yet.
 */

import { buildBackdropFromMapFx } from './fromMapFx.ts';
import { OVERLAY_KIND_REGISTRY } from '../../mapfx/overlayKindRegistry.ts';
import shaderText from '../../mapfx/shaders/embers/fragment.glsl?raw';

export const EMBERS_BACKDROP = buildBackdropFromMapFx({
  kindId:      'embers',
  kind:        OVERLAY_KIND_REGISTRY.embers,
  shaderText,
  // "Ember Colour" reads more clearly in the backdrop popover than
  // the generic 'Colour' the wrapper emits by default.
  colourLabel: 'Ember Colour',
});
