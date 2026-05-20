# Changelog

## v2.14.3 — 2026-05-20

### Viewport chrome cluster + calibration master-follower

A follow-up release the same day as v2.14.2, focused on direct-
manipulation chrome on the Player and Scaled View rects plus the
last piece of the calibration UX rework.

**Calibration is now line ↔ H/V ↔ DPI master-follower.** v2.14.2
made H/V and DPI bidirectional; v2.14.3 brings the ruler line into
the same loop. Drag the line and the H, V, and DPI inputs back-
fill; type H/V or pick a DPI and the line auto-positions
horizontally across the map middle with length N × pps. Last-
touched of {line, H/V, DPI} is the master; the other two follow.
N (the "this line is X squares" input) stays at the user's value
(default 10) — it's independent, just scales what the line
represents.

**Move Projection View button retired; rect carries its own move
handle.** The scaled view's projector rect on the GM canvas now
has a small green move handle pinned to its top-left corner. Drag
from there to reposition. The previous edit-mode flow (OK/Cancel
buttons, click-outside auto-commit, full-canvas pointer capture)
is gone. The canvas stays `pointer-events: none` so pan/zoom,
marker selection, and fog painting pass through everywhere except
the handle itself. The side panel's `+ Open Projector Monitor…`
button is renamed `+ Open Scaled View Monitor…` and takes the
prominent slot the move button used to occupy.

**Aspect-ratio lock toggle on the Player View rect.** Padlock-
rectangle icon at the bottom-right of the rect chrome, above the
resize handle. Engaged = the resize handle preserves the rect's
current W:H ratio (one axis drives, the other follows the
constraint). Off = free resize. State persists per map in
`ViewState.aspectLocked` and broadcasts via the existing view
sync path. Distinct from the existing one-shot 16:9 snap button.

**View-broadcast eye icon on both rects.** Top-left of each
viewport rect (just above the move handle, outside the rect) now
carries an eye icon that mirrors the panel-header bypass toggle.
Eye open = the view is being broadcast; eye closed (red) = the
view shows the faff placeholder. Click either the eye or the
header switch and both update.

**Show Grid icon on the Scaled View rect.** New grid icon below
the move handle, only emitted when the active map is calibrated.
Clicking flips the `gridEnabled` projector-viewport flag through
the same broadcast path as the side-panel `Show grid` toggle, so
both stay in sync. The Player View grid (resizes with the map on
window resize) is a separate piece of work — needs new player-
side rendering.

**Map Compositor data-model scaffold.** Type-only foundation for
the v2.15 headline feature: `CompositeTile` interface,
`MapAsset.source` gains `'composite-map'`, and `compositeTiles[]`
+ `compositeMode` ('modular' | 'layered') optional fields land on
`MapAsset`. No editor, renderer, or dropdown entry yet — just the
shape so storage / bundle export / migration code can be staged
without churn when the editor lands. All fields are additive and
optional; existing assets load unchanged.

## v2.14.2 — 2026-05-20

### Multi-fix beta release — calibration UX, sticky paint, GM-side names, lifecycle

**Map calibration rebuilt around a self-reactive H/V + DPI pair.**
The calibration modal grew a third row: **DPI dropdown** with the
common values (60, 70 VTT, 75, 100 VTT, 140 VTT, 150, 300). Picking
a DPI back-fills H and V from the map's actual pixel dimensions.
Typing in only H or only V auto-fills the empty side at 1:1 (square
grid), which incidentally kills the `<line> attribute x1: Expected
length, "-Infinity"` console error that the empty-default-zero state
used to throw. When H × V works out to one of the common DPIs the
feedback flips green and labels the match ("matches 100 (VTT) DPI"),
so a quick "does this look right?" reads at a glance. The ruler
line stays the manual fallback — line ↔ H/V/DPI master-follower
sync is the v2.14.3 piece.

**Fog Paint / Erase is sticky again, the right way.** Pre-v2.14
the action button stayed lit after a commit but the underlying
action sometimes wasn't actually armed — clicking the lit button
did nothing for one tick. v2.14 went single-shot (button cleared
after every commit) which fixed the inconsistency but broke the
"keep dropping polys" flow. v2.14.2 re-arms cleanly: every commit
runs `_endAction` (full state reset) then `_startAction` (re-arm)
in the same tick, so the button stays lit, the editor is in the
correct state for the next stroke, and clicking the button or
switching Drawing Mode is the explicit exit. Polygon, brush, and
fill modes all behave consistently.

**Marker names on the GM map, independent of player visibility.**
New per-marker toggle **Show Name on GM map** (default ON) sits
alongside the existing Show Name on player map (default off). The
GM-side name survives the marker being hidden from players — useful
for tracking where each NPC / trap / clue sits even when invisible
to the table. Locked markers fade their name to dim chrome so
background-prop labels stay quiet.

**Locked-marker badge cluster decluttered.** Locked markers now
only display the eye / speaker / sensor badges when the
corresponding feature is **on**. A locked-and-hidden prop drops the
eye; a locked-and-muted source drops the speaker. Live (unlocked)
markers always show the full row.

**Projection View renamed to Scaled View** across the UI (panel
title, HELP heading, README) — terminology change ahead of the
v2.15 work where Scaled View takes on more roles than just
projector output.

**UI scale slider floor lowered to 50%** (from 75%) for users on
small screens or who want more map real-estate.

**Asset library Upload tabs gain a storage hint.** Both Map and
Audio Upload tabs now spell out that uploads are saved locally in
the map pack and travel with bundle exports / work offline.

**Beta channel welcome MOTD.** First launch on a beta host (not
www.mappadux.com or localhost) now shows a warning-style modal
explaining that features may come and go, but maps should stay
compatible. Dismissed once per browser.

**Spawned windows close with the GM.** Closing the main Mappadux
GM window now broadcasts a `gm-closing` signal on a dedicated
`mappadux:lifecycle` BroadcastChannel; Player, Scaled View, and
Calibration popups listen on it and self-close. Same-origin only;
remote players over P2P aren't affected.

## v2.14.1 — 2026-05-18

### Marker resize — upper cap removed

The on-canvas marker resize handle used to clamp at 8× base size,
inherited from when there was an explicit slider with that range.
With the slider gone the cap was just an arbitrary ceiling, and a GM
prepping a Mothership session ran into it trying to stretch a
ventilation-system token across the map.

Cap is gone. The handle now scales freely; markers can legitimately
end up larger than the screen for room-scale hazards, oversized
vehicles, or environmental overlays. Lower bound stays in place (a
small floor so the marker remains grabbable). The sprite canvas has
its own internal pixel-budget ceiling so memory stays sane at
extreme sizes — markers just get a touch softer when stretched well
beyond their texture footprint.

## v2.14.0 — 2026-05-17

### New onboarding pack + smaller fixes

**Getting Started pack refreshed.** New default bundle ships an
eight-step onboarding flow as handouts the GM lands on at first
launch:

  1. Welcome
  2. No Logins. WTF?
  3. Player Connections
  4. Map Selection and...
  5. Making Stuff Look Fancy (starfield backdrop, CRT-collapse reveal)
  6. Griffinholm (image map with fog of war, audio, mist filter)
  7. Markers, Sound & Motion
  8. Rons-Moto-1979 — Encounter (Mothership-style scenario: 12
     markers, 10 fog polys, 3 audio sources, motion tracker, retro
     sci-fi green filter)

`lastMapId` points at "1. Welcome" so a fresh install opens on
context, then the GM moves through the tutorial sequentially.
Demonstrates every major surface: FoW + MapFX, Backdrops, filters,
transitions, markers, soundboard, motion tracker, handout
animations.

**Per-backdrop-kind drafts.** Tuning a backdrop's sliders, then
switching kinds, then switching back, now restores the previous
kind's values. Earlier the params dropped on every switch and the
GM had to re-dial. Stashed in view.backdropDrafts[kind]; mirrors
MapFX's per-kind shaderParams behaviour. Per-map; travels in
.mappadux exports via the existing ViewState path.

**Paint button clears after every commit.** Each polygon close,
brush stroke release, or fill click now clears the green Paint
highlight so the GM gets visible "operation completed" feedback.
Drawing-mode toggle (Polygon / Brush / Fill) remains the sticky
preference. Fill's Tolerance slider still refines the last-placed
polygon via a new `preserveFillState` opt on _endAction.

**New handout from hamburger Asset Library auto-selects.** The
"Map Asset Library…" hamburger entry used a no-op onPick, so a
handout created from there saved to IDB but left the dropdown
stale and the map unselected. Both library entry points now route
through openAddMapDialog — pick / create from either, get the same
insert + select + load.

**Delete All Data wider sweep.** Earlier only `dmr_*` localStorage
keys were wiped; `mappadux:*` keys (projector calibrations,
drawing mode pref, broadcast audio toggle, fullscreen-seen flag,
etc.) survived. Settings copy reads "wipes everything including
local settings — acts like a fresh install"; the prefix filter now
matches.

**Backdrop + FoW row styling unified.** Both surfaces now share
`.fog-row--kind`: `[Backdrop] [None] [✨]` and
`[Type] [Fog of War] [✨]`. Removed the wide param-row gap on the
Backdrop side; added a "Type" label on the FoW side; same flex
treatment on both.

**Local fonts: 12 catalog faces now bundled.** The
@fontsource/* packages ship the woff2 bytes inside the app bundle,
precached by the PWA service worker. Mappadux's Small Asset
Library principle ("SAVE HERE") now holds for fonts too — the 12
catalog families work fully offline, no Google CDN dependency for
the built-in set. User-added Browse-Google-Fonts entries keep
streaming; uploaded woff2/ttf blobs keep the FontFace API path.

  - Rasteriser walks `document.styleSheets` to inline the bundled
    woff2 bytes into the SVG document so handout PNGs render
    locally too (was hitting Google's CDN per render via the
    inline-from-css fetch).
  - Bundle export schema gained `fontFamily` — user-added Google
    Fonts now round-trip through .mappadux exports.

**Migration covers every overlay kind.** The
`SUPPORTED_KINDS` allowlist in migrations.ts hadn't been kept up
with the OverlayKind union — firestorm, aurora, embers, noise,
and transparent polygons were silently coerced to fog on reload.
Allowlist updated; new kinds round-trip cleanly. Pre-v2.14 saves
that had already lost their non-fog kinds aren't recoverable
(data was overwritten with 'fog' previously).

**Live backdrop changes propagate to player windows.** Player
view_update handler missed setBackdrop, so backdrop kind / param
edits required a player reconnect to apply. Now mirrors map_change
behaviour and tweaks reach the player instantly.

**Smaller fixes.** Bg-colour persistence on transparent textmaps
(auto-sample no longer overwrites user picks on reload); UI scale
slider in Settings → Display (75–150% scales the whole sidebar in
proportion); new text-element font inheritance from selected /
last-on-page element; logo etymology surfaces on the brand icon
tooltip.

## v2.13.1 — 2026-05-17

### Text Map editor — font dropdown + new-text inheritance

Two handout-editor bug fixes flagged during v2.13 testing.

**Font dropdown floor is now the 12 bundled catalog families.** The
dropdown previously relied on the ImageAssetStore as source of
truth, with a 3-string fallback (Cinzel / Georgia / Times New
Roman) when the store was empty. Any deployment whose IDB pre-
dated a catalog addition — or that had run Delete All Data between
seedings — silently lost fonts from the dropdown, and the set
differed across machines depending on when the seed had last
landed. Switched the floor to BASE_FONTS, built from BUNDLED_FONTS
directly + the two system serifs, so the 12 catalog families are
always present regardless of store state. User-added Image-Library
fonts append below. The Google Fonts CSS request also pre-loads
the full floor so previews render even when the seed missed.

**New text elements inherit the full font style.** Earlier only
the session-wide last-picked font family + colour carried over;
size and alignment had to be re-set on every new box. Now `+ Text`
inherits fontFamily / fontScale / color / textAlign from the
currently-selected text element (if any), or the most recent text
element on the page, or the session-wide scalars, or page defaults
— in that priority order. Bold / italic / underline live inline
in the html body and still can't carry to an empty new element.

## v2.13.0 — 2026-05-17

### Transparency, persistence, UI scale

Smaller release than v2.12 — three threads that fit together cleanly.

**Make Transparent — new MapFX kind.** A polygon kind that doesn't
draw anything visible; instead it punches alpha holes through the
map. The clip-pass downstream mixes the active backdrop in behind
the holes, so a Make-Transparent patch on any image map becomes a
window through to whatever backdrop the GM has chosen. Pair with a
Starfield backdrop for a constellation chart, an Ocean backdrop for
a ship's deckplan, etc. Renderer uses CustomBlending with src=Zero
on both RGB and alpha — RGB factors leave the destination untouched
while the alpha factors do `dstAlpha *= (1 - srcAlpha)`, so the
shader's mask coverage scales the alpha-removal linearly.

**Background colour persists across reloads.** The auto-sample
heuristic ("if bg is `#000000`, sample the map's top-left pixel")
couldn't tell "user never picked anything" from "user picked black"
from "user picked something we lost". On a transparent textmap the
sample also returned `#000000` (alpha-0 pixels decode as RGB 0,0,0),
so the state could quietly churn black-over-black on every reload
and mask a persistence race. Replaced with an explicit
hasSavedConfig signal from loadForMap; the auto-sample only fires
on a map's *first* ever load. Also: a transparent sampled pixel no
longer writes anything, leaving the default `#000000` in place.

**Migrations preserve every MapFX kind.** Caught while testing
Make Transparent: areas marked transparent came back as opaque fog
after a refresh. The migration's `SUPPORTED_KINDS` allowlist hadn't
been kept up with the OverlayKind union — firestorm, aurora,
embers, noise, and transparent all coerced to fog on load. Silent
data loss. Allowlist now covers every kind with a comment pinning
it to types.ts so a future addition surfaces the same hazard.
(Pre-v2.13 saves can't be recovered — the data was already
overwritten with 'fog' at the previous save.)

**Live backdrop changes propagate to player windows.** The player's
view_update handler called `setView` but not `setBackdrop`. Because
the renderer rebuilds the clip-pass when the backdrop kind changes
on a separate code path, bg-colour edits ticked the uniform but
backdrop kind / param tweaks needed the player to disconnect and
reconnect before taking effect. Mirror the map_change handler:
setView, then setBackdrop with msg.payload.backdrop ?? null.

**Brush mode is now sticky.** Each brush stroke commits and the
next drag starts a fresh stroke without re-clicking Paint —
matches Fill's behaviour and resolves the "Brush button still
glowing after I dragged once" confusion. Brush erase the same way.

**UI scale slider in Settings → Display.** New 75–150% slider
scales the whole left-hand sidebar in proportion: fonts, padding,
borders, icons, popovers all scale together via CSS `zoom` on
`#sidebar`. The grid column also scales — `--sidebar-width: calc(280px
* var(--ui-scale))` in main.css — so the column footprint shrinks
or grows in lockstep with the contents. The map canvas itself is
untouched. Persists in `dmr_ui_scale`. Default 100%; double-click
the slider to reset.

**Make Transparent is also visible through transparent textmaps.**
Combining the v2.12 transparent-paper handout option with a
backdrop produces a "see through" handout where the backdrop fills
everywhere the page is transparent. Plus a Make-Transparent patch
on the same handout extends the effect to image maps too.

**Logo tooltip.** The brand icon now carries the Latin etymology
(mappa + dux = map guide; also a duck on a map) in addition to the
share-link hint.

**Smaller fixes.** Brush mode is sticky like Fill. Live view edits
(bg colour, backdrop kind, backdrop params) reach connected players
without forcing a reconnect. MOTD popup system stays in place
(empty version disables it for v2.13; ready for the first future
release that wants to surface a message).

**Help.md** catches up with the unified Fog of War & MapFX surface
(kinds, drawing modes, sparkle popover, paint-another-like-this,
Make Transparent) and adds Display + Performance Settings sections.

## v2.12.x — 2026-05-17

### Backdrops + MapFX unification + UI consolidation

Major refactor and feature expansion since 2.12.0. The Backdrop and
MapFX subsystems now share a single shader source per effect, and
the GM tunes both via the same compact sparkle-button popover
pattern. New shaders added, all old ones expanded.

**Unified shader architecture.** Each shareable effect lives in
`src/mapfx/shaders/<id>/fragment.glsl` with a `BEGIN backdrop-
shareable` marker block. The MapFX path keeps its polygon-mask
wrapper at the bottom; the new `src/rendering/backdrops/fromMapFx
.ts` wrapper lifts the marker block into the clip-pass and
composites the result over `uBgColor` using the kind's blend mode.
Texture passthrough (uNoise) shares the MapFX shader registry
cache. End result: one place to tweak any effect — no more drift
between the polygon-painted version and the bars version.

**Every backdrop-suitable MapFX kind is now also a backdrop.**
Eleven backdrops available (alphabetised): Aurora, Coloured Flames,
Embers, Firestorm, Magic Portal, Magical Light, Mist / Smoke,
Noise, Ocean, Starfield, Thundercloud. Picking any of them from
the Map panel's sparkle button fills the bars with the same visual
the GM paints on the map. The MapFX-only kinds are Fog of War
(just a flat fill) and River (its directional flow needs the
larger map view to read).

- **Noise** — new MapFX kind + Backdrop. Colourable TV-static,
  cheap (single hash per fragment), reads as scintillation /
  haunted-screen / magical interference depending on tint.
- **Aurora / Embers** — new MapFX kinds added alongside the
  backdrop variants that landed earlier in 2.12. Same algorithms;
  GM paints aurora curtains or rising sparks as regions on the
  map.
- **Firestorm Scale** — new slider amplifies the volumetric
  raymarch coverage so the GM can dial inferno-level density that
  fills the canvas.
- **Starfield Glow** — slider exposed on both MapFX + Backdrop;
  0 collapses haloed orbs to crisp pinpoint stars, 1 keeps the
  original Shadertoy look.

**Backdrop dropdown alphabetised** for scannability now that the
list has grown to 11. 'None (solid colour)' stays pinned at the
top.

**Sparkle-popover UI on both sides.** The GM panel rows for FoW
and Map both compressed to `[active name] [✦ sparkle]`. The
sparkle opens a popover hosting the kind dropdown + Colour (or
Background) row + Edge Fade + the active effect's params. Old
inline kind dropdown and inline colour swatch removed — single
source of truth, single editing surface. The same `FxPopover`
component drives both popovers.

**Per-kind in-use indicator.** Green '●' prefix + accent colour
on every kind that has at least one polygon on the current map's
fog state. Visible inside the popover dropdown.

**Slider drag-capture protection.** Each popover's onChange paths
flip a suppress flag so the structural refresh hooks skip the
DOM rebuild mid-drag — sliders no longer stutter or drop pointer
capture.

**Textmap transparent paper option.** Tick "Transparent" next to
the Paper colour to rasterise the textmap with a clear alpha
channel; the underlying GM canvas shows through any gaps in the
body. (Note: making backdrop effects specifically visible behind
a transparent map requires a follow-up renderer change; the
rasterised PNG with alpha is the foundation.)

**FX param dump helper** at `window.mappaduxDumpFx()` for capturing
the GM's tuned per-kind drafts + active backdrop params as paste-
friendly JSON. Cached on `window._mppFxLast`.

**MOTD popup.** Edit `src/motd/motd.ts` (version + title + body)
to surface a one-off message on first launch after a version
bump. Auto-suppressed during first-install when the About dialog
auto-opens.

**Bug fixes.** Fog of War defaults to hard edge (Edge Fade 0).
Firestorm Speed slider now actually does something (was dead
because the shader ignored `uSpeed`). MapFX panel active-kind
label refreshes on backdrop change. Various smaller UI tweaks.

**Acknowledgements expanded** with the new shaders + the dual-mode
attributions.

## v2.12.0 — 2026-05-14

### Immersion: unified overlay system + nine MapFX shaders

v2.12 collapses Fog of War and the MapFX painting tools into one
unified polygon system, then layers eight shader-driven effects on
top of it. Every shape the GM paints is a polygon with a `kind` —
fog and MapFX are interchangeable, so the GM can use flame as fog,
swirl mist over a battlefield, drop a starfield over a sci-fi map,
or open a magic portal mid-encounter. Paint with click-polygon or
brush; commit with single-shot Paint / Erase actions.

#### Nine overlay kinds

All shader-driven kinds are GM-tintable, animated where appropriate,
and self-contained except where noted:

- **Fog of War** — the original, kept as just another kind in the
  registry. Same polygon list, same draw tools, click priority
  guaranteed (always wins overlap selection).
- **Coloured Flames** — Promethean by nimitz, CC-BY-NC-SA. Per-poly
  intensity + scale; GM tints the flames any colour from natural
  orange to soulfire blue, green wisp, purple eldritch.
- **River** — Pierco's "A river" fork, CC-BY-NC-SA. Per-poly
  intensity, scale, speed, **direction** (compass radians, every
  river bends differently). Refracted bed texture under the
  shimmering surface.
- **Ocean** — afl_ext, MIT. Procedural waves with per-poly
  intensity, scale, speed, wave-height. Sun locked for stable
  ambience; tint via uColor for blood seas / void oceans.
- **Magical Light** — in-house. Soft radial glow + animated swirls
  + twinkling particles, additive blend. Per-poly intensity, scale,
  speed, swirls, particles. Tint chooses the light hue.
- **Starfield** — Deadtotem's "StarField practice", CC-BY-NC-SA.
  Eight parallax layers, per-poly intensity, scale, speed (up to
  warp), **direction** (head-on approach → sideways → receding).
- **Magic Portal** — Delincoter's "Magic Portal", CC-BY-NC-SA.
  Continuous-open energy disc with event-horizon centre; per-poly
  intensity, scale, speed; tint for any portal colour.
- **Thundercloud** — mahalis's "thundercloud", CC BY-NC. Cool slate
  body with random lightning flashes; per-poly intensity, scale,
  speed, **lightning** (flash brightness; tint controls flash hue,
  not body — keeps the storm-cloud look consistent).
- **Smoke / Mist** — deusnovus's Smooth Fog Shader, CC-BY-NC-SA.
  Two-FBM domain-warp drifting wisps; per-poly intensity, scale,
  speed, **direction**.

#### Per-polygon everything

Every overlay property is per-polygon and persists through reloads:

- **Colour** — selecting a polygon snaps the swatch to its colour;
  edits update that polygon immediately. With no selection, the
  swatch drives the "next new polygon" draft. The GM's last-tuned
  values carry forward.
- **Shader params** — same pattern. Selected polygon's sliders show
  its values; tweaking updates that polygon; new polygons inherit
  the kind's draft. River direction, ocean wave-height, light
  swirls all behave the same way.
- **Paint-another-like-this** — if Paint is clicked with a polygon
  selected, the new polygon inherits the exemplar's colour and
  shader params. Rows of identical campfires, a consistent river
  flow, evenly-tuned fog patches — no re-tuning per shape.
- **Morph kind via dropdown** — change the dropdown while a polygon
  is selected and that polygon's kind morphs in place. "This FoW
  patch is actually flames"; "this fire pool should be cool mist".
  The shader plane recreates with the new kind's GLSL.

#### Edge Fade — universal soft edges

A single Edge Fade slider in the panel softens any polygon's outline
organically, baked into the alpha mask at rasterise time. Slider
range 0..0.20 with 0.10 default at the midpoint — the calibrated
sweet spot that removes pixelation cleanly on every kind. Works for
fog and every shader kind uniformly; zero per-frame cost.

#### Click priority by dropdown order

When polygons overlap, clicking selects by kind priority (fog first,
then MapFX kinds in dropdown order, then most-recently created as
tiebreaker). A fog patch under a fire pool can always be reached.
The dropdown order doubles as the priority order — natural mental
model.

#### Editor UX

- **Drawing Mode toggle** — Polygon or Brush, sticky across reloads
  via localStorage (not bundle state).
- **Brush size** in CSS pixels so zooming in gives finer detail
  painting for free.
- **Selection-only handles** — trashcan glyph at bottom-left of any
  selected polygon (FogEditor + future polish sweep across editors).
- **No more centre-of-poly selector icons** — interior clicks select
  any kind, panel auto-opens to the picked polygon's kind, swatch
  + sliders snap to its values.
- **Hint as tooltip** — panel header carries the workflow hint on
  hover; no permanent panel space taken.

#### Generic self-sample infrastructure

Any shader that declares `uniform sampler2D uMap` automatically
receives the map texture + a per-plane `uMapUv` (the polygon's
bbox in map-UV) so the shader can sample the rendered map
underneath the polygon. Used as opt-in refraction-bed for future
"river over the GM's painted river" mode (toggle ships in v2.12;
default off).

#### Persistence

The migration in `storage/migrations.ts` preserves `holes`,
`shaderParams`, and `edgeFade` through map reloads + bundle export
/ import. Pre-v2.12 polygons gain `kind: 'fog'` automatically;
polygons with removed kinds (dev placeholders) coerce to fog so
existing shapes survive.

#### Acknowledgements

`ACKNOWLEDGEMENTS.md` now credits the Shadertoy creators behind
every adapted shader (nimitz, Pierco, afl_ext, Deadtotem, Delincoter,
deusnovus, mahalis) with their original Shadertoy URLs, licences,
and sub-attributions for the noise / hash primitives they relied on
(iq, David Hoskins). Each shader file's header also carries an
"Adaptation notes" block describing what was changed for top-down
battlemap use.

#### Animated backdrops (in the bars)

The letterbox / pillarbox area around the map used to be a dead
solid colour. v2.12 turns it into per-pack territory:

- **Theme → Backdrop dropdown** in the Customise pack… dialog,
  alongside Mode + Accent. First kind shipped is a slow drifting
  **Starfield** (Deadtotem, CC-BY-NC-SA) — ideal for sci-fi packs,
  blooms softly behind the map without ever overlaying it.
- Implemented as a clip-pass shader injection — the rectangle inside
  the GM's viewport keeps showing the composed map untouched; the
  starfield only paints the dead bars.
- Backdrop choice travels with the bundle via `ThemeConfig.backdrop`.
  Adding new kinds is a single registry entry in
  `src/rendering/backdrops/`.
- Player / Projector broadcast of the backdrop choice is a v2.13
  follow-up; the GM canvas reads it today.

#### Animated maps (webm / mp4)

Map assets are no longer image-only:

- Upload a `.webm` or `.mp4` through the same drop zone you'd use
  for a PNG. The library treats it as a regular MapAsset — same
  calibration flow, same fog editor, same marker workflow.
- The renderer detects video via a magic-byte sniff (EBML for webm,
  ftyp atom for mp4) and wraps it in a `THREE.VideoTexture`. Looped,
  muted, autoplaying — no user gesture needed.
- Magic Wand fill samples the current video frame so flood-fill
  works against whatever the GM is actually looking at.
- Per-file upload cap raised from 50 MB → 200 MB to fit short loops
  comfortably; the file picker accept attribute extended.
- Player / Projector broadcast of video bytes (and frame sync) is
  a v2.13 follow-up; the GM canvas plays today.

#### Sliders are "feel" controls

Visible numeric readouts have been stripped from every "feel"
slider in the GM UI — Filter, Transition, MapFX, Text Map element
toolbar. The number lives on the slider's `title` attribute for
share / screenshot use; the chrome stays uncluttered so users
trust the touch and stop precision-twiddling.

---

## v2.11.0 — 2026-05-13

### Workspace pan/zoom, a rebuilt direct-manipulation UX, and tablet-as-screen

v2.11 turns the GM canvas into a real workspace and rebuilds every
selection / handle interaction around one consistent design language.
The biggest practical win is **tablet-as-screen**: any device on the
LAN — a phone, a spare tablet, a laptop — opens the player view in a
browser and becomes a fully functional second screen. Pack your
gaming laptop and two tablets and you have a complete three-screen
in-person VTT setup in a bag: laptop as the GM screen, one tablet
flat on the table as the calibrated 1″-scale projector / floorplan,
and the other facing the players for handouts and reveals.

#### GM canvas workspace

- **Mouse drag-pan** — click + drag anywhere on the canvas (away from
  handles / markers) to pan the camera. Cursor flips to "grabbing".
- **Wheel zoom + keyboard pan** — scroll-wheel zooms around the
  cursor; arrow keys pan; R resets. Carried over from earlier A4 work.
- **Touch gestures** — two-finger pinch to zoom + pan, single-touch
  still reserved for editors (fog draw, marker handles).
- **Off-screen indicator pills** — when a player / projector rect is
  panned out of the visible workspace a colour-matched pill appears
  at the wrapper edge with a rotating arrow pointing to the rect.
  Click recentres the camera on it.
- **Reset view pill** — small bottom-right affordance that appears
  only when the camera is off identity. Click restores the default
  centred fit.

#### Direct-manipulation rebuild — markers and viewport rectangles

The marker panel's separate label / icon / size / role inputs are
gone in favour of on-canvas chrome. Every marker now carries:

- **Move handle** at the top-left corner (drag = move + select).
- **Badge row** along the top edge — visibility, audio role, motion
  role; live indicators of state, click to toggle.
- **Resize + rotate handles** at the bottom-right and top edges when
  selected.
- **Locked enforcement** — locked markers ignore handle drags and
  show greyed badges as display-only.
- **Per-marker sprite layer** — each marker renders into its own
  Three.js sprite with an unbounded-resolution canvas texture, so
  large markers stay crisp even at deep player-side zoom levels.

The player and projector viewport rectangles speak the same language:

- **Move handle** at the top-left, **resize handle** at the bottom-
  right (player only — projector size is calibration-locked),
  **aspect-lock (16:9)** and **maximise / restore** buttons on the
  right edge.
- **"Pop" shortcut** — grabbing the move handle on a full-map player
  rect snaps it to 50% map dimensions centred, so a maximised rect
  becomes draggable in one gesture.
- **Selection is handle-only** — clicking inside the rect no longer
  steals selection, so canvas clicks fall through to markers, fog
  selection, and mouse drag-pan as expected.

#### Side panel rework

- **Player View panel retired** — every action it carried is now a
  handle click on the rect. The broadcast toggle ("GM is faffing"
  placeholder) moved to the **Player Connection** panel header
  (Session was renamed for clarity).
- **Background Colour** folded into Map Selection alongside the
  other per-map settings.
- **Projection View panel** auto-collapses when the projector rect
  is deselected.
- **Blackout button retired** — broadcast toggle covers the same
  need with a friendlier UX (and the legacy `'black'` projection
  mode normalises to `'full'` on load for backward compatibility).

#### EditableSelect — in-place rename combobox

A new custom combobox wraps every renamable dropdown:

- **Map dropdown**, **Marker dropdown**, **Projector calibration
  picker** — selected option's label is editable inline. Click to
  rename, Enter commits, Esc reverts, chevron opens the menu.
- The separate "Name" input rows in the Map and Marker panels are
  gone; the dropdown IS the rename field.
- **Native `<select>` baseline** — unified styling across every
  modal dropdown (licence pickers, calibration LFD selects, Text
  Map font / aspect, Freesound duration) so the visual family is
  consistent without per-control wrapping.

#### Fullscreen UX

- The exit-fullscreen button on player + projector grows to ~50vmin
  in `:fullscreen` state and stays fully visible — a generous tap
  target so dismounting fullscreen from a tablet doesn't require
  precision aiming at a 20px corner button.

#### Text Map editor

- **Element chrome unified** with the marker / viewport rect design:
  move handle top-left, resize bottom-right, delete badge top-right,
  selection cue = dashed outline + soft veil.

#### Calibration board (mobile)

- **Pinch + drag-pan** on the manual calibration board so tablet
  users can zoom in on a crowded grid to place endpoints precisely.

#### Image Assets Library

- Stream B landed earlier in v2.11 — a third first-class asset
  library alongside Maps and Sounds, with the same library / web-
  link / upload / connector taxonomy. Includes the **Lucide** icon
  set (MIT) and **game-icons.net** (CC-BY 3.0) as built-in
  connectors with proper attribution flow-through to the unified
  credits modal.
- **Icon-picker preview prefetch threshold** raised from 12 → 30,
  giving previews sooner without slamming the jsDelivr CDN on
  wide 2-char searches.

#### Text Maps (Handouts)

- Stream C landed earlier in v2.11 — text-map / handout entries are
  a new map type with a rich element editor, multiple aspect
  presets, font picker, and animated reveal transitions.

#### Internals

- **CanvasTransform** controller — a pure-math pan/zoom model
  shared between the GM workspace, the calibration board, and any
  future zoomable surface.
- **Gestures** helper extended with a `pointerType` field on
  drag events so consumers can filter mouse vs touch without going
  back to the raw PointerEvent.
- **Renderer** gained mapNormToCanvasCss / canvasCssToMapNorm /
  worldToScreen / setCameraTransform so the editors (Fog, Marker,
  Viewport, ProjectorViewport) all route through one source of
  truth for screen ↔ map coordinate translation.

## v2.10.5 — 2026-05-11

Feature:
- **Map scale auto-detect + legacy retrofit** — on import (Upload and Web
  Links tabs) Mappadux now guesses each map's grid size and 1″ scale from
  a stack of three signals: any `[WxH]` pattern in the filename or map
  name (range [5, 200]); embedded image DPI parsed from PNG `pHYs` or
  JPEG JFIF density (clipped to a [50, 600] px/sq range); and the GCD of
  the image dimensions, assuming square cells. Candidates are scored
  with bonuses for standard DPIs (75/150/300 most, 72/100/200 next),
  signal alignment, and "nice" round numbers.
  - **Scaled** (yellow badge, auto-applied) when at least one strong
    external signal (DPI or filename) confirms a standard-DPI candidate.
  - **AutoScaled** (orange badge) when the detector picked a best guess
    but the score gap is narrow, or when the user picked an option from
    the new candidate dialog.
  - **No grid** (grey badge) when the user explicitly opted a map out
    of scaling — handouts, world maps, stat blocks, etc. Also offered as
    the bottom row in the candidate dialog.
  - Ambiguous imports (multiple candidates tied, no tiebreaker) open a
    small radio-list dialog showing the top three options plus the
    no-grid opt-out. Skip leaves the map uncalibrated for manual work.
  - A new **retrofit pass** runs every time a `.mappadux` (or legacy
    `.json`) pack loads — quietly auto-detects scale on any map in the
    pack that lacks it, so older packs upgrade themselves on first
    open. Status bar reports the count: *"Auto-scaled 4, 2 need a look"*.
  - The Calibrate flow now stamps `scaleConfidence: 'manual'` so the
    auto-detector treats hand-calibrated maps as authoritative and
    never overrides them.
  - Per-asset "No grid" toggle in the library editor flips the opt-out
    immediately; clicking the No-grid pill on a map clears the opt-out
    and opens the manual Calibrate modal.

Fix:
- **Projection View** — Open Projector / Open Projector Monitor buttons
  no longer fail with "Waiting for P2P… try again in a moment." on cold
  load. The buttons gated on `Host.roomCode`, which only became available
  after the PeerJS broker handshake completed — fast on localhost dev,
  noticeably slower on production HTTPS, so clicks that came in early
  hit the warning branch and never reached `window.open`. `Host` now
  tracks the requested peer ID synchronously inside `start()` and the
  `roomCode` getter returns it immediately, so the projector window
  launches right away and connects to the same-browser GM over
  BroadcastChannel without waiting on the broker. Remote-projector /
  remote-player PeerJS paths unchanged.

Fix:
- **Projector kept the previous map's filter on map swap** — the
  projector's `map_change` handler updated markers, fog, and dimensions
  but never re-read `msg.filter`, so swapping to a map with "none"
  selected left the prior map's filter applied until the user toggled
  the dropdown off and back on. Now mirrors the player path: pulls the
  incoming filter from `map_change` and re-applies.

Polish:
- **Projector overlay warnings fade** — the "Waiting for GM to load a
  map…" and "Map not calibrated…" messages now fade out 5 seconds after
  first appearing. The GM-side UI still shows these conditions
  persistently, so the projection window doesn't need to keep nagging
  over what's being shown. Re-fires (and re-fades) on the next
  transition into the warning state.

## v2.10.4 — 2026-05-10

Docs:
- **screenshot.png** refreshed to show the v2.10 GM interface.

## v2.10.3 — 2026-05-10

Docs:
- **HELP.md** brought up to v2.10. New **App Menu (☰)** section covers
  Save / Save Encrypted / Load Map Pack, Customise pack…, New Map
  Pack…, Settings…, About…, and `?bundle=<URL>` sharing. Session,
  Map, Markers, and Soundboard entries updated for the v2.10 UI
  (Map Pack name field, dropdown-sentinel + Add patterns, ⬇ download
  buttons, QR-click-to-copy, "X players connected" line, hamburger
  as the home for pack-level actions). Projector section unchanged
  bar a small note that the LFD calibration step now points users at
  the Projector path when their screen isn't listed.

## v2.10.2 — 2026-05-10

Docs:
- **ACKNOWLEDGEMENTS.md** rewritten as the Mappadux attribution system's
  own output for the default *Getting Started* pack — 15 audio sources
  (Freesound, mix of CC0 / CC-BY / CC-BY-NC) and 3 map sources, all
  with creator / licence / source-URL. Practising what we preach.
- **README.md** — removed the stale "Future Plans" section (the lone
  Lighting bullet); release history reference kept.

## v2.10.1 — 2026-05-10

Hotfix on the v2.10.0 rollout:

- **Removed the wildcard `vercel.json` redirect** that 301-ed every
  path from `dynamic-map-renderer-v2.vercel.app` to `www.mappadux.com`.
  Subresource requests (.js / .css / manifest) were getting cross-
  origin-redirected, and CORS blocked them — assets failed to load on
  the legacy origin. Domain redirect is now configured at the Vercel
  dashboard level, which scopes it to top-level HTML navigation and
  leaves subresource requests untouched.
- **Bundle: `lastMapId`** added. The map the creator was viewing when
  they saved now travels in the pack and is restored on import — gated
  to map ids actually present in the bundle so stale references fall
  through to the first-map default rather than stranding the recipient.

## v2.10.0 — 2026-05-10

### Customisation, distribution, and a clean home for app-level actions

v2.10 is the "make this feel like a real product you'd share" release. The
hamburger menu becomes the home for everything pack-level; map packs gain
encryption, gzip compression, custom branding, theming, and URL-based
sharing; and the asset libraries finally let you pull individual assets
back out.

#### Hamburger menu

- New ☰ button in the GM sidebar brand block, hosts all pack-level
  actions. Click-outside / Escape closes. Items can flag themselves as
  `danger` (red) for destructive entries.
- Entries (in order): **Save Map Pack…**, **Save Encrypted Pack…**,
  **Load Map Pack**, **Customise pack…**, **New Map Pack…** (red),
  **Settings…**, **About…** (footer).
- Old in-panel **Save to File** / **Load Maps File** buttons removed —
  the bundle flows live here now.

#### Map Pack format

- Saved bundles use a branded **`.mappadux`** extension. Load dialog
  accepts both `.mappadux` and legacy `.json`.
- File is **gzipped** before write (CompressionStream); typical pack size
  drops ~10–25%. Bigger relative win on the encrypted path where base64
  inflation used to dominate.
- Save fires the native OS save picker (`window.showSaveFilePicker`
  where supported, anchor fallback elsewhere). Custom
  `application/x-mappadux-pack` MIME so the picker doesn't pad the filter
  with `.exe` / `.com` / `.bin` like generic octet-stream does.
- New pack-level `packName` field, edited in the Map Selection panel
  ("Map Pack" input) and pre-filled into save filenames as a slug. Default
  bundle seeds the name as **"Getting Started"**.

#### Optional password encryption

- New hamburger entry **Save Encrypted Pack…**. Web Crypto AES-GCM with
  a PBKDF2-derived key (200k iterations, SHA-256). Per-file random
  salt + IV.
- Wrong password on load surfaces a generic "Wrong password or corrupt
  file" — no leakage about which it was. AES-GCM tag does the integrity
  check, no separate HMAC.
- Bundle JSON gets gzipped *before* encryption so encrypted files are
  smaller too.
- Decryption is checked BEFORE wiping the workspace, so cancelling at
  the password prompt leaves your current pack intact.

#### Customisable splash + About

- New **About…** dialog (auto-opens on first run / on every Load Map
  Pack). Display mode shows the creator's title / banner image / rich
  description body / links, then a fixed Mappadux footer (Discord,
  Ko-fi, GitHub, mappadux.com, MIT licence).
- New **Customise pack…** dialog (edit mode) lets creators set per-pack:
  - Title, banner image with **drag-to-pan crop picker** for off-aspect
    images, rich body text.
  - Rich-text toolbar: **B / I / U**, align left/centre/right, bullets,
    numbered list, font (System/Serif/Mono/Display), colour picker.
  - Up to N creator links (Patreon, socials, Kickstarter, etc.).
- Output sanitised via a strict allow-list (`p, br, b/strong, i/em, u, ul,
  ol, li, span, font, div` + filtered `style`) so loading a community
  pack can't inject script or load remote resources.
- New default body is a friendly origin-story intro that emphasises the
  built-in attribution flow.

#### Theme

- Per-pack **Theme** section in Customise mode: Dark/Light segmented
  toggle + custom accent colour picker with hex echo and Reset.
- CSS-variable driven; hover/dim shades derive automatically from the
  live `--accent` via `color-mix()`. Map render area unaffected — chrome
  only.
- Edits apply **live** during the dialog so you see the result; Cancel
  reverts to whatever was active when the dialog opened.

#### New Map Pack + Settings

- **New Map Pack…** (red) clears the workspace and starts an empty pack
  with a name you choose — no Getting Started re-seed.
- **Settings…** dialog with three sections:
  - **Storage** — live IndexedDB usage / quota readout, persistence
    status, "Request persistent storage" button.
  - **API Keys (this browser only)** — lists stored credentials (Freesound)
    with redacted previews; bulk delete; messaging that keys never travel
    in pack exports.
  - **Danger Zone** — **Delete DB** (wipe IDB, keep API keys + calibration,
    reload) and **Delete All Data** (wipe IDB + every `dmr_*` localStorage
    entry, reload). Reloads instead of in-place reset so state guarantees
    are simple.

#### Per-asset download

- ⬇ button on every locally-stored row in **Map Library** and **Sound
  Library** — pulls the original blob back out as a file download with a
  sensible filename. Routes through the same `showSaveFilePicker` path
  as Save Map Pack so you can pick where the asset lands.

#### Bundle URL load

- `?bundle=<URL>` startup parameter loads a pack from a URL instead of
  default-seeding. If your IDB already has content, you get a three-way
  prompt: **Save current, then load** / **Discard and load** / **Cancel**.
  Param is stripped from the URL after handling so a reload doesn't
  re-trigger.

#### Bundle data audit + fixes

- `MapAsset.pixelsPerSquare` and `calibrationLine` were being **dropped**
  on bundle export for locally-stored map assets — calibration didn't
  survive save/load. Fixed: both fields now travel in the bundle and
  round-trip correctly.
- Stored audio: `attributionLink` was being dropped on export. Fixed.
- Custom icons: `addedAt` was being dropped. Fixed (with sensible
  fallback for older bundles).

#### Session panel tighten-up

- Old visible **Room Code** row removed. Code is shown on hover (QR
  tooltip).
- **Copy Player URL** is now a small white bar to the left of the QR;
  the QR itself is also clickable to copy.
- "Players connected" count below the QR; pluralisation handled
  automatically. Disconnect path was missing a notify call when
  `conn.on('error')` fired — fixed; count now updates on any disconnect.

#### Vercel routing

- `vercel.json` now redirects `dynamic-map-renderer-v2.vercel.app` →
  `https://www.mappadux.com/` (301). Deep links preserved.

#### Misc

- Map Selection, Marker, and Projector dropdowns unified on a single
  **+ Add New X** sentinel pattern (bold-green action option at the
  bottom). Standalone Add buttons removed.
- LFD calibration step now tells the user to switch to the Projector
  path if their screen / resolution isn't listed.

## v2.9.0 — 2026-05-10

### Mappadux brand + Projector / Battlemap mode

The big rebrand and the v2.9 projector feature land together. The product
name is now **Mappadux** ("VTT@Home"); the package, repo folder, and
default Vercel slug stay as `dynamic-map-renderer-v2` for now (custom
domain `mappadux.com` is purchased and queued for setup). Page titles,
GM sidebar brand block, player connect heading, and PWA manifest all
carry the new name.

The much larger story is **Projector / Battlemap mode** — render a
calibrated crop of the active map at true table scale on an under-table
screen or down-projector, so a 1″ creature on the map actually projects
as 1″ on the surface and miniatures occupy real-world inches.

#### Map calibration

- Per-asset `pixelsPerSquare`, expressed as **1″ / 25 mm** grid squares
  (not 5'/D&D-square — that's a separate concept).
- New **Map Calibration Modal**: drag two endpoint crosshairs across a
  known-distance line on the map, type how many squares it represents.
  Saves both the resulting `pixelsPerSquare` AND the original endpoints
  so re-editing picks up where you left off.
- Fullscreen SVG editor with scroll-zoom (zoom-toward-cursor) and
  drag-pan; uses `getScreenCTM()` so endpoint pointer math is correct
  regardless of `preserveAspectRatio` letterboxing.
- Orange-base + green marching-ants visual on the calibration line, with
  oversize crosshairs that grab where the cursor actually clicks.

#### Projector calibration

- Per-device setup persisted in `localStorage`
  (`dmr_projector_setups`, `dmr_projector_active`). One device can hold
  multiple named setups — Game Room TV, Garage Projector, etc.
- Two calibration paths in a guided 3-step wizard:
    - **Large Format Display** — pick diagonal inches + resolution from
      dropdowns, the math computes pixels-per-inch automatically.
    - **Projector** — full-bleed live grid + coarse/fine sliders.
      Hold a ruler against the projection surface and dial it in.
- **Standalone calibration window** (`/calibrate.html`) — calibration
  is meaningless unless it physically projects at scale, so the modal
  opens as its own popup with a hint banner: *"Drag this window onto
  your projector or under-table screen, then toggle Fullscreen — the
  grid you'll see in the next step needs to be physically projected
  at scale before you can ruler it."*
- Saved → window auto-closes; the GM's Projector dropdown picks up
  the new setup via a `storage` event.

#### Projector window (`/projector.html`)

- Joins the GM as a P2P Guest (BroadcastChannel for same-browser, PeerJS
  for remote). Receives the active map and renders a
  `setup.pixelsPerSquare × map.pixelsPerSquare` crop centred on
  `projectorViewport.centerX/Y`.
- Three render modes (mutually exclusive): **scaled** (calibrated crop
  at table scale), **full** (fit-to-window, ignore calibration), or
  **black** (mute the surface during a transition).
- **0° / 90° / 180° / 270° rotation** of the rendered output via CSS
  transform — for fitting a portrait map onto a landscape projector.
  Effective dimensions swap for 90 / 270, used by the calibration math
  so the crop math stays right at any rotation.
- **1″ grid overlay** (toggle + colour picker) — anchored to projector
  calibration only, ignores map scale. Lines spaced at the projector's
  `pixelsPerSquare` CSS pixels, centred on the window so the middle of
  the projection is always a grid intersection.
- **Disable Filters** switch — defaults to off (filters apply by
  default, so the projector mirrors the player view). Toggle on for
  battlemap-pure unfiltered output. Master gate via
  `Renderer.setFilterEnabled` so the filter pass is bypassed entirely.
- **Auto-fade controls** — the setup label / fullscreen / recalibrate
  panel fades to opacity 0 after 10 s of mouse inactivity. Movement
  brings it back to 0.3; hover raises it to full. Table players don't
  see lingering UI chrome.
- **Markers are MAP-fixed** on the projector (not screen-fixed) — a
  token sized for one grid square stays one grid square physically,
  regardless of how zoomed the projector crop is.

#### Multi-projector (primary + monitors)

- First projector to connect = **primary**. Drives the GM's orange/green
  rectangle and uses its own calibration to render at table scale.
- Subsequent projectors = **monitors**. Mirror the primary's exact crop
  fit-to-window. Skip their own calibration. The monitor's canvas is
  constrained to the primary's aspect ratio via a CSS variable, white
  pad fills the bars, and a TV-bezel frame welds to the canvas (not
  the window) so what's *inside* the bezel matches the primary 1:1.
- Big red bottom-left **PROJECTOR MONITOR N** badge always at full
  opacity; fullscreen icon stays bottom-right and forced to icon-only.
- Closing the primary tears down the whole projection — a
  `projector_shutdown` message is broadcast to every monitor, which
  call `window.close()` themselves. No auto-promotion.
- Each window picks a `clientId` uuid and sends it in `projector_hello`;
  the GM addresses per-projector state via `projector_role` messages
  (broadcast, filtered by `targetId`). Monitors get fresh
  `primaryViewNW/NH/Aspect` whenever the primary's situation changes.

#### Projection View panel — single-control workflow

- Replaces the multi-button launch UI with one **Projector** dropdown:
    - **No Projection** (default — selecting again closes all)
    - One option per saved calibration setup
    - **+ Calibrate New Projector…** (opens the calibration popup)
- Default state shows just the dropdown + an intro paragraph
  explaining the feature. The full controls (Move Projection View,
  Black Out / Full Map, Disable Filters, Rotation, 1″ Grid, Open
  Projector Monitor, Recalibrate this Map) only appear when a primary
  is live.
- All toggles use the same iOS-style switches as the rest of the app.
- The launch button switches from primary blue to ghost style once a
  primary is connected, signalling its purpose has shifted from "open
  projection" to "open monitor".
- Touching any other control while moving the projection rectangle
  implicitly commits — matches the user's mental model that going
  somewhere else means *I'm done*. (Same auto-commit applied to the
  Player View edit mode for consistency.)

#### Calibration sync + error states

- Live recalibration of an in-use map fires `map_meta_update` so the
  primary projector re-crops at the new scale; monitors get a fresh
  `primaryView*` via `projector_role`.
- GM warning banner when the active map has no `pixelsPerSquare`.
- Projector "Waiting for GM to load a map…" overlay when no map yet.
- Projector top banner *"Map not calibrated — projection is
  fit-to-window, not at table scale"* when scaled mode lacks
  calibration.

#### Cosmetic alignment

- Fullscreen toggle is at **bottom-right** across player / projector /
  calibration windows. One spot to learn for the whole app.
- Calibration modal dropped its top-right "Saved picker / + New /
  Delete" actions — the GM dropdown now manages saved setups.
- Calibration name input capped to 28ch to nudge users toward short,
  memorable names that fit comfortably in the dropdown.

### Backlog seeded for later

- `.md`-as-map "text handouts" (calligraphic parchment / line printer /
  green-screen terminal renderings of markdown).
- Animated volumetric fog of war — keep the polygon system, swap the
  flat alpha for drifting noise.
- GM canvas zoom/pan + workspace overlay model (queued alongside the
  eventual map-mosaicing work).

## v2.8.0 — 2026-05-10

### Asset Management Refresh

A from-scratch overhaul of how the app stores, shares, and credits its audio
and image assets. The user-facing TL;DR: every audio sound and every map image
is now tracked separately from the maps that use them, so one image can back
multiple maps with their own fog / markers / tracker config, and remote-source
assets (Freesound, Web Links) only travel in your data pack when you say so.

#### Sounds — `My Library` overhaul

- **Web Links tab** in the Add Sound dialog. Paste comma / newline / space
  delimited URLs to audio files; each is validated via an `<audio>` probe
  with `crossOrigin='anonymous'` and a 15 s timeout. Valid ones land in your
  library tagged **URL**; the file streams from the source at runtime.
- **Tag pills** on every library row — `Freesound` (green), `URL` (blue),
  `Stored` (grey, additive). Stored = "this asset will travel with bundle
  exports". Uploads are always Stored; Freesound and URL items become Stored
  only when you explicitly click **Store**.
- **Store button** per row promotes a remote asset to fully-local. Bulk
  variants in the footer:
    - **Store All Used** — only assets actually referenced somewhere
    - **Store All** — every non-stored asset
    - **Delete All Unused** — permanently remove the un-referenced ones
- **Trash chip** `[!]` next to library rows that no map references.
  Hover-tooltip explains they're safe to delete.
- **Editable attribution** on Upload + URL rows (Freesound rows are locked).
  Pen icon next to the licence opens an inline form: Licence dropdown
  (CC0 / CC-BY / CC-BY-SA / CC-BY-NC / CC-BY-NC-SA / CC-BY-ND / CC-BY-NC-ND
  / Permission Granted / Other), Attribution text, Link URL.
- **Attributions modal** moved out of the Soundboard panel into both
  libraries' footers as **ℹ Attributions & Licences**. Now shows separate
  **Audio assets** and **Map assets** sections with a clipboard-friendly
  **Copy All** button.

#### Maps — `Map / MapAsset` split

- **Map / MapAsset entity split** under the hood. A `StoredMap` is now a
  named instance pointing at a separate `MapAsset` that owns the actual
  image. Two named maps can share one image asset with their own fog /
  markers / audio / tracker config.
- **`+ Add New Map` dialog** replaces the lone Upload button. Three tabs:
    - **My Library** — every MapAsset, with `URL` / `Stored` tags,
      pixel dimensions, hover-preview thumbnail, per-row Store /
      Use / Delete + the same trash chip / inline editor / footer
      bulk-action buttons as the Sounds library.
    - **Web Links** — paste image URLs, validate via `Image()` probe.
    - **Upload** — drop a PNG / JPG / WebP, name it, add.
- **Name field under the dropdown** — live-edit the active map's display
  name; the dropdown label updates as you type.
- **Clone Map** alongside a renamed **Delete Map**. Clone copies the per-map
  config (fog, markers, audio slots, tracker) with regenerated marker / slot
  IDs, sharing the same MapAsset (no image duplication). Append `- copy` to
  the name (de-duped).
- **`⚠ Fix Missing Map` button** appears when the current map's asset isn't
  retrievable (deleted, broken Web Link, offline + uncached). Reuses the
  Add Map dialog to relink — the map's other settings are preserved.
- **Procedural placeholder** image rendered at the asset's cached
  `imageWidth × imageHeight` so fog / marker / viewport coords stay
  positioned correctly during the missing state.

#### Bundle format (`bundleSchema: 2`)

- New `mapInstances`, `storedMapAssets`, `remoteMapAssets`, `storedAudio`,
  `remoteAudio` fields. **Stored** assets travel with their blobs; **URL**
  assets travel as metadata-only and re-fetch on the recipient.
- Legacy fields (`maps[]`, `uploadedAudio[]`, `freesoundAudio[]`) still
  written for back-compat — older clients can still read v2.8 bundles.
- `Load Maps File` clears every asset library before importing, so two
  bundles loaded back-to-back don't accumulate strays.

#### Footer & misc

- **Storage gauge** in the bottom corner shows `XX.X / YYY MB` of browser
  storage used (via `navigator.storage.estimate()`). Refreshes every 30 s,
  tints orange past 80 % of quota.
- **DB schema** bumped to v4 with an idempotent upgrade callback that
  self-heals stuck-version states from interrupted earlier upgrades.
- **`@vercel/analytics`** added behind a build-time `__VERCEL_DEPLOY__`
  flag (`process.env.VERCEL === '1'`). Vercel deploys get privacy-friendly
  page-view tracking; self-hosters and local dev get a fully analytics-free
  bundle (verified — no `@vercel/analytics` strings in `dist/` on a
  non-Vercel build).

### Refactors

- New `MapAssetStore` facade mirroring `AudioAssetStore` (runtime cache for
  non-stored URL fetches, `store()` / `getBlob()` priority chain,
  `getAttributions()`, `readDimensions()`, `update(id, patch)`).
- `assetUsage.ts` gains `getUsedMapAssetIds()` alongside the existing audio
  + icon helpers, used by the Map Library trash tracking.

---

## v2.7.0 — 2026-05-09

### New Features

- **Motion Tracker** — periodic radar / sonar / sensor sweep layered on top of the marker system. Use it for _Aliens_-style motion sensors, submarine sonar, sci-fi sensor sweeps, magical scrying — any "I'm here" pulse mechanic.
  - **Roles** — markers can now be assigned a **Motion Source** or **Motion Tracker** role independently of any audio role they hold (so a single marker can be e.g. both an Audio Source and a Motion Source). One Tracker per map; sources are unlimited.
  - **Scan loop** — every _Ping rate_ seconds the tracker emits an outgoing ping. A ring expands from the tracker for _Scan speed_ seconds and, as it crosses each Motion Source, fires a return blob + return ping at the moment of contact.
  - **Concurrent rings** — when rate < speed, multiple ring fronts coexist on screen simultaneously.
  - **Per-map persistence** — the tracker's range, rate, speed, colour, and assigned ping sounds are stored on the map state and carry forward as defaults to any new map created after.
  - **Logarithmic range slider** — slider position 0..1 maps to range 0.05..4.0 (Y-axis-normalised map units), giving fine control at the low end where most useful values live. The selected tracker shows a dotted preview ring in the configured colour as you drag the slider.
  - **Blob modes** — each Motion Source picks its own tracker view: **Single blob** (one circle the size of the source's icon), **Multi-blob (few)** (3–5 medium scattered blobs), or **Multi-blob (many)** (7–13 small scattered blobs, similar overall footprint). Cluster shapes are deterministically randomised per source so each contact looks unique but stays stable while it fades.
  - **Audio return only mode** — toggle "Audio return only (no blobs)" to get audible pings without visual contacts — for spookier reveals.
  - **Outgoing & return ping sounds** — assign any sound from your library (Library / Freesound / Upload) to the outgoing ping (fires when a scan starts) and return ping (fires when a source is detected). Independent volume sliders for each. Two CC0 sounds are bundled and seeded into every library by default — no setup needed to get the classic motion-tracker feel.
  - **Player passthrough** — the expanding ring and return blobs render through the same Three.js plane as the markers, so all visual filters (Parchment, CRT, Watercolour, etc.) apply to them. Audio plays on connected players too. Late-joining or refreshed players sync immediately.
  - **Hit-area underlay** — return blobs render beneath the marker icons so the source token stays clearly visible on top of its detection splash.

### Refactors & Architecture

- **Multi-role marker schema** — single `marker.role` field replaced by a roles object (`roles: { audio?, motion? }`) so a marker can independently participate in several interaction systems. Versioned migration framework introduced (`STATE_VERSION` 1 → 2) with a migrator chain in `src/storage/migrations.ts` — replaces ad-hoc field guards previously inline in `loadForMap`.
- **MarkerInteraction registry** — marker-driven systems (positional audio, motion tracker) live in `src/gm/markerInteractions/` as plug-in modules implementing a common `MarkerInteraction` interface. Each owns its runtime state and reacts to `onMarkersChanged` / `onMapLoaded` / `reset`. Adding a new interaction is now a single new file.
- **AssetSourceConnector** — generic interface (`src/audio/connectors/`) decouples the asset picker UI from any specific source. Freesound is the first connector; Web Links and other APIs slot in cleanly without modal rewrites.
- **State helpers** — `StateManager.updateMarker(id, patch)` and `updateMarkers(updater)` consolidate the marker-mutation pattern across GMApp.

### Visuals & Polish

- **Marker panel reshuffle** — Name → Locked → Hide from players → **Marker Icon** subsection (Icon, Colour, Size, Show Name) → Marker Sounds → Marker Motion → Clone/Delete. Dividers above the action buttons.
- **Badge colour scheme** — sources blue (muted: purple), listeners/trackers green (muted: red). Hidden marker eye stays red/green.
- **Marker icons on player view** — pre-squash on the texture so they render as true circles after the texture-to-plane stretch on non-square maps; multiplied by `viewNH` so they stay screen-fixed regardless of how zoomed the player view is.
- **Audio "max range" → "sound limit"** label on the audio source range circle to disambiguate from tracker range.

### Fixes

- **Load Maps File wipe** — bundle import now also wipes the audio asset library and custom icon library before importing the new bundle, so two bundles loaded back-to-back don't accumulate assets.
- **Last-opened map** — the GM remembers which map was active and re-opens it on reload, instead of always defaulting to the first map.

---

## v2.6.0 — 2026-05-07

### New Features

- **Marker audio — positional audio sources** — markers can now be assigned a role of _Audio Source_ or _Listener_. Audio Sources play a looping or randomised sound whose volume falls off with distance to the Listener marker. The listener position is determined by another marker set to the Listener role (typically the player character). Volume falloff is calculated in real time as either marker is dragged.
  - **Assign sound** — click the new "Assign Sound" button in the marker properties panel to pick any sound from My Library.
  - **Playback modes** — Once / Loop / Random (same scheduler as the Soundboard).
  - **Volume** — per-source volume slider and a per-role mute toggle.
  - **Max distance** — configurable radius slider beyond which the source is inaudible.
  - **Preloading** — all audio-source buffers for the current map are preloaded on map load so positional audio starts immediately.
  - **P2P broadcast** — `positional_play` / `positional_stop` / `positional_volume` messages keep player-side audio in sync as markers move.
- **Clone Marker** — a **Clone Marker** button sits alongside Delete Marker. Creates an exact copy of the selected marker offset by +0.02 in both axes, with " - copy" appended to the label. Useful for quickly placing groups of identical tokens.
- **Player auto-reconnect** — if the GM refreshes or the P2P connection drops, the player window automatically attempts to reconnect with exponential back-off (2 s → 4 s → 8 s → 16 s → 30 s cap). The status bar shows "Reconnecting… (Ns, attempt N)" while retrying.
- **Freesound pagination** — search results now show a **More results… (N remaining)** button when the API returns more than one page. Each click appends the next batch of 20 without clearing the existing results. The status line tracks how many are shown vs total.
- **Delete custom icon** — a **✕ Delete custom icon** button appears below **+ Upload custom icon** in the icon picker when custom icons exist. Clicking it enters delete mode (icons turn red-bordered); clicking any custom icon removes it from IndexedDB and the in-memory cache. **← Cancel delete** exits without removing anything.

### Fixes

- **Bundle import state clobber** — importing a bundle file (`Load Maps File`) no longer discards the freshly-imported per-map configs. Previously, `loadMap` flushed the old in-memory session state to IDB after the import wrote fresh configs with the same map IDs — silently overwriting markers, audio slots, and player view with stale data. Fixed by calling `StateManager.resetForImport()` before repopulating the map list, ensuring the flush in `loadMap` is a no-op.
- **Soundboard slot/audio restore** — discrete state mutations (markers, audio, transitions) now trigger an immediate IDB write rather than waiting for the 400 ms debounce. This closes the window where a page refresh could occur before the debounced write fired and wipe the last change.

---

## v2.5.0 — 2026-05-06

### New Features
- **Soundboard** — each map now has a per-map Soundboard panel (between Fog of War and Markers). Add up to 10 slots per page (pageable for more). Each slot has a play/stop button, loop toggle, individual volume slider, and a remove button.
- **Freesound integration** — search Freesound.org directly from the app (requires a free API key, stored in `localStorage` only — never exported). Results show duration, username, and license. Duration filter dropdown: ≤10s / ≤20s / ≤30s (default) / ≤60s / ≤120s / Any length. Preview before importing.
- **Sound library** — imported sounds are stored in IndexedDB and shared across all maps. The "My Library" tab in the picker lets you reuse any previously imported sound on any map with one click.
- **Attribution tracking** — the "ℹ Attributions" button in the Soundboard panel lists all Freesound attribution strings and license labels so CC-BY compliance is always accessible.
- **Broadcast to players** — soundboard play/stop events are sent over P2P so players hear audio in real time. A "Broadcast to players" toggle in the panel silences remote delivery for in-person play.
- **Auto-reload** — if a sound blob is missing from local storage, the engine silently re-downloads it from Freesound before flagging the slot as unavailable.
- **Player autoplay recovery** — if the browser blocks autoplay, a "Click anywhere to enable audio" hint appears on the player screen and retries on the next interaction.
- **P2P snapshot** — currently-playing slots travel in `full_state` and `map_change` so players who connect mid-session hear what's already playing.

---

## v2.4.0 — 2026-05-05

### Changes
- **Sidebar panel order** — Fog of War → Markers → Player View → Filter → Background Colour.
- **Panel headings** — brighter text, bolder weight, subtle blue-tinted background; hover lifts to full white. Makes sections easier to scan.
- **Auto-open Markers panel** — clicking any marker on the canvas opens the Markers sidebar panel if it is collapsed.
- **Auto-open Fog panel** — entering fog draw mode or selecting a polygon opens the Fog of War panel if it is collapsed.

---

## v2.3.5 — 2026-05-05

### Fixes
- **Markers on map change** — switching maps now sends the new map's markers (and any custom icon blobs) atomically inside `map_change`, the same way fog/filter/view already travel. Previously `marker_update` was never broadcast on a map switch, so players kept the previous map's markers until a manual drag triggered a sync.

---

## v2.3.4 — 2026-05-05

### Changes
- **Custom icons sent to players** — custom uploaded icons are now transmitted over P2P. The GM encodes each referenced `asset:uuid` icon to a data URL and includes it in `marker_update` and `full_state` messages; the player decodes each entry to an `ImageBitmap` and caches it by key, skipping any already cached. This mirrors the pattern planned for audio asset delivery.

---

## v2.3.3 — 2026-05-05

### Changes
- **Show Name toggle** — each marker now has a "Show Name on player map" checkbox (default off). When off, the player map shows the icon only; the GM always sees the label regardless of this setting.

---

## v2.3.2 — 2026-05-05

### Fixes
- **Player marker Y-axis** — markers placed at the top of the GM map now appear at the top on the player screen. `MarkerTexture` was applying `(1 − y)` before drawing, which double-inverted the coordinate (Three.js `CanvasTexture` with `flipY=true` already handles the canvas→UV flip). Fixed to `cy = y * H`.

---

## v2.3.1 — 2026-05-05

### Changes
- **Markers subject to filters** — player marker layer moved from a 2D canvas DOM overlay into the Three.js scene as Plane 2 (CanvasTexture), so all GLSL post-processing filters (parchment, retro sci-fi, watercolor, etc.) are applied to markers the same as the map and fog layers.
- **Icon picker** — replaced the free-text icon input with a click-to-open picker grid. Includes 46 preset Unicode symbols (shapes, chess/card suits, circled numbers ①–⑳, check/cross marks). Custom icons can be uploaded (resized to 64×64), are stored in IndexedDB, and are included in map bundle exports/imports for full portability.
- **Icon visual redesign** — removed the filled circle background. Icons now render directly in the marker's chosen colour with a dark stroke outline for readability. Default icon changed from 📍 to ◆. Image icons (custom uploads) use `asset:<uuid>` keys and render as-is.
- **Asset storage** — added `assets` store helpers (`saveAsset`, `getAllAssets`, `deleteAsset`) to the IndexedDB layer. Custom icons (`type: 'icon'`) are included in bundle export/import alongside maps.

---

## v2.3.0 — 2026-05-05

### New Features
- **Markers / tokens** — GMs can now place, move, and manage tokens on the map.
  - **Add** — click "+ Add Marker" in the sidebar or right-click the map to place a marker at any position.
  - **Drag** — click and drag any marker to reposition it; position is broadcast to players on release.
  - **Select** — click a marker to select it; its properties appear in the Markers sidebar panel.
  - **Sidebar controls** — edit name, icon (emoji), colour, and size. Toggle "Hide from players" to ghost the marker on the GM canvas while hiding it entirely from the player view.
  - **GM status badges** — each marker shows two clickable mini-badges: visibility (green ✓ / red ✕) and a role badge for audio sources (♪) and listeners (◉). Clicking a badge toggles the property directly on the canvas.
  - **HUD buttons** — a floating mini-toolbar above the selected marker offers one-click toggle-visibility and delete.
  - **Marker dropdown** — the sidebar dropdown lists all markers; selecting from it highlights the marker on the canvas.
  - **Player view** — players see all non-hidden markers rendered at their correct map-relative positions regardless of zoom or viewport offset. Markers re-project automatically on view changes.
  - **Persistence** — markers are saved per-map in IndexedDB and restored on reload.
  - **P2P broadcast** — marker changes are broadcast as `marker_update`; hidden markers are filtered out before transmission.

---

## v2.2.4 — 2026-05-05

### Changes
- **Scanline → Terminal Clear** — redesigned from a simple line sweep to an 80×25 character-grid wipe (configurable 40–160 cols, 10–50 rows). Each cell flashes phosphor green before being cleared, with a multi-cell fade band preceding the clear front. Cleared left-to-right, top-to-bottom. Configurable duration 500ms–6s.
- **Diagonal wipe polygon fix** — corrected vertex ordering for both `diag_tl` and `diag_tr` which previously produced self-crossing polygons and visible artifacts. Full case analysis for all five geometric phases (triangle → landscape quad → portrait quad → pentagon → full fill).
- **Wipe direction labels** — arrows now indicate movement direction (e.g. `→ Left to right`) rather than the start edge.

---

## v2.2.2 — 2026-05-05

### Fixes
- **Wipe / Scanline / Static Dissolve** — transitions were showing the edge glow but removing the whole image at once rather than revealing it progressively. Root cause: `drawEdge` and noise code left `ctx.fillStyle` set to a low-alpha gradient at the end of each frame; `ctx.save()` on the next frame captured that as the active fill, so `destination-out` was painting with near-transparent paint and punching no holes. Fixed by setting `ctx.fillStyle = '#000'` inside every `destination-out` block (`destination-out` ignores colour and uses alpha only).

---

## v2.2.1 — 2026-05-05

### New Features
- **Map transitions** — animated transitions play on the player screen when the GM switches maps. Select the transition (and configure its parameters) from the Current Map panel in the GM view. The transition holds the current view, plays the animation, and reveals the new map — filter, fog, and view all swap atomically so nothing flickers in early.
  - **None** — instant cut (default behaviour, unchanged).
  - **Fade** — fades the current map to black, swaps to the new map, fades back in. Duration configurable.
  - **CRT Collapse** — the screen collapses to a horizontal line, then to a phosphor dot (with green/amber glow), then expands back out with the new map. Colour and timing configurable.
  - **Wipe** — directional wipe in 6 directions (left, right, up, down, diagonal TL, diagonal TR) with a bright edge glow. Duration configurable.
  - **Scanline** — top-to-bottom or bottom-to-top reveal with a green scan-line glow. Duration configurable.
  - **Static Dissolve** — randomised block-by-block dissolve with subtle static noise. Block size and duration configurable.
  - Architecture mirrors the filters system: each transition lives in `src/transitions/definitions/<id>/index.ts` with its own param schema. Adding a new transition is a single new file — no registry edits needed. See `ADDING_TRANSITIONS.md` in the definitions folder.
- **Version badge** — current version shown in small text at the bottom of the GM sidebar.
- **LAN IP in QR code and player links** — when running the dev server locally, the QR code, "Open Player Window" button, and "Copy Player URL" now use the machine's LAN IP address instead of `localhost`. Allows phones and tablets on the same network to connect during local testing. (Production builds are unaffected.)

### Fixes & Improvements
- **Mobile viewport fix** — switched `Renderer` from `window.addEventListener('resize')` to `ResizeObserver`. On Android/Pixel the window resize event never fired on initial layout, causing the player to show the full map instead of the GM-defined viewport rectangle.
- **Atomic map change** — filter, view, and fog state now travel inside the `map_change` message rather than as separate follow-up messages. Eliminates a race where the new filter or view could briefly flash on the old map before the transition ran.
- **Transition reveal correctness** — transitions now snapshot the old frame, load the new map underneath while the snapshot covers the canvas, then animate the snapshot away. This ensures wipe/dissolve/scanline transitions reveal actual new content rather than the old map.

---

## v2.1.0 — 2026-04-18

### New Features
- **Interactive viewport editor** — the pan/zoom sliders are replaced by a direct on-map editor. A faint orange marching-ants rectangle is permanently overlaid on the GM's map showing exactly what players currently see. Click **Edit Player View** to activate drag handles: move the rectangle by dragging inside it, or resize it freely by dragging any corner. Hit **OK** to commit or **Cancel** to revert.
- **Reset to Full Map** — one-click button to snap the player view back to showing the complete map.
- **Strict viewport clipping** — the player's screen is hard-clipped to the GM's rectangle. No map content outside that rectangle is ever visible regardless of the player's screen size or aspect ratio. Background colour fills any letterbox or pillarbox bars.

---

## v2.0.0 — 2026-04-01

Initial public release of the v2 rewrite.

- Peer-to-peer via WebRTC (PeerJS) — no server required beyond static hosting.
- Eight visual filters including four artistically-styled effects (Ballpoint Pen, Hand Drawing, Watercolour, Oil Painting).
- Bundle import/export — save and restore the full map library as a single `.json` file.
- Default map bundle support (`public/default-bundle.json`).
- QR code for instant player connection on mobile.
- Auto-save of all per-map settings to IndexedDB.
- PWA support — installable on desktop and mobile.
- GPU-efficient rendering — static filters render on change only; animated filters run at full frame rate only when active.
