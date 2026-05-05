# Dynamic Map Renderer — GM Help

This is the GM control panel. The sidebar on the left controls everything the players see on their screen. Panels can be collapsed or expanded by clicking their title bar.

---

## Session

Manages the live connection between you (the GM) and your players.

**Room Code** — The unique three-word code for this session (e.g. `silent-raven-forge`). Players enter this code on the player page to connect. The code is remembered across page reloads so your players can reconnect to the same room.

**QR Code** — Scan with a phone or tablet to open the player view directly. Useful for getting players connected quickly at the table.

**Open Player Window** — Opens the player view in a new browser window on this machine. Handy for testing or for running the player display on the same PC connected to a projector.

**Copy Player URL** — Copies the full player URL (including the room code) to your clipboard. Share this link with remote players.

**Players** — Shows how many player windows are currently connected.

---

## Map

### Current Map

**Map selector** — Dropdown list of all uploaded maps. Select a map here to load it onto the GM preview and push it to all connected players immediately.

**Upload New Map** — Upload a map image file (`.png`, `.jpg`, `.jpeg`, `.webp`). The map is stored locally in your browser and added to the selector. The map is immediately loaded and pushed to players.

**Delete Current Map** — Permanently deletes the currently selected map and all its saved settings (fog polygons, filter, view position). This cannot be undone.

### All Map Data

**Save to File** — Exports all your maps and their saved configurations (fog, filters, view) as a single `.json` bundle file. Use this to back up your maps or transfer them to another machine.

**Load Maps File** — Replaces all current maps with the contents of a previously saved bundle file. A confirmation prompt will appear first as this operation is destructive and cannot be undone. Make sure you have saved a backup first.

---

## Fog of War

Used to hide parts of the map from players — for permanent GM-only notes, unexplored areas, or classic fog of war.

**Draw** — Toggle draw mode on and off. While active the cursor changes to a crosshair. Click on the map to place vertices one at a time. Click near the first vertex (within the snap radius) to close and commit the polygon. Press **Esc** or right-click to cancel a polygon in progress.

**Delete** — Appears only when a completed polygon is selected. Deletes the selected polygon, revealing that area on the player map. You can also press the **Del** or **Backspace** key.

**Fog Colour** — The fill colour for new fog polygons. Click the swatch to open the colour picker. Changes apply to new polygons; existing polygons keep their original colour. Matching this colour to the border or background of your map image creates a seamless masked look.

> **Workflow tip:** Click on an existing fog polygon (when Draw is off) to select it — the marching-ant outline brightens and the Delete button appears. Clicking empty space deselects.

---

## Filter

Applies a full-screen visual effect to the **player** view only. The GM always sees the unfiltered map.

**Filter selector** — Choose from available effects:

| Filter | Best for |
|--------|----------|
| None | Unfiltered map |
| Parchment Fantasy | Fantasy, historical, gothic |
| Retro Sci-Fi Green | Mothership, Traveller, Alien RPG |
| Retro Sci-Fi Amber | Amber-phosphor terminal variant |
| Ballpoint Pen | Hand-sketched dungeon maps |
| Hand Drawing | Hatched ink sketch with colour |
| Watercolour | Hand-painted fantasy / nautical |
| Oil Painting | Painterly impasto style |

Selecting *None* removes all effects.

Below the selector, each filter exposes parameter groups (e.g. Display, Colour, CRT Effects). Click a group header to expand it and adjust its sliders. Groups are collapsed by default. Settings are saved per map so each map can have its own filter configuration.

---

## Player View

Controls the pan and zoom of the player camera. The GM's own view is unaffected — this only changes what players see.

**Center X / Center Y** — Pan the player view horizontally and vertically. Both are normalised 0–1 values where 0.5 / 0.5 is the centre of the map. Adjust with the slider or type a value directly.

**Zoom** — Zoom level multiplier. 1.0 fits the whole map to the player's screen. Values above 1.0 zoom in; values below zoom out.

---

## Background Colour

Sets the colour displayed **behind** the map image on both the GM and player screens — visible in letterboxed or pillarboxed areas when the map does not fill the full display.

**Colour** — Click the swatch to pick a colour. When a new map is loaded for the first time the colour is automatically sampled from the top-left pixel of the map image as a sensible starting point. You can override it at any time; your choice is saved with the map.

---

## Status Bar

The strip at the very bottom of the sidebar shows the current status message — map loading progress, errors, export confirmations, and similar feedback.
