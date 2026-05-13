# Mappadux — GM Help

The sidebar controls everything players see. Click any panel title to expand or collapse it. The **☰** icon at the top-right of the sidebar opens the app-level menu — Save/Load Pack, Customise, Settings, About.

---

## App Menu (☰)

Pack-level actions live behind the hamburger.

**Save Map Pack…** — Exports your current workspace (all maps, audio, icons, fog, markers, splash, theme) as a single `.mappadux` file. The default filename derives from your Map Pack name + today's date; the OS save dialog lets you rename or pick a location.

**Save Encrypted Pack…** — Same export, but first prompts for a password. The bundle is wrapped in AES-GCM encryption with a PBKDF2-derived key. The recipient needs the password to open it. **If you forget it, the pack cannot be recovered — Mappadux has no recovery.**

**Load Map Pack** — Picks a `.mappadux` (or legacy `.json`) file from your disk and replaces your workspace with it. Encrypted packs prompt for their password before any destructive action, so a wrong-password cancel leaves your current pack intact. Auto-opens the About dialog on success.

**Customise pack…** — Opens the About dialog in edit mode. Set a **title**, **banner image** (with drag-to-pan crop picker for off-aspect images), **rich-text description** (bold / italic / underline, alignment, bullets, font, colour), **creator links** (Patreon, Discord, etc.), and the pack's **theme** (Dark / Light + accent colour). All of this travels with the bundle.

**New Map Pack…** *(red)* — Wipes the current workspace and starts a fresh, empty pack with a name you choose. Save first if you want to keep your current work.

**Settings…** — Three sections:
- **Storage** — How much of your browser's IndexedDB quota Mappadux is using. **Request persistent storage** asks the browser not to evict data under pressure.
- **API Keys (this browser only)** — Lists any external-service credentials stored locally (e.g. Freesound). Keys never travel in Map Pack exports. Bulk delete available.
- **Danger Zone** — **Delete DB** wipes IndexedDB but keeps API keys + projector calibration. **Delete All Data** wipes everything including local settings — acts like a fresh install.

**About…** — Shows the pack's splash content (title, banner, body, creator links) and the always-on Mappadux footer (Discord, Ko-fi, GitHub, mappadux.com, MIT licence). Auto-opens on first run and after any **Load Map Pack** so you land on context.

> **Sharing a pack via URL** — Append `?bundle=<URL>` to the Mappadux URL
> (e.g. `https://www.mappadux.com/?bundle=https://example.com/my-pack.mappadux`)
> and Mappadux will fetch and load that pack on startup. If you already have content, you're asked **Save current, then load** / **Discard and load** / **Cancel**. Encrypted packs prompt for their password as usual.

---

## Player Connection *(renamed from Session in v2.11)*

**QR Code** — Scan to open the player view on a phone or tablet at the table. **Hover** the QR for a tooltip showing the three-word room code; **click** the QR (or the small light bar to its left) to copy the player URL to your clipboard. Any device on the same network with a browser is a fully functional second screen — no app install, no cable.

**Players connected** — Live count below the QR. Counts both same-machine browser windows AND remote LAN devices, plus any connected projectors. Hover for a per-peer breakdown.

**Open Player Window** — Opens a local player window on this machine — handy for a second screen, projector, or quick preview.

**Broadcast toggle** *(panel header)* — visual bypass switch. Off swaps the player view for a friendly "the GM is faffing" placeholder while keeping the underlying state streaming so flipping back is instant.

Room codes stay the same across page reloads. If a player's connection drops, their window will automatically try to reconnect. If the public PeerJS broker is unreachable, same-machine browser windows still work via BroadcastChannel; the QR fades and a notice explains why remote devices can't join until the broker recovers (auto-retried every minute).

---

## Map

**Map Pack** — A name for your whole collection of maps. Travels with bundle exports and is used as the default filename when you **Save Map Pack…** from the menu. The default starter pack lands with the name "Getting Started" — edit it here once you start customising. You can also edit it inside the Save dialog.

**Map selector** — Switch between your maps. Switching instantly updates all connected players. The dropdown's selected label is **editable in place** *(v2.11)* — click it to rename the current map, Enter to commit, Esc to revert. Use the chevron to pick a different map. The bold-green **+ Add New Map…** entry at the bottom opens the Add Map dialog.

**+ Add New Map…** *(dropdown sentinel)* — Opens the Add Map dialog with three tabs:
- **My Library** — every map image already in your pack. Hover for a thumbnail preview. Click **Use** to spin up a new map instance pointing at it (one image can back many maps with their own fog / markers / tracker config). Per-row **Store** / pen-edit / **⬇ download** / delete + footer bulk buttons (Store All Used / Store All / Delete All Unused), plus **ℹ Attributions & Licences**.
- **Web Links** — paste image URLs (PNG / JPG / WebP). Each is validated; valid ones land in your library tagged `URL` and stream from the source at runtime.
- **Upload** — drop a local image, name it, add. Uploaded images are always stored.

**Clone Map** — Duplicates the active map with a `- copy` suffix. The image is shared with the original (no extra storage); fog, markers, audio, and tracker settings are copied independently so you can edit each map separately.

**Delete Map** — Removes the named map and its per-map settings (fog, markers, audio). The underlying image asset stays in your library and can be reused.

**⚠ Fix Missing Map** — Appears when the current map's image asset can't be retrieved (deleted, broken URL, offline + uncached). The map shows a placeholder so fog / marker positions stay sensible; click the button to relink to a different asset via the Add Map dialog.

**Transition** — Choose an animated effect to play on the player screen when you switch maps (Fade, CRT Collapse, Wipe, etc.). Parameters for the selected transition appear below the dropdown.

**Background Colour** *(v2.11 — moved here from its own panel)* — The fill colour shown around the map when the player's screen has a different aspect ratio. Auto-sampled from the map's top-left corner on first load.

**Edit this Handout (Text Map)** — visible only when the current map is a text-map / handout. Opens the rich Text Map editor in a dialog. See **Text Maps** below.

**Start Animation** — visible only when the current handout has an animated reveal configured. Triggers the reveal on every connected player + projector.

> Saving the whole pack — including all map / audio / image assets, fog, markers, splash, and theme — is in the **☰ menu** (Save Map Pack… / Save Encrypted Pack…). See **App Menu** above.

---

## Text Maps (Handouts) *(new in v2.11)*

A second map type for letters, posters, journal pages, stat blocks, and in-fiction documents. Text maps are first-class — they live alongside image maps in your library, ship in bundles, and broadcast to players exactly like image maps.

**Create** — from **+ Add New Map…** → the **Text Map** option, or from the asset library.

**Edit** — click **Edit this Handout (Text Map)** in Map Selection to open the editor in a full-screen dialog. Each handout is a page sized to your chosen aspect (16:9 / A4 / 4:3 / Square / 2:3 / custom), filled with absolutely-positioned **elements**: text blocks, images, or icons. Elements can be moved (top-left handle), resized (bottom-right handle), and deleted (top-right badge). Type into a selected text element to edit its content; the per-element toolbar adjusts font, size, colour, and alignment.

**Animated reveal** — text maps support an optional animation that "types" each character of every text element onto the page when triggered. Configure in the editor; trigger from Map Selection with the **▶ Start Animation** button while the handout is broadcast to players / projectors.

---

## Fog of War

Hides parts of the map from players.

**Draw** — Click to place polygon vertices on the map. Click the first vertex again (or near it) to close and commit the shape. Press **Esc** or right-click to cancel.

**Delete** — Appears when a polygon is selected. Removes it to reveal that area. **Del** / **Backspace** also work.

**Select** — Click any existing fog polygon (with Draw off) to select it; click empty space to deselect.

**Fog Colour** — Sets the colour of new polygons. Matching it to your map's border or background makes the fog blend in seamlessly.

---

## Filter

Applies a visual effect to the **player screen only** — the GM always sees the normal map.

Choose from None, Parchment Fantasy, Retro Sci-Fi Green/Amber, Ballpoint Pen, Hand Drawing, Watercolour, or Oil Painting. Each filter has adjustable sliders that appear below the selector. Settings are saved per map.

---

## Player View

**Orange rectangle** — Always visible on the GM's map; shows exactly what players can see right now.

**Direct manipulation** *(v2.11)* — Click the move handle (top-left corner of the rect) to select it. Selected rect gains:

- **Move handle** (top-left) — drag to reposition.
- **Resize handle** (bottom-right) — drag to resize freely.
- **Aspect-lock 16:9** (right edge) — snaps the rect to 16:9 physical proportions keeping the short edge fixed. Click again to undo.
- **Maximise / Restore** (right edge) — first click expands to full map; second click restores the pre-max view.

**Pop shortcut** — grabbing the move handle on a rect that already fills the entire map shrinks it to 50% map-dimensions centred. Gives you a sensibly-sized rect to drag/resize on the next gesture without having to fight a maximised view first.

**Broadcast toggle** — the visual-bypass switch in the **Player Connection** panel header. Off swaps the player screen for a friendly "the GM is faffing" placeholder while keeping the underlying state streaming, so flipping back is instant.

**Background Colour** — set in **Map Selection**. The fill colour shown around the map when the player's screen has a different shape. Auto-sampled from the map's top-left corner on first load.

---

## GM Workspace pan / zoom *(v2.11)*

The GM canvas itself is now a workspace you can pan and zoom through:

- **Wheel** — zoom around the cursor.
- **Mouse drag** — click + drag any empty space (away from handles / markers) to pan. Cursor flips to a grabbing hand.
- **Arrow keys** — pan; **R** — reset to centred fit.
- **Touch** — two-finger pinch to zoom + pan; single-touch is reserved for the editors (fog draw, marker handles).
- **Reset view** pill at the bottom-right appears whenever the camera is off identity. Click to snap back.
- **Off-screen indicators** — if you pan a viewport rectangle out of sight, a small pill appears at the edge of the canvas pointing toward it. Click to recentre the camera on that rect.

The workspace is **GM-only** — players and projectors always render at the rectangle the GM has chosen, not the GM's current zoom level. Zoom in on the GM canvas to place markers precisely, then frame whatever you want players to see with the player viewport rect.

---

## Projection View

A second on-table mode that renders the active map at **true table scale** — for use with an under-table screen, a down-projector, or any other surface where a 1″ creature on the map needs to physically project as 1″. Miniatures occupy real-world inches.

**Projector dropdown** — single control that runs the whole flow:

- **No Projection** *(default)* — nothing is being projected. Selecting this while a projector is open closes it and any monitor windows that were attached.
- **&lt;saved calibration name&gt;** — opens a primary projector window using that calibration. The first projector to connect is the **primary**; further windows you open join as **monitors** (see below).
- **+ Calibrate New Projector…** *(bold-green dropdown sentinel)* — opens the calibration wizard in its own window. Drag that window onto your projector or under-table screen, click the bottom-right ⛶ Fullscreen, then walk through the 3 steps: pick the display type, dial in the grid (LFD diagonal/resolution **or** projector live-grid + ruler), name and save. The window closes itself; the new calibration appears in the dropdown immediately. *If your screen size or resolution isn't in the LFD lists, switch to the Projector option and use the live ruler-on-screen calibration instead.*

When no projector is active, the panel shows just the dropdown and a brief intro paragraph. Once a primary connects, the full controls appear:

**Direct manipulation** *(v2.11)* — Same chrome as the Player View rect: click the **move handle** at the top-left of the green rect to select + drag the projection. Selection adds a **maximise / restore** button on the right edge that toggles between calibrated `scaled` mode and `full` map mode. Resize / aspect-lock aren't shown — projector size is locked to your calibration so you can't accidentally rescale at the table.

**Broadcast toggle** — the visual-bypass switch in the **Projection View** panel header swaps the projector to a "GM is faffing" placeholder while keeping the underlying state streaming. Replaces the older dedicated Blackout button.

**Full Map** — Show the entire map fit-to-window on the projector, ignoring calibration. Handy for showing scope before zooming into a calibrated battlemap. When the active map isn't calibrated, this is the only available projection mode — Scaled View greys out with a "Scaled View (Unavailable)" label and a warning explaining that calibration unlocks it.

**Disable Filters** — When ticked, the GM's active visual filter does **not** apply to the projector — useful for projecting a clean battlemap while players still get a Parchment / Sci-Fi Green / etc. filter on their own screens. Off by default.

**Rotation (0° / 90° / 180° / 270°)** — Rotate the rendered output to fit a portrait map onto a landscape projector (or vice versa). There's no inherent "up" on a table display, so use whichever angle lines up with how the projector is mounted.

**1″ Grid Overlay** — Toggle a calibrated 1″ / 25 mm grid over the projection in any colour you pick. The grid is anchored to your projector calibration (not the map's), so it always projects as 1″ squares regardless of how you've cropped the map. Use it for ranges, movement, area-of-effect templates.

**+ Open Projector Monitor…** — Opens an additional window that **mirrors** the primary's exact crop, fit-to-window with a TV-bezel frame and a red **PROJECTOR MONITOR N** badge in the corner. Monitors don't use their own calibration — they're "what the table sees" repeaters for an off-table viewer (e.g. a player at the far end of the room, or the GM glancing at a second screen). Closing the primary window automatically closes all attached monitors.

**Recalibrate this Map…** — Re-runs map calibration without leaving the panel. Live changes propagate immediately to the projector and any monitors.

**Calibrate this Map** *(at the asset level, in the Map Library)* — Drag two endpoints across a known distance on the map and tell it how many 1″ / 25 mm squares it represents. Saves both the calculated `pixelsPerSquare` and the original endpoints so re-editing picks up where you left off.

> Tip: the projector window's setup label and fullscreen icon fade out after 10 s of mouse inactivity so they don't intrude during play. Move the mouse to bring them back.

---

## Markers / Tokens

Place icons on the map to represent characters, objects, or points of interest.

**Add Marker** — Pick **+ Add Marker** (the bold-green option at the bottom of the marker dropdown) to drop one at map centre, or right-click anywhere on the map to place one at that point.

**Direct manipulation** *(v2.11)* — every marker carries on-canvas chrome when selected:

- **Move handle** at the top-left — drag to reposition. Position broadcasts to players immediately on release.
- **Badge row** along the top edge — clickable mini-indicators for visibility, audio role, and motion role. Click any badge to toggle its state without going through the panel.
- **Resize + rotate** handles at the bottom-right and top edges.

**Select** — Click the marker's move handle, or pick it from the dropdown. Its properties appear in the panel.

**Rename in place** — the marker dropdown's selected label is editable directly. Click it to edit, Enter to commit, Esc to revert.

**Properties** — Edit the icon, colour, and size. Toggle **Hide from players** to make a marker invisible to players while it remains visible (ghosted) to you. Toggle **Locked** to make a marker panel-access-only — the on-canvas handles ignore clicks on locked markers.

**Show Name** — When on, the marker's label is visible on the player screen. Off by default.

**Clone Marker** — Creates an exact copy of the selected marker, offset slightly and labelled " - copy".

**Delete Marker** — Removes the selected marker.

**Icon picker** — Click the icon button to open the **Small Asset Library** modal. Browse your saved icons, paste a Web Link, upload a file, or pull from the built-in connectors: **Lucide** (MIT) and **game-icons.net** (CC-BY 3.0). Tintable icons follow your chosen marker colour.

---

## Marker Roles & Positional Audio

Each marker can be given a **role** using the role buttons in its properties panel. A single marker can hold both an audio role and a motion role at the same time.

**Audio Source** — This marker plays a sound. Assign a sound from your library, set volume, playback mode (Once / Loop / Random), and the maximum distance at which it can be heard.

**Listener** — Represents where the players are standing. Audio Sources get louder or quieter as the Listener marker moves closer or further away. Only one Listener is active at a time.

Moving either marker updates player audio in real time. Audio Sources can be hidden from players — they'll still hear the sound without seeing the marker.

---

## Marker Motion (Tracker)

The Motion Tracker brings sweeping radar / sonar to your map — _Aliens_-style motion sensors, submarine ASDIC / sonar pings, magical scrying, sci-fi sensor sweeps, anything where a position emits "I'm here" pulses on a periodic scan. One marker is the **tracker**; any number of others are **sources**.

**Motion Source** — A marker that the tracker can detect. Pick a **Tracker view** (Single blob / Multi-blob few / Multi-blob many) for how it shows up when picked up. Hidden Motion Sources still register on the tracker — useful for things the players can't see.

**Motion Tracker** — One per map. When this marker is set up:

- **Range** — how far the tracker can detect (logarithmic slider — fine control at the low end, can extend well beyond the map).
- **Ping rate** — how often the scan repeats (0.25 s for tense, fast pulsing; up to 15 s for occasional sweeps). When rate is shorter than scan speed, multiple rings expand on screen at once.
- **Scan speed** — how long the ring takes to expand from the tracker out to its full range.
- **Colour** — the ring and blob colour. The tracker marker also shows a dotted "tracker range" preview ring in this colour while you're configuring it.
- **Audio return only (no blobs)** — silences the visual contacts but keeps the audio pings. For when you want the players to *hear* something out there without knowing where.
- **Outgoing ping** & **Return ping** — sounds played at scan start and at each contact, with independent volume sliders. Two CC0 sounds are bundled by default so it works out of the box.

The **Muted** toggle on either tracker or source temporarily switches it off.

The visuals and audio are mirrored to connected players, with the rings and blobs passing through any active visual filter — so a sonar pulse on a Parchment-filtered map looks hand-drawn.

---

## Soundboard

Play ambient music and sound effects to your players.

**Slots** — Each slot holds one sound. Click **+ Assign Sound** to open the sound picker:
- **My Library** — your saved sounds. Each row shows source pills (`Freesound`, `URL`) and a `Stored` pill if it's been kept locally. **`[!]`** marks rows no map references — safe to delete. The pen icon lets you edit licence + attribution + link on user-added rows. **⬇** pulls the asset back to disk as a file. Footer buttons: **Store All Used** / **Store All** / **Delete All Unused**, plus **ℹ Attributions & Licences** which opens a unified credits modal (audio + map assets) with **Copy All** to clipboard.
- **Freesound Search** — search [freesound.org](https://freesound.org) by keyword. Imported sounds work like URL assets by default — click **Store** in the library to take a permanent local copy.
- **Web Links** — paste one or more URLs to audio files. Each is validated; valid ones land in your library tagged `URL` and stream from the source at runtime.
- **Upload** — drag and drop a local audio file. Uploads are always stored.

**Stored vs URL** — A `Stored` asset is part of your data pack: it works offline and travels with bundle exports. A URL asset is a reference: it streams from the web at runtime and stays out of bundle exports unless you Store it. Click **Store** on any URL or Freesound row to flip it to Stored.

**Playback modes** — Each slot has three modes (click the icons):
- ** Once** — plays once and stops.
- ** Loop** — plays continuously; auto-resumes when you return to this map.
- ** Random** — fires one-shots at randomised intervals. Use the frequency slider to set roughly how often.

**Volume** — Slider per slot.

**Mute All** — Silences all audio instantly on your side without stopping playback state.

**Broadcast to players** — Toggle whether players hear the soundboard (on by default). Turning it off lets you preview sounds privately.

**ℹ Attributions** — Lists all CC-licensed sounds in use. Keep this handy for crediting Freesound authors.

---

## Status Bar

The strip at the bottom of the sidebar shows loading progress, errors, and confirmations.
