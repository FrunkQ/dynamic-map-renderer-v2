# Acknowledgements

Mappadux ships with a built-in attribution system. Every audio and map
asset in the GM's library carries its licence, creator, and source URL,
and **Copy attributions** in the asset library generates a ready-to-paste
credits block. The list below is the same output for the assets bundled
with the default *Getting Started* pack — practising what we preach.

## Default "Getting Started" Pack

### Audio assets

| Asset | Creator | Licence | Source |
|-------|---------|---------|--------|
| Skittering bugs.mp3 | Mendenhall02 | CC0 (Public Domain) | https://freesound.org/people/Mendenhall02/sounds/521869/ |
| Tracker Ping (Outgoing) — edited from "motion tracker blip.wav" | Balcoran | CC0 (Public Domain) | https://freesound.org/s/478187/ |
| Tracker Ping (Return) — edited from "motion tracker beep.wav" | Balcoran | CC0 (Public Domain) | https://freesound.org/s/478186/ |
| Peaceful Harp Loop (120bpm) | joanne_pang | CC-BY-NC | https://freesound.org/people/joanne_pang/sounds/846038/ |
| sci-fi swoosh.ogg | adharca | CC0 (Public Domain) | https://freesound.org/people/adharca/sounds/275521/ |
| Spaceship engine 1.wav | InSintesi | CC-BY | https://freesound.org/people/InSintesi/sounds/347613/ |
| Control Room Alarms ("It's all kicking off!") | Jeff.Sergeant | CC-BY | https://freesound.org/people/Jeff.Sergeant/sounds/647575/ |
| Mess_room_sounds.WAV | ivolipa | CC0 (Public Domain) | https://freesound.org/people/ivolipa/sounds/260731/ |
| S_L_2_Scifi_Room_Ambience_05.wav | Tim_Verberne | CC0 (Public Domain) | https://freesound.org/people/Tim_Verberne/sounds/576097/ |
| air_hiss_small_cryo_loop.wav | typeoo | CC0 (Public Domain) | https://freesound.org/people/typeoo/sounds/521508/ |
| First Aid medic health hp sci-fi bubble beep.wav | ryusa | CC-BY | https://freesound.org/people/ryusa/sounds/531134/ |
| Astrogator1_STTOS_recreated.wav | zimbot | CC-BY | https://freesound.org/people/zimbot/sounds/183856/ |
| Retro Control Center | adh.dreaming | CC0 (Public Domain) | https://freesound.org/people/adh.dreaming/sounds/616764/ |
| Lasers2 | inkyframes | CC-BY | https://freesound.org/people/inkyframes/sounds/783889/ |
| Deep Space Ship Effect | hykenfreak | CC-BY | https://freesound.org/people/hykenfreak/sounds/214663/ |

The motion-tracker ping sounds (`MT-ping.mp3` / `MT-return.mp3`)
distributed as static files in `src/assets/` are Balcoran's CC0
samples — trimmed and level-adjusted for use in the motion-tracker
system. CC0 doesn't require attribution but giving credit is good
etiquette.

### Map assets

| Asset | Creator | Licence | Source |
|-------|---------|---------|--------|
| Help.png | FrunkQ | CC0 (Public Domain) | https://github.com/FrunkQ/dynamic-map-renderer-v2 |
| Map-Griffinholm.jpg | Elven Tower Cartography | CC-BY 4.0 | https://www.elventower.com/ |
| Rons-Moto-1979.png | kidneykid1800 | Permission granted | https://www.reddit.com/r/mothershiprpg/comments/18c71ep/8bit_map_nostromo_alien_inspired_map/ |

## UI Icons

The hamburger menu, library buttons, and other in-app icon affordances use
**Lucide** (https://lucide.dev), an MIT-licensed icon set originally forked
from Feather Icons. Individual path data is hand-extracted from the
`lucide-static` package and inlined as monochrome SVG so the icons follow
the current theme colour.

Lucide is also exposed at runtime in the **Small Assets Library**'s
"Browse Lucide" tab, where users can import individual icons into their
own packs. Imports carry the same MIT attribution string via the unified
asset-library credits modal.

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
