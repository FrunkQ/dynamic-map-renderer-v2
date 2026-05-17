/**
 * Ocean backdrop — derived from the MapFX 'ocean' kind. Self-
 * contained (no helper textures); top-down water surface with
 * procedural sky reflection + sun glints filling the bars. Ideal
 * use case: ship floorplan maps where the deck IS the map and the
 * surrounding sea fills the letterbox / pillarbox bars. Pair with
 * Calm wave height for a docked-vessel scene; bump Wave Height to
 * 2.0 for a stormy sea.
 *
 * Adapted from afl_ext (MIT) — see ACKNOWLEDGEMENTS.md.
 */

import { buildBackdropFromMapFx } from './fromMapFx.ts';
import { OVERLAY_KIND_REGISTRY } from '../../mapfx/overlayKindRegistry.ts';
import shaderText from '../../mapfx/shaders/ocean/fragment.glsl?raw';

export const OCEAN_BACKDROP = buildBackdropFromMapFx({
  kindId:      'ocean',
  kind:        OVERLAY_KIND_REGISTRY.ocean,
  shaderText,
  colourLabel: 'Water Hue',
});
