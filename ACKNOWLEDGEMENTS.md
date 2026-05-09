# Acknowledgements

## Map Images

**Rons-Moto-1979** map used with permission.
Source: https://www.reddit.com/r/mothershiprpg/comments/18c71ep/8bit_map_nostromo_alien_inspired_map/#lightbox

**"Map-Griffinholm"** by Elven Tower Cartography, released under [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).

## Bundled Sounds

Motion-tracker ping sounds in `src/assets/` are edited from these Creative Commons Zero (CC0 — Public Domain) samples by **Balcoran** on Freesound:

| File | Source |
|------|--------|
| `MT-ping.mp3` (outgoing scan ping) | https://freesound.org/s/478187/ — "motion tracker blip.wav" |
| `MT-return.mp3` (return ping when contact detected) | https://freesound.org/s/478186/ — "motion tracker beep.wav" |

CC0 doesn't require attribution but giving credit is good etiquette. Both samples were trimmed and adjusted for use in the motion tracker system.

## Visual Filters

The following filter effects are adapted from ShaderToy shaders by **florian berger (flockaroo)**,
used under the [Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported](https://creativecommons.org/licenses/by-nc-sa/3.0/) licence.

| Filter | Name | Source |
|--------|------|--------|
| Ballpoint Pen | Scribble Blue (tsV3Rw) | https://www.shadertoy.com/view/tsV3Rw |
| Hand Drawing | Hand Drawing (XtVGD1) | https://www.shadertoy.com/view/XtVGD1 |
| Watercolour | Watercolor (ltyGRV) | https://www.shadertoy.com/view/ltyGRV |
| Oil Painting | Oil Painting (Mlcczf) | https://www.shadertoy.com/view/Mlcczf |

Modifications made:
- Translated from ShaderToy GLSL to Three.js EffectComposer / GLSL ES 1.00
- Replaced `iChannel0` (video/image input) with `tDiffuse` (rendered scene texture)
- Replaced `iChannel1`/`iChannel2` (noise/paper textures) with procedural GLSL noise
- Replaced ShaderToy uniforms (`iResolution`, `iTime`) with equivalent Three.js uniforms
- Reduced iteration counts for real-time performance
- Exposed artistic parameters as user-adjustable sliders
