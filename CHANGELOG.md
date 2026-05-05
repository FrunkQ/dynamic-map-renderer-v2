# Changelog

## v2.2 — 2026-05-05

### New Features
- **Map transitions** — animated transitions play on the player screen when the GM switches maps. Select the transition (and configure its parameters) from the Current Map panel in the GM view. The transition holds the current view, plays the animation, and reveals the new map at the midpoint — filter, fog, and view all swap atomically so nothing flickers in early.
  - **None** — instant cut (default behaviour, unchanged).
  - **Fade** — fades the current map to black, swaps to the new map, fades back in. Duration configurable.
  - **CRT Collapse** — the screen collapses to a horizontal line, then to a phosphor dot (with green/amber glow), then expands back out with the new map. Colour and timing configurable.
  - Architecture mirrors the filters system: each transition lives in `src/transitions/definitions/<id>/index.ts` with its own param schema. Adding a new transition is a single new file — no registry edits needed.

### Fixes & Improvements
- **Mobile viewport fix** — switched `Renderer` from `window.addEventListener('resize')` to `ResizeObserver`. On Android/Pixel the window resize event never fired on initial layout, causing the player to show the full map instead of the GM-defined viewport rectangle.
- **LAN IP in QR code and player links** — when running the dev server locally, the QR code, "Open Player Window" button, and "Copy Player URL" now use the machine's LAN IP address instead of `localhost`. This allows phones and tablets on the same network to connect during local testing without any extra configuration. (Production builds are unaffected.)
- **Atomic map change** — filter, view, and fog state now travel inside the `map_change` message rather than as separate follow-up messages. Eliminates a race where the new filter or view could briefly flash on the old map before the transition ran.

---

## v2.1 — 2026-04-18

### New Features
- **Interactive viewport editor** — the pan/zoom sliders are replaced by a direct on-map editor. A faint orange marching-ants rectangle is permanently overlaid on the GM's map showing exactly what players currently see. Click **Edit Player View** to activate drag handles: move the rectangle by dragging inside it, or resize it freely by dragging any corner. Hit **OK** to commit or **Cancel** to revert.
- **Reset to Full Map** — one-click button to snap the player view back to showing the complete map.
- **Strict viewport clipping** — the player's screen is hard-clipped to the GM's rectangle. No map content outside that rectangle is ever visible regardless of the player's screen size or aspect ratio. Background colour fills any letterbox or pillarbox bars.

---

## v2.0 — 2026-04-01

Initial public release of the v2 rewrite.

- Peer-to-peer via WebRTC (PeerJS) — no server required beyond static hosting.
- Eight visual filters including four artistically-styled effects (Ballpoint Pen, Hand Drawing, Watercolour, Oil Painting).
- Bundle import/export — save and restore the full map library as a single `.json` file.
- Default map bundle support (`public/default-bundle.json`).
- QR code for instant player connection on mobile.
- Auto-save of all per-map settings to IndexedDB.
- PWA support — installable on desktop and mobile.
- GPU-efficient rendering — static filters render on change only; animated filters run at full frame rate only when active.
