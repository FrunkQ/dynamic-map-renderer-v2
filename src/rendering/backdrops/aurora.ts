/**
 * Aurora backdrop — derived from the MapFX 'aurora' kind. One source
 * (src/mapfx/shaders/aurora/fragment.glsl) drives both subsystems
 * via the backdrop wrapper.
 *
 * allowColor is false on the aurora kind because the dual-curtain
 * design uses uColorA + uColorB (both already in shaderParams) — no
 * separate single-swatch primary colour to prepend.
 */

import { buildBackdropFromMapFx } from './fromMapFx.ts';
import { OVERLAY_KIND_REGISTRY } from '../../mapfx/overlayKindRegistry.ts';
import shaderText from '../../mapfx/shaders/aurora/fragment.glsl?raw';

export const AURORA_BACKDROP = buildBackdropFromMapFx({
  kindId:      'aurora',
  kind:        OVERLAY_KIND_REGISTRY.aurora,
  shaderText,
});
