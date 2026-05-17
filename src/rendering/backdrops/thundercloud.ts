/**
 * Thundercloud backdrop — derived from the MapFX 'thundercloud'
 * kind. Stormy slate cloud with randomly-positioned lightning
 * flashes filling the bars. Pair with a low Lightning setting for
 * a moody cloudy backdrop, crank Lightning for a magical-storm
 * showcase.
 *
 * Adapted from mahalis (2019) — see ACKNOWLEDGEMENTS.md.
 */

import { buildBackdropFromMapFx } from './fromMapFx.ts';
import { OVERLAY_KIND_REGISTRY } from '../../mapfx/overlayKindRegistry.ts';
import shaderText from '../../mapfx/shaders/thundercloud/fragment.glsl?raw';

export const THUNDERCLOUD_BACKDROP = buildBackdropFromMapFx({
  kindId:      'thundercloud',
  kind:        OVERLAY_KIND_REGISTRY.thundercloud,
  shaderText,
  colourLabel: 'Lightning Hue',
});
