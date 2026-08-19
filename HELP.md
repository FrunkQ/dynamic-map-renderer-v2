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

**Settings…** — an accordion (opening one section closes the others):
- **Storage** — How much of your browser's IndexedDB quota Mappadux is using. **Request persistent storage** asks the browser not to evict data under pressure.
- **Display** — **UI scale** slider (75–150%) shrinks or grows the whole left-hand sidebar in proportion — fonts, padding, icons, popovers all scale together. The map canvas itself is untouched. Double-click the slider to reset to 100%.
- **Scaled View** — toggle map transitions & animations.
- **Performance** — **Send only the first frame to local player windows** (for same-machine player windows where a 4K animated map is starving Chrome's decoder budget) and **Cap animated map texture at 1080p** (for remote players whose GPUs struggle with full-resolution video uploads). Both default off.
- **Soundtracks** — enable / configure the YouTube + Spotify soundtrack providers.
- **Player Permissions** *(v2.17)* — what connected players can do: allow pings, allow messages, let players move their own token, and *Full player UI in the GM preview window* (off by default — the inline preview stays a clean, non-registering preview unless you flip this on).
- **Game System** *(v2.17)* — initiative order direction: High → Low (d20) or Low → High (roll-under systems).
- **Reply Assistant (LLM)** *(v2.17)* — optional LLM that drafts replies to player messages. Walks you through it: **Base URL** (pre-filled with the LM Studio local address) → **API key** (blank for LM Studio; required for OpenRouter etc.) → **Test connection & fetch models** → pick the **Model** from the dropdown. Plus an editable system prompt. Everything stays between your browser and the endpoint you choose.
- **API Keys (this browser only)** — Lists any external-service credentials stored locally (Freesound, Spotify Client ID, LLM key). Keys never travel in Map Pack exports; delete any of them here.
- **Danger Zone** — **Delete DB** wipes IndexedDB but keeps API keys + projector calibration. **Delete All Data** wipes everything including local settings — acts like a fresh install. Also hides the **Show in-progress features** toggle (reveals the Stagecraft Lighting / Automation UI).

**About…** — Shows the pack's splash content (title, banner, body, creator links) and the always-on Mappadux footer (Discord, Ko-fi, GitHub, mappadux.com, MIT licence). Auto-opens on first run and after any **Load Map Pack** so you land on context.

> **Sharing a pack via URL** — Append `?bundle=<URL>` to the Mappadux URL
> (e.g. `https://www.mappadux.com/?bundle=https://example.com/my-pack.mappadux`)
> and Mappadux will fetch and load that pack on startup. If you already have content, you're asked **Save current, then load** / **Discard and load** / **Cancel**. Encrypted packs prompt for their password as usual.
>
> **Where to host the pack file.** The URL must be **https** (an `http://` link is blocked on the https site), and for a *seamless* one-click load the host must allow cross-origin access (a CORS header). Hosts that work out of the box:
> - **GitHub** — commit the `.mappadux` to a repo and use its **`raw`** URL (`https://raw.githubusercontent.com/...`). Free, https, CORS-enabled, up to 100 MB. Easiest option.
> - **Cloudflare R2** (public bucket), **Amazon S3** with a CORS rule, or your own server with `Access-Control-Allow-Origin: *`.
> - Same site (host the file on mappadux.com itself) needs nothing extra.
>
> If a host doesn't send CORS, Mappadux falls back automatically: it offers to **download** the pack (a download isn't subject to CORS) and then load it from your disk in one extra click. **Google Drive / Dropbox share links are unreliable** for this — prefer a raw/direct file URL.
>
> Full setup guide (GitHub / Cloudflare R2 / S3 / your own server): [docs/hosting-map-packs.md](docs/hosting-map-packs.md).

---

## Running multiple sessions from one machine *(power-user tip)*

One GM window = one room code = one room of players + projectors. If you want to drive *different* content to different devices at the same time — say a battlemap on a table tablet AND a handout on a player tablet, simultaneously and independently — open a **second Mappadux instance**.

**Easiest path *(new in v2.15)*** — pick **New Mappadux instance** from the ☰ menu. The new tab opens with `?instance=NAME` in the URL (e.g. `?instance=amber-falcon`); each instance has its own IndexedDB, its own room code, and its own player / projector spawn URLs. Two GMs side-by-side, each running their own game, no crosstalk.

You can also still use a **private / incognito window** for full browser-level isolation if that suits you better.

To share the same pack between both instances:

1. In the first window, **☰ → Save Map Pack…** to a `.mappadux` file.
2. Open the second instance and load Mappadux.
3. **☰ → Load Map Pack** → pick the file you just saved.

Or, if you've hosted the pack at a URL, open both windows with `?bundle=<URL>` and they'll both auto-load it. The `?bundle=` and `?instance=` params can be combined.

Use cases this unlocks: floorplan tablet (room A's projector view) + handout tablet (room B's player view), multiple battlemaps in parallel, a "rehearsal" window where you stage the next scene while the live window keeps the players' current view going.

---

## Player Views

*(Consolidates the old Player Connection + Scaled View panels — v2.17.)*

One panel for everything player-facing. The header carries the **broadcast toggle** — a visual bypass that swaps both the player and projector views for a friendly "the GM is faffing" placeholder while keeping the underlying state streaming, so flipping back is instant (anyone who connects while it's off lands on the placeholder too). Inside are two collapsible sections:

### Player connections

**QR code** — Scan to open the player view on any phone, tablet, or laptop on the same network — a fully functional second screen, no app install, no cable. The QR is always a clean, flag-free join URL (it uses your LAN IP when running locally), so a scanning device always lands as a real player. The URL is shown beneath it.

**Window summary** — A live count of connected player *windows* by type and capability (not the player roster — that's the **Players** panel): **Local windows** (GM previews + same-machine player windows), **Scaled views** (projector windows), and **Remote** (network devices, split into PC vs mobile).

**Show Player View** *(replaces "Open Player Window")* — an inline preview of the player view, docked on the GM canvas. **Pop it out** to a standalone window (sound + fullscreen) when you want it on a second screen. The inline preview stays a silent, non-registering GM preview; pop-outs and QR-scanned devices register as real players. (Toggle *Settings → Player Permissions → Full player UI in the GM preview window* if you want the inline preview to behave as a real player instead.)

### Scaled view

The true-table-scale battlemap mode — see **Scaled View** below for the full workflow.

Room codes stay the same across page reloads. If a player's connection drops, their window auto-reconnects. If the public PeerJS broker is unreachable, same-machine browser windows still work via BroadcastChannel; the QR fades and a notice explains why remote devices can't join until the broker recovers (auto-retried every minute).

---

## Player Voice *(new in v2.17)*

Players stop being a passive audience. Each interaction has a switch in **Settings → Player Permissions**, so you only enable what suits your table.

**Players panel** — A live roster of everyone who's introduced themselves (name + colour), with a connected / total count in the header. Identities persist across reconnects. **+ Add offline player** lets you create a player for someone at the table with no device — you set their name + colour and act on their behalf; real players appear here automatically when they connect.

**Player tokens** — Place a token for any player from the Players panel and drop it on the map. With **Let players move their own token** on, that player can drag *their* token from their own view — you see it move live and get a **send it back** button to undo it. Off keeps token placement entirely in your hands.

**Pings** — With **Allow player pings** on, a player right-clicks (or long-presses on touch) the map to ping a point. Everyone sees a pulse in that player's colour for a few seconds; on your screen it stays put, labelled with their name, until you dismiss it.

**Messaging** — With **Allow player messages** on, players can message you privately or each other (those are copied to you). Threads arrive in the **Player Voice panel** with an unread count.

**Reply Assistant (LLM)** — Optional. When configured (see **Settings → Reply Assistant**), each incoming message gets a **Suggest replies** action that drafts a few in-character responses via your chosen LLM; click one to drop it into the reply box. Works with a local LM Studio server (no key) or a hosted provider like OpenRouter.

**Initiative tracker** — Opens from **Roll for Initiative** in the Players panel. A fanned-deck rail: broadcast a roll prompt to the table, fill in / drag to reorder the order, advance turns (the current actor parks behind the **ROUND END** marker so it acts next round), and end combat to close it. Sort direction (High → Low for d20, Low → High for roll-under) is set in **Settings → Game System**. The rail is mirrored to players + projector.

---

## Annotations *(new in v2.17)*

GM scene-tracking tools you drop directly on the map. Each is **anchored 1:1 to the map** (it stays glued to the same spot through pan / zoom) and mirrored live to players + projector. Annotations are saved with the map and travel in the pack.

- **Progress clocks** — Blades-style segmented clocks; click to fill / unfill segments. Track a looming threat, a ritual's progress, a chase.
- **Timers & countdowns** — real-time countdowns or count-up stopwatches with play / pause / reset on the edge controls.
- **Whiteboard** — a freehand drawing layer over the map.
- **Notes** — sticky text notes that resize to fit.

Select an object via its move handle first, then use the edge controls (edit, play / pause, reset) — nothing reacts until it's selected. The object's chrome accent picks up the colour you choose for it.

---

## Map

**Map Pack** — A name for your whole collection of maps. Travels with bundle exports and is used as the default filename when you **Save Map Pack…** from the menu. The default starter pack lands with the name "Getting Started" — edit it here once you start customising. You can also edit it inside the Save dialog.

**Map selector** — Switch between your maps. Switching instantly updates all connected players. The dropdown's selected label is **editable in place** *(v2.11)* — click it to rename the current map, Enter to commit, Esc to revert. Use the chevron to pick a different map. The bold-green **+ Add New Map…** entry at the bottom opens the Add Map dialog.

**+ Add New Map…** *(dropdown sentinel)* — Opens the Add Map dialog with three tabs:
- **My Library** — every map image already in your pack. Hover for a thumbnail preview. Click **Use** to spin up a new map instance pointing at it (one image can back many maps with their own fog / markers / tracker config). Per-row **Store** / pen-edit / **⬇ download** / delete + footer bulk buttons (Store All Used / Store All / Delete All Unused), plus **ℹ Attributions & Licences**.
- **Web Links** — paste image URLs (PNG / JPG / WebP). Each is validated; valid ones land in your library tagged `URL` and stream from the source at runtime.
- **Upload** — drop a local image, name it, add. Uploaded images are always stored.
- **+ Create a New Composite Map** *(v2.15)* — opens the Composite Map editor so you can tile multiple images into one map. See **Composite Maps** below.

**Clone Map** — Duplicates the active map with a `- copy` suffix. The image is shared with the original (no extra storage); fog, markers, audio, and tracker settings are copied independently so you can edit each map separately.

**Delete Map** — Removes the named map and its per-map settings (fog, markers, audio). The underlying image asset stays in your library and can be reused.

**⚠ Fix Missing Map** — Appears when the current map's image asset can't be retrieved (deleted, broken URL, offline + uncached). The map shows a placeholder so fog / marker positions stay sensible; click the button to relink to a different asset via the Add Map dialog.

**Transition** — Choose an animated effect to play on the player screen when you switch maps (Fade, CRT Collapse, Wipe, etc.). Parameters for the selected transition appear below the dropdown.

**Background Colour** *(v2.11 — moved here from its own panel)* — The fill colour shown around the map when the player's screen has a different aspect ratio. Auto-sampled from the map's top-left corner on first load.

**Edit this Handout (Text Map)** — visible only when the current map is a text-map / handout. Opens the rich Text Map editor in a dialog. See **Text Maps** below.

**Start Animation** — visible only when the current handout has an animated reveal configured. Triggers the reveal on every connected player + projector.

**Upper-layer transparency** *(v2.15, layered composites only)* — a slider on the Map panel that fades the topmost tile of a layered composite so you can preview what's beneath without painting Reveal Map Layer brushes. GM-only — players never see the partial fade.

> Saving the whole pack — including all map / audio / image assets, fog, markers, splash, and theme — is in the **☰ menu** (Save Map Pack… / Save Encrypted Pack…). See **App Menu** above.

---

## Soundtracks *(new in v2.16)*

Pack-level background music that persists across map switches.
Distinct from the per-map **Soundboard** (sound effects + per-map
ambience): Soundtracks are the running score for your whole
session — the tavern lute that keeps playing as you walk to the
inn's bedroom and back again. Two providers ship:

- **YouTube / YouTube Music** — no sign-in needed for the user;
  YouTube's IFrame Player handles playback. Single tracks and
  playlists both supported.
- **Spotify** — full programmatic control via Spotify's Web
  Playback SDK + Web API. Requires a **Premium** account (the
  SDK refuses to stream for Free accounts) and a one-time
  Spotify Developer App registration.

### Setup is in Settings

Open **☰ → Settings → Soundtracks**. Toggle the providers you
want, then for Spotify follow the on-screen step-by-step to
register a Developer App and Connect. Setup is a one-time
operation; tokens persist locally and never travel in
`.mappadux` bundles.

### Slots

The Soundtracks panel renders a vertical list of **slots**. The
first slot is always **Silence** — selecting it crossfades
whatever's playing to nothing. Add more slots via **+ Add slot**;
each slot holds either a single track or a full playlist / album.

Paste a YouTube or Spotify URL into the slot's input — Mappadux
recognises whether it's a single track or a playlist and adjusts
the controls accordingly. URLs travel in `.mappadux` exports.

### Slot controls

When a slot is active (the one currently playing or selected):

- **Play / Pause / Prev / Next** — standard transport. Prev / Next
  only show for playlists. The pause icon also flips when you
  pause via an external transport (Bluetooth remote, OS media
  keys, lock screen).
- **Loop** — single tracks replay when they end; playlists cycle
  back to the start.
- **Shuffle** — playlists only. Default ON for new playlists.
  Shuffled playlists also start on a random track (not always
  track 0 of the ordered list).
- **Restart / Resume** — Restart (default for single tracks)
  always starts from the slot's Start trim point. Resume (default
  for playlists + loops) picks up where you left off when you
  switch back to this slot.

### Start / End trim *(single tracks)*

Two number fields below the transport. Type a value directly, or
**click the "Start" / "End" label** while a track is playing to
grab the current playhead position. Tick marks appear on the
progress bar so the trim points are visible. The End trim is
actively enforced — playback stops (or loops back to Start when
Loop is on) when the playhead crosses End.

### Progress bar

Shows the live playhead. **Click anywhere on the bar to seek**
to that position. Useful for auditioning the track before
grabbing a Start / End trim point.

### Per-slot volume + panel mute

Each slot has its own volume slider (0–100%). The panel header
has a master mute toggle that silences soundtracks output without
stopping playback — toggling it back on resumes mid-track. The
Soundboard's separate mute affects only sound effects.

### Crossfading between slots

Selecting a different slot crossfades the active engine's volume
down while the new slot's engine fades up. The default crossfade
is 1.5s. Switching between providers (YT → Spotify or vice versa)
works the same way — Mappadux holds both engines in parallel.

### Per-slot resume

When you switch away from a slot mid-track, Mappadux captures the
position. Switching back later picks up where you left off
(provided the slot's Restart toggle is off). For shuffled
playlists the resume is **track-stable** — Mappadux replays the
exact track you were on at the saved position, then hands off to
the playlist (re-shuffled) for the rest. Resume state is
in-memory only — closing the tab resets it.

### What doesn't travel in bundles

Spotify Client ID and OAuth tokens stay on your machine. Bundle
imports show a clear Reconnect button if Spotify is enabled but
not authorised for that browser.

---

## Stagecraft — Lighting + Automation *(in-progress, v2.18)*

A thin reference + recall layer over WLED, Home Assistant, and
QLC+. Mappadux remembers which preset goes with which map and
fires it on map switch. The configuration UI is currently hidden
behind the **Settings → Danger Zone → Show in-progress features**
toggle while the hardware-test pass continues. With the toggle on:

- **WLED endpoints** — add one row per WLED-firmware device on
  your LAN. Label + URL (e.g. `192.168.1.42` or
  `wled-table.local`). Use **Test** to confirm. Mappadux only
  references presets you've already authored in WLED's own UI.
- **Home Assistant** — paste an HA URL + a long-lived access
  token (HA → Profile → Long-Lived Access Tokens).
- **QLC+** — connect to a running QLC+ instance via its
  WebSocket API.

Once at least one device or HA link is configured, a **Lighting /
Automation** panel appears in the sidebar. Per-map assignments
travel in `.mappadux` bundles; the credentials don't.

---

## StarMaps — Star System Explorer *(new in v2.18)*

A StarMap is a map with no picture: it shows your players a **live Star System Explorer view** — the full 3D star map, orrery and info panels, exactly as SSE's own player view — inside their normal Mappadux player window. You drive it from your Star System Explorer tab (focus a planet, run time, push a Player View); Mappadux just frames it. The star-map data never passes through Mappadux, so nothing about SSE's redaction changes.

**Adding one:** Add Map dialog → **+ Add a StarMap (Star System Explorer)**. Mappadux looks for a running Star System Explorer in the same browser, tells you which starmap it found, and lists that starmap's Player Views — tick the ones you want and one StarMap map is created per view (named "*starmap* — *view*"). If SSE is not open the dialog says so and offers to open it; come back and it picks up automatically.

**At the table:** activate a StarMap like any other map. Players' windows show the live view (interactive — what they may do is set by the Player View in SSE). Switch to a handout, then back — the cut is instant, because the SSE view is kept warm behind the scenes; several StarMaps on the same campaign share it. The projector shows the same full-screen view.

**Driving it:** your own GM canvas shows exactly what the players see — it is *not* the control surface. Focus a planet, run time, change the Player View from your **Star System Explorer** tab (a caption on the map reminds you, with an *Open SSE tab* button; dismiss it once you know).

**What is different for a StarMap:** filters run **inside** Star System Explorer (the Player View's own CRT/thermal look), so Mappadux's filter controls are disabled for it — no filter-on-filter. Fog, grid, markers, the viewport crop and annotations do not apply. Players keep a **Ping** button (drops a ping at screen centre; other players' pings show over the view). Sound, soundboard and Player Voice carry on as normal.

**Beta vs production:** Settings → Connections → *Star System Explorer address* sets where NEW StarMaps look (production by default; use `https://beta.starsystemx.com` to pair beta Mappadux with beta SSE). Each StarMap remembers the address it was created with; the Add/Edit dialog can change it per map.

**Wrong or missing starmap:** if SSE has a different starmap loaded, a banner names the one this map expects and the one that is loaded — load the right one in SSE, or **Re-point** the map at what is loaded. If SSE is closed, the banner offers to open it and the map goes live by itself once SSE announces the starmap. StarMap maps travel in your pack (with the SSE address, session id and starmap name), so a pack loaded next session reconnects on its own.

---

## Composite Maps *(new in v2.15)*

A composite map stitches several image maps together into one playable surface. Two flavours:

- **Modular** — tiles laid side-by-side: dungeon corridors, hex regions, overland strips. The grid pitch is taken from the master tile so squares line up.
- **Layered** — tiles stacked on top of each other: a roof over an interior, a magical illusion concealing a chamber, a covered well. The **Reveal Map Layer** brush (in the MapFX dropdown next to Make Transparent) punches holes through the top tile to expose whatever's underneath.

Open the Composite Map editor from the Add Map dialog's **+ Create a New Composite Map**, or right-click an existing composite in the library to re-open it.

Inside the editor, every selected tile shows the unified chrome (see **Editor chrome** at the end of this file): move handle top-left, rotation handle above with a stem (snaps ±2° to 90 / 45 / 30 degree angles), flip-V top-centre, flip-H right-edge mid, lock-aspect + reset stacked above the bottom-right resize handle, red trashcan bottom-left. Right-click a tile for **Bring to Front / Forward / Send Backward / Send to Back** plus **Duplicate Map** and **Delete**.

**Layered pill** lights up next to **Composite** on library rows when at least one pair of tiles overlaps — the signal that the layered-composite tools (Reveal Map Layer brush, Upper-layer transparency slider) light up on this map.

The editor has per-modal Undo / Redo (Ctrl+Z / Ctrl+Y) for the duration of the session.

---

## Text Maps (Handouts) *(new in v2.11)*

A second map type for letters, posters, journal pages, stat blocks, and in-fiction documents. Text maps are first-class — they live alongside image maps in your library, ship in bundles, and broadcast to players exactly like image maps.

**Create** — from **+ Add New Map…** → the **Text Map** option, or from the asset library.

**Edit** — click **Edit this Handout (Text Map)** in the Map panel to open the editor in a full-screen dialog. Each handout is a page sized to your chosen aspect (16:9 / A4 / 4:3 / Square / 2:3 / custom), filled with absolutely-positioned **elements**: text blocks, images, icons, or a **live YouTube video** *(v2.17)*. Elements can be moved (top-left handle), resized (bottom-right handle), rotated, and deleted (top-right badge). Type into a selected text element to edit its content; the per-element toolbar adjusts font, size, colour, and alignment.

**Video element** *(v2.17)* — paste a YouTube link via **+ YouTube** in the editor toolbar. The video plays live on the GM, players, and projector (it isn't baked into the page image). It defaults to a locked 16:9 box (toggle the lock / reset to re-snap). In play, **only the GM has controls** — your play / pause / seek / volume drive the player + projector copies, which follow within about half a second. The GM screen is muted so it doesn't echo the room. Active visual filters tint the video on the player view. **Desktop viewers only** — mobile browsers can't composite the video over the map, so it's skipped there (a documented limitation).

**Animated reveal** — text maps support an optional animation that "types" each character of every text element onto the page when triggered. Configure in the editor; trigger from Map Selection with the **▶ Start Animation** button while the handout is broadcast to players / projectors.

---

## Fog of War & MapFX

One unified system covers both "hide a region from players" (fog) and "paint an animated effect onto a region" (MapFX). Same drawing tools, same selection model — only the **Kind** picker decides what the shape does.

**Kind** *(dropdown)* — Pick what your next painted shape will be:
- **Fog of War** — opaque colourable fill. The original use case.
- **Make Transparent** — punches alpha holes in the map so the chosen **Backdrop** shows through. Lets you reveal the backdrop through any map (e.g. a magical window, a glass floor, an aurora bleed-through).
- **MapFX** — animated shaders that live on the map itself: **Fire**, **Firestorm**, **Embers**, **River**, **Ocean**, **Light**, **Mist**, **Thundercloud**, **Aurora**, **Portal**, **Starfield**, **Noise** (colourable TV static).

Polygons of every kind coexist. Click any kind in the dropdown to switch what you're painting; existing shapes of other kinds stay put. Kinds in active use are marked with a green dot prefix in the dropdown.

**Drawing Mode** *(sticky preference)* — Three ways to paint a shape:
- **Polygon** — click vertices, click near the first vertex (or double-click) to close.
- **Brush** — click and drag to paint a freeform stroke; each stroke commits one polygon. Brush stays armed after a commit — drag again to paint another without re-clicking Paint. **Size** slider underneath controls brush radius.
- **Fill** *(Magic Wand)* — click a region on the map and the flood-fill algorithm captures everything within the colour **Tolerance**. After clicking, drag the Tolerance slider to widen/narrow the catch live.

**Paint / Erase** *(action buttons)* — Picking a drawing mode auto-engages Paint. Click **Erase** instead to carve a hole out of every existing polygon (regardless of kind) that the next shape overlaps. Re-click the lit button to disengage.

**Sparkle button** (✨ next to the Kind dropdown) — Opens a popover with the active kind's tuning sliders: **Edge Fade** (soft polygon edges), kind-specific shader params (Intensity, Speed, Direction, Glow, etc.), and a colour swatch when the kind supports tinting.

**Select** — Click any existing polygon to select it. Selected polygons get a trash-can handle at the bottom-left apex (red) — drag/click to delete. **Del** / **Backspace** also work.

**Paint-another-like-this** — If a polygon is selected when you click Paint, the next shape inherits its colour + shader params. Lets you lay down a row of identical campfires or aurora patches without re-tuning each one.

**Clear all of this Kind** — Wipes every polygon of the currently active kind without touching other kinds. Confirms first with the count.

---

## Backdrops — animated letterbox / pillarbox effects

When the player's screen has a different aspect ratio from the active map's viewport, the bars around the map fill with a **backdrop**. By default that's the per-map **Background Colour**; the **Backdrop** picker (sparkle button next to the colour swatch in Map Selection) replaces the solid fill with an animated shader.

**Kinds** — Same library as MapFX: Aurora, Embers, Fire, Firestorm, Light, Mist, Noise, Ocean, Portal, Starfield, Thundercloud. (River is MapFX-only — it works better on the larger map plane.) Each kind has the same tuning sliders as its MapFX cousin.

**Use with Make Transparent** — A transparent textmap (handout with paper set to transparent) or a Make-Transparent MapFX patch on any image map both reveal the backdrop through the map. Lets you composite a starfield behind a constellation chart, a fire glow under a translucent battlemap, or an ocean swell behind a ship's deckplan.

---

## Filter

Applies a full-screen visual effect to the **player screen only** — the GM always sees the normal map. Two broad families:

- **Artistic / stylised** — Parchment Fantasy, Retro Sci-Fi Green / Amber (CRT phosphor), Ballpoint Pen, Hand Drawing, Watercolour, Oil Painting.
- **Atmospheric / lighting** — Night Vision, Thermal, Candlelight, Dawn / Dusk, Horror, Mist, Underwater, Sandstorm, weather looks, and more, for tinting a scene's mood.

Pick the type from the dropdown; the sparkle button opens its tuning sliders plus a per-map **Tint Player Markers** toggle (so tokens, and the in-map video, take on the scene's look too). Settings are saved per map. The header bypass switch turns filtering off entirely.

---

## Player View

**Orange rectangle** — Always visible on the GM's map; shows exactly what players can see right now.

**Direct manipulation** *(v2.11)* — Click the move handle (top-left corner of the rect) to select it. Selected rect gains:

- **Move handle** (top-left) — drag to reposition.
- **Resize handle** (bottom-right) — drag to resize freely.
- **Aspect-lock 16:9** (right edge) — snaps the rect to 16:9 physical proportions keeping the short edge fixed. Click again to undo.
- **Maximise / Restore** (right edge) — first click expands to full map; second click restores the pre-max view.

**Pop shortcut** — grabbing the move handle on a rect that already fills the entire map shrinks it to 50% map-dimensions centred. Gives you a sensibly-sized rect to drag/resize on the next gesture without having to fight a maximised view first.

**Broadcast toggle** — the visual-bypass switch in the **Player Views** panel header. Off swaps the player screen for a friendly "the GM is faffing" placeholder while keeping the underlying state streaming, so flipping back is instant (it covers both the player and projector views).

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

**Undo / Redo *(new in v2.15)*** — two semi-transparent buttons sit at the top-centre of the GM canvas; they fade up on hover. Keyboard: **Ctrl+Z** undo, **Ctrl+Y** or **Ctrl+Shift+Z** redo. Covers fog / MapFX polygons and marker placements. Brush strokes collapse to a single undo entry so one Ctrl+Z wipes a whole run-on stroke rather than a single mouse-move's worth. The stack clears when you switch to a different map.

---

## Scaled View

*(Reached via the **Player Views** panel → **Scaled view** section.)*

**Direct manipulation** *(v2.14.3)* — The scaled view's rect on the GM canvas has a green **move handle** at its top-left corner; drag from there to reposition. Top-left also carries the **broadcast eye** (mirrors the panel header's bypass toggle) and a **Show Grid** icon (calibrated maps only). The handle replaces the older Move Projection View button + edit-mode flow.

A second on-table mode that renders the active map at **true table scale** — for use with an under-table screen, a down-projector, or any other surface where a 1″ creature on the map needs to physically project as 1″. Miniatures occupy real-world inches.

**Projector dropdown** — single control that runs the whole flow:

- **No Projection** *(default)* — nothing is being projected. Selecting this while a projector is open closes it and any monitor windows that were attached.
- **&lt;saved calibration name&gt;** — opens a primary projector window using that calibration. The first projector to connect is the **primary**; further windows you open join as **monitors** (see below).
- **+ Calibrate New Projector…** *(bold-green dropdown sentinel)* — opens the calibration wizard in its own window. Drag that window onto your projector or under-table screen, click the bottom-right ⛶ Fullscreen, then walk through the 3 steps: pick the display type, dial in the grid (LFD diagonal/resolution **or** projector live-grid + ruler), name and save. The window closes itself; the new calibration appears in the dropdown immediately. *If your screen size or resolution isn't in the LFD lists, switch to the Projector option and use the live ruler-on-screen calibration instead.*

When no projector is active, the panel shows just the dropdown and a brief intro paragraph. Once a primary connects, the full controls appear:

**Direct manipulation** *(v2.11)* — Same chrome as the Player View rect: click the **move handle** at the top-left of the green rect to select + drag the projection. Selection adds a **maximise / restore** button on the right edge that toggles between calibrated `scaled` mode and `full` map mode. Resize / aspect-lock aren't shown — projector size is locked to your calibration so you can't accidentally rescale at the table.

**Broadcast toggle** — the visual-bypass switch in the **Player Views** panel header swaps both the player and projector to a "GM is faffing" placeholder while keeping the underlying state streaming. Replaces the older dedicated Blackout button.

**Full Map** — Show the entire map fit-to-window on the projector, ignoring calibration. Handy for showing scope before zooming into a calibrated battlemap. When the active map isn't calibrated, this is the only available projection mode — Scaled View greys out with a "Scaled View (Unavailable)" label and a warning explaining that calibration unlocks it.

**Disable Filters** — When ticked, the GM's active visual filter does **not** apply to the projector — useful for projecting a clean battlemap while players still get a Parchment / Sci-Fi Green / etc. filter on their own screens. Off by default.

**Rotation (0° / 90° / 180° / 270°)** — Rotate the rendered output to fit a portrait map onto a landscape projector (or vice versa). There's no inherent "up" on a table display, so use whichever angle lines up with how the projector is mounted.

**1″ Grid Overlay** — Toggle a calibrated 1″ / 25 mm grid over the projection in any colour you pick. The grid is anchored to your projector calibration (not the map's), so it always projects as 1″ squares regardless of how you've cropped the map. Use it for ranges, movement, area-of-effect templates.

**+ Open Projector Monitor…** — Opens an additional window that **mirrors** the primary's exact crop, fit-to-window with a TV-bezel frame and a red **PROJECTOR MONITOR N** badge in the corner. Monitors don't use their own calibration — they're "what the table sees" repeaters for an off-table viewer (e.g. a player at the far end of the room, or the GM glancing at a second screen). Closing the primary window automatically closes all attached monitors.

**Recalibrate this Map…** — Re-runs map calibration without leaving the panel. Live changes propagate immediately to the projector and any monitors.

**Calibrate this Map** *(at the asset level, in the Map Library)* — Three ways to dial in the map's pixels-per-square, pick whichever matches what you know:

- **Ruler line** — Drag the two crosshairs across a known distance on the map and tell it how many 1″ / 25 mm squares the line spans. Saves both the calculated `pixelsPerSquare` and the original endpoints so re-editing picks up where you left off.
- **Whole-map H × V** — Type how many squares the full map is, horizontally and vertically. Filling only one side auto-fills the other at 1:1 (square grid). When both H and V resolve to a common map DPI the feedback flips green and labels the match ("matches 100 (VTT) DPI").
- **DPI dropdown** *(v2.14.2)* — Pick from the common map DPIs (60, 70 VTT, 75, 100 VTT, 140 VTT, 150, 300). H and V back-fill from the map's actual pixel dimensions. The 70 / 100 / 140 entries are the standard "VTT" exports — handy when you know the source app's preset.

*(v2.14.3)* — All three are now **self-reactive**: the last control you touched is the master; the other two derive their values from it. Drag the ruler line and H, V, and the DPI dropdown back-fill. Type H or V and the line auto-positions horizontally across the map's middle, length = N × pixels-per-square. Pick a DPI and all three update together. The `This line is N squares` input stays at whatever you type — it scales what the line represents, independent of the master/follower loop.

> Tip: the projector window's setup label and fullscreen icon fade out after 10 s of mouse inactivity so they don't intrude during play. Move the mouse to bring them back.

---

## Measure distance *(new in v2.17)*

Right-click (or long-press on touch) the map and pick **Measure from here**, then click a second point. A line is drawn between the two with the game-world distance — based on the map's grid — shown to one decimal place. The line fades after about five seconds; press **Esc** or right-click to cancel mid-measure.

Available on both the GM map and the player view. The item is greyed out until the map is **calibrated** (has a grid scale) — there's no meaningful distance without one.

Set the scale in **Settings → Scaled View → Measurement scale**: a number plus a unit tag, e.g. `5` + `'` (the D&D default of 5 feet per square) or `3` + `m`. The number is multiplied by the square count; the tag is appended to the result. Your scale is shared with connected player views, so everyone measures in the same units — and it travels inside `.mappadux` pack exports (alongside the initiative direction and player-permission rules), so a shared pack plays on the creator's system constants.

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

**Show Name on player map** — When on, the marker's label is visible on the player screen. Off by default.

**Show Name on GM map** *(v2.14.2)* — When on, the marker's label is visible on the GM map regardless of whether the marker is hidden from players. Lets you track where each NPC / trap / clue sits even when invisible to the table. Defaults ON; fades to dim chrome when the marker is locked so background-prop labels stay quiet.

Locked markers also auto-declutter their status badge row from v2.14.2: only the indicators that are currently **on** appear (a locked-and-hidden marker drops the eye, a locked-and-muted source drops the speaker). Live markers always show the full row so you can flip any of them at a click.

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
