# Changelog

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
