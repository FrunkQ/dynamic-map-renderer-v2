# StarMap map kind — detailed design (SSE2 live map source)

Status: DETAILED DESIGN, ready to build. This is the Mappadux half (Phase 3) of
the VTT integration designed in the Star System Explorer repo:
`star-system-generator/docs/dev/vtt-integration-design.md` (Part I = settled
high-level design + decision log; Part II §9.1-9.2 = the SSE2-side contract
this doc consumes). Read that doc first.

Prerequisite: SSE2 Phase 1+2 shipped (stable `broadcastId`, ANNOUNCE/HELLO/
REQUEST_REMOTE/HEARTBEAT messages, `?embed=1` + `setPreset` postMessage,
`/bridge` route). This build gates on `AnnouncePayload.appVersion`.

## 1. What it is

A fifth map-asset kind. A StarMap map has no image: activating it shows every
player a live SSE2 player view (full 3D app in an iframe) that the GM drives
from the SSE2 tab. Mappadux carries only a tiny descriptor; view data flows
over SSE2's own channel (BroadcastChannel same-browser, PeerJS remote).
Target table flow: station maps and terminal screens in Mappadux, instant cut
into the live starmap, instant cut back.

## 2. Data model

`src/types.ts`:

```ts
// MapAsset.source union gains:
source: 'upload' | 'web-link' | 'text-map' | 'composite-map' | 'starmap';

// New payload field on MapAsset (mirrors textMap?: TextMapConfig):
starMap?: StarMapConfig;

interface StarMapConfig {
  origin: string;       // SSE2 origin, default 'https://starsystemx.com'
  sessionId: string;    // SSE2 starmap.broadcastId (stable)
  starmapId: string;    // identity anchor for the reload prompt
  starmapName: string;  // for prompts/labels
  presetId: string;     // the Player View this map shows on activation
  presetName: string;   // display
}
```

- No blob, ever. `locallyStored: true` (payload-carrying, like text-maps).
- One StarMap map per chosen Player View; several maps may share one
  `origin+sessionId` (same campaign, different presets) — they share a single
  warm iframe (§6).

## 3. Wire protocol (Mappadux P2P)

New members of the `GMMessage` union (`src/types.ts`), all small single-frame
JSON (no blob path):

```ts
interface MsgStarMapShow {
  type: 'starmap_show';
  payload: { origin: string; sessionId: string; presetId: string;
             backgroundColor?: string };
}
// full_state additions:
//   starMap?: MsgStarMapShow['payload'];        // active map IS a StarMap
//   starMapPrewarm?: { origin: string; sessionId: string };  // pack contains one
```

- `starmap_show` is sent where `map_change` would have gone (GMApp activation
  path). It carries everything a viewer needs; no `map_change` is sent for a
  StarMap activation, so `MsgMapChange.mapBlob` stays required and untouched.
- Any subsequent `map_change` implicitly ends StarMap mode on viewers (hide
  layer, resume renderer).
- `starMapPrewarm` rides `full_state` whenever the pack contains at least one
  StarMap map, so viewers mount the hidden iframe at connect time (§6).

## 4. GM-side components

### 4.1 Sse2Bridge client (`src/gm/Sse2Bridge.ts`)

Manager for the hidden SSE2 `/bridge` iframe + its postMessage protocol
(`{ns:'sse2-bridge', v:1}`; see SSE2 doc §9.2).

- `ensure(origin): Promise<void>` — mount hidden iframe at `<origin>/bridge`
  (one per origin; in practice one).
- `hello(timeoutMs=3000): Promise<Announce | null>` — request/response with
  requestId correlation; null = no SSE2 instance answered.
- `ensureRemote(sessionId): Promise<void>` — must be called on StarMap
  activation so remote players can dial in (SSE2 will toast on its side).
- `onAnnounce(cb)` — unsolicited announces (SSE2 tab opened/loaded later);
  drives the "auto-resume after Open SSE2" flow.
- Strict origin checks both directions; `targetOrigin` always explicit.

### 4.2 Add flow (MapAssetModal)

- New footer button next to Create Handout / Create Composite:
  `#map-library-create-starmap-btn` → StarMap dialog.
- Dialog states:
  1. **Searching** — spinner while `hello()` runs.
  2. **Found** — "Connected: <starmapName>" + checkbox list of Player Views
     (from `AnnouncePayload.presets`). OK mints, per ticked view, a
     `MapAsset {source:'starmap', starMap:{...}}` + a `StoredMap` named
     "<starmapName> — <presetName>" (template: `_createCompositeFromTile`,
     MapAssetModal.ts ~340), then `onPick`s the first.
  3. **Not found** — "No Star System Explorer session found in this browser."
     + primary button **Open Star System Explorer** (`window.open(origin)`) +
     Retry. An unsolicited announce while the dialog is open auto-advances to
     state 2 (decision Q2: every create/edit point is connection-aware).
- Edit flow: an existing StarMap asset's edit action reopens the same dialog
  seeded with its config (re-pick preset, refresh names, change origin).
- Version gate: `appVersion` below the Phase 1 SSE2 release → state 3 variant
  "Star System Explorer needs updating to support integration".

### 4.3 Activation path (GMApp)

In the map-switch flow, branch on `asset.source === 'starmap'` BEFORE the
`getBlob` fetch/null-check (GMApp.ts ~3185):

1. `Sse2Bridge.ensure(origin)` + `hello()`:
   - announce matches `starmapId` → proceed; also `ensureRemote(sessionId)`.
   - announce mismatches → non-blocking banner "This map expects starmap
     '<name>'. Currently loaded: '<other>'. Load it in SSE2, then Retry."
     Do not broadcast yet.
   - no announce → banner "Open Star System Explorer to power this map" +
     Open button; auto-proceed when an announce with the right id arrives.
2. Broadcast `starmap_show` (+ set it as the `full_state` representation).
3. Local GM preview: `StarMapLayer` in `mode:'gm'` over the GM canvas;
   `Renderer` paused (§6). The GM's control surface remains the SSE2 tab —
   the preview is "what players see".
4. `MapAssetStore.getBlob()` gains an early `null` return for `'starmap'`
   (never called on the happy path, but belt-and-braces for thumbnail code).
5. `_dropdownKindForAsset` (GMApp.ts ~175) gains a `'starmap'` arm + glyph
   (pick at build; a star glyph, e.g. `✦`).

### 4.4 Disable gates (per decision log Q4/Q5)

When the ACTIVE map is a StarMap:

- **Filters**: `_effectiveFilter()` (GMApp.ts ~5376) returns
  `{filterId:'none', params:{}}`; filter dropdown + FX button disabled with a
  tooltip "Filters run inside Star System Explorer for StarMap maps". The
  per-map saved FilterState is left untouched (restored if the asset kind
  ever changes).
- **Viewport**: ViewportEditor + ProjectorViewportEditor entry points hidden
  (same branch pattern as the text-map/composite buttons, GMApp.ts ~3174).
  `view_update` still broadcasts `backgroundColor` (letterbox behind the
  iframe) but viewers ignore the crop for StarMap.
- **Fog / markers / annotate / measure / grid**: GM tools hidden or disabled.
- **Pings: KEPT** (screen-space, roughly aligned is accepted).
- **Player tool dropdown**: viewers receive the StarMap state and restrict
  their tool select to Ping only (options hidden, not inert).
- Chat, audio, soundboard, motion-tracker-as-audio: untouched.

## 5. Viewer-side rendering (PlayerApp + ProjectorApp)

### 5.1 StarMapLayer (`src/rendering/StarMapLayer.ts`)

Clone of `TextMapVideoLayer`'s lifecycle discipline, simplified to one
full-bleed iframe:

- DOM slot: new `#starmap-layer` div in `player.html` and `projector.html`,
  stacked ABOVE `#renderer-canvas` and BELOW `#ping-layer` (pings must draw
  over the iframe) and `#status`.
- `preload({origin, sessionId})` — mount hidden iframe at
  `<origin>/catalogue?sid=<sessionId>&embed=1` (no preset param on prewarm).
- `show({origin, sessionId, presetId})` — if the warm iframe matches
  origin+sessionId: postMessage `{ns:'sse2-embed', v:1, cmd:'setPreset',
  presetId}` into it and unhide (instant). Otherwise (re)load the full URL
  including `preset=` and unhide when ready.
- `hide()` — hide but KEEP the iframe alive and connected (warm for the cut
  back).
- `refresh()` — rebuild the iframe; carries over the cross-origin
  fullscreen-blank workaround wholesale (see PlayerApp.ts ~394 and
  TextMapVideoLayer.refresh).
- `mode:'gm' | 'viewer'` — BOTH interactive (pointer events ON; the preset's
  `interactive`/`followGM` flags govern capability inside SSE2). This differs
  deliberately from the video layer's inert viewer mode.

### 5.2 PlayerApp wiring

- `full_state.starMapPrewarm` → `layer.preload(...)` (session-start warm-up).
- `starmap_show` → run the map transition, then: hide `#renderer-canvas`,
  `renderer.setPaused(true)` (new method — suspends the RAF loop so exactly
  one WebGL app runs; resume on exit), `layer.show(payload)`, honour
  `backgroundColor` on the body behind the layer, restrict tools to Ping.
- `map_change` / `handout_reveal` etc. → `layer.hide()`,
  `renderer.setPaused(false)`, restore tool dropdown, normal path resumes.
- Hold/offline states are SSE2's own (decision Q6) — Mappadux does nothing.

### 5.3 ProjectorApp wiring

Same layer, `mode:'viewer'`, full-bleed (decision Q5): ignore calibration,
crop and rotation for StarMap; on `starmap_show` hide canvas + pause renderer
+ show layer; restore on exit. `ProjectorViewport.filterEnabled` is moot
(filter already forced `none` upstream).

## 6. Pre-warm and instant switching

- Trigger: pack contains ≥1 StarMap map → GM includes `starMapPrewarm` in
  `full_state`; viewers preload immediately after connect (after first map
  render so it never delays first paint).
- One iframe per `origin+sessionId` serves every StarMap map in the pack;
  preset changes ride `setPreset` postMessage — no reloads. Cold-boot cost
  (SvelteKit + lazy three chunk + REQUEST_STARMAP handshake, ~1-3 s) is paid
  once, hidden, at session start.
- GM preview uses the same discipline on the GM surface.
- Mappadux transitions still play over show/hide, so the station-deck to
  starmap cut can be styled.

## 7. Persistence and bundles

- Per-map `SessionState` (configs store) works unchanged; filter/fog state
  saved but ignored while the kind is starmap.
- `bundleIO.ts` export: StarMap assets follow the text-map branch
  (payload-carrying, no blob — see the `textMap` export at ~line 336); import
  restores `starMap` payload intact. `origin+sessionId+starmapId` travel in
  the pack — which is exactly the "prompt to load the right starmap next
  time" anchor (§4.3 step 1 runs on pack load too, via the `lastMapId`
  activation path).

## 8. Failure modes

| Situation | Behaviour |
|---|---|
| SSE2 tab not open on activation | GM banner + Open button; players see SSE2's waiting screen if already shown, else previous map stays until GM proceeds |
| Wrong starmap loaded | GM banner naming expected vs loaded; no broadcast until resolved |
| SSE2 GM tab closes mid-session | Viewers' iframes show SSE2's offline state (heartbeat loss); Mappadux takes no action (Q6) |
| Remote player, PeerJS broker unreachable | SSE2's own non-fatal degradation; same-room players on BroadcastChannel unaffected |
| Old SSE2 version (no ANNOUNCE) | hello() times out → treated as "not found" with an "update SSE2" hint |
| Fullscreen toggle blanks iframe | `StarMapLayer.refresh()` (ported workaround) |

## 9. Build order (each step a commit, beta channel)

1. Types + `MsgStarMapShow` + `full_state` fields; `getBlob` early-return;
   dropdown glyph. (No behaviour yet.)
2. `Sse2Bridge.ts` + Add StarMap dialog (mint assets; connection-aware
   states). Verifiable against a Phase-1 SSE2 beta.
3. `StarMapLayer` + PlayerApp wiring + `Renderer.setPaused` (+ player
   ping-only tools). Browser-verify GM+player same machine.
4. GM activation path + preview + disable gates + banners.
5. ProjectorApp wiring.
6. Pre-warm (`starMapPrewarm`) + `setPreset` instant switching.
7. Bundle export/import + pack-load reconnect flow.
8. Polish: transitions over show/hide, Help.md, CHANGELOG.
