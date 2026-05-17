/**
 * Portal backdrop — derived from the MapFX 'portal' kind. Same
 * swirling event-horizon visual scaled to the full bars. A bit
 * unusual as a backdrop but striking on the right map (a wizard's
 * sanctum, an inter-planar travel scene). Pair with low uScale if
 * the disc reads too large in the bars.
 *
 * Adapted from Delincoter's "Magic Portal" — see ACKNOWLEDGEMENTS.md.
 */

import { buildBackdropFromMapFx } from './fromMapFx.ts';
import { OVERLAY_KIND_REGISTRY } from '../../mapfx/overlayKindRegistry.ts';
import shaderText from '../../mapfx/shaders/portal/fragment.glsl?raw';

export const PORTAL_BACKDROP = buildBackdropFromMapFx({
  kindId:      'portal',
  kind:        OVERLAY_KIND_REGISTRY.portal,
  shaderText,
  colourLabel: 'Portal Hue',
});
