# Known issues

Living list of things Mappadux currently doesn't do well, with the
working-around-it answer where one exists. Each entry has a short
**Symptom** / **Cause** / **Workaround** trio so you can skim. New
entries land at the top.

---

## Animated maps stall on same-machine player popups

**Symptom.** You open the player view as a popup on the GM's own
machine (the "Open Player Window" button). When an animated map
(`.webm` / `.mp4`) loads, the popup shows the first frame and never
animates — even after sitting there for a while.

**Cause.** Chrome (and Chromium-based browsers) aggressively
throttle the video decoder for background / non-focused windows in
the same browser process. Two windows on the same machine are
fighting for the same per-process decode budget; the secondary
window loses every time. Phones, tablets, and PCs running player
view in a separate browser don't have this problem because they're
in their own process.

**Workaround.** Intentional. As of v2.12.19 the GM never sends the
full video bytes to same-browser peers — they only receive the
first-frame snapshot via the regular `map_change` channel. Use a
remote device (phone on the LAN, separate laptop) as the player
view if you want to see the animation there. The GM's own canvas
plays the animation locally; same-machine projector windows behave
the same as player popups (static first frame only).

---

## Animated-map texture is GPU-heavy at very high source resolutions

**Symptom.** A 4K-or-larger animated map runs OK fullscreen but
stutters / freezes when the window isn't maximised, even on remote
players.

**Cause.** WebGL `texImage2D` on a `HTMLVideoElement` uploads the
full source frame to the GPU every render. At 4K + 60 Hz that's
~2 GB/s. Lower-end GPUs can't keep up.

**Workaround.** Settings → Performance → **Cap animated maps at
1080p**. Bounces the video through a CPU-sized downscale canvas
before upload. Looks slightly softer, plays much more reliably.
Off by default — capable hardware doesn't need it.

---

## Animated map "first frame" can drift on lengthy MP4s

**Symptom.** The static snapshot shown to same-machine peers (and
to remote peers during the brief gap before the video bundle
arrives) is sometimes a few frames into the video rather than
exactly frame 0.

**Cause.** `extractFirstFrameSnapshot` waits for `loadeddata` or
`canplay` to fire before drawing the current frame to a canvas.
Some browser / codec combinations have already advanced
`currentTime` past 0 by then.

**Workaround.** Author videos so the first frame is the
representative still you want. If the snapshot matters specifically
(e.g. for a reveal still), pause your source video at frame 0
before encoding.

---

## PeerJS broker outages block new remote joiners

**Symptom.** Remote players can't connect; the QR area shows
"Network broker unreachable".

**Cause.** Mappadux uses the public PeerJS signalling server for
peer discovery. It's a free public service and occasionally
unavailable.

**Workaround.** Same-browser windows (player popup, same-machine
projector) keep working via BroadcastChannel during a broker
outage — the broker is only needed for cross-device peers.
Mappadux auto-retries every minute and the QR re-appears as soon
as the broker recovers. Self-hosting a PeerJS broker is on the
v2.13+ wish list.

---

## iOS Safari ignores `<option>` styling in `<select>` dropdowns

**Symptom.** Map selector glyphs (`▣` for image maps, `▶` for
animated, `▤` for text-map handouts) all render correctly on iOS
— but any styling we set on options (colour, italic) is dropped.

**Cause.** iOS Safari deliberately strips inline styles from
native `<option>` elements for a uniform native picker look. WebKit
on iPad does the same.

**Workaround.** None needed — the glyphs themselves carry the
visual information, and they ARE rendered because they're part of
the option text. Affected platforms still get the same functional
distinction.

---

## Magic Wand caps at 500 vertices on extremely jagged silhouettes

**Symptom.** A magic-wand fill on a very intricate outline looks
slightly smoother than the raw pixel boundary.

**Cause.** The Douglas-Peucker simplification step caps polygon
vertex count to keep boolean erase operations fast. The adaptive
ladder (40 → 80 → 200 → 500) picks the lowest cap that captures
the shape within ~1% of IoU; very fiddly silhouettes hit the 500
ceiling.

**Workaround.** Acceptable for any practical map use; the
mask-texture rasterisation at edge fade > 0 smooths the remaining
pixel difference anyway. The cap is in `src/mapfx/floodFill.ts`
(`_CAP_LADDER`) if you really need to raise it.

---

## Map dropdown italic styling not visible on iOS Safari

Same root cause as the option-styling note above — replaced by the
glyph approach in v2.12.x so this is now informational only. Listed
for completeness in case anyone reads the codebase and wonders why
the italic CSS path was removed.

---

## Animated backdrops only render on the GM canvas

**Symptom.** You pick a Starfield backdrop from Settings → Theme
→ Backdrop. It appears in the GM letterbox bars. Player and
projector views show the plain background colour in their bars.

**Cause.** Backdrop state lives in `ThemeConfig` which doesn't
travel over P2P yet. The Renderer-level support is fully there;
only the broadcast wiring is missing.

**Workaround.** None — feature gap on the player / projector side.
Queued for v2.13.
