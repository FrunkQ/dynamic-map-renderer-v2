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

## Image Asset Library Connectors *(v2.11)*

The Small Asset Library ships two built-in icon source connectors so users
can pull icons into their packs without leaving the app. Both flow proper
per-asset attribution back through the unified credits modal whenever
an icon is used in a pack.

| Source | Licence | Asset count | Authors |
|---|---|---|---|
| [Lucide](https://lucide.dev) | MIT | ~1,500 | Lucide contributors (forked from Feather Icons by Cole Bemis) |
| [game-icons.net](https://game-icons.net/) | [CC-BY 3.0](https://creativecommons.org/licenses/by/3.0/) | ~4,000 | Lorc, Delapouite, Skoll, Quoting, and other contributors |

SVGs are served via jsDelivr from the upstream GitHub repositories at use
time; the bundled manifests carry name, slug, and author metadata only,
not the SVG bytes.

## Visual Filters

The following filter effects are adapted from ShaderToy shaders by **florian berger (flockaroo)**,
used under the [Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported](https://creativecommons.org/licenses/by-nc-sa/3.0/) licence.

| Filter | Name | Source |
|--------|------|--------|
| Hand Drawing | Hand Drawing (XtVGD1) | https://www.shadertoy.com/view/XtVGD1 |
| Watercolour | Watercolor (ltyGRV) | https://www.shadertoy.com/view/ltyGRV |
| Oil Painting | Oil Painting (Mlcczf) | https://www.shadertoy.com/view/Mlcczf |

## MapFX Shaders

The MapFX *Coloured Flames* effect's shader is adapted from **"Promethean" by nimitz (@stormoid)**,
used under the [Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported](https://creativecommons.org/licenses/by-nc-sa/3.0/) licence.

| Effect | Name | Source |
|--------|------|--------|
| Coloured Flames | Promethean (4tB3zV) by nimitz | https://www.shadertoy.com/view/4tB3zV |
| River | A river (MsSGWK, Pierco fork) | https://www.shadertoy.com/view/MsSGWK |
| Starfield | StarField practice (tllfRX) by Deadtotem (2020) | https://www.shadertoy.com/view/tllfRX |
| Magic Portal | Magic Portal (NtBXWV) by Delincoter (2021) — noise primitive [hash33 + simplex noise](https://www.shadertoy.com/view/4sc3z2) | https://www.shadertoy.com/view/NtBXWV |
| Mist | Smooth Fog Shader (7ldGWf) by deusnovus (2021) — remix of [pontino's Fog Shader](https://www.shadertoy.com/view/tst3zr) | https://www.shadertoy.com/view/7ldGWf |
| Thundercloud | thundercloud (3dcXWS) by mahalis (2019), used under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) — 3D noise by [Inigo Quilez (MIT)](https://www.shadertoy.com/view/Xsl3Dl), hash helpers by [David Hoskins (CC BY-SA 4.0)](https://www.shadertoy.com/view/4djSRW) | https://www.shadertoy.com/view/3dcXWS |
| Firestorm | GPU hacks #07 - DirectX 12 (wtB3RG) by PrzemyslawZaworski (2019) — same source as the Firestorm backdrop, ported again as a polygon-masked MapFX kind | https://www.shadertoy.com/view/wtB3RG |
| Aurora | Original — drifting curtain bands, GM-tunable colours (same algorithm as the Aurora backdrop) | Mappadux | — | — |
| Embers | Original — parallax cell-grid sparks, GM-tunable tint (same algorithm as the Embers backdrop) | Mappadux | — | — |
| Noise | Original — colourable TV-static, single hash per fragment. Cheap; default white tint reads as classic monochrome static. | Mappadux | — | — |

### MIT-licensed shaders

The MapFX *Ocean* effect's shader is adapted from work by **afl_ext (2017-2024)**,
distributed under the [MIT licence](https://opensource.org/licenses/MIT).

| Effect | Name | Source |
|--------|------|--------|
| Ocean | Ocean / open-sea waves (afl_ext) | Shadertoy (see source comment) |

Modifications made to afl_ext's ocean shader:
- Replaced the mouse-rotated 3D camera + ray-march of two water planes with a fixed top-down view; each shader-plane pixel samples the surface directly via `vUv` mapped to wave-space.
- Dropped the sky-only branch (top-down can't see horizon).
- Reduced `ITERATIONS_NORMAL` from 36 to 16; at battlemap altitude the micro-detail isn't visible and 36-iteration normals scale poorly when a large ocean polygon covers most of the screen.
- Kept the procedural atmosphere + sun + ACES tone-mapping intact — they're what give the original its plausible-daytime look.
- Removed the trailing `pow(.., 1/2.2)` sRGB encoding inside ACES; the renderer's `OutputPass` does sRGB encoding for the whole scene and keeping it in the shader would double-encode.
- Added per-poly uniforms: `uColor` (gentle 20% hue tint mixed in after tone-mapping), `uIntensity`, `uScale` (wave feature size, 0.25–4 — covers small bay through horizon-spanning ocean), `uSpeed` (0 = mirror-still through 4 = stormy). No direction slider — ocean swells are multi-directional in the wave-sum, not a single flow vector.



Modifications made to "Promethean":
- Translated from ShaderToy GLSL to Three.js ShaderMaterial / GLSL ES 1.00.
- Replaced `iTime` with `time`; kept the `iChannel0` noise texture purpose as `uNoise`.
- Replaced mouse-controlled camera (`iMouse`) with a slow time-driven auto-rotation so the orb keeps moving without user input.
- Per-polygon plane: each painted fire polygon owns its own plane sized to its bounding box, so the orb appears centred on the polygon rather than at the centre of the map.
- Added `uMask` (per-polygon alpha mask), `uColor` (polygon tint colour), `uIntensity` (0.05–1.5 output multiplier), `uScale` (0.25–4 procedural feature scale), and `uAspect` (plane width/height for non-square polygons).
- Removed the hard-coded warm palette inside `vmarch`; the orb now produces a luminance signal that is multiplicatively tinted by `uColor` at composite time, so the GM can paint red / blue / green / purple flames using the same shader.
- Output uses additive blending in the renderer's scene composite so the flame reads as glowing fire over the underlying map.

Modifications made to "A river" (Pierco fork):
- Reduced the 3D mouse-rotated camera + plane intersection to a fixed top-down view — Mappadux is a battlemap, not a scenic close-up. Each shader-plane pixel maps directly to a wave surface point via `vUv`.
- Replaced the `iChannel0` skybox cubemap with a procedural sky tint (no horizon visible top-down).
- `iChannel1` riverbed texture is the original Shadertoy asset (`bed.jpg` in the river folder). A planned future variant samples the underlying map texture instead so the GM's painted river bed shimmers through — generic `uMap` + `uMapUv` uniform support is in `shaderRegistry` ready for it, but the v1 shader uses the original bed texture so we can iterate on the wave / refraction math first.
- `iChannel2` wave noise is the original Shadertoy asset (`noise.jpg` in the river folder) — softer than our generic noise.png and gives the rolling-wavelet look the original was tuned for.
- Added per-poly uniforms: `uColor` (water hue tint), `uIntensity` (output multiplier), `uScale` (wave feature density), `uSpeed` (flow rate), `uDirection` (flow direction in radians, compass convention with 0 = north). Each is a slider in the GM panel.
- Output uses normal alpha blending (not additive) — a real river has a definite surface that obscures what's strictly under it, modulated by refraction. Additive would have just brightened the bed.

## Animated Backdrops

The animated backdrops that fill the letterbox / pillarbox bars
around the map. As of v2.12 every shareable MapFX kind also runs
as a backdrop via the same shader source — one fragment.glsl, two
rendering paths. Credits are inherited from the MapFX side; the
attributions listed here cover the dual-use cases.

| Backdrop | MapFX source kind | Author | Licence |
|----------|-------------------|--------|---------|
| Aurora | aurora | Mappadux original | — |
| Coloured Flames | fire | nimitz (2014) — see MapFX section above | CC BY-NC-SA 3.0 |
| Embers | embers | Mappadux original | — |
| Firestorm | firestorm | PrzemyslawZaworski (2019) — GLSL fragment ported, raymarch reduced from 128 to 48 steps | CC BY-NC-SA 3.0 |
| Magic Portal | portal | Delincoter (2021) — see MapFX section above | CC BY-NC-SA 3.0 |
| Magical Light | light | Mappadux original | — |
| Mist / Smoke | mist | deusnovus (2021) — see MapFX section above; `smooth_fog` backdrop id retired in v2.12, aliased to `mist` for backwards compat | CC BY-NC-SA 3.0 |
| Noise | noise | Mappadux original — TV-static, single hash per fragment | — |
| Ocean | ocean | afl_ext (2017-2024) — see MapFX section above | MIT |
| Starfield | starfield | Deadtotem (2020) — see MapFX section above | CC BY-NC-SA 3.0 |
| Thundercloud | thundercloud | mahalis (2019) — see MapFX section above; noise primitive by Inigo Quilez (MIT); hash helpers by David Hoskins (CC BY-SA 4.0) | CC BY-NC 4.0 |

Modifications shared by every backdrop port:
- Original MapFX shader's `void main()` keeps the polygon-mask shell. A `vec4 fxEffect(vec2 uv)` function below the helpers carries the visible algorithm. The backdrop wrapper (src/rendering/backdrops/fromMapFx.ts) lifts the marker-delimited block (uniforms + helpers + fxEffect) into the clip-pass and composites the result over `uBgColor` using the kind's blend mode (additive for 'screen' kinds, alpha-composite for 'normal' kinds).
- Texture passthrough (uNoise for Fire / Light, uBed for River) shares the MapFX shaderRegistry cache so loading happens once regardless of which subsystem mounts the shader first.

Backdrop-specific tweaks (where the port diverges from the MapFX behaviour or convention):
- Aurora / Embers — written in-house for Mappadux.
- Smooth Fog — same algorithm as the MapFX *Mist* effect (credited above), exposed here as a full-bars backdrop with GM-tunable fog colour, background, and density. `INTENSITY` and the two hardcoded colours promoted to uniforms; aspect-correct UV so cells don't squash on tall/wide bars.
- Firestorm — kept only the GLSL fragment from the Shadertoy entry (the surrounding C/HLSL DirectX 12 reference code is irrelevant for our use). Reduced the raymarch from 128 to 48 steps with a wider step length, exposed the hot-core + smoke colours and an overall intensity.

### Under evaluation *(may be removed before v2.12 ships)*

The following shader is saved in the source tree for evaluation only and is
not currently wired into the renderer. If it is dropped before release, the
files in `src/mapfx/shaders/fire-fluid/` and this entry will be removed.

| Effect | Name | Author | Licence | Source |
|--------|------|--------|---------|--------|
| Fire (fluid sim, multi-pass) | Volumetric fluid fire (dsKfWR) | al-ro | MIT | https://www.shadertoy.com/view/dsKfWR |
