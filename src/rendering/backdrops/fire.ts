/**
 * Fire backdrop — derived from the MapFX 'fire' (Coloured Flames)
 * kind. Volumetric flame orb filling the bars. Adapted from nimitz's
 * "Promethean" — see ACKNOWLEDGEMENTS.md.
 *
 * Uses the shared uNoise grayscale texture (fire/noise.png) via the
 * backdrop wrapper's texture passthrough. Cheap enough to live in
 * the bars; if you carpet a 4K canvas with it you'll notice the
 * cost, same as Firestorm.
 */

import { buildBackdropFromMapFx } from './fromMapFx.ts';
import { OVERLAY_KIND_REGISTRY } from '../../mapfx/overlayKindRegistry.ts';
import shaderText from '../../mapfx/shaders/fire/fragment.glsl?raw';

export const FIRE_BACKDROP = buildBackdropFromMapFx({
  kindId:      'fire',
  kind:        OVERLAY_KIND_REGISTRY.fire,
  shaderText,
  colourLabel: 'Flame Hue',
});
