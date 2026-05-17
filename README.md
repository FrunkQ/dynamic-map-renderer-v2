<h1 align="center">
  <img src="src/assets/Mappadux-Icon.png" alt="" height="48" align="middle" />
  &nbsp;Mappadux — VTT@Home
</h1>

> Latin _mappa_ (cloth / signal banner / map) + _dux_ (leader / guide). Map guide. Also a duck on a map.

## Try It Now

**[https://www.mappadux.com/](https://www.mappadux.com/)**

No account needed. No server. Everything stays on your device — maps you upload are stored in your browser's local storage and never sent anywhere. Just open the link and go.

## Why Mappadux

**Hi, I'm Alex.** I wanted VTT features for the table I actually game at — players around real wood, a screen showing the map. I kept cobbling together half a dozen tools, and prep was eating most of my evening before anyone arrived. I wanted *one* thing: fast to set up, easy to use without breaking the flow of play. That's Mappadux.

### Any device on your LAN is a second screen

Mappadux connects the GM and players over peer-to-peer, so **any phone, tablet, or laptop on the same network is a fully functional second screen** — no HDMI cable, no DisplayLink dongle, no installed app. Open the QR code on the device, done.

> Pack your gaming laptop and two old tablets. The laptop is your GM screen. One tablet sits flat on the table at true 1″ scale as the projector view — your battlemap / floorplan. The other tablet faces the players for handouts, room descriptions, and reveals. That's a full three-screen VTT setup in a bag.

> **Pro tip — drive more screens at once.** Need the floorplan AND a handout up at the same time, on different tablets? Open Mappadux a second time in a private / incognito window — that gives you a fresh, independent GM session with its own room code. To get your pack into both, **Save Map Pack…** from the first window, then drag the `.mappadux` file into the second one (or host it once and use `?bundle=<URL>` for instant load in both). Now you can run two GM windows side-by-side: one broadcasting the battlemap to the table tablet via its projector view, the other broadcasting a handout to a player tablet via its player view. Each room is independent, so the same pack can feed as many simultaneous views as you have devices.

### What it does

- **Sets up in minutes, not hours.** Add a map, set a scale, drop a few markers — you're ready.
- **Shows maps on any tablet / phone** for players, or **projects at true 1″ / 25 mm scale** onto an under-table screen or down-projector for in-person play.
- **Fog of war, markers, motion trackers, atmospheric audio, and visual filters** — without hunting through menus mid-scene.

It tries to feel **immersive** too: parchment / hand-drawn / CRT-phosphor filters, smooth map transitions, positional and motion-tracker audio.

And it's built to **share**. Whole packs — maps, audio, splash, theme — travel in a single `.mappadux` file (optionally encrypted), so a session you built can reach your players, your Patreon, or the wider community as easily as forwarding an email.

**Credit the creators.** Every map and sound in Mappadux carries its licence, source, and creator. The asset library has a *Copy attributions* action that produces a ready-to-paste credits block — please use it. The community that supplies free, high-quality assets only keeps going if we keep crediting it.

Players connect over peer-to-peer (PeerJS); no server infrastructure beyond static file hosting. Everything stays on your device.

![Mappadux — GM interface showing filter panel](./screenshot.png)

## Features

- **Map library** — add `.png`, `.jpg`, `.jpeg`, `.webp` images by upload, paste-by-URL, or pick from your existing library. One map image asset can back multiple named maps with their own fog / markers / audio / tracker config — handy for re-using the same battlemap across encounters. Hover for thumbnail preview, rename live, **Clone Map** for instant copies (image shared, settings duplicated independently). Missing or broken asset URLs render a placeholder so fog and marker positions stay sensible until you click **⚠ Fix Missing Map**.
- **Auto-scale on import** — Mappadux guesses each map's 1″ grid from filename hints (`[40x30]`), embedded image DPI (PNG `pHYs` / JPEG JFIF), and the greatest common factor of the image dimensions (assuming square cells). High-confidence detections apply silently and badge the map **Scaled** (yellow); best-guess matches badge **AutoScaled** (orange); ambiguous imports prompt a small radio dialog with the top candidates. Maps that have no grid (handouts, world maps, stat blocks) can be opted out with one toggle. Legacy packs get the same pass on load, so older bundles upgrade themselves automatically.
- **Fog of War** — draw arbitrary polygons to hide areas from players; click to select and delete.
- **Visual filters** — full-screen post-processing effects applied to the player view only:

  | Filter | Style |
  |---|---|
  | None | Unfiltered (with optional invert) |
  | Ballpoint Pen | Hand-sketched ink drawing |
  | Hand Drawing | Hatched cross-hatch with halftone colour |
  | Oil Painting | Painterly impasto brush strokes |
  | Parchment Fantasy | Aged sepia parchment with candlelight |
  | Retro Sci-Fi Amber | Warm amber-phosphor CRT terminal |
  | Retro Sci-Fi Green | Classic green-phosphor CRT terminal |
  | Watercolour | Soft watercolour wash |

- **Map transitions** — animated transitions when switching maps on the player view. Select per-map from the GM's Current Map panel:

  | Transition | Description |
  |---|---|
  | None | Instant cut (default) |
  | Fade | Fades to black, swaps map, fades back in |
  | CRT Collapse | Screen collapses to a phosphor dot then expands with the new map |
  | Wipe | Directional wipe (6 directions) with a bright edge glow |
  | Terminal Clear | 80×25 character-grid wipe with phosphor green flash |
  | Static Dissolve | Randomised block-by-block dissolve with static noise |

  Transitions are extensible — each lives in its own folder under `src/transitions/definitions/` with its own configurable parameters.

- **GM workspace pan/zoom** *(new in v2.11)* — the GM canvas is now a real workspace. Mouse drag to pan, scroll-wheel to zoom around the cursor, arrow keys to nudge, R to reset. Two-finger pinch + drag on touch. A small "Reset view" pill appears at the bottom-right whenever the camera is off identity. Off-screen indicator pills appear at the wrapper edge when a viewport rectangle is panned out of view — click to recentre.
- **Markers / tokens** — place and manage tokens on the map from the Markers panel:
  - **Add** — click **+ Add Marker** in the sidebar or right-click the map.
  - **Direct manipulation** — every marker carries on-canvas chrome when selected: a move handle at the top-left, a row of action badges along the top (visibility / audio role / motion role), and resize + rotate handles. Drag the move handle to reposition; click badges to toggle state.
  - **Properties** — edit name, icon, colour, and size per marker.
  - **Icon picker** — click the icon button to open a grid of 46 preset Unicode symbols (shapes, chess/card suits, circled numbers ①–⑳, check/cross marks). Upload your own custom icon (resized to 64×64 and saved to IndexedDB); custom icons are included in bundle export/import and transmitted to connected players automatically. Use **✕ Delete custom icon** to remove any uploaded icon from the picker.
  - **Clone** — **Clone Marker** duplicates the selected marker (offset slightly, label gets " - copy"), useful for quickly placing groups of identical tokens.
  - **Show Name** — per-marker toggle to display the label on the player map (off by default — players see the icon only unless enabled).
  - **Visibility** — toggle **Hide from players** to ghost the marker on the GM canvas while hiding it from players entirely.
  - **GM badges** — each marker on the GM canvas shows clickable mini-badges for visibility, audio role (source/listener), and motion role (source/tracker). Sources are blue, listener/tracker are green, muted versions are red/purple respectively.
  - **Filter passthrough** — player markers live inside the Three.js scene, so all active GLSL filters (parchment, retro sci-fi, watercolour, etc.) apply to them exactly as to the map.
  - **Persistence** — markers are saved per-map in IndexedDB and restored on reload.
  - **Multi-role markers** — the same marker can simultaneously hold an audio role *and* a motion role (e.g. a creature that emits an ambient howl AND pings the motion tracker).
  - **Marker audio (positional)** — assign an audio role to any marker:
    - **Audio Source** — plays a sound (loop, random, or one-shot) whose volume attenuates with distance to the Listener. Assign a sound from your library, set volume, max-distance radius, and playback mode. Multiple sources are supported.
    - **Listener** — represents the players' ears. Move the listener marker to change what the players hear from each source in real time.
    - All positional audio is broadcast to connected players via P2P.
  - **Motion Tracker** — periodic radar / sonar / sensor sweep. Pick one marker as **Motion Tracker** and one or more as **Motion Source**. Every few seconds the tracker fires an outgoing ping; an expanding ring sweeps from the tracker, and as it crosses each source it fires a return blob + return ping at that exact moment. Configure range (logarithmic slider, 0.05–4.0 of map height), ping rate (0.25–15 s), scan speed, colour, and per-source blob style (single / multi-few / multi-many). Works for _Aliens_-style motion sensors, submarine sonar, sci-fi sensor sweeps, magical scrying — any "I'm here" pulse mechanic. Two CC0 ping sounds are bundled by default. Works through visual filters on the player view.

- **Player view control** — an orange rectangle on the GM's canvas always shows what players see. Direct-manipulation chrome: a move handle at the top-left, resize handle at the bottom-right, plus **aspect-lock (16:9)** and **maximise / restore** buttons on the right edge when selected. Grabbing the move handle on a full-map rect snaps it to 50% map-dimensions centred so a maximised view becomes draggable in one gesture. The player's screen is strictly clipped to the rectangle; background colour fills any bars caused by aspect-ratio differences. A **broadcast toggle** in the Player Connection panel header swaps the player view for a friendly placeholder ("the GM is faffing") while you reset things mid-scene.
- **Projector view (battlemap mode)** — render a calibrated crop of the map at true table scale on an under-table screen or down-projector, so a 1″ creature on the map projects as 1″ on the surface and miniatures occupy real-world inches. Calibrate the map (1″ / 25 mm squares) and the projector device once; thereafter the Projection View panel runs the whole flow from a single dropdown — pan the rectangle to move, optional 1″ grid overlay, rotation for portrait maps, mirror to additional bezel-framed monitor windows. See [HELP.md](./HELP.md#projection-view) for the workflow.
- **Background colour** — set the letterbox colour; auto-sampled from the map on first load.
- **Real-time sync** — all GM changes (map, fog, filter, view, markers, audio, transition) push to connected players instantly.
- **Room code** — three-word memorable code persists across reloads so players can reconnect. If the connection drops, the player window auto-reconnects with exponential back-off.
- **QR code** — scan to open the player view on a phone or tablet instantly. When running locally, uses your LAN IP so other devices on the same network can connect.
- **Soundboard** — play ambient audio and sound effects to connected players from the Soundboard panel:
  - Up to 8 configurable slots per page, with unlimited pages.
  - **Assign sounds** — click any slot to open the sound picker:
    - **My Library** — browse and manage previously saved sounds. Each row shows source / store-state tag pills (`Freesound`, `URL`, `Stored`), an `[!]` chip on assets no map references, an inline editor for licence + attribution + link on user-added rows, and Store / Use / Delete buttons. Footer adds bulk **Store All Used** / **Store All** / **Delete All Unused** plus an **ℹ Attributions & Licences** button that opens a unified credits modal with one-click **Copy All** for both audio + map assets.
    - **Freesound Search** — search [freesound.org](https://freesound.org) by keyword with optional duration filter. Preview before importing. Results paginate with a **More results…** button. Requires a free Freesound API key (paste it into the search tab — it's saved to your browser). Imported sounds are URL-style by default — click **Store** in the library to make them offline-usable and bundle-portable.
    - **Web Links** — paste comma / newline / space delimited URLs to audio files. Each is validated and added to your library tagged `URL`; the file streams from the source at runtime. Click **Store** to take a copy offline.
    - **Upload** — drag and drop any local audio file, or click to browse. Uploaded sounds are stored in IndexedDB and embedded in your bundle export.
  - **Playback modes** — two toggles per slot, combinable:
    - **Loop** 🔄 — plays continuously until stopped; auto-resumes when you return to the map.
    - **Random** 🎲 — fires one-shot plays at randomised intervals. A frequency slider sets the target rate (1–100 plays per 10 minutes); the actual timing is randomised around that target so the soundscape never feels mechanical. Works like a simulated GM pressing play at the right moment. Both loop and random state persist across map switches.
  - **Volume** — per-slot volume slider.
  - **Per-map loop persistence** — looping sounds that were playing when you left a map auto-resume when you return to it.
  - **Broadcast to players** — toggle whether audio is sent to connected players (on by default). Turning it off leaves your local preview unaffected.
  - **Mute all** — silences all audio on the GM side instantly without stopping playback state.
  - **Player mute** — players can right-click the player screen at any time to toggle their own audio mute. A badge indicator (🔇 / 🔊) confirms the action.
  - **Attributions** — the ℹ Attributions button lists all CC-BY sounds currently in use, with full credit text ready to copy.
  - **Preloading** — all sounds assigned to a map are cached on the player client when the map loads, so playback starts instantly with no buffering delay.

- **Text Maps (handouts)** *(new in v2.11)* — a second map type for letters, posters, journal pages, stat blocks, in-fiction documents. Rich element editor with text + image elements, font picker, multiple aspect presets, per-element move/resize, and an optional animated reveal so the handout types itself out for the players.

- **Image Assets Library** *(new in v2.11)* — a third first-class asset library alongside Maps and Sounds. Marker icons + handout images live here with the same Library / Web Links / Upload taxonomy as audio, plus built-in connectors for **Lucide** (~1500 MIT-licensed icons) and **game-icons.net** (~4000 CC-BY 3.0 fantasy / sci-fi / abstract icons). Attribution flows through the unified credits modal.

- **Bundle import/export** — save and restore your entire pack as a single `.json` file. **Stored** assets (uploads + anything you've explicitly Stored) travel with their blobs and work offline on the recipient. **URL** assets travel as references only and re-fetch on first use, keeping bundle size small.
- **Auto-save** — all per-map settings (fog polygons, filter, view position, background colour) save automatically to browser IndexedDB.
- **PWA support** — installable as an app on desktop and mobile.
- **GPU-efficient rendering** — static filters render only on change; animated filters run at full frame rate only when needed.

## Setup & Development

Requires Node.js 18+.

```bash
# Install dependencies
npm install

# Start dev server (GM view: http://localhost:5173 — Player view: http://localhost:5173/player)
npm run dev

# Type-check
npm run typecheck

# Run unit tests
npm test

# Build for production
npm run build

# Preview production build locally
npm run preview
```

## Deployment

The app builds to a static `dist/` folder and can be deployed anywhere that serves static files.

**Vercel** (recommended — `vercel.json` is already configured):
```bash
vercel deploy
```

The `vercel.json` sets the required `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers (needed for WebRTC) and rewrites `/player` to `player.html`.

For other hosts, ensure those two COOP/COEP headers are set on all responses, and that `/player` resolves to `player.html`.

## Usage

1. **GM view** — open the root URL (e.g. `https://your-deployment.vercel.app/`).
   - Upload maps with **Upload New Map**.
   - Share the room code or QR code with players, or click **Open Player Window** for a local second screen.
   - Draw fog polygons, choose a filter, set a transition, and adjust the player view.
   - Add markers via the Markers panel or by right-clicking the map; drag to reposition.
   - Use the Soundboard panel to play ambient sound and effects to players.
   - Use **Save to File** to back up your map library (including custom icons and uploaded audio); **Load Maps File** to restore it.

2. **Player view** — open `<your URL>/player`, enter the room code, and connect.
   - The player sees whatever the GM is showing, filtered, cropped, and transitioned as the GM sets it.

3. **Projector view (battlemap mode, optional)** — for in-person play. From the **Projection View** panel: calibrate the projector once (modal opens in its own window — drag onto the projector display and ruler it in), then pick the saved calibration to launch a true-table-scale projector window. Full walkthrough in [HELP.md](./HELP.md#projection-view).

## Default Maps

To pre-load maps for first-time users, export your map library from the GM view (**Save to File**) and save the resulting file as:

```
public/default-bundle.json
```

The app imports this bundle automatically the first time a user opens it with an empty library. Existing users with saved maps are unaffected.

## Project Structure

```
src/
  gm/           GM interface (GMApp, StateManager, FogEditor, MapManager, MarkerEditor,
                              IconPicker, SoundboardPanel, FreesoundModal,
                              MapCalibrationModal, ProjectorCalibrationModal,
                              ProjectorViewportEditor)
  player/       Player interface (PlayerApp)
  projector/    Projector interface (ProjectorApp, calibrationStorage)
  audio/        Soundboard engine, asset store, and Freesound API client
                (SoundboardEngine, AudioAssetStore, FreesoundClient)
  rendering/    Three.js renderer + EffectComposer pipeline (Renderer, MarkerLayer, MarkerTexture)
  filters/      Filter registry, panel UI, and per-filter definitions
    definitions/
      none/
      ballpoint_blue/
      hand_drawing/
      oil_painting/
      parchment_fantasy/
      retro_sci_fi_amber/
      retro_sci_fi_green/
      watercolor/
  transitions/  Transition registry, engine, panel UI, and per-transition definitions
    definitions/
      none/
      fade/
      crt_collapse/
      wipe/
      scanline/
      static_dissolve/
  p2p/          PeerJS host/guest session management + local BroadcastChannel fallback
  storage/      IndexedDB wrapper (maps, configs, assets, audio), bundle import/export
  styles/       CSS
public/
  default-bundle.json   (optional — pre-loaded maps for first-time users)
index.html      GM entry point
player.html     Player entry point
projector.html  Projector entry point (calibrated table-scale battlemap view)
calibrate.html  Standalone projector-calibration window
```

## Known Limitations

- **Browser storage** — maps are stored in IndexedDB. Clearing browser data will delete them. Export a bundle regularly as a backup.
- **PeerJS relay** — connections go through the public PeerJS broker by default. On restricted networks a self-hosted PeerJS server may be needed.
- **Single GM** — the session model assumes one GM and any number of read-only players.

For more detail on caveats and workarounds, see [docs/KNOWN_ISSUES.md](./docs/KNOWN_ISSUES.md). [CHANGELOG.md](./CHANGELOG.md) has the release history.

---

## Acknowledgements

### Map Images

**Rons-Moto-1979** map used with permission.
Source: https://www.reddit.com/r/mothershiprpg/comments/18c71ep/8bit_map_nostromo_alien_inspired_map/#lightbox

**"Map-Griffinholm"** by Elven Tower Cartography, released under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

### Bundled Sounds

The two motion-tracker ping sounds bundled in `src/assets/` are edited from CC0 samples by **Balcoran** on Freesound:

| Sound | Source |
|---|---|
| `MT-ping.mp3` (outgoing) | [motion tracker blip.wav](https://freesound.org/s/478187/) |
| `MT-return.mp3` (return) | [motion tracker beep.wav](https://freesound.org/s/478186/) |

Both released under [CC0 1.0 Universal (Public Domain)](https://creativecommons.org/publicdomain/zero/1.0/).

### Visual Filters

The Ballpoint Pen, Hand Drawing, Watercolour, and Oil Painting filter effects are adapted from ShaderToy shaders by **florian berger (flockaroo)**, used under the [Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported](https://creativecommons.org/licenses/by-nc-sa/3.0/) licence.

| Filter | ShaderToy ID | URL |
|---|---|---|
| Ballpoint Pen | tsV3Rw | https://www.shadertoy.com/view/tsV3Rw |
| Hand Drawing | XtVGD1 | https://www.shadertoy.com/view/XtVGD1 |
| Watercolour | ltyGRV | https://www.shadertoy.com/view/ltyGRV |
| Oil Painting | Mlcczf | https://www.shadertoy.com/view/Mlcczf |

Modifications: translated to GLSL ES 1.00 / Three.js EffectComposer; ShaderToy uniforms replaced with Three.js equivalents; iteration counts reduced for real-time performance; artistic parameters exposed as user sliders.

### Prior Work

This project was inspired by the Tannhauser Remote Desktop created by the [Quadra](https://www.quadragames.com/) team for their *Warped Beyond Recognition* adventure — a fantastic example of using technology to enhance the tabletop experience.

### Development

This project was built with the assistance of [Claude Code](https://claude.ai/code) by Anthropic. The original v1 was built with Google Gemini 2.5 Pro. Both the code and the project are offered freely — use it for whatever you like.
