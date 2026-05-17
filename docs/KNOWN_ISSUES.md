# Known issues

Living list of things Mappadux currently doesn't do well, with the
working-around-it answer where one exists. Each entry has a short
**Symptom** / **Cause** / **Workaround** trio so you can skim. New
entries land at the top.

---

## Animated maps stall on same-machine player popups

**Symptom.** You open the player view as a popup on the GM's own
machine (the "Open Player Window" button). When an animated map
(`.webm` / `.mp4`) loads, the popup either never animates or starts
and then freezes within a few seconds.

**Cause.** Chrome (and Chromium-based browsers) aggressively
throttle the video decoder for background / non-focused windows in
the same browser process. Two windows on the same machine are
fighting for the same per-process decode budget; the secondary
window loses every time. Phones, tablets, and PCs running the
player view in a separate browser don't have this problem because
they're in their own process.

**Workaround.** Settings → Performance → **Send only the first
frame to local player windows**. With this on, the GM withholds
the full video from same-browser peers (player popups, same-machine
projector window) — they show a static first frame instead, and
never start a video decoder. Remote players (phones / separate
devices on the LAN) still receive the animation. Default off —
flip it on if you hit the stall on a high-resolution source.

**When to leave off (default).** Lower-resolution animated maps
that play fine in popups; sessions where no local player windows
are open; capable hardware where the secondary-window throttle
doesn't kick in.

**Alternative.** Use a remote device (phone on the LAN, separate
laptop) as the player view — different process, no throttle, full
animation. The GM's own canvas always animates locally regardless
of the toggle.

---

## Animated-map texture is GPU-heavy at very high source resolutions

**Symptom.** A 4K-or-larger animated map runs OK fullscreen on the
GM canvas / remote player but stutters when the window isn't
maximised, or stutters even at fullscreen on older GPUs.

**Cause.** WebGL `texImage2D` on a `HTMLVideoElement` uploads the
full source frame to the GPU every render. At 4K + 60 Hz that's
~2 GB/s. Lower-end GPUs can't keep up.

**Workaround.** Settings → Performance → **Cap animated map
texture at 1080p**. Bounces the video through a CPU-sized
downscale canvas before upload. Looks slightly softer when zoomed
in, plays much more reliably. Off by default — capable hardware
doesn't need it.

**Both toggles combine.** A modest setup with 4K animated maps can
turn BOTH on: local windows show the static first frame
(no decoder), remote players receive the video but render it at
1080p texture (cheap GPU). Hardware does the minimum work to deliver
the experience.

**Future options if these become a blunt instrument** — Mappadux
could escalate beyond these toggles, in roughly this order of
increasing complexity:

1. **Picture-in-Picture mode.** Render the video into a PiP window
   on demand — PiP gets foreground-priority decoder budget from
   the browser. Trade-off: visible PiP UI is intrusive.
2. **WebCodecs decode loop.** Bypass `HTMLVideoElement` entirely;
   demux + decode on a worker thread, push frames as ImageBitmaps
   to the texture. Full control, no browser throttling. Heavy to
   implement but the architectural "right answer".
3. **Import-time transcode.** Re-encode 4K → 1080p in the GM's
   browser when the asset is uploaded, store the transcoded
   version alongside. Pays the cost once, every playback after is
   cheap. Adds a "preparing animated map…" step on upload.
4. **Per-asset opt-in to animate-on-remote-only.** Tag specific
   high-cost assets to never animate same-machine, regardless of
   the global toggle, so a creator's heavyweight loop doesn't ruin
   a host's table session.

Sketched in `src/rendering/Renderer.ts` as a comment block; nothing
implemented today.

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
