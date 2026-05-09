# Dynamic Map Renderer — GM Help

The sidebar controls everything players see. Click any panel title to expand or collapse it.

---

## Session

**Room Code** — The three-word code your players use to connect (e.g. `silent-raven-forge`). It stays the same across page reloads. If a player's connection drops, their window will automatically try to reconnect.

**QR Code** — Scan to open the player view on a phone or tablet at the table.

**Open Player Window** — Opens a local player window on this machine — handy for a second screen or projector.

**Copy Player URL** — Copies the full link (with the room code) to share with remote players.

**Players** — Shows how many player windows are connected right now.

---

## Map

**Map selector** — Switch between your maps. Switching instantly updates all connected players.

**Name** — Live-rename the selected map; the dropdown label updates as you type. The underlying image keeps its own filename — this is just the display name in your pack.

**+ Add New Map** — Opens the Add Map dialog with three tabs:
- **My Library** — every map image already in your pack. Hover for a thumbnail preview. Click **Use** to spin up a new map instance pointing at it (one image can back many maps with their own fog / markers / tracker config). Per-row Store / pen-edit / delete + footer bulk buttons (Store All Used / Store All / Delete All Unused), plus **ℹ Attributions & Licences**.
- **Web Links** — paste image URLs (PNG / JPG / WebP). Each is validated; valid ones land in your library tagged `URL` and stream from the source at runtime.
- **Upload** — drop a local image, name it, add. Uploaded images are always stored.

**Clone Map** — Duplicates the active map with a `- copy` suffix. The image is shared with the original (no extra storage); fog, markers, audio, and tracker settings are copied independently so you can edit each map separately.

**Delete Map** — Removes the named map and its per-map settings (fog, markers, audio). The underlying image asset stays in your library and can be reused.

**⚠ Fix Missing Map** — Appears when the current map's image asset can't be retrieved (deleted, broken URL, offline + uncached). The map shows a placeholder so fog / marker positions stay sensible; click the button to relink to a different asset via the Add Map dialog.

**Transition** — Choose an animated effect to play on the player screen when you switch maps (Fade, CRT Collapse, Wipe, etc.). Parameters for the selected transition appear below the dropdown.

**Save to File** — Exports the entire pack (maps, image assets, audio assets, fog, markers, tracker config) as a single `.json` backup file. **Stored** assets travel with their blobs; **URL** assets travel as references and re-fetch on the recipient.

**Load Maps File** — Replaces everything with a previously saved bundle. You'll be asked to confirm — back up first.

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

**Edit Player View** — Drag inside the rectangle to move it; drag any corner to resize it freely. Click **OK** to confirm or **Cancel** to revert.

**Reset to Full Map** — Snaps the view back to the full map instantly.

**Background Colour** — The fill colour shown around the map if the player's screen has a different shape. Auto-sampled from the map's top-left corner on first load.

---

## Markers / Tokens

Place icons on the map to represent characters, objects, or points of interest.

**Add Marker** — Click **+ Add Marker** in the sidebar or right-click the map to place one at that position.

**Drag** — Click and drag any marker to reposition it. Moves are broadcast to players immediately on release.

**Select** — Click a marker on the map or choose it from the dropdown. Its properties appear in the panel.

**Properties** — Edit the label, icon, colour, and size. Toggle **Hide from players** to make a marker invisible to players while it remains visible (ghosted) to you.

**Show Name** — When on, the marker's label is visible on the player screen. Off by default.

**Clone Marker** — Creates an exact copy of the selected marker, offset slightly and labelled " - copy".

**Delete Marker** — Removes the selected marker.

**Icon picker** — Click the icon button to choose from preset symbols or upload your own image. To remove a custom uploaded icon, click **✕ Delete custom icon** inside the picker, then click the icon you want to remove.

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
- **My Library** — your saved sounds. Each row shows source pills (`Freesound`, `URL`) and a `Stored` pill if it's been kept locally. **`[!]`** marks rows no map references — safe to delete. The pen icon lets you edit licence + attribution + link on user-added rows. Footer buttons: **Store All Used** / **Store All** / **Delete All Unused**, plus **ℹ Attributions & Licences** which opens a unified credits modal (audio + map assets) with **Copy All** to clipboard.
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
