/**
 * Noise backdrop — colourable TV-static filling the bars. Derived
 * from the MapFX 'noise' kind so the visual + tuning is shared
 * across both subsystems.
 */

import { buildBackdropFromMapFx } from './fromMapFx.ts';
import { OVERLAY_KIND_REGISTRY } from '../../mapfx/overlayKindRegistry.ts';
import shaderText from '../../mapfx/shaders/noise/fragment.glsl?raw';

export const NOISE_BACKDROP = buildBackdropFromMapFx({
  kindId:      'noise',
  kind:        OVERLAY_KIND_REGISTRY.noise,
  shaderText,
  colourLabel: 'Static Tint',
});
