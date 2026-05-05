# Dynamic Map Renderer v2

## Description

Dynamic Map Renderer v2 is a browser-based tool for tabletop roleplaying game GMs. It lets you display map images to players in real time, with full control over fog of war, visual filters, pan, and zoom — all from a separate GM interface. Players connect via a peer-to-peer link; no server infrastructure is required beyond static file hosting.

This version is a complete rewrite of the original Python/Flask application. It is a pure browser app built with TypeScript, Three.js, and Vite, and is deployable to any static host (Vercel, Netlify, GitHub Pages, etc.).

## What's New in v2

- **No server required** — peer-to-peer via WebRTC (PeerJS). Deploy to any static host.
- **Eight visual filters** — including four new artistically-styled effects (Ballpoint Pen, Hand Drawing, Watercolour, Oil Painting) alongside the updated CRT filters.
- **Bundle import/export** — save and restore your entire map library (images + fog + filter settings) as a single `.json` file.
- **Default map bundle** — place a `public/default-bundle.json` file to pre-load maps for first-time users.
- **QR code** — scan to open the player view on a phone or tablet instantly.
- **Auto-save** — all per-map settings (fog polygons, filter, view position, background colour) save automatically to browser IndexedDB.
- **PWA support** — installable as an app on desktop and mobile.
- **GPU-efficient rendering** — static filters render only on change; animated filters run at full frame rate only when needed.

## Features

- **Map library** — upload `.png`, `.jpg`, `.jpeg`, `.webp` map images; store and switch between them.
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

- **Player view control** — pan (Centre X/Y) and zoom independently of the GM's own view.
- **Background colour** — set the letterbox colour; auto-sampled from the map on first load.
- **Real-time sync** — all GM changes (map, fog, filter, view) push to connected players instantly.
- **Room code** — three-word memorable code persists across reloads so players can reconnect.

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
   - Draw fog polygons, choose a filter, adjust the player view.
   - Use **Save to File** to back up your map library; **Load Maps File** to restore it.

2. **Player view** — open `<your URL>/player`, enter the room code, and connect.
   - The player sees whatever the GM is showing, filtered and cropped as the GM sets it.

## Default Maps

To pre-load maps for first-time users, export your map library from the GM view (**Save to File**) and save the resulting file as:

```
public/default-bundle.json
```

The app imports this bundle automatically the first time a user opens it with an empty library. Existing users with saved maps are unaffected.

## Project Structure

```
src/
  gm/           GM interface (GMApp, StateManager, FogEditor, MapManager)
  player/       Player interface (PlayerApp)
  rendering/    Three.js renderer + EffectComposer pipeline (Renderer, ShaderMaterial)
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
  p2p/          PeerJS host/guest session management + local BroadcastChannel fallback
  storage/      IndexedDB wrapper, map manager, bundle import/export
  styles/       CSS
public/
  default-bundle.json   (optional — pre-loaded maps for first-time users)
index.html      GM entry point
player.html     Player entry point
```

## Known Limitations

- **Browser storage** — maps are stored in IndexedDB. Clearing browser data will delete them. Export a bundle regularly as a backup.
- **PeerJS relay** — connections go through the public PeerJS broker by default. On restricted networks a self-hosted PeerJS server may be needed.
- **Single GM** — the session model assumes one GM and any number of read-only players.

## Future Plans

1. **Map transitions** — fade and wipe animations when switching maps on the player view.
2. **Markers / tokens** — place and manage visual tokens on the map.
3. **Audio** — ambient sound tied to maps or locations (e.g. Aliens-style motion tracker).
4. **Lighting** — dynamic light radius effects around tokens.

---

## Acknowledgements

### Map Images

**Rons-Moto-1979** map used with permission.
Source: https://www.reddit.com/r/mothershiprpg/comments/18c71ep/8bit_map_nostromo_alien_inspired_map/#lightbox

**"Map-Griffinholm"** by Elven Tower Cartography, released under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

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
