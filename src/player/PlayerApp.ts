import { Guest } from '../p2p/Guest.ts';
import { generateId } from '../utils/id.ts';
import { MessageLog } from '../ui/MessageLog.ts';
import { perceptualVolume } from '../audio/volumeCurve.ts';
import { MeasureTool, squaresBetweenNorm } from '../rendering/MeasureTool.ts';
import { PlayerIdentifyModal, type PlayerIdentity } from './PlayerIdentifyModal.ts';
import { PlayerActionMenu, type ActionMenuItem } from './PlayerActionMenu.ts';
import { PlayerMessageComposer } from './PlayerMessageComposer.ts';
import { PlayerMessageToasts } from './PlayerMessageToasts.ts';
import { PingLayer } from '../rendering/PingLayer.ts';
import { PlayerMarkerLayer } from '../rendering/PlayerMarkerLayer.ts';
import { PlayerInitiativeRail } from './PlayerInitiativeRail.ts';
import { ClocksLayer } from '../annotate/ClocksLayer.ts';
import { TimersLayer } from '../annotate/TimersLayer.ts';
import { NotesLayer } from '../annotate/NotesLayer.ts';
import { WhiteboardLayer } from '../annotate/WhiteboardLayer.ts';
import { TextMapVideoLayer } from '../rendering/TextMapVideoLayer.ts';
import { StarMapLayer } from '../rendering/StarMapLayer.ts';
import { parseIceParam } from '../p2p/iceConfig.ts';
import { TextMapAltText } from '../rendering/TextMapAltText.ts';
import { PlayerInitiativeRollModal } from './PlayerInitiativeRollModal.ts';
import { showFullPlayerUiInPreview, getMeasureUnitValue, getMeasureUnitSuffix,
  getDiceDetailPreference, setDiceDetailPreference,
  getDiceRenderPreference, setDiceRenderPreference } from '../storage/localSettings.ts';
import { DiceLayer } from '../rendering/DiceLayer.ts';
import { PlayerDiceTray } from './PlayerDiceTray.ts';
import { rollFormula, type RollOutcome } from '../dice/roll.ts';
import { isPhysicalDiceSupported } from '../dice/physicalRoll.ts';
import { reduceDetail, type DiceDetail } from '../dice/dicePolicy.ts';
import { Viewer } from '../viewers/Viewer.ts';
import { PROFILE_PLAYER } from '../viewers/profiles.ts';
import { drawGrid } from '../viewers/strategies/drawGrid.ts';
import { attachGestures } from '../utils/Gestures.ts';
import { decodeImageBitmap } from '../utils/decodeImageBitmap.ts';
import { Renderer } from '../rendering/Renderer.ts';
import { MarkerTexture } from '../rendering/MarkerTexture.ts';
import { MarkerSprites } from '../rendering/MarkerSprites.ts';
import { MarkerOverlay, type OverlayItem } from '../rendering/MarkerOverlay.ts';
import { getMarkerAspect, getMarkerBitmap } from '../rendering/MarkerLayer.ts';
import { isGlyphIcon, glyphToDataUrl } from '../rendering/glyphIcon.ts';
import { filterRegistry } from '../filters/FilterRegistry.ts';
import { cssApproxForFilter } from '../filters/cssApproximations.ts';
import { TransitionEngine } from '../transitions/TransitionEngine.ts';
import { transitionRegistry } from '../transitions/TransitionRegistry.ts';
import type { GMMessage, TransitionConfig, Marker, MarkerIconData, SoundboardAudioData, SoundboardSlot, FogState, FilterState, ViewState, CompositeWirePayload } from '../types.ts';
import type { MotionOverlay, MotionOverlayScan, MotionOverlayBlob } from '../rendering/MarkerLayer.ts';

/**
 * PlayerApp — top-level orchestrator for the player view.
 *
 * Reads the room code from the URL fragment (#roomcode).
 * If the fragment is absent or empty, waits for a room code input.
 * Connects via P2P Guest (BroadcastChannel for local window, PeerJS for network).
 * Applies all incoming state updates to the Renderer.
 *
 * Markers are rendered as a CanvasTexture inside the Three.js scene (Plane 2)
 * so they pass through the active GLSL filter pipeline.
 */
export class PlayerApp {
  private renderer!: Renderer;
  private markerTexture!: MarkerTexture;
  private markerSprites!: MarkerSprites;
  private markerOverlay!: MarkerOverlay;
  private transitionEngine!: TransitionEngine;
  private guest!: Guest;
  private statusEl!: HTMLElement;
  private messageLog?: MessageLog;
  private connectPanel!: HTMLElement;
  private roomInput!: HTMLInputElement;
  /** Tracks which map ID the player is currently showing (or loading). */
  private currentMapId: string | null = null;
  private currentMarkers: Marker[]    = [];
  private playerIconCache = new Map<string, ImageBitmap>();
  /** slotId → <audio> element for active soundboard slots (one-shots) */
  private sbAudioEls  = new Map<string, HTMLAudioElement>();
  /** assetId → data URL so re-plays don't need the URL resent */
  private sbAssetUrls = new Map<string, string>();
  /** v2.16.50 — gapless looping for looping soundboard slots. Lazy-
   *  loaded so a player who never hears a loop pays zero AudioContext
   *  cost. Loop slots tracked in `_sbLoopSlots` so stop / volume /
   *  mute route to the right engine. */
  private _sbLoopPlayer: import('../audio/WebAudioLoopPlayer.ts').WebAudioLoopPlayer | null = null;
  private _sbLoopSlots = new Set<string>();
  /** Current slot configurations (for restoring on reconnect) */
  private sbSlots: SoundboardSlot[] = [];
  /** Master mute flag. Defaults to muted; pop-out windows from the GM's
   *  PiP (gmPreview=1 && !pip=1) start UNMUTED in init() because the
   *  user just clicked pop-out — the resulting popup inherits that
   *  gesture and can autoplay (v2.16.43). */
  private sbMuted = true;
  /** slotIds paused by a mute transition — used to resume them on unmute. */
  private _sbPausedByMute = new Set<string>();
  /** markerIds paused by a positional mute-all — resumed on unmute. */
  private _posPausedByMute = new Set<string>();
  /** Live state of the Markers-panel master mute (broadcast by the GM).
   *  Silences both positional sources and the tracker ping. */
  private _posMutedAll = false;
  private _audioResumeScheduled = false;
  /** markerId → <audio> element for active positional sources */
  private _posAudioEls  = new Map<string, HTMLAudioElement>();
  /** assetId → URL so re-plays (late join / random fires) don't need the data resent */
  private _posAssetUrls = new Map<string, string>();
  /** v2.15 — shared viewer chrome (lifecycle close, fullscreen button,
   *  faff hold-screen with QR, mute indicator). The PlayerApp keeps
   *  rendering / P2P / message dispatch for now; later phases will
   *  fold more of the surface into Viewer too. */
  private viewer!: Viewer;
  /** v2.14.17 — map calibration + dimensions threaded through from the
   *  GM via full_state / map_change. Needed by the map-relative grid
   *  drawing strategy when the GM has Show Grid turned on for the
   *  Player View. */
  private mapPixelsPerSquare: number | null = null;
  private mapImageWidth:      number        = 0;
  private mapImageHeight:     number        = 0;
  /** v2.14.18 — grid offset for the active map (border-nudge alignment). */
  private gridOffsetX:        number        = 0;
  private gridOffsetY:        number        = 0;
  /** v2.14.31 — shared per-map grid colour (replaces the prior
   *  view-scoped ViewState.playerGridColor). Updated from full_state
   *  / map_change / map_meta_update broadcasts. */
  private gridColor:          string | null = null;
  /** v2.14.17 — Player-side grid overlay canvas. Drawn into whenever
   *  the GM's view broadcast carries playerGridEnabled=true and the
   *  active map is calibrated. */
  private playerGridCanvas: HTMLCanvasElement | null = null;
  /** v2.14.18 — Player-side zoom + pan within the GM-defined crop.
   *  `_broadcastView` is the GM's most recent view (the outer bounds);
   *  `_localOverride` is the player's chosen sub-rect (or null if
   *  they're matching the GM exactly). The rendered view is the
   *  override clamped to fit inside the broadcast. */
  private _broadcastView: ViewState | null = null;
  private _localOverride: { centerX: number; centerY: number; viewNW: number; viewNH: number } | null = null;
  /** Snapshot of the override at gesture start — gesture deltas are
   *  cumulative, so we re-derive the override from the snapshot each
   *  pointermove rather than integrating per-frame deltas.
   *
   *  `override` is in bv-aspect normalised coords (what we store /
   *  broadcast); `effective` is the canvas-aspect-extended viewport the
   *  user actually sees on canvas (used for cursor / centroid /
   *  drag-delta anchoring so the world point under the finger stays
   *  glued through the gesture). The two differ when the player's
   *  canvas aspect doesn't match the GM-defined viewport's aspect. */
  private _gestureSnap: {
    override:  { centerX: number; centerY: number; viewNW: number; viewNH: number };
    effective: { centerX: number; centerY: number; viewNW: number; viewNH: number };
    midX: number;
    midY: number;
  } | null = null;
  private _resetViewBtn: HTMLButtonElement | null = null;
  /** Minimum override width/height in map-norm units (caps zoom-in). */
  private static readonly MIN_OVERRIDE_VIEW = 0.05;
  // ── Motion-tracker overlay (rings + return blobs broadcast by the GM) ──────
  private _trackerScans: MotionOverlayScan[] = [];
  private _trackerBlobs: MotionOverlayBlob[] = [];
  private _trackerRafId: number | null       = null;
  /** Cached tracker ping audio data URLs, keyed by assetId. Populated by the
   *  first tracker_scan/tracker_blob carrying that asset's dataUrl. */
  private _trackerAudioUrls = new Map<string, string>();
  // ── WebGL context-loss recovery ──────────────────────────────────────────
  /** Room code retained so we can reconnect if cached state is unavailable. */
  private roomCode = '';
  /** Cached renderer inputs — replayed on WebGL context restore. */
  private lastMapBlob:  ArrayBuffer | null = null;
  private lastFog:      FogState           = { polygons: [] };
  private lastFilter:   FilterState | null = null;
  private lastView:     ViewState  | null  = null;
  /** v2.14 — promise that resolves when the in-flight map_change /
   *  handout_reveal / video_bundle texture load finishes. Each
   *  message that loads a new map texture awaits this before
   *  starting its own load, so handout_reveal can't race against a
   *  same-map reload's still-decoding starting-frame texture.
   *  Caught while debugging the "reveal snaps to end" report. */
  private _pendingMapLoad: Promise<void> = Promise.resolve();
  private _contextLost = false;
  /**
   * Sequence numbers of messages already processed.
   * Local player windows receive every broadcast TWICE — once via BroadcastChannel
   * (fast, sub-ms) and once via PeerJS (slower, ~50-200ms).  Without dedup, the
   * second delivery re-runs loadMap with a new loadGen, which then discards the
   * first (BC) texture decode and waits for a second, slower decode.  More
   * critically, re-processing map_change resets currentMapId mid-flight, which
   * can make valid fog_update messages appear to belong to a different map and
   * get discarded.  Tracking seqs lets us drop the PeerJS duplicate entirely.
   */
  private seenSeqs = new Set<number>();

  /**
   * Stable id for this player tab so the GM's heartbeat tracker can
   * deduplicate pings from this client (vs. counting each ping as a
   * distinct player). Regenerated per page load — a reload looks like a
   * fresh player and the prior id naturally expires from the GM's map.
   */
  private clientId = generateId();
  /** v2.16.44 — cross-window audio mutual exclusion. When this window
   *  is unmuted, claim audio so other local Mappadux tabs / windows
   *  hear our claim and silence themselves. When forced to mute by
   *  another window's claim, drops local audio. */
  private _audioCoord: import('../utils/AudioCoordinator.ts').AudioCoordinator | null = null;
  /** Interval id for the BC liveness ping. Cleared on disconnect. */
  private _heartbeatInterval: number | null = null;

  // ── v2.17 Player Voice — identity ──────────────────────────────────────────
  /** Stable device-persisted player id; survives reloads so the GM keeps the
   *  same persistent player record bound to this device across reconnects. */
  private playerId: string = this._loadPlayerId();
  /** Chosen identity (name/character/colour), persisted on this device. */
  private identity: PlayerIdentity | null = this._loadIdentity();
  /** True once we've shown the first-connect identify prompt (so a cancel
   *  doesn't re-pop it on every reconnect). */
  private _identityPromptShown = false;
  private _identityModal = new PlayerIdentifyModal();
  private _actionMenu = new PlayerActionMenu();
  /** True iff this page was launched from the GM's "Open Player Window" button.
   *  Detected via the ?gmPreview=1 URL flag — explicit, foolproof, and never
   *  triggered by real player tabs (the QR URL doesn't carry it). */
  private _gmPreviewFlag = (() => {
    try { return new URLSearchParams(location.search).has('gmPreview'); }
    catch { return false; }
  })();
  /** v2.16.42 — true iff this page is the inline PiP iframe spawned by
   *  the GM's PlayerPip overlay. Detected via `?pip=1`. Used to:
   *    - skip the mute indicator entirely (it's a silent preview)
   *    - force-mute audio playback (PiP never makes sound)
   *  Pop-out windows that come from the PiP's pop-out button DON'T
   *  carry the flag, so they get sound + the small mute toggle. */
  private _isPip = (() => {
    try { return new URLSearchParams(location.search).get('pip') === '1'; }
    catch { return false; }
  })();
  private _composer = new PlayerMessageComposer();
  private _msgToasts: PlayerMessageToasts | null = null;
  private pingLayer: PingLayer | null = null;
  /** Transient on-map ruler ("Measure from here"). */
  private _measureTool: MeasureTool | null = null;
  private playerMarkerLayer: PlayerMarkerLayer | null = null;
  /** Per-player icon data URLs received via player_icon_update (chunked over
   *  the wire so multi-KB images don't blow past the DataChannel limit).
   *  Merged into the marker view before handing to PlayerMarkerLayer. */
  private _playerIcons = new Map<string, string>();
  /** Last received player_markers payload — re-merged on any icon update so
   *  an icon arriving after the markers triggers an immediate re-render. */
  private _lastPlayerMarkers: Array<{ playerId: string; name: string; color: string; x: number; y: number; iconChar?: string; hasIcon?: boolean }> = [];
  /** Icons currently being requested via `player_icon_request` — debounce so
   *  a single missing-icon doesn't spawn a request per render frame. Entries
   *  clear on a successful player_icon_update or after 5 s. */
  private _pendingIconRequests = new Map<string, ReturnType<typeof setTimeout>>();
  private initiativeRail: PlayerInitiativeRail | null = null;
  /** v2.16.76 — read-only progress clocks mirrored from the GM. */
  private _annotateClocks: ClocksLayer | null = null;
  /** v2.16.77 — read-only whiteboard mirrored from the GM. */
  private _annotateBoard: WhiteboardLayer | null = null;
  /** v2.16.78 — read-only timers / countdowns mirrored from the GM. */
  private _annotateTimers: TimersLayer | null = null;
  /** v2.16.80 — read-only player notes mirrored from the GM. */
  private _annotateNotes: NotesLayer | null = null;
  /** v2.16.91 — live YouTube videos on a text-map page. */
  private _textMapVideos: TextMapVideoLayer | null = null;
  /** v2.18 — StarMap: full-bleed Star System Explorer view (docs/starmap-map-kind-design.md). */
  private _starMap: StarMapLayer | null = null;
  private _starMapActive = false;
  /** v2.17.27 — screen-reader region for the active text-map (text + image alt
   *  sent by the GM). No visual presence; runs on mobile too (unlike video). */
  private _textMapAlt: TextMapAltText | null = null;
  /** v2.17.34 — last marker name/icon/colour signature, so the initiative rail
   *  only re-renders on a linked marker's identity change, not position drags. */
  private _markerIdentitySig = '';
  private _initiativeRollModal = new PlayerInitiativeRollModal();
  /** Roster broadcast by the GM — used to list other players as message targets. */
  private roster: Array<{ id: string; playerName: string; characterName: string; color: string; connected: boolean }> = [];
  /** Player-Voice features the GM currently allows. Default-on until the GM
   *  says otherwise (mirrors the default-enabled settings). */
  private features = { pings: true, messaging: true, movableMarkers: true, dice: true };
  /** v2.19 Dice. The tray is the GM's set; the layer is where a roll is shown.
   *  `diceRollerDetail` is standing policy from the GM, because a roller draws
   *  their own roll immediately rather than waiting for the relay. */
  private _diceTray: PlayerDiceTray | null = null;
  private _diceLayer: DiceLayer | null = null;
  private _diceRollerDetail: DiceDetail = 'full';
  private _diceCelebrate: import('../dice/roll.ts').CelebrateDirection = 'high';
  /** v2.17.10 — measurement scale received from the GM (player_features), so
   *  the ruler reads in the GM's units. Null until received → falls back to
   *  this browser's local setting (same-browser views) or the 5' default. */
  private _measureUnitValue:  number | null = null;
  private _measureUnitSuffix: string | null = null;
  /** Long-press detection state for touch ping/menu. */
  private _pressTimer: number | null = null;
  private _pressStart: { x: number; y: number } | null = null;

  async init(): Promise<void> {
    // v2.16.43 — pop-out windows from the GM's PiP start UNMUTED. The
    // user just clicked the pop-out button, so the new popup inherits
    // a fresh user gesture and can autoplay. PiP iframes themselves
    // (pip=1) stay muted; identified-by-QR remote players also stay
    // muted (no gmPreview flag), small icon top-right is their toggle.
    if (this._gmPreviewFlag && !this._isPip) this.sbMuted = false;

    // v2.16.43 — PiP iframes have no use for the floating fullscreen
    // button (the iframe is bounded by its host frame).
    if (this._isPip) {
      const fs = document.getElementById('player-fullscreen-btn');
      if (fs) fs.hidden = true;
    }

    // v2.15 — Viewer owns the chrome (lifecycle, fullscreen, faff
    // overlay, mute indicator) AND the rendering pipeline (Renderer,
    // marker layer, transition engine). PlayerApp drives the P2P side
    // and the post-map-load callback chain; the rest comes out of
    // Viewer via readonly fields. Profile-driven so future viewer
    // kinds slot in without forking these init paths.
    this.viewer = new Viewer(PROFILE_PLAYER, {
      fullscreenBtn:        this._isPip ? null : document.getElementById('player-fullscreen-btn'),
      rendererCanvas:       document.querySelector<HTMLCanvasElement>('#renderer-canvas')!,
      markerOverlayEl:      document.getElementById('marker-overlay'),
      transitionCanvas:     document.querySelector<HTMLCanvasElement>('#transition-canvas'),
      preserveDrawingBuffer: true,
      // Icon-only mute button is the single audio toggle source.
      onMuteToggle: () => this._toggleMute(),
    });
    this.viewer.init();

    // Alias the pipeline pieces locally so the existing `this.renderer`
    // / `this.markerTexture` / etc. call sites elsewhere in this file
    // don't need touching. Future cleanup can switch them all to
    // `this.viewer.renderer` direct access.
    this.renderer        = this.viewer.renderer;
    this.markerTexture   = this.viewer.markerTexture;
    this.markerSprites   = this.viewer.markerSprites;
    this.markerOverlay   = this.viewer.markerOverlay;
    this.transitionEngine = this.viewer.transitionEngine!;

    // v2.17 Player Voice — ping pulses anchored to map coords, auto-fading.
    const pingLayerEl = document.getElementById('ping-layer');
    if (pingLayerEl) {
      this.pingLayer = new PingLayer(
        pingLayerEl,
        (x, y) => this.renderer.mapNormToCanvasCss(x, y),
        { showLabel: false, persistent: false, ttlMs: 10000 },
      );
    }
    // Measure-from-here ruler (player face). Same component as the GM uses;
    // distance maths reads this view's mirrored grid scale.
    const measureLayerEl = document.getElementById('measure-layer');
    if (measureLayerEl) {
      this._measureTool = new MeasureTool({
        host: measureLayerEl,
        project: (x, y) => this.renderer.mapNormToCanvasCss(x, y),
        unproject: (clientX, clientY) => {
          const c = document.querySelector<HTMLCanvasElement>('#renderer-canvas');
          if (!c) return null;
          const r = c.getBoundingClientRect();
          return this.renderer.canvasCssToMapNorm(clientX - r.left, clientY - r.top);
        },
        squaresBetween: (a, b) =>
          squaresBetweenNorm(a, b, this.mapImageWidth, this.mapImageHeight, this.mapPixelsPerSquare),
        unit: () => ({
          value:  this._measureUnitValue  ?? getMeasureUnitValue(),
          suffix: this._measureUnitSuffix ?? getMeasureUnitSuffix(),
        }),
      });
    }
    // v2.17 Player Voice — incoming-message toasts (GM replies, other players).
    const toastsEl = document.getElementById('player-msg-toasts');
    if (toastsEl) this._msgToasts = new PlayerMessageToasts(toastsEl);

    // v2.17 Player Voice — initiative rail (atmospheric face).
    const initEl = document.getElementById('player-initiative');
    if (initEl) {
      this.initiativeRail = new PlayerInitiativeRail(initEl);
      // v2.16.72 — the rail resolves player portraits from the icon cache
      // (the initiative_update broadcast no longer carries the data URL).
      this.initiativeRail.setIconResolver((pid) => this._playerIcons.get(pid));
      // v2.17.34 — resolve a GM-linked threat's marker name + cached image from
      // the marker data the player already holds (no extra broadcast).
      this.initiativeRail.setMarkerResolver((markerId) => {
        const m = this.currentMarkers.find((mk) => mk.id === markerId);
        if (!m) return null;
        const bitmap = getMarkerBitmap(m, this.playerIconCache);
        // Font/Unicode glyph markers have no bitmap — rasterise the glyph so the
        // card shows the actual icon, not just a name disc.
        const glyphDataUrl = !bitmap && isGlyphIcon(m.icon) ? glyphToDataUrl(m.icon, m.color) : null;
        return { name: m.label, bitmap, glyphDataUrl };
      });
    }
    // v2.16.76+ — read-only annotation overlays, map-anchored 1:1 with the
    // GM. project = map-norm → screen; read-only so unproject is unused.
    const anchor = { project: (x: number, y: number) => this.renderer.mapNormToCanvasCss(x, y), unproject: () => null };
    const clocksEl = document.getElementById('annotate-clocks');
    if (clocksEl) this._annotateClocks = new ClocksLayer(clocksEl, false, anchor);
    const timersEl = document.getElementById('annotate-timers');
    if (timersEl) this._annotateTimers = new TimersLayer(timersEl, false, anchor);
    const notesEl = document.getElementById('annotate-notes');
    if (notesEl) this._annotateNotes = new NotesLayer(notesEl, false, anchor);
    // v2.17.27 — screen-reader region for handout text/image alt. Visually
    // hidden (so parent choice is cosmetic) and runs on every viewer including
    // mobile/touch. player.html has no canvas wrapper, so anchor on <body>.
    // Focusable a11y boxes over the handout, positioned via the player's own
    // projection; canvas marked role="img" too. (player.html has no canvas
    // wrapper → anchor the region on body.)
    this._textMapAlt = new TextMapAltText(
      document.body,
      (x, y) => this.renderer.mapNormToCanvasCss(x, y),
      document.querySelector<HTMLCanvasElement>('#renderer-canvas'),
    );
    const videoLayerEl = document.getElementById('textmap-video-layer');
    // v2.16.102 — in-map YouTube video doesn't render on mobile: Android
    // composites video through a hardware overlay that can't punch through the
    // WebGL map canvas, so it showed only an empty box (and the v2.16.101
    // CSS coaxing made it worse). Rather than display a dead outline, skip the
    // video layer entirely on touch devices. Known limitation — see backlog.
    const isMobileViewer = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    if (videoLayerEl && !isMobileViewer) {
      this._textMapVideos = new TextMapVideoLayer(videoLayerEl, (x, y) => this.renderer.mapNormToCanvasCss(x, y), { mode: 'viewer' });
      // v2.16.97 — a cross-origin YouTube iframe goes blank when the page
      // toggles fullscreen (the browser drops its compositing surface), and
      // the layer reuses the same host so nothing rebuilds on its own. Force
      // a rebuild once the transition settles; the clip re-syncs to the GM
      // within ~1.5 s.
      document.addEventListener('fullscreenchange', () => {
        window.setTimeout(() => this._textMapVideos?.refresh(), 250);
      });
    }
    // v2.18 — StarMap layer. Interactive on purpose (the preset's own flags govern
    // what players may do inside SSE); kept warm when hidden.
    const starMapEl = document.getElementById('starmap-layer');
    if (starMapEl) this._starMap = new StarMapLayer(starMapEl, 'viewer');

    // v2.19 Dice. Both surfaces are screen-space overlays; the tray is inert
    // until the GM sends a set, so a table that does not use dice sees nothing.
    const diceLayerEl = document.getElementById('dice-layer');
    if (diceLayerEl) this._diceLayer = new DiceLayer(diceLayerEl, 'viewer');
    const diceTrayEl = document.getElementById('dice-tray');
    if (diceTrayEl && !this._isPreviewMode()) {
      this._diceTray = new PlayerDiceTray(diceTrayEl, {
        onRoll: (entry, whisper) => void this._rollDice(entry, whisper),
        onConnectDice: () => void this._connectPhysicalDice(),
        onWhisperChange: (armed, reason) => {
          // Never let the mode change silently: the first they would know is a
          // secret roll on the table screen.
          if (!armed && reason === 'timeout') this._diceLayer?.showLine({
            rollId: `whisper-off-${Date.now()}`,
            label: 'Whisper off',
            outcome: { formula: 'after ten minutes', dice: [], modifier: 0, total: 0 },
            rollerKey: '__notice__', rollerName: 'Dice', rollerColor: '#a5b4fc',
          });
        },
      });
      // Real dice are only offered where Web Bluetooth can actually work.
      this._diceTray.setPairingAvailable(isPhysicalDiceSupported());
    }
    // v2.16.77 — read-only whiteboard mirrored from the GM.
    const boardEl = document.getElementById('annotate-whiteboard') as HTMLCanvasElement | null;
    if (boardEl) this._annotateBoard = new WhiteboardLayer(boardEl, (x, y) => this.renderer.mapNormToCanvasCss(x, y));

    // v2.17 Player Voice — player tokens. Players can drag only their own, and
    // only while the GM allows movable markers.
    const pmEl = document.getElementById('player-marker-layer');
    if (pmEl) {
      this.playerMarkerLayer = new PlayerMarkerLayer(pmEl, {
        project:   (x, y) => this.renderer.mapNormToCanvasCss(x, y),
        unproject: (cx, cy) => {
          const canvas = document.querySelector<HTMLCanvasElement>('#renderer-canvas');
          if (!canvas) return null;
          const r = canvas.getBoundingClientRect();
          return this.renderer.canvasCssToMapNorm(cx - r.left, cy - r.top);
        },
        canDrag: (playerId) => this.features.movableMarkers && playerId === this.playerId,
        onDragMove: (_pid, x, y) => this.guest.send({ type: 'player_marker_move', playerId: this.playerId, clientId: this.clientId, x, y, done: false }),
        onDragEnd:  (_pid, x, y) => this.guest.send({ type: 'player_marker_move', playerId: this.playerId, clientId: this.clientId, x, y, done: true }),
        onRotateMove: (_pid, facing) => this._sendOwnMarkerRotation(facing, false),
        onRotateEnd:  (_pid, facing) => this._sendOwnMarkerRotation(facing, true),
        getPxPerSquare: () => this._tokenPxPerSquare(),
      });
    }

    // Post-map-load: marker re-render + overlay refresh. Viewer has
    // already pushed the new aspect ratio into MarkerTexture +
    // MarkerSprites before invoking this hook.
    this.viewer.onMapLoaded(() => {
      this.markerTexture.render(this.currentMarkers, this.playerIconCache);
      this.markerSprites.render(this.currentMarkers, this.playerIconCache);
      this._updateMarkerOverlay();
      this.renderer.markMarkersDirty();
      // v2.14.17 — redraw the player-side grid on map load too. The
      // new map may bring a different mapPixelsPerSquare /
      // mapImageWidth, which the map-relative strategy needs.
      this._refreshPlayerGrid();
    });

    // v2.14.17 — bind the player-side grid canvas + redraw on canvas
    // resize.
    // v2.14.33 — observe the RENDERER canvas (not window.resize). The
    // Renderer's own ResizeObserver fires before mine on the same
    // element (registered earlier in init), so by the time my callback
    // runs the camera has already been updated for the new dimensions
    // and mapNormToCanvasCss returns coords against the new frustum.
    // window.resize was firing too early — my grid was projecting
    // gridlines against the OLD camera onto the NEW canvas size,
    // which drifted on every window resize.
    this.playerGridCanvas = document.querySelector<HTMLCanvasElement>('#player-grid');
    const rendererCanvas = document.querySelector<HTMLCanvasElement>('#renderer-canvas');
    if (rendererCanvas) {
      new ResizeObserver(() => this._refreshPlayerGrid()).observe(rendererCanvas);
    }

    // v2.14.18 — bind the Reset View button + wire pan/zoom gestures
    // on the renderer canvas. The button stays hidden until the
    // player has actually deviated from the GM's broadcast view.
    this._resetViewBtn = document.getElementById('player-reset-view-btn') as HTMLButtonElement | null;
    this._resetViewBtn?.addEventListener('click', (e) => {
      // Don't let this click bubble to the document-level mute toggle.
      e.stopPropagation();
      this._localOverride = null;
      this._applyEffectiveView();
    });
    this._attachPlayerGestures();

    this.renderer.onContextLost = () => {
      this._contextLost = true;
      this.setStatus('Renderer lost — recovering…');
    };
    this.renderer.onContextRestored = () => {
      this._contextLost = false;
      this._recoverRenderer();
    };

    // visibilitychange fires when the user returns to the tab/app on mobile.
    // - If the WebGL context was lost while hidden and webglcontextrestored
    //   hasn't fired yet, this is a fallback trigger.
    // - If the page has been hidden for a while, mobile battery saving / OS
    //   sleep may have torn down the WebRTC data channel silently. PeerJS
    //   doesn't always get a close event in that case, so we proactively
    //   reconnect on resume rather than wait for the user to refresh the page.
    let hiddenSince: number | null = null;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        hiddenSince = performance.now();
        return;
      }
      if (this._contextLost) this._recoverRenderer();
      const wasHiddenFor = hiddenSince !== null ? performance.now() - hiddenSince : 0;
      hiddenSince = null;
      // Threshold of 10s: tab-switches under that don't trigger a reconnect.
      // Above it we always tear down + reconnect — checking conn.open isn't
      // reliable because mobile OS sleep often kills the WebRTC channel
      // silently without firing close, leaving conn.open=true on a dead pipe.
      // A few seconds of "Reconnecting…" on the rare survived-conn case is a
      // small cost vs. needing the user to refresh the tab.
      // v2.16.68 — Skip the visibility-driven reconnect in GM-preview
      // mode. The PiP popup keeps registering as "hidden" whenever the
      // GM focuses the main window, which was triggering teardown +
      // PeerJS reconnect every ~10s — visible in the GM log as a
      // stream of "player_identify received" from a fresh PeerJS
      // clientId each time. BroadcastChannel still works regardless
      // of visibility, so the PiP doesn't need this defensive reconnect.
      if (wasHiddenFor > 10_000 && this.roomCode && !this._gmPreviewFlag) {
        this.setStatus('Reconnecting…');
        this.guest?.connect(this.roomCode);
      }
    });

    this.statusEl     = document.querySelector('#status')!;
    // v2.17.20 — connection chatter feeds a quiet activity log rather than a
    // toast over the map. v2.17.21 — on the player view there's no visible (i)
    // at all (a corner indicator distracts during play); the log is opened on
    // demand via the right-click "Show activity" entry below.
    this.messageLog   = new MessageLog(document.body, { title: 'Activity', showButton: false });
    this.connectPanel = document.querySelector('#connect-panel')!;
    this.roomInput    = document.querySelector<HTMLInputElement>('#room-input')!;

    const roomCode = location.hash.slice(1).trim();

    if (roomCode) {
      this.connect(roomCode);
    } else {
      this.showConnectPanel();
    }

    document.querySelector('#connect-btn')?.addEventListener('click', () => {
      const code = this.roomInput.value.trim();
      if (code) {
        this.connectPanel.hidden = true;
        this.connect(code);
      }
    });

    // v2.16.42 — canvas-tap-to-unmute retired. The browser's autoplay
    // policy was the original reason for it (any user click anywhere
    // satisfied the gesture requirement, the giant "tap anywhere to
    // start audio" prompt taught users to do so); in practice modern
    // browsers accept the user's connect-button click + the page load
    // itself as user activation. The small mute icon top-right is now
    // the single affordance — transparent until clicked, the user
    // taps it once to unmute and again to mute. No giant prompt.

    // Prevent the browser context menu on right-click (keep canvas clean).
    // v2.17.23 — in the GM's local preview (PiP iframe / pop-out) the renderer
    // canvas has `pointer-events: none` (so the GM can pan/zoom the map behind
    // it), which means the canvas's own contextmenu handler below NEVER fires
    // there. The right-click lands on the body and only reaches this document
    // listener — so this is where we open the activity log for a preview window,
    // giving the GM the connection log for debugging even though the player
    // action menu (ping/measure) is intentionally suppressed in previews.
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this._isPreviewMode()) this.messageLog?.show({ x: e.clientX, y: e.clientY });
    });

    // v2.17 Player Voice — right-click / long-press the map → action menu (ping, …).
    const mapCanvas = document.querySelector<HTMLCanvasElement>('#renderer-canvas');
    mapCanvas?.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this._isPreviewMode()) return; // preview right-click handled at document level above
      this._openPlayerMenu(e.clientX, e.clientY);
    });
    mapCanvas?.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      if (this._isPreviewMode()) return;
      this._pressStart = { x: e.clientX, y: e.clientY };
      this._clearPressTimer();
      this._pressTimer = window.setTimeout(() => {
        this._pressTimer = null;
        if (this._pressStart) this._openPlayerMenu(this._pressStart.x, this._pressStart.y);
      }, 500);
    });
    mapCanvas?.addEventListener('pointermove', (e) => {
      if (!this._pressStart) return;
      if (Math.abs(e.clientX - this._pressStart.x) > 10 || Math.abs(e.clientY - this._pressStart.y) > 10) {
        this._clearPressTimer(); // became a pan — not a long-press
      }
    });
    mapCanvas?.addEventListener('pointerup',     () => this._clearPressTimer());
    mapCanvas?.addEventListener('pointercancel', () => this._clearPressTimer());

    // v2.17 Player Voice — identity button (set / change who you are).
    document.querySelector('#player-identity-btn')?.addEventListener('click', () => {
      void this.openIdentityModal();
    });
    this._refreshIdentityButton();
    // Apply GM-preview gating at page load so it takes effect before the first
    // network message arrives, rather than briefly flashing player chrome.
    this._refreshPreviewModeUi();

    // Clean disconnect so the GM drops our binding immediately — BroadcastChannel
    // never signals close, so this mirrors the projector_bye pattern.
    window.addEventListener('pagehide', () => {
      try { this.guest?.send({ type: 'player_bye', clientId: this.clientId }); } catch { /* unloading */ }
    });

    // v2.16.42 — show the mute icon top-right immediately so the user
    // can toggle audio with a single click. PiP iframes (`?pip=1`)
    // skip this entirely — they're silent previews.
    if (!this._isPip) this.viewer.showMuteIndicator(this.sbMuted);

    // v2.16.44 — same-browser audio mutual exclusion. PiP iframes don't
    // participate (they're silently muted by construction); every other
    // player view does. If this window started unmuted (pop-out from
    // PiP, etc.) we immediately claim audio so any other live Mappadux
    // tab silences itself.
    if (!this._isPip) {
      void import('../utils/AudioCoordinator.ts').then(({ AudioCoordinator }) => {
        this._audioCoord = new AudioCoordinator({
          clientId: this.clientId,
          onForceMute: () => {
            if (this.sbMuted) return;
            this._applyMute(true);
            this.viewer.showMuteIndicator(this.sbMuted);
          },
        });
        if (!this.sbMuted) this._audioCoord.claim();
      });
    }
  }

  /** v2.14.17 — Refresh the player-side 1″ grid overlay. Drawn via
   *  the shared map-relative strategy so spacing tracks the current
   *  view fraction. No-op when the GM has the grid off, when the
   *  active map isn't calibrated, or when the canvas isn't bound. */
  private _refreshPlayerGrid(): void {
    if (!this.playerGridCanvas) return;
    drawGrid(this.playerGridCanvas, {
      effectiveW:         window.innerWidth,
      effectiveH:         window.innerHeight,
      enabled:            !!this.lastView?.playerGridEnabled,
      color:              this.gridColor ?? '#ffffff',
      mapPixelsPerSquare: this.mapPixelsPerSquare,
      mapImageWidth:      this.mapImageWidth,
      mapImageHeight:     this.mapImageHeight,
      gridOffsetX:        this.gridOffsetX,
      gridOffsetY:        this.gridOffsetY,
      renderer:           this.renderer,
    });
  }

  /** v2.14.18 — Apply the broadcast view + any local zoom override
   *  to the renderer. Called on view_update / full_state / map_change,
   *  and on every override mutation (wheel, drag, pinch, reset). */
  private _applyEffectiveView(): void {
    const bv = this._broadcastView;
    if (!bv) return;

    // Clamp the override to fit inside the broadcast bounds. If there's
    // no override the broadcast view IS the effective view.
    let effective: ViewState;
    if (this._localOverride) {
      this._clampOverride(bv);
      const ov = this._localOverride;
      effective = {
        ...bv,
        centerX: ov.centerX,
        centerY: ov.centerY,
        viewNW:  ov.viewNW,
        viewNH:  ov.viewNH,
      };
    } else {
      effective = bv;
    }

    this.lastView = effective;
    // 2026-05-31 — suppress the renderer's clip pass when the player
    // has zoomed in / panned. The renderer's camera already draws the
    // full canvas area (letterbox bars are produced by clipPass blacking
    // out pixels outside the GM-defined viewport aspect). Disabling the
    // clip means those extra pixels become visible — the player sees
    // more of the map filling the canvas. The GM-defined aspect ratio
    // only constrains the view when the player is at the broadcast
    // view (no override active).
    this.renderer.setView(effective, { clip: !this._localOverride });
    this.renderer.setBackdrop(effective.backdrop ?? null);
    this.markerSprites.render(this.currentMarkers, this.playerIconCache);
    this._updateMarkerOverlay();
    this.renderer.markMarkersDirty();
    this._refreshPlayerGrid();

    // Reset-view button visibility follows the override state. A small
    // tolerance avoids flashing the button if the override just
    // happens to coincide with the broadcast (e.g. after clamping).
    if (this._resetViewBtn) {
      const showReset = !!this._localOverride;
      this._resetViewBtn.hidden = !showReset;
    }
  }

  /** Mutate `_localOverride` so its rect fits inside the broadcast
   *  view rect. viewNW/viewNH get clamped to [MIN, broadcast.viewN*];
   *  center is clamped so the override rect stays within bounds. */
  private _clampOverride(bv: ViewState): void {
    const ov = this._localOverride;
    if (!ov) return;
    const minSize = PlayerApp.MIN_OVERRIDE_VIEW;
    ov.viewNW = Math.min(bv.viewNW, Math.max(minSize, ov.viewNW));
    ov.viewNH = Math.min(bv.viewNH, Math.max(minSize, ov.viewNH));
    const dx = (bv.viewNW - ov.viewNW) / 2;
    const dy = (bv.viewNH - ov.viewNH) / 2;
    ov.centerX = Math.min(bv.centerX + dx, Math.max(bv.centerX - dx, ov.centerX));
    ov.centerY = Math.min(bv.centerY + dy, Math.max(bv.centerY - dy, ov.centerY));
  }

  /** Wire pointer / wheel / pinch handlers. Bound to document.body so
   *  no overlay layer (transition canvas, grid canvas, marker overlay,
   *  faff dimmer) can intercept the gesture — the canvas itself sits
   *  beneath all of them. Coordinate math still uses the renderer
   *  canvas's rect, which is identical to the body rect on the player
   *  page (the canvas fills the viewport). */
  private _attachPlayerGestures(): void {
    const canvas = document.querySelector<HTMLCanvasElement>('#renderer-canvas');
    if (!canvas) return;
    attachGestures(document.body, {
      // Pointerdown gate — let the connect panel's input + buttons
      // and the two floating chrome buttons keep their native event
      // handling. Without this, e.g. tapping the Connect button on
      // mobile would be captured as a gesture-start and the click
      // would never fire.
      shouldStart: (e) => {
        const t = e.target as HTMLElement | null;
        if (!t) return true;
        if (t.closest('.connect-panel')) return false;
        if (t.closest('#player-fullscreen-btn')) return false;
        if (t.closest('#player-reset-view-btn')) return false;
        return true;
      },
      onWheel: (e) => this._zoomAtClient(e.clientX, e.clientY, e.factor),
      onDrag:  (e) => {
        // Only treat mouse / pen / touch single-finger drags as pans.
        // (attachGestures also exposes pointerType — currently we accept
        // all of them; tap-to-mute still survives because attachGestures
        // doesn't fire onDrag until the pointer actually moves.)
        if (e.phase === 'start') {
          const snap = this._currentOverrideSnapshot();
          this._gestureSnap = {
            override:  snap,
            effective: this._expandToCanvasAspect(snap),
            midX: e.clientX, midY: e.clientY,
          };
          return;
        }
        if (!this._gestureSnap || !this._broadcastView) return;
        const canvasRect = canvas.getBoundingClientRect();
        const bv = this._broadcastView;
        const snap    = this._gestureSnap.override;
        const snapEff = this._gestureSnap.effective;
        // dx/dy is cumulative from start. Convert client-px → view-norm
        // using the EFFECTIVE viewport (what the user actually sees on
        // canvas). With clip suppressed, dragging the canvas full-width
        // moves the world by snapEff.viewNW, not snap.viewNW — using
        // snap here would feel "sticky" off-centre.
        const dnx = -e.dx / canvasRect.width  * snapEff.viewNW;
        const dny = -e.dy / canvasRect.height * snapEff.viewNH;
        this._localOverride = {
          centerX: snap.centerX + dnx,
          centerY: snap.centerY + dny,
          viewNW:  snap.viewNW,
          viewNH:  snap.viewNH,
        };
        // Skip applying for tiny pre-threshold drags (< 1px) so a
        // genuine tap-to-mute click doesn't get clobbered by a stray
        // sub-pixel pointermove between down and up.
        if (e.phase === 'move' && Math.hypot(e.dx, e.dy) < 1) return;
        this._clampOverride(bv);
        this._applyEffectiveView();
        if (e.phase === 'end') this._gestureSnap = null;
      },
      onTwoFinger: (e) => {
        if (e.phase === 'start') {
          const snap = this._currentOverrideSnapshot();
          this._gestureSnap = {
            override:  snap,
            effective: this._expandToCanvasAspect(snap),
            midX: e.midX, midY: e.midY,
          };
          return;
        }
        if (!this._gestureSnap || !this._broadcastView) return;
        const canvasRect = canvas.getBoundingClientRect();
        const snap    = this._gestureSnap.override;
        const snapEff = this._gestureSnap.effective;
        // Scale around the original centroid (in client px). e.scale is
        // cumulative — fingers spread → >1 → zoom IN → smaller view.
        // Cursor / centroid maps to world coords via the EFFECTIVE viewport,
        // since that's what the user sees; zoom factor applies uniformly to
        // both the stored override and the effective viewport.
        const u0 = (this._gestureSnap.midX - canvasRect.left) / canvasRect.width;
        const v0 = (this._gestureSnap.midY - canvasRect.top)  / canvasRect.height;
        const wx0 = snapEff.centerX - snapEff.viewNW / 2 + u0 * snapEff.viewNW;
        const wy0 = snapEff.centerY - snapEff.viewNH / 2 + v0 * snapEff.viewNH;
        const newW    = snap.viewNW    / e.scale;
        const newH    = snap.viewNH    / e.scale;
        const newEffW = snapEff.viewNW / e.scale;
        const newEffH = snapEff.viewNH / e.scale;
        // Pan from centroid drift, again in effective space.
        const dnx = -e.panDx / canvasRect.width  * snapEff.viewNW;
        const dny = -e.panDy / canvasRect.height * snapEff.viewNH;
        this._localOverride = {
          viewNW:  newW,
          viewNH:  newH,
          centerX: wx0 - (u0 - 0.5) * newEffW + dnx,
          centerY: wy0 - (v0 - 0.5) * newEffH + dny,
        };
        this._clampOverride(this._broadcastView);
        this._applyEffectiveView();
        if (e.phase === 'end') this._gestureSnap = null;
      },
    });
  }

  /** Snapshot the current effective view as an override seed — used
   *  when the player starts a gesture from the GM-matching state. */
  private _currentOverrideSnapshot(): { centerX: number; centerY: number; viewNW: number; viewNH: number } {
    if (this._localOverride) {
      const ov = this._localOverride;
      return { centerX: ov.centerX, centerY: ov.centerY, viewNW: ov.viewNW, viewNH: ov.viewNH };
    }
    const bv = this._broadcastView!;
    return { centerX: bv.centerX, centerY: bv.centerY, viewNW: bv.viewNW, viewNH: bv.viewNH };
  }

  /** Expand a bv-aspect viewport snapshot to the canvas-aspect viewport the
   *  player actually sees on canvas. When the clip pass is off (override
   *  active), the renderer's camera extends beyond the snapshot's viewNW/H
   *  in whichever axis is too narrow for the canvas aspect — the cursor's
   *  client-px position therefore maps to a world coordinate via the
   *  EXTENDED dimensions, not the original. Used everywhere a gesture needs
   *  to keep a world point glued to the user's finger / cursor. 2026-05-31. */
  private _expandToCanvasAspect(
    s: { centerX: number; centerY: number; viewNW: number; viewNH: number },
  ): { centerX: number; centerY: number; viewNW: number; viewNH: number } {
    const canvas = document.querySelector<HTMLCanvasElement>('#renderer-canvas');
    if (!canvas || canvas.clientWidth === 0 || canvas.clientHeight === 0) return s;
    const ma = this.renderer.mapAspect;
    if (ma <= 0) return s;
    const sa = canvas.clientWidth / canvas.clientHeight;
    const va = (s.viewNW * ma) / s.viewNH;
    let viewNW = s.viewNW;
    let viewNH = s.viewNH;
    if (sa > va)      viewNW = (s.viewNH * sa) / ma;
    else if (sa < va) viewNH = (s.viewNW * ma) / sa;
    return { centerX: s.centerX, centerY: s.centerY, viewNW, viewNH };
  }

  /** Zoom around a client-px point. factor < 1 = zoom IN, >1 = zoom OUT. */
  private _zoomAtClient(clientX: number, clientY: number, factor: number): void {
    if (!this._broadcastView) return;
    const canvas = document.querySelector<HTMLCanvasElement>('#renderer-canvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const u = (clientX - rect.left) / rect.width;
    const v = (clientY - rect.top)  / rect.height;
    const cur    = this._currentOverrideSnapshot();
    const curEff = this._expandToCanvasAspect(cur);
    // World point under the cursor maps via the EFFECTIVE viewport (matches
    // what the user sees on canvas); zoom factor applies uniformly to both
    // the stored override and the effective view.
    const wx0 = curEff.centerX - curEff.viewNW / 2 + u * curEff.viewNW;
    const wy0 = curEff.centerY - curEff.viewNH / 2 + v * curEff.viewNH;
    const newW    = cur.viewNW    * factor;
    const newH    = cur.viewNH    * factor;
    const newEffW = curEff.viewNW * factor;
    const newEffH = curEff.viewNH * factor;
    this._localOverride = {
      viewNW:  newW,
      viewNH:  newH,
      centerX: wx0 - (u - 0.5) * newEffW,
      centerY: wy0 - (v - 0.5) * newEffH,
    };
    this._clampOverride(this._broadcastView);
    // If the wheel-out has restored the override to match the broadcast
    // exactly, drop it back to null so the Reset button hides itself.
    const bv = this._broadcastView;
    const ov = this._localOverride;
    const eps = 1e-4;
    if (
      Math.abs(ov.viewNW - bv.viewNW) < eps &&
      Math.abs(ov.viewNH - bv.viewNH) < eps &&
      Math.abs(ov.centerX - bv.centerX) < eps &&
      Math.abs(ov.centerY - bv.centerY) < eps
    ) {
      this._localOverride = null;
    }
    this._applyEffectiveView();
  }

  /** v2.14.54 — composite payload handling. When map_change /
   *  full_state carries a composite payload, the mapBlob is a packed
   *  concatenation of tile bytes (not a final PNG). Unpack + rasterise
   *  locally so the renderer's loadMap gets a normal image buffer.
   *  Returns the input blob unchanged for non-composite maps. */
  private async _maybeRasterizeComposite(
    blob:      ArrayBuffer,
    composite: CompositeWirePayload | undefined,
  ): Promise<{ renderable: ArrayBuffer; backing?: ArrayBuffer }> {
    if (!composite) return { renderable: blob };
    const { unpackCompositeBundle } = await import('../maps/compositeWireFormat.ts');
    const { rasterizeFromTiles }    = await import('../maps/rasterizeComposite.ts');
    const inputs = unpackCompositeBundle(blob, composite);
    const result = await rasterizeFromTiles(inputs, composite.aspect);
    if (!result) return { renderable: blob };
    const renderable = await result.blob.arrayBuffer();
    // v2.14.70 — when the composite has 2+ tiles, also rasterise a
    // "minus topmost tile" backing so the Reveal Map Layer brush
    // exposes the layer underneath through alpha holes in the main
    // map. Single-tile composites skip the backing (nothing to
    // reveal). The viewer computes the backing locally from the
    // same wire-shipped tile bytes — no extra bandwidth.
    if (inputs.length < 2) return { renderable };
    // v2.15.16 — Backing membership = "tiles with something drawn
    // OVER them" (matches the GM-side rasterizeRevealBacking rule
    // shared via compositeOverlap.backingTileIndices). Earlier this
    // used inputs.slice(0, -1) — only the single LAST tile got
    // excluded, which broke composites with multiple top tiles
    // covering the same bottom (only one became transparent under
    // the upper-layer slider on the GM, both broke on the player).
    const { backingTileIndices } = await import('../maps/compositeOverlap.ts');
    const covered = backingTileIndices(
      inputs.map((i) => i.tile),
      (id) => inputs.find((i) => i.asset.id === id)?.asset,
      composite.aspect,
    );
    if (covered.size === 0) return { renderable };
    const drawnInputs = inputs.filter((_, idx) => covered.has(idx));
    // Pass full inputs as extentInputs so the backing PNG shares the
    // main composite's dimensions exactly.
    const backingResult = await rasterizeFromTiles(drawnInputs, composite.aspect, inputs);
    if (!backingResult) return { renderable };
    const backing = await backingResult.blob.arrayBuffer();
    return { renderable, backing };
  }

  private _recoverRenderer(): void {
    if (this.lastMapBlob) {
      // Re-feed the cached state — recreates all GPU resources from scratch.
      void this.renderer.loadMap(this.lastMapBlob, this.lastFog).then(() => {
        if (this.lastFilter) this.renderer.setFilter(this.lastFilter);
        // Re-apply through the effective-view path so any active zoom
        // override survives context loss.
        if (this._broadcastView || this.lastView) {
          if (!this._broadcastView && this.lastView) this._broadcastView = this.lastView;
          this._applyEffectiveView();
        }
        this.setStatus('');
      });
    } else if (this.roomCode) {
      // No cached blob yet (first load) — reconnect to get a fresh full_state.
      this.connect(this.roomCode);
    }
  }

  // ─── P2P ──────────────────────────────────────────────────────────────────

  private connect(roomCode: string): void {
    this.roomCode = roomCode;
    this.setStatus('Connecting…');

    // Destroy any existing guest (e.g. WebGL context-recovery reconnect) before
    // creating a new one, so there are never two active P2P connections at once.
    this.guest?.destroy();

    this.guest = new Guest({
      onConnected:    () => {
        this.setStatus('');
        // v2.16.43 — tell the GM this peer is a PiP / pop-out preview so
        // it shows "GM Player View disconnected" instead of the generic
        // "Player (peerid…) disconnected" when the GM minimises / closes
        // the preview.
        if (this._gmPreviewFlag) {
          try { this.guest?.send({ type: 'gm_preview_hello', clientId: this.clientId }); } catch { /* best-effort */ }
        }
        void this._onConnectedIdentity();
      },
      onDisconnected: () => this.setStatus('Disconnected — waiting for GM…'),
      onReconnecting: (attempt, delayMs) => {
        const secs = Math.round(delayMs / 1000);
        this.setStatus(`Reconnecting… (${secs}s, attempt ${attempt})`);
      },
      onError: (err)  => this.setStatus(`Error: ${err.message}`),
      // v2.18 — honest verdict when neither a direct nor relayed path exists (UDP blocked,
      // no TLS relay): say so instead of "Connecting…" forever. Reconnect keeps trying.
      onIceState: (st) => { if (st === 'ice-failed') this.setStatus('Connection blocked by this network — it will not carry a direct or relayed link to the GM (UDP blocked, no relay). Ask the GM for a link with a relay, or try another network.'); },
      onMessage: (msg, blob) => this.handleMessage(msg, blob),
    });
    // v2.18 — BYO relay from the join URL (?ice=), set before dialling.
    this.guest.setIceServers(parseIceParam(new URLSearchParams(location.search).get('ice')));

    // v2.17.16 — A GM preview (PiP / pop-out) is always same-browser, so
    // ride on LocalChannel alone and skip the flaky PeerJS loopback. Real
    // players (QR / room code, no gmPreview flag) still connect over PeerJS.
    if (this._gmPreviewFlag) {
      this.guest.connectLocalOnly();
    } else {
      this.guest.connect(roomCode);
    }

    // Liveness pings so the GM can detect this same-machine player even
    // though BroadcastChannel offers no presence signal. PeerJS-connected
    // players ping too — Host swallows those (the conn lifecycle already
    // tracks them) so the bandwidth cost is a few bytes per 4s.
    if (this._heartbeatInterval !== null) clearInterval(this._heartbeatInterval);
    const beat = () => {
      // Don't announce a same-browser preview popup as a real player.
      // v2.17.16 — gate on the gmPreview flag (not _isPreviewMode): the GM's
      // own Player View is tracked via gm_preview_hello, so it must never
      // also heartbeat as a local player — even when "preview behaves as a
      // real player" is on — or it would be counted twice.
      if (this._gmPreviewFlag) return;
      this.guest.send({ type: 'player_heartbeat', clientId: this.clientId });
    };
    beat();
    this._heartbeatInterval = window.setInterval(beat, 4000);
  }

  /** True when this view was launched from the GM's "Open Player Window" button
   *  AND the override setting hasn't been flipped on. Detection is the
   *  ?gmPreview=1 URL flag — phones / laptops connecting via QR never have it,
   *  so they're never preview mode regardless of any local state. */
  private _isPreviewMode(): boolean {
    return this._gmPreviewFlag && !showFullPlayerUiInPreview();
  }

  /** Apply preview-mode visibility to the player chrome (identity pill, toasts
   *  container). Cheap to call on every incoming message — flips state idempotently. */
  private _refreshPreviewModeUi(): void {
    const preview = this._isPreviewMode();
    const pillEl = document.querySelector<HTMLElement>('#player-identity-btn');
    if (pillEl) pillEl.hidden = preview;
    const toastsEl = document.querySelector<HTMLElement>('#player-msg-toasts');
    if (toastsEl) toastsEl.hidden = preview;
    document.body.classList.toggle('is-gm-preview', preview);
  }

  // ── v2.17 Player Voice — identity ──────────────────────────────────────────

  private _loadPlayerId(): string {
    try {
      const existing = localStorage.getItem('mappadux:player_id');
      if (existing) return existing;
      const fresh = generateId();
      localStorage.setItem('mappadux:player_id', fresh);
      return fresh;
    } catch { return generateId(); }
  }

  private _loadIdentity(): PlayerIdentity | null {
    try {
      const raw = localStorage.getItem('mappadux:player_identity');
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<PlayerIdentity>;
      if (typeof parsed.color !== 'string') return null;
      return {
        playerName:    typeof parsed.playerName === 'string' ? parsed.playerName : '',
        characterName: typeof parsed.characterName === 'string' ? parsed.characterName : '',
        color:         parsed.color,
      };
    } catch { return null; }
  }

  private _saveIdentity(id: PlayerIdentity): void {
    this.identity = id;
    try { localStorage.setItem('mappadux:player_identity', JSON.stringify(id)); } catch { /* private mode */ }
    this._refreshIdentityButton();
  }

  /** Push our identity to the GM. No-op if we have none yet, or in preview mode. */
  private _sendIdentify(): void {
    if (!this.identity) return;
    if (this._isPreviewMode()) return;
    this.guest.send({
      type: 'player_identify',
      playerId:      this.playerId,
      clientId:      this.clientId,
      playerName:    this.identity.playerName,
      characterName: this.identity.characterName,
      color:         this.identity.color,
      // v2.16.103 — device class for the GM's connections summary (PC/mobile).
      mobile:        window.matchMedia('(hover: none) and (pointer: coarse)').matches,
    });
    // Diagnostic — visible in DevTools so we can confirm an identify went out
    // when something looks wrong on the GM side.
    console.info('[player] identify sent', { playerId: this.playerId, name: this.identity.characterName || this.identity.playerName });
    // Brief on-screen confirmation so the player can see the GM was told.
    const who = this.identity.characterName || this.identity.playerName || 'Player';
    this.setStatus(`Connected as ${who}`);
    setTimeout(() => { if (this.statusEl.textContent === `Connected as ${who}`) this.setStatus(''); }, 2500);
  }

  /** On (re)connect: announce existing identity, or prompt once on first join.
   *  Suppressed entirely in GM preview mode — the popup isn't a real player. */
  private async _onConnectedIdentity(): Promise<void> {
    this._refreshPreviewModeUi();
    if (this._isPreviewMode()) return;
    if (this.identity) { this._sendIdentify(); return; }
    if (this._identityPromptShown) return;
    this._identityPromptShown = true;
    const myIcon = this._playerIcons.get(this.playerId);
    const chosen = await this._identityModal.open(undefined, {
      takenColours: this._takenColours(),
      ...(myIcon ? { previewIconDataUrl: myIcon } : {}),
    });
    if (chosen) { this._saveIdentity(chosen); this._sendIdentify(); }
  }

  /** Re-open the identify modal so the player can change their details. The
   *  modal also exposes a Forget-me button that wipes local state + asks the
   *  GM to remove the persistent record so testing can restart cleanly. */
  async openIdentityModal(): Promise<void> {
    const myIcon = this._playerIcons.get(this.playerId);
    const chosen = await this._identityModal.open(this.identity ?? undefined, {
      onForget: () => this._forgetMe(),
      takenColours: this._takenColours(),
      ...(myIcon ? { previewIconDataUrl: myIcon } : {}),
    });
    if (chosen) { this._saveIdentity(chosen); this._sendIdentify(); }
  }

  /** Colours already claimed by other connected players — used by the identify
   *  modal to badge palette tiles that are in use. */
  private _takenColours(): Array<{ color: string; name: string }> {
    return this.roster
      .filter((p) => p.id !== this.playerId)
      .map((p) => ({ color: p.color, name: p.characterName || p.playerName || 'Player' }));
  }

  /** Re-merge the last received markers with the current icon cache and push
   *  to the layer. Called on both player_markers arrival and player_icon_update. */
  private _reRenderPlayerMarkers(): void {
    const merged = this._lastPlayerMarkers.map((m) => {
      const cached = this._playerIcons.get(m.playerId);
      return cached ? { ...m, iconDataUrl: cached } : m;
    });
    this.playerMarkerLayer?.setMarkers(merged);
  }

  /** Patch E v2.16.30 — apply the active filter's CSS approximation to the
   *  player-marker-layer DOM overlay when the GM has enabled the per-map
   *  "Affect Player Markers" toggle. Clears the filter otherwise. The map
   *  itself is filtered by the GLSL shader pipeline; this only touches the
   *  screen-space token layer so it visually participates in the look. */
  private _applyMarkerLayerFilter(): void {
    const layer = document.getElementById('player-marker-layer');
    if (!layer) return;
    if (this.lastFilter?.affectPlayerMarkers) {
      const css = cssApproxForFilter(this.lastFilter.filterId);
      layer.style.filter = css || '';
    } else {
      layer.style.filter = '';
    }
    // v2.16.94 — the in-map YouTube video layer ALWAYS participates in the
    // scene look (no per-map toggle, unlike markers): onboarding / cutscene
    // clips get the same CSS-approx tint as the map. The GM removes it by
    // turning the visual filter off. DOM filter applies to the iframe at the
    // compositing stage, so cross-origin YouTube content tints fine.
    const videoLayer = document.getElementById('textmap-video-layer');
    if (videoLayer) {
      videoLayer.style.filter = this.lastFilter ? cssApproxForFilter(this.lastFilter.filterId) : '';
    }
  }

  /** Ask the GM to resend a specific player's icon. Debounced per playerId so
   *  the same missing icon can't spawn a request per render frame. Cleared on
   *  the icon's arrival or after 5 s. */
  private _requestMissingIcon(playerId: string): void {
    if (this._pendingIconRequests.has(playerId)) return;
    this.guest.send({ type: 'player_icon_request', playerId });
    const timer = setTimeout(() => this._pendingIconRequests.delete(playerId), 5000);
    this._pendingIconRequests.set(playerId, timer);
  }

  /** Send a player_marker_move covering JUST a facing change on the player's
   *  own token. Position is read from the last received marker view so the
   *  GM accepts the move (it always expects x,y). */
  private _sendOwnMarkerRotation(facing: number, done: boolean): void {
    const mine = this._lastPlayerMarkers.find((m) => m.playerId === this.playerId);
    if (!mine) return;
    this.guest.send({
      type: 'player_marker_move',
      playerId: this.playerId,
      clientId: this.clientId,
      x: mine.x,
      y: mine.y,
      facing,
      done,
    });
  }

  /** Current screen-pixels-per-map-square at the active zoom, or null if the
   *  map isn't calibrated. Mirrors the GM-side helper so tokens scale to
   *  their footprint on calibrated maps regardless of which view is rendering. */
  private _tokenPxPerSquare(): number | null {
    if (!this.mapPixelsPerSquare || !this.mapImageHeight) return null;
    const scale = this.renderer.worldToScreenScale();
    return (this.mapPixelsPerSquare / this.mapImageHeight) * scale.pxPerWorldY;
  }

  /** Wipe local identity, ask the GM to drop the registry record, and reload
   *  with a fresh playerId so the next connect starts from zero. */
  private _forgetMe(): void {
    try { this.guest?.send({ type: 'player_forget_me', playerId: this.playerId, clientId: this.clientId }); } catch { /* connection might be flaky — try anyway */ }
    try {
      localStorage.removeItem('mappadux:player_id');
      localStorage.removeItem('mappadux:player_identity');
    } catch { /* private mode */ }
    // Brief delay so the message has a chance to flush before the reload.
    setTimeout(() => location.reload(), 200);
  }

  // ── v2.17 Player Voice — pings ─────────────────────────────────────────────

  private _clearPressTimer(): void {
    if (this._pressTimer !== null) { clearTimeout(this._pressTimer); this._pressTimer = null; }
    this._pressStart = null;
  }

  // ── v2.18 StarMap mode ─────────────────────────────────────────────────────

  private _enterStarMap(t: { origin: string; sessionId: string; presetId: string; backgroundColor?: string }): void {
    if (!this._starMap) return;
    this._starMapActive = true;
    document.body.classList.add('starmap-active');
    if (t.backgroundColor) document.body.style.backgroundColor = t.backgroundColor;
    this._starMap.show({ origin: t.origin, sessionId: t.sessionId, presetId: t.presetId });
    // Exactly one 3D app on the device: the SSE view. The map canvas is hidden
    // under the layer, so skip its GL work entirely (instant resume on exit).
    this.renderer.setPaused(true);
    this._textMapVideos?.clear();
    this._refreshStarMapPingButton();
  }

  private _exitStarMap(): void {
    if (!this._starMapActive) return;
    this._starMapActive = false;
    document.body.classList.remove('starmap-active');
    document.body.style.backgroundColor = '';
    this._starMap?.hide(); // warm for the cut back
    this.renderer.setPaused(false);
    this._refreshStarMapPingButton();
  }

  /** In StarMap mode the map gesture cannot reach us — a cross-origin iframe
   *  swallows its own pointer events (and it MUST, so players can drive the
   *  view). So "Ping" is offered from a corner button beside the existing
   *  chrome, and drops the ping at screen centre (screen-space, roughly
   *  aligned — decision Q4). Other players' pings still draw over the frame. */
  private _refreshStarMapPingButton(): void {
    let btn = document.querySelector<HTMLButtonElement>('#player-starmap-ping-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'player-starmap-ping-btn';
      btn.className = 'player-reset-view-btn player-starmap-ping-btn';
      btn.title = 'Ping the star map (everyone sees it)';
      btn.textContent = '◎ Ping';
      btn.hidden = true;
      btn.addEventListener('click', () => this._sendPing(0.5, 0.5));
      document.body.appendChild(btn);
    }
    btn.hidden = !(this._starMapActive && this.features.pings && !this._isPreviewMode());
  }

  /** Open the player action menu at a viewport point, if it maps onto the map. */
  private _openPlayerMenu(clientX: number, clientY: number): void {
    const canvas = document.querySelector<HTMLCanvasElement>('#renderer-canvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const norm = this.renderer.canvasCssToMapNorm(clientX - rect.left, clientY - rect.top);
    if (!norm || norm.x < 0 || norm.x > 1 || norm.y < 0 || norm.y > 1) return; // off-map / letterbox

    const items: ActionMenuItem[] = [];
    if (this.features.pings) {
      items.push({ label: 'Ping here', onSelect: () => this._sendPing(norm.x, norm.y) });
    }
    // Measure-from-here ruler. Ghosted when the active map has no scale.
    const measurable = this.mapPixelsPerSquare != null && this.mapImageWidth > 0 && this.mapImageHeight > 0;
    items.push({
      label: 'Measure from here',
      disabled: !measurable,
      onSelect: () => this._measureTool?.start({ x: norm.x, y: norm.y }),
    });
    if (this.features.messaging) {
      items.push({ label: 'Message the GM', onSelect: () => void this._composeAndSend(undefined, 'the GM') });
      for (const p of this.roster) {
        if (p.id === this.playerId) continue; // not yourself
        const label = p.characterName || p.playerName || 'player';
        items.push({ label: `Message ${label}`, onSelect: () => void this._composeAndSend(p.id, label) });
      }
    }
    // Utility entries — same actions as the floating corner buttons, surfaced
    // here too so the menu and the buttons are the two routes to the same thing.
    items.push({
      label: this.identity ? 'Change your name / colour' : 'Introduce yourself',
      onSelect: () => void this.openIdentityModal(),
    });
    items.push({
      label: document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen',
      onSelect: () => document.querySelector<HTMLButtonElement>('#player-fullscreen-btn')?.click(),
    });
    const resetBtn = document.querySelector<HTMLButtonElement>('#player-reset-view-btn');
    if (resetBtn && !resetBtn.hidden) {
      items.push({ label: 'Reset view to GM\'s', onSelect: () => resetBtn.click() });
    }
    // v2.19 — a pack sets the ceiling for dice; this is how a player lowers it
    // on their own screen. Cycles rather than nesting a submenu.
    if (this.features.dice) {
      const current = getDiceDetailPreference();
      const nextOf: Record<DiceDetail, DiceDetail> = { full: 'line', line: 'none', none: 'full' };
      const wording: Record<DiceDetail, string> = { full: 'the dice', line: 'a line of text', none: 'nothing' };
      items.push({
        label: `Dice show me: ${wording[current]}`,
        onSelect: () => setDiceDetailPreference(nextOf[current]),
      });
      // The other axis: not how much, but what they look like. Only worth
      // offering when this player is actually being shown dice.
      if (current === 'full') {
        const look = getDiceRenderPreference();
        const nextLook = { auto: 'shaped', shaped: 'plain', plain: 'auto' } as const;
        const lookWording = { auto: 'automatic', shaped: 'shaped dice', plain: 'plain numbers' } as const;
        items.push({
          label: `Dice look: ${lookWording[look]}`,
          onSelect: () => setDiceRenderPreference(nextLook[look]),
        });
      }
    }
    // v2.17.21 — connection/activity log on demand only (no corner indicator).
    items.push({ label: 'Show activity', onSelect: () => this.messageLog?.show({ x: clientX, y: clientY }) });
    this._actionMenu.open(clientX, clientY, items);
  }

  /** Prompt for message text, then send to the GM (toPlayerId undefined) or
   *  another player. Ensures we have an identity first. */
  private async _composeAndSend(toPlayerId: string | undefined, label: string): Promise<void> {
    if (!this.features.messaging) return;
    if (!this.identity) {
      await this.openIdentityModal();
      if (!this.identity) return;
    }
    const text = await this._composer.open(label);
    if (!text) return;
    this.guest.send({
      type: 'player_message',
      messageId:    generateId(),
      fromPlayerId: this.playerId,
      clientId:     this.clientId,
      ...(toPlayerId ? { toPlayerId } : {}),
      text,
    });
  }

  private _sendPing(x: number, y: number): void {
    if (!this.features.pings) return;
    // A ping carries the player's colour + name, so make sure we have one first.
    if (!this.identity) {
      void this.openIdentityModal().then(() => { if (this.identity) this._emitPing(x, y); });
      return;
    }
    this._emitPing(x, y);
  }

  // ── v2.19 Dice (docs/dice-design.md) ──────────────────────────────────────

  /** Tap to roll. We roll HERE, draw it here, and tell the GM what it came to —
   *  the faces are decided once, by whoever rolled. Identity first, so the GM
   *  can attribute it, exactly as pings do. */
  private async _rollDice(entry: import('../types.ts').DiceButton, whisper: boolean): Promise<void> {
    const outcome = rollFormula(entry.formula);
    if (!outcome) return;
    await this._emitRoll(entry.label, outcome, whisper, false);
  }

  /**
   * v2.19.5 — pair the player's own Pixels dice. From here on the tray's chips
   * step aside: they throw their dice and the roll appears, with every rule
   * and every bit of the look unchanged.
   */
  private async _connectPhysicalDice(): Promise<void> {
    if (!this.features.dice || !isPhysicalDiceSupported()) return;
    if (!this.identity) {
      await this.openIdentityModal();
      if (!this.identity) return;
    }
    try {
      if (!this._pixels) {
        const { PixelsLink } = await import('../dice/pixelsLink.ts');
        this._pixels = new PixelsLink({
          onRoll: (outcome) => {
            // The dice decided; whisper still applies to what you throw next.
            void this._emitRoll(outcome.formula, outcome, this._diceTray?.isWhispering ?? false, true);
          },
          onCollecting: (count) => this._diceTray?.setCollecting(count),
          onDiceChanged: (dice) => this._diceTray?.setPhysicalDice(dice.map((d) => ({ id: d.id, name: d.name }))),
        });
      }
      await this._pixels.addDie();
    } catch {
      // A cancelled chooser, a die that would not connect, a browser that said
      // no: nothing to report but the tray staying as it was.
    }
  }
  private _pixels: import('../dice/pixelsLink.ts').PixelsLink | null = null;

  /** The one path a roll takes, whether it was tapped or thrown. */
  private async _emitRoll(label: string, outcome: RollOutcome, whisper: boolean, physical: boolean): Promise<void> {
    if (!this.features.dice) return;
    if (!this.identity) {
      await this.openIdentityModal();
      if (!this.identity) return;
    }
    const rollId = generateId();
    this.guest.send({
      type: 'dice_roll',
      playerId: this.playerId,
      clientId: this.clientId,
      rollId,
      label,
      roll: outcome,
      whisper,
      ...(physical ? { physical: true } : {}),
    });
    // A whisper is never relayed, so this local draw is the only one there is —
    // and a whisper always shows in full, because the table cannot show it.
    this._showDice(whisper ? 'full' : this._diceRollerDetail, {
      rollId,
      label,
      outcome,
      rollerKey: this.playerId,
      rollerName: this.identity.characterName || this.identity.playerName || 'You',
      rollerColor: this.identity.color,
      whisper,
    });
  }

  /** Policy says how much; this device may always say less. */
  private _showDice(detail: DiceDetail, show: import('../rendering/DiceLayer.ts').DiceShow): void {
    show.celebrate = this._diceCelebrate;
    const effective = reduceDetail(detail, getDiceDetailPreference());
    if (effective === 'full') this._diceLayer?.showFull(show);
    else if (effective === 'line') this._diceLayer?.showLine(show);
  }

  private _emitPing(x: number, y: number): void {
    this.guest.send({ type: 'player_ping', pingId: generateId(), playerId: this.playerId, clientId: this.clientId, x, y });
  }

  /** Pop the roll-for-initiative prompt; send the value back to the GM if the
   *  player types one. Identity is required so the GM can colour + name the card.
   *  Suppressed in GM preview mode. */
  private async _handleInitiativeCall(message?: string): Promise<void> {
    if (this._isPreviewMode()) return;
    if (!this.identity) {
      await this.openIdentityModal();
      if (!this.identity) return;
    }
    const value = await this._initiativeRollModal.open(message, this.identity.color);
    if (!value) return;
    this.guest.send({ type: 'initiative_roll', playerId: this.playerId, clientId: this.clientId, value });
  }

  private _refreshIdentityButton(): void {
    const btn = document.querySelector<HTMLButtonElement>('#player-identity-btn');
    if (!btn) return;
    const dot = btn.querySelector<HTMLElement>('.player-identity-dot');
    const label = btn.querySelector<HTMLElement>('.player-identity-label');
    if (this.identity) {
      if (dot) dot.style.background = this.identity.color;
      // Character name first — the in-fiction handle. Fall back to the player's
      // own name only when the character is blank. The GM Players panel shows
      // both, which is the canonical place to look up either one.
      if (label) label.textContent = this.identity.characterName || this.identity.playerName || 'You';
      btn.classList.remove('player-identity-btn--prompting');
    } else {
      if (dot) dot.style.background = 'transparent';
      if (label) label.textContent = 'Who are you?';
      btn.classList.add('player-identity-btn--prompting');
    }
  }

  // ─── Message handling ─────────────────────────────────────────────────────

  private handleMessage(msg: GMMessage, mapBlob?: ArrayBuffer): void {
    // First message via BroadcastChannel proves we're a same-browser session;
    // refresh preview-mode UI gating idempotently every time.
    this._refreshPreviewModeUi();

    // ── Sequence-number deduplication ────────────────────────────────────────
    // Local player windows receive every broadcast twice: once via the fast
    // BroadcastChannel (sub-ms) and once via PeerJS (~50-200ms later).
    // The first delivery (BC) is canonical.  When the PeerJS copy arrives we
    // recognise the seq and drop it before any state is touched.
    const seq = (msg as unknown as Record<string, unknown>)['_seq'];
    if (typeof seq === 'number') {
      if (this.seenSeqs.has(seq)) return; // duplicate — already handled via BC
      this.seenSeqs.add(seq);
      // Trim the set so it doesn't grow without bound over a long session.
      if (this.seenSeqs.size > 200) {
        const sorted = [...this.seenSeqs].sort((a, b) => a - b);
        this.seenSeqs = new Set(sorted.slice(-100));
      }
    }

    switch (msg.type) {
      case 'full_state': {
        // Resend identify on every full_state so the GM gets us even if the
        // on-connect send was lost or arrived before the GM was ready. Cheap
        // and idempotent — registry.identify is an upsert. Doesn't fire if
        // we have no identity yet (modal is then handling first introduction).
        if (this.identity) this._sendIdentify();
        this.currentMapId   = msg.payload.map?.id ?? null;
        this.currentMarkers = msg.payload.markers ?? [];
        this.sbSlots        = msg.payload.audio?.slots ?? [];
        // v2.16.100 — videos now ride in full_state, so a fresh window /
        // preview / pop-out gets them on connect (not only via the discrete
        // textmap_videos message, which could miss the timing).
        this._textMapVideos?.setVideos(msg.textMapVideos ?? []);
        this._textMapAlt?.setItems(msg.textMapAlt ?? []);
        // v2.18 — StarMap: pre-warm the SSE view when the pack has one, and enter
        // StarMap mode if the ACTIVE map is one (late joiner / reconnect).
        // v2.18.10 — prewarm ONLY when the active map is not itself a StarMap: this same
        // full_state carries the one we are about to show, and mounting it presetless first only
        // costs a wasted frame (and used to cost the right view entirely).
        if (msg.starMapPrewarm && !msg.starMap) this._starMap?.preload(msg.starMapPrewarm);
        if (msg.starMap) this._enterStarMap(msg.starMap);
        else if (this._starMapActive) this._exitStarMap();
        // v2.14.17 — pick up calibration + dimensions for the
        // player-side grid renderer.
        // v2.14.18 — gridOffsetX/Y travel in the same payload.
        if (msg.mapPixelsPerSquare !== undefined) this.mapPixelsPerSquare = msg.mapPixelsPerSquare;
        if (msg.mapImageWidth      !== undefined) this.mapImageWidth      = msg.mapImageWidth;
        if (msg.mapImageHeight     !== undefined) this.mapImageHeight     = msg.mapImageHeight;
        if (msg.gridOffsetX        !== undefined) this.gridOffsetX        = msg.gridOffsetX;
        if (msg.gridOffsetY        !== undefined) this.gridOffsetY        = msg.gridOffsetY;
        if (msg.gridColor          !== undefined) this.gridColor          = msg.gridColor;
        if (mapBlob) {
          this.lastFog     = msg.payload.fog ?? { polygons: [] };
          // v2.14.54 — composite payload requires local rasterise.
          // Wrap in IIFE since handleMessage itself is sync.
          const compositeForFs = msg.composite;
          const fogForFs       = msg.payload.fog;
          void (async () => {
            const { renderable, backing } = await this._maybeRasterizeComposite(mapBlob, compositeForFs);
            this.lastMapBlob = renderable;
            await this.renderer.loadMap(renderable, fogForFs, backing);
          })();
        } else {
          this.renderer.updateFog(msg.payload.fog);
          this.lastFog = msg.payload.fog ?? { polygons: [] };
        }
        if (msg.payload.filter) this.lastFilter = msg.payload.filter;
        if (msg.payload.view) {
          this._broadcastView = msg.payload.view;
          this.lastView = msg.payload.view;
        }
        this.renderer.setFilter(msg.payload.filter);
        this._applyMarkerLayerFilter();
        this._applyEffectiveView();
        void (async () => {
          if (msg.iconData?.length)         await this._decodeIconData(msg.iconData);
          if (msg.soundboardAssets?.length) this._cacheSoundboardAssets(msg.soundboardAssets);
          if (msg.soundboardActive?.length) this._applySoundboardActive(msg.soundboardActive);
          this.markerSprites.render(this.currentMarkers, this.playerIconCache);
          this._updateMarkerOverlay();
          this.renderer.markMarkersDirty();
        })();
        this.setStatus('');
        break;
      }

      case 'map_change': {
        this.currentMapId = msg.payload.id;
        // v2.18 — any ordinary map ends StarMap mode (the SSE view stays warm, hidden).
        if (this._starMapActive) this._exitStarMap();
        // Abandon any in-flight ruler — its anchor belonged to the old map.
        this._measureTool?.cancel();
        if (msg.markers !== undefined) this.currentMarkers = msg.markers;
        if (msg.audio?.slots)          this.sbSlots = msg.audio.slots;
        // v2.14.17 — refresh calibration + dimensions for the new map.
        // v2.14.18 — and the grid offset.
        if (msg.mapPixelsPerSquare !== undefined) this.mapPixelsPerSquare = msg.mapPixelsPerSquare;
        if (msg.mapImageWidth      !== undefined) this.mapImageWidth      = msg.mapImageWidth;
        if (msg.mapImageHeight     !== undefined) this.mapImageHeight     = msg.mapImageHeight;
        if (msg.gridOffsetX        !== undefined) this.gridOffsetX        = msg.gridOffsetX;
        if (msg.gridOffsetY        !== undefined) this.gridOffsetY        = msg.gridOffsetY;
        if (msg.gridColor          !== undefined) this.gridColor          = msg.gridColor;
        // Stop any playing audio from the previous map
        this._stopAllSoundboard();
        this._stopAllPositional();
        // Drop any in-flight tracker visuals from the previous map
        this._trackerScans = [];
        this._trackerBlobs = [];
        // v2.12.x — animated map two-phase delivery: nothing UI-side
        // to do during the wait. The snapshot is on screen from this
        // map_change handler below; the video_bundle that follows
        // just swaps the texture invisibly when ready. Faff overlay
        // would only obscure the static map the GM sees behind it.
        if (mapBlob) {
          const fog    = msg.fog    ?? { polygons: [] };
          const filter = msg.filter;
          const view   = msg.view;
          const blob   = mapBlob;
          this.lastMapBlob = blob;
          this.lastFog     = fog;
          if (filter) this.lastFilter = filter;
          if (view)   this.lastView   = view;
          // Track this map load on _pendingMapLoad so a follow-up
          // handout_reveal awaits it before swapping the texture
          // again. Without this serialisation the reveal can race
          // against the still-decoding starting-frame load and the
          // animation visibly "snaps to end".
          const prior = this._pendingMapLoad;
          const composite = msg.composite;
          this._pendingMapLoad = (async () => {
            await prior;
            if (msg.iconData?.length)       await this._decodeIconData(msg.iconData);
            if (msg.soundboardActive?.length) this._applySoundboardActive(msg.soundboardActive);
            // v2.14.54 — rasterise composite payload locally if
            // present. Cache the rendered blob (not the packed
            // bundle) so context-recovery can re-feed instantly.
            const { renderable, backing } = await this._maybeRasterizeComposite(blob, composite);
            this.lastMapBlob = renderable;
            await this.runTransition(msg.transition, async () => {
              await this.renderer.loadMap(renderable, fog, backing);
              if (filter) this.renderer.setFilter(filter);
              this._applyMarkerLayerFilter();
              if (view) {
                // v2.14.18 — fresh map = fresh broadcast bounds.
                // Drop any zoom override so the player starts on the
                // GM-prescribed view of the new map.
                this._broadcastView = view;
                this._localOverride = null;
                this._applyEffectiveView();
              }
            });
          })();
        }
        break;
      }

      case 'handout_reveal': {
        // Reveal animation for a handout. Routes through the
        // renderer's IN-SCENE reveal overlay so the EffectComposer
        // post-effect filter runs over BOTH halves of the reveal
        // (snapshot of unsullied starting frame + underlying final
        // frame). Map→map transitions stay on the existing DOM-overlay
        // path — different filter semantics by design.
        if (!mapBlob) break;
        if (msg.mapId !== this.currentMapId) break; // stale message
        const finalBlob = mapBlob;
        const startBlob = this.lastMapBlob; // cached starting frame
        const fog    = this.lastFog;
        const filter = this.lastFilter;
        const view   = this.lastView;
        this.lastMapBlob = finalBlob;
        // Serialise behind any in-flight map_change load so the
        // reveal's applyChange doesn't race against the still-
        // decoding starting-frame texture. Without this the
        // underlying canvas state is undefined during def.play and
        // the animation visibly snaps to end. _pendingMapLoad chains
        // the new load AFTER the previous one resolves.
        const prior = this._pendingMapLoad;
        this._pendingMapLoad = (async () => {
          await prior;
          let preSnap: ImageBitmap | undefined;
          if (startBlob) {
            try {
              preSnap = await createImageBitmap(new Blob([startBlob], { type: 'image/png' }));
            } catch { preSnap = undefined; }
          }
          // Open an in-scene reveal overlay sized to the WebGL
          // canvas's CSS pixels. The TransitionEngine paints onto
          // this offscreen canvas; the renderer pulls those pixels
          // into a CanvasTexture on a plane inside the EffectComposer
          // pipeline. Filter applies. The overlay is torn down when
          // the transition finishes.
          const rendererCanvas = document.querySelector<HTMLCanvasElement>('#renderer-canvas')!;
          const revealCanvas = this.renderer.beginRevealOverlay(
            rendererCanvas.clientWidth  || window.innerWidth,
            rendererCanvas.clientHeight || window.innerHeight,
          );
          try {
            await this.runTransition(msg.transition, async () => {
              await this.renderer.loadMap(finalBlob, fog);
              if (filter) this.renderer.setFilter(filter);
              if (view) {
                // Handout reveal stays on the same map_id — preserve
                // any in-flight player override; just refresh bounds
                // in case the GM updated the broadcast crop alongside.
                this._broadcastView = view;
                this._applyEffectiveView();
              }
            }, preSnap, revealCanvas);
          } finally {
            this.renderer.endRevealOverlay();
          }
        })();
        break;
      }

      case 'video_bundle': {
        // v2.12.x animated-map phase 2 — we already have a static
        // snapshot from the preceding map_change; this message
        // carries the full video bytes. Swap the renderer texture
        // from still image to VideoTexture by re-loading via
        // renderer.loadMap with the video buffer. Skip if the GM
        // has already moved on to a different map.
        //
        // Note: same-browser peers (player popups, same-machine
        // projector) never reach this branch because Host
        // suppresses video_bundle over LocalChannel — those peers
        // stay on the static snapshot from the preceding map_change.
        // Only remote PeerJS peers receive the bundle and animate.
        if (!mapBlob) break;
        if (msg.mapId !== this.currentMapId) break;
        const videoBuf = mapBlob;
        this.lastMapBlob = videoBuf;
        void this.renderer.loadMap(videoBuf, this.lastFog).then(() => {
          if (this.lastFilter) this.renderer.setFilter(this.lastFilter);
          // video_bundle is a static→video swap on the SAME map, so
          // keep any active override and re-apply it via the effective
          // view path.
          this._applyEffectiveView();
        });
        break;
      }

      case 'filter_update': {
        this.lastFilter = msg.payload;
        this.renderer.setFilter(msg.payload);
        this._applyMarkerLayerFilter();
        break;
      }

      case 'fog_update': {
        // Safety net: discard fog updates for a different map.
        // With seq deduplication the BC+PeerJS race is already prevented, but
        // this guard catches any edge case where mapId doesn't match.
        if (msg.mapId && msg.mapId !== this.currentMapId) break;
        this.lastFog = msg.payload;
        this.renderer.updateFog(msg.payload);
        break;
      }


      case 'view_update': {
        // v2.14.18 — GM's view becomes the new broadcast bounds.
        // Any active player-side zoom override is preserved and
        // re-clamped to fit the new bounds inside _applyEffectiveView
        // (so panning/cropping by the GM doesn't snap the player out
        // of their local zoom). Backdrop, marker re-render, and grid
        // refresh all happen inside _applyEffectiveView.
        this._broadcastView = msg.payload;
        this._applyEffectiveView();
        break;
      }

      case 'map_meta_update': {
        // v2.14.28 — GM rebroadcasts map metadata after recalibration.
        // Without this handler, the player kept using the old pps so
        // its map-relative grid drew at the OLD spacing even though
        // the asset's calibration had changed. (The map image still
        // looked right because the texture was unchanged.) Update the
        // cached metadata and redraw the grid.
        if (msg.mapPixelsPerSquare !== undefined) this.mapPixelsPerSquare = msg.mapPixelsPerSquare;
        if (msg.mapImageWidth      !== undefined) this.mapImageWidth      = msg.mapImageWidth;
        if (msg.mapImageHeight     !== undefined) this.mapImageHeight     = msg.mapImageHeight;
        if (msg.gridOffsetX        !== undefined) this.gridOffsetX        = msg.gridOffsetX;
        if (msg.gridOffsetY        !== undefined) this.gridOffsetY        = msg.gridOffsetY;
        if (msg.gridColor          !== undefined) this.gridColor          = msg.gridColor;
        this._refreshPlayerGrid();
        break;
      }

      case 'marker_update': {
        this.currentMarkers = msg.payload;
        void (async () => {
          if (msg.iconData?.length) await this._decodeIconData(msg.iconData);
          this.markerSprites.render(this.currentMarkers, this.playerIconCache);
          this._updateMarkerOverlay();
          this.renderer.markMarkersDirty();
          // v2.17.34 — a marker (or its image) may back a linked initiative
          // card; re-render the rail when a marker's IDENTITY (name/icon/colour)
          // changes so the card stays current — but not on position-only drags
          // (the FLIP animation would churn).
          const sig = this.currentMarkers.map((m) => `${m.id}:${m.label}:${m.icon}:${m.color}`).join('|');
          if (sig !== this._markerIdentitySig) {
            this._markerIdentitySig = sig;
            this.initiativeRail?.refresh();
          }
        })();
        break;
      }

      case 'positional_play': {
        // Reuse the same binary-or-dataUrl pattern as soundboard_play
        if (mapBlob) {
          const url = URL.createObjectURL(new Blob([mapBlob], { type: 'audio/mpeg' }));
          this._posAssetUrls.set(msg.assetId, url);
          this._posPlay(msg.markerId, url, msg.loop, msg.volume);
        } else {
          if (msg.dataUrl) this._posAssetUrls.set(msg.assetId, msg.dataUrl);
          const url = this._posAssetUrls.get(msg.assetId);
          if (url) this._posPlay(msg.markerId, url, msg.loop, msg.volume);
        }
        break;
      }

      case 'positional_volume': {
        const el = this._posAudioEls.get(msg.markerId);
        if (el) el.volume = Math.max(0, Math.min(1, msg.volume));
        break;
      }

      case 'positional_stop': {
        const el = this._posAudioEls.get(msg.markerId);
        if (el) { el.pause(); el.currentTime = 0; }
        this._posAudioEls.delete(msg.markerId);
        break;
      }

      case 'positional_mute_all': {
        // Pause / resume every positional source so loops survive the
        // round-trip cleanly. Soundboard slots are unaffected — they
        // ride the separate soundboard_mute_all channel. The flag also
        // gates the tracker ping so an active scan keeps animating
        // silently when marker audio is muted.
        this._posMutedAll = msg.muted;
        if (msg.muted) {
          this._posPausedByMute.clear();
          for (const [id, el] of this._posAudioEls.entries()) {
            if (!el.paused) {
              this._posPausedByMute.add(id);
              el.pause();
            }
          }
        } else {
          for (const id of this._posPausedByMute) {
            const el = this._posAudioEls.get(id);
            if (el) void el.play().catch(() => { /* autoplay blocked */ });
          }
          this._posPausedByMute.clear();
        }
        break;
      }

      case 'audio_update': {
        // Slot configuration updated (assign/unassign, loop, volume)
        this.sbSlots = msg.payload.slots ?? [];
        // Stop any slots that are no longer assigned
        for (const [slotId, el] of this.sbAudioEls.entries()) {
          const slot = this.sbSlots.find((s) => s.id === slotId);
          if (!slot?.assetId) { el.pause(); this.sbAudioEls.delete(slotId); }
        }
        break;
      }

      case 'soundboard_play': {
        if (mapBlob) {
          // Audio delivered as binary chunks — create an object URL for it.
          const objUrl = URL.createObjectURL(new Blob([mapBlob], { type: 'audio/mpeg' }));
          this.sbAssetUrls.set(msg.assetId, objUrl);
          this._sbPlay(msg.slotId, objUrl, msg.loop, msg.volume);
        } else {
          // Inline dataUrl (local BroadcastChannel) or cached replay.
          if (msg.dataUrl) this.sbAssetUrls.set(msg.assetId, msg.dataUrl);
          const url = this.sbAssetUrls.get(msg.assetId);
          if (url) this._sbPlay(msg.slotId, url, msg.loop, msg.volume);
        }
        break;
      }

      case 'soundboard_stop': {
        // v2.16.50 — slot may be on either engine; stop both paths.
        if (this._sbLoopSlots.has(msg.slotId)) {
          this._sbLoopPlayer?.stop(msg.slotId);
          this._sbLoopSlots.delete(msg.slotId);
        }
        const el = this.sbAudioEls.get(msg.slotId);
        if (el) { el.pause(); el.currentTime = 0; }
        break;
      }

      case 'soundboard_asset': {
        if (mapBlob) {
          const objUrl = URL.createObjectURL(new Blob([mapBlob], { type: 'audio/mpeg' }));
          this.sbAssetUrls.set(msg.assetId, objUrl);
        } else if (msg.dataUrl) {
          this.sbAssetUrls.set(msg.assetId, msg.dataUrl);
        }
        break;
      }

      case 'soundboard_volume': {
        // v2.16.50 — route to whichever engine owns the slot.
        if (this._sbLoopSlots.has(msg.slotId)) {
          this._sbLoopPlayer?.setVolume(msg.slotId, msg.volume);
        } else {
          const el = this.sbAudioEls.get(msg.slotId);
          // v2.17.7 — perceptual taper on the fader position (see volumeCurve.ts).
          if (el) el.volume = perceptualVolume(msg.volume);
        }
        break;
      }

      case 'soundboard_mute_all': {
        this._applyMute(msg.muted);
        break;
      }

      case 'view_placeholder': {
        if (msg.target !== 'player') break;
        this.viewer.showFaffOverlay(msg.show, msg.message);
        break;
      }

      case 'tracker_scan': {
        this._trackerScans.push({
          startTime: performance.now(),
          centre:    msg.centre,
          range:     msg.range,
          speedSecs: msg.speedSecs,
          colour:    msg.colour,
        });
        this._playTrackerPing(msg.audioAssetId, msg.audioDataUrl, msg.audioVolume);
        this._kickTrackerRaf();
        break;
      }

      case 'tracker_blob': {
        // fadeMs=0 is the GM's "audio-only return" sentinel — skip the visual blob.
        if (msg.fadeMs > 0) {
          this._trackerBlobs.push({
            startTime: performance.now(),
            sourceId:  msg.sourceId,
            position:  msg.position,
            fadeMs:    msg.fadeMs,
            mode:      msg.mode,
            colour:    msg.colour,
          });
          this._kickTrackerRaf();
        }
        this._playTrackerPing(msg.audioAssetId, msg.audioDataUrl, msg.audioVolume);
        break;
      }

      case 'dice_show': {
        // v2.19 — our OWN roll comes back as an echo; we drew it when we rolled
        // it, so that the tap feels instant. Everyone else's is drawn here.
        if (msg.rollerClientId && msg.rollerClientId === this.clientId) break;
        this._showDice(msg.detailOthers, {
          rollId: msg.rollId,
          label: msg.label,
          outcome: msg.roll,
          rollerKey: msg.fromPlayerId ?? 'gm',
          rollerName: msg.fromName,
          rollerColor: msg.fromColor,
          whisper: msg.whisper,
          ...(msg.dieBase ? { skin: { base: msg.dieBase, ...(msg.dieInk ? { ink: msg.dieInk } : {}) } } : {}),
        });
        break;
      }

      case 'ping_show': {
        // v2.17 Player Voice — a ping relayed by the GM; pulse it on our map.
        this.pingLayer?.add({ id: msg.pingId, x: msg.x, y: msg.y, color: msg.color, name: msg.name });
        break;
      }

      case 'player_features': {
        // v2.17 Player Voice — GM toggled which interactions are allowed.
        if (typeof msg.pings === 'boolean')          this.features.pings          = msg.pings;
        if (typeof msg.messaging === 'boolean')      this.features.messaging      = msg.messaging;
        if (typeof msg.movableMarkers === 'boolean') this.features.movableMarkers = msg.movableMarkers;
        if (typeof msg.dice === 'boolean')          this.features.dice           = msg.dice;
        if (msg.diceRollerDetail) this._diceRollerDetail = msg.diceRollerDetail;
        if (msg.diceCelebrate) this._diceCelebrate = msg.diceCelebrate;
        if (msg.diceSet || typeof msg.dice === 'boolean') {
          this._diceTray?.update(msg.diceSet, this.features.dice);
        }
        // v2.17.10 — adopt the GM's measurement scale.
        if (typeof msg.measureUnitValue === 'number' && msg.measureUnitValue > 0) this._measureUnitValue = msg.measureUnitValue;
        if (typeof msg.measureUnitSuffix === 'string') this._measureUnitSuffix = msg.measureUnitSuffix;
        break;
      }

      case 'player_roster': {
        // v2.17 Player Voice — who else is in the session (message targets).
        this.roster = msg.players;
        break;
      }

      case 'player_markers': {
        // v2.17 Player Voice — player tokens placed on the active map. Icon
        // data URLs travel separately via player_icon_update (they'd otherwise
        // blow past the DataChannel limit), so we merge the cache in here.
        this._lastPlayerMarkers = msg.markers;
        this._reRenderPlayerMarkers();
        // v2.16.25 self-heal — any marker the GM says has an icon but we
        // don't have cached locally → request it. Covers dropped chunked
        // deliveries + tokens that arrived before the layer was ready.
        for (const m of msg.markers) {
          if (m.hasIcon && !this._playerIcons.has(m.playerId)) {
            this._requestMissingIcon(m.playerId);
          }
        }
        // Player's own icon may have changed (or just arrived) — refresh the
        // identity pill if we're currently identified.
        this._refreshIdentityButton();
        break;
      }

      case 'player_icon_update': {
        // PeerJS path → mapBlob carries the assembled PNG bytes (chunked over
        // the wire like maps + soundboard). BroadcastChannel path → msg.dataUrl
        // carries the inline data URL directly. Either way we cache something
        // an <img src=…> can consume.
        let url: string | undefined;
        if (mapBlob) {
          url = URL.createObjectURL(new Blob([mapBlob], { type: 'image/png' }));
        } else if (msg.dataUrl) {
          url = msg.dataUrl;
        }
        const prev = this._playerIcons.get(msg.playerId);
        if (url) this._playerIcons.set(msg.playerId, url);
        else     this._playerIcons.delete(msg.playerId);
        // Revoke the previous object URL to release its bytes — but only if it
        // was a blob:// URL we created (don't revoke an inline data: URL).
        if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
        // Clear any pending self-heal request for this player.
        const pending = this._pendingIconRequests.get(msg.playerId);
        if (pending) { clearTimeout(pending); this._pendingIconRequests.delete(msg.playerId); }
        this._reRenderPlayerMarkers();
        // v2.16.72 — an icon may arrive AFTER the initiative state; refresh
        // the rail so the portrait fills in for the matching player card.
        this.initiativeRail?.refresh();
        if (msg.playerId === this.playerId) this._refreshIdentityButton();
        break;
      }

      case 'initiative_update': {
        // v2.17 Player Voice — atmospheric initiative rail update.
        this.initiativeRail?.setState(msg.state);
        // v2.16.64 — if the GM ended combat (tracker visibility flipped
        // off OR deck went empty) while we still had a roll prompt
        // open, close the prompt rather than leaving the player staring
        // at an orphaned modal.
        if (!msg.state.visible || msg.state.activeDeck.length === 0) {
          this._initiativeRollModal.cancel();
        }
        break;
      }

      case 'annotate_clocks': {
        // v2.16.76 — mirror the GM's progress clocks (read-only).
        this._annotateClocks?.setClocks(msg.clocks);
        break;
      }
      case 'annotate_stroke': {
        // v2.16.77 — append a whiteboard stroke from the GM.
        this._annotateBoard?.addStroke(msg.stroke);
        break;
      }
      case 'annotate_clear': {
        this._annotateBoard?.clear();
        break;
      }
      case 'annotate_timers': {
        // v2.16.78 — mirror the GM's timers (read-only; ticks locally).
        this._annotateTimers?.setTimers(msg.timers);
        break;
      }
      case 'annotate_notes': {
        // v2.16.80 — mirror the GM's player-visible notes (read-only).
        this._annotateNotes?.setNotes(msg.notes);
        break;
      }
      case 'textmap_videos': {
        // v2.16.91 — live YouTube videos for the active text-map.
        this._textMapVideos?.setVideos(msg.videos);
        break;
      }
      case 'starmap_show': {
        // v2.18 — the GM activated a StarMap: show the live SSE view (transition
        // out of the previous map first, like any map cut), pause the map
        // renderer, and restrict tools to Ping. Sent WHERE map_change would go.
        this.currentMapId = null; // no StoredMap texture is on screen now
        this._measureTool?.cancel();
        this._stopAllSoundboard();
        this._stopAllPositional();
        this._trackerScans = [];
        this._trackerBlobs = [];
        const target = msg.payload;
        void this.runTransition(undefined, async () => { this._enterStarMap(target); });
        break;
      }
      case 'textmap_alt': {
        // v2.17.27 — handout text/image alt for the screen-reader region.
        this._textMapAlt?.setItems(msg.items);
        break;
      }
      case 'video_playback': {
        // v2.16.95 — follow the GM's play/pause/seek/volume for one video.
        this._textMapVideos?.applyPlayback({
          id: msg.id, videoId: msg.videoId, state: msg.state,
          seconds: msg.seconds, volume: msg.volume,
        });
        break;
      }

      case 'initiative_call': {
        // v2.17 Player Voice — GM asked everyone to roll.
        void this._handleInitiativeCall(msg.message);
        break;
      }

      case 'message_deliver': {
        // v2.17 Player Voice — a message addressed to us (GM reply or another
        // player). Broadcast reaches everyone; only show ours, and never in
        // preview mode (the GM popup isn't a real player so messages aren't
        // for it).
        if (msg.toPlayerId === this.playerId && !this._isPreviewMode()) {
          this._msgToasts?.show({ messageId: msg.messageId, fromName: msg.fromName, fromColor: msg.fromColor, text: msg.text });
        }
        break;
      }
    }
  }

  /** Cache the tracker ping audio if a fresh dataUrl arrived, and fire a one-shot. */
  private _playTrackerPing(assetId: string | undefined, dataUrl: string | undefined, volume: number | undefined): void {
    if (!assetId) return;
    if (dataUrl) this._trackerAudioUrls.set(assetId, dataUrl);
    const url = this._trackerAudioUrls.get(assetId);
    if (!url) return;
    if (this.sbMuted || this._posMutedAll) return; // respect player mute + GM marker-mute
    const a = new Audio(url);
    a.volume = Math.max(0, Math.min(1, volume ?? 0.8));
    void a.play().catch(() => { /* autoplay-policy ignore */ });
  }

  // ─── Motion-tracker overlay ───────────────────────────────────────────────

  /** Drive the tracker overlay redraw loop. Idempotent; self-terminates when
   *  there are no rings expanding and no blobs still fading. */
  private _kickTrackerRaf(): void {
    if (this._trackerRafId !== null) return;
    const tick = (now: number) => {
      // Prune expired
      this._trackerScans = this._trackerScans.filter((s) => now - s.startTime < s.speedSecs * 1000);
      this._trackerBlobs = this._trackerBlobs.filter((b) => now - b.startTime < b.fadeMs);

      const overlay: MotionOverlay = {
        now,
        scans: this._trackerScans,
        blobs: this._trackerBlobs,
      };
      this.markerTexture.render(this.currentMarkers, this.playerIconCache, overlay);
      this.markerSprites.render(this.currentMarkers, this.playerIconCache);
      this._updateMarkerOverlay();
      this.renderer.markMarkersDirty();

      if (this._trackerScans.length > 0 || this._trackerBlobs.length > 0) {
        this._trackerRafId = requestAnimationFrame(tick);
      } else {
        this._trackerRafId = null;
        // Final draw with no overlay so the motion texture is clean.
        this.markerTexture.render(this.currentMarkers, this.playerIconCache);
        this.renderer.markMarkersDirty();
      }
    };
    this._trackerRafId = requestAnimationFrame(tick);
  }

  // ─── Soundboard ───────────────────────────────────────────────────────────

  private _sbPlay(slotId: string, dataUrl: string, loop: boolean, volume: number): void {
    // v2.16.50 — hybrid playback: loops go through Web Audio for
    // gapless MP3 looping; one-shots stay on HTMLAudioElement.
    if (loop) {
      // Sweep up any HTMLAudio that was hosting this slot before.
      const html = this.sbAudioEls.get(slotId);
      if (html) { html.pause(); html.currentTime = 0; }
      void this._sbPlayLoop(slotId, dataUrl, volume);
      return;
    }
    // Non-loop / one-shot — clear any prior loop on this slot first.
    if (this._sbLoopSlots.has(slotId)) {
      this._sbLoopPlayer?.stop(slotId);
      this._sbLoopSlots.delete(slotId);
    }
    let el = this.sbAudioEls.get(slotId);
    if (!el) {
      el = new Audio();
      this.sbAudioEls.set(slotId, el);
    }
    if (el.src !== dataUrl) {
      el.pause();
      el.src = dataUrl;
    }
    el.currentTime = 0;
    el.loop   = false;
    // v2.17.7 — perceptual taper on the fader position (see volumeCurve.ts).
    el.volume = perceptualVolume(volume);
    el.muted  = this.sbMuted;
    void el.play().catch(() => {
      this._scheduleAudioResume();
    });
  }

  /** v2.16.50 — Web Audio path for looping soundboard slots. Decodes
   *  the source once (cached by assetId-equivalent dataUrl key) and
   *  loops gaplessly. */
  private async _sbPlayLoop(slotId: string, dataUrl: string, volume: number): Promise<void> {
    if (!this._sbLoopPlayer) {
      const { WebAudioLoopPlayer } = await import('../audio/WebAudioLoopPlayer.ts');
      if (!this._sbLoopPlayer) this._sbLoopPlayer = new WebAudioLoopPlayer();
    }
    this._sbLoopSlots.add(slotId);
    await this._sbLoopPlayer.play(
      slotId,
      // dataUrl is unique per asset (blob: or data:) so it works as a
      // cache key without us threading the assetId through the soundboard
      // wire protocol.
      dataUrl,
      async () => {
        const resp = await fetch(dataUrl);
        return resp.arrayBuffer();
      },
      volume,
    );
    this._sbLoopPlayer.setMuted(this.sbMuted);
  }

  private _stopAllSoundboard(): void {
    // v2.12.1 bug fix — must fully tear down, not just pause. Pausing
    // alone leaves the elements in `sbAudioEls`, and the unmute path
    // (and `_scheduleAudioResume`) iterate every entry and resume any
    // that are paused — which would replay every slot ever heard on
    // every prior map in one go after a few map swaps while muted.
    // Clearing the maps matches the symmetric behaviour of
    // `_stopAllPositional` and ensures `_applySoundboardActive` for
    // the new map starts from a clean slate.
    for (const el of this.sbAudioEls.values()) {
      el.pause();
      el.currentTime = 0;
      el.removeAttribute('src');
      try { el.load(); } catch { /* harmless on browsers without media reset */ }
    }
    this.sbAudioEls.clear();
    this._sbPausedByMute.clear();
    // v2.16.50 — also tear down any loop-engine slots so a map switch
    // starts from silence on both engines.
    this._sbLoopPlayer?.stopAll();
    this._sbLoopSlots.clear();
  }

  private _cacheSoundboardAssets(assets: { assetId: string; dataUrl?: string }[]): void {
    for (const { assetId, dataUrl } of assets) {
      if (dataUrl && !this.sbAssetUrls.has(assetId)) {
        this.sbAssetUrls.set(assetId, dataUrl);
      }
      // Assets without a dataUrl here arrive via binary soundboard_asset messages below.
    }
  }

  private _applySoundboardActive(active: SoundboardAudioData[]): void {
    for (const item of active) {
      // dataUrl may be absent (stripped for chunked binary delivery).
      // Play from cache if available; individual soundboard_play messages follow.
      if (item.dataUrl) this.sbAssetUrls.set(item.assetId, item.dataUrl);
      const url = this.sbAssetUrls.get(item.assetId);
      if (url) this._sbPlay(item.slotId, url, item.loop, item.volume);
    }
  }

  private _scheduleAudioResume(): void {
    if (this._audioResumeScheduled) return;
    this._audioResumeScheduled = true;
    const resume = () => {
      this._audioResumeScheduled = false;
      for (const el of this.sbAudioEls.values()) {
        if (el.paused && el.src) void el.play().catch(() => {});
      }
      for (const el of this._posAudioEls.values()) {
        if (el.paused && el.src) void el.play().catch(() => {});
      }
    };
    document.addEventListener('click',   resume, { once: true });
    document.addEventListener('keydown', resume, { once: true });
  }

  private _toggleMute(): void {
    // v2.16.42 — PiP iframes can't be unmuted (audio is by-design
    // silent in the preview; the GM uses the popped-out window when
    // they actually need sound).
    if (this._isPip) return;
    this._applyMute(!this.sbMuted);
    this.viewer.showMuteIndicator(this.sbMuted);
    // v2.16.44 — let other Mappadux tabs / windows on this machine
    // know our audio state changed. Claim wins; release just stops
    // heartbeating.
    if (this.sbMuted) this._audioCoord?.release();
    else              this._audioCoord?.claim();
  }

  /**
   * Apply a mute/unmute transition by pausing/resuming the currently
   * playing audio elements rather than just setting `el.muted`. Looping
   * background tracks survive mute → unmute cycles because pause
   * preserves the playback position; setting `el.muted = false` after
   * the element has been silent is unreliable in some browsers, so we
   * pause on mute and explicitly resume on unmute.
   */
  private _applyMute(muted: boolean): void {
    const wasMuted = this.sbMuted;
    this.sbMuted = muted;
    // v2.16.50 — loop-engine slots silence via GainNode (keeps phase),
    // independent of the pause/resume dance the HTMLAudio path needs.
    this._sbLoopPlayer?.setMuted(muted);
    if (muted && !wasMuted) {
      this._sbPausedByMute.clear();
      for (const [slotId, el] of this.sbAudioEls.entries()) {
        if (!el.paused) {
          this._sbPausedByMute.add(slotId);
          el.pause();
        }
      }
      for (const el of this._posAudioEls.values()) el.muted = true;
    } else if (!muted && wasMuted) {
      for (const el of this.sbAudioEls.values())   el.muted = false;
      for (const el of this._posAudioEls.values()) el.muted = false;
      for (const slotId of this._sbPausedByMute) {
        const el = this.sbAudioEls.get(slotId);
        if (el) void el.play().catch(() => { /* autoplay blocked */ });
      }
      this._sbPausedByMute.clear();
    }
  }

  // v2.15 — _showFaffOverlay, _showMuteIndicator, _faffOverlayEl,
  // _muteIndicatorEl all lifted into Viewer. Callers use
  // this.viewer.showFaffOverlay / this.viewer.showMuteIndicator.

  // ─── Positional audio ─────────────────────────────────────────────────────

  private _posPlay(markerId: string, url: string, loop: boolean, volume: number): void {
    let el = this._posAudioEls.get(markerId);
    if (!el) {
      el = new Audio();
      this._posAudioEls.set(markerId, el);
    }
    if (el.src !== url) { el.pause(); el.src = url; }
    el.currentTime = 0;
    el.loop   = loop;
    el.volume = Math.max(0, Math.min(1, volume));
    el.muted  = this.sbMuted;
    el.play().then(
      () => { /* ok */ },
      () => { this._scheduleAudioResume(); },
    );
  }

  private _stopAllPositional(): void {
    for (const el of this._posAudioEls.values()) { el.pause(); el.currentTime = 0; }
    this._posAudioEls.clear();
    this._posAssetUrls.clear();
  }

  // ─── Icon cache ───────────────────────────────────────────────────────────

  private async _decodeIconData(iconData: MarkerIconData[]): Promise<void> {
    await Promise.all(
      iconData
        .filter(({ key }) => !this.playerIconCache.has(key))
        .map(async ({ key, dataUrl }) => {
          try {
            const bmp = await decodeImageBitmap(dataUrl);
            this.playerIconCache.set(key, bmp);
          } catch {
            /* shrug — skip this icon, fallback circle will render */
          }
        }),
    );
  }

  /**
   * Sync the HTML overlay so each marker label sits below its icon in
   * screen px. World coords ↦ screen via the renderer's camera projection,
   * with a small vertical offset for breathing room below the icon body
   * (icon body half-height = 0.025 × m.size world units; PAD_FACTOR
   * margin in the per-marker sprite is on top of that).
   */
  private _updateMarkerOverlay(): void {
    const aspect = this.renderer.mapAspect;
    const scale  = this.renderer.worldToScreenScale();
    const items: OverlayItem[] = [];
    for (const m of this.currentMarkers) {
      if (m.hidden) continue;
      const wx = (m.position.x - 0.5) * aspect;
      const wy = -(m.position.y - 0.5);
      const s  = this.renderer.worldToScreen(wx, wy);
      if (!s) continue;
      const iconAspect = getMarkerAspect(m, this.playerIconCache);
      const halfHWorld = 0.025 * m.size;
      const halfWWorld = halfHWorld * iconAspect;
      items.push({
        id:               m.id,
        anchorX:          s.x,
        anchorY:          s.y,
        iconHalfWidthPx:  halfWWorld * scale.pxPerWorldX,
        iconHalfHeightPx: halfHWorld * scale.pxPerWorldY,
        label: { text: m.label ?? '', visible: !!m.showLabel && !!m.label },
        // No move handle on player — read-only view.
      });
    }
    this.markerOverlay.update(items);
  }

  // ─── Transitions ──────────────────────────────────────────────────────────

  private async runTransition(
    config: TransitionConfig | undefined,
    applyChange: () => Promise<void>,
    /** Optional pre-decoded snapshot for the transition's "before"
     *  state. Handout reveal pathway passes in the raw starting-frame
     *  bitmap so the filter doesn't get baked into the snapshot at
     *  capture time. Map→map transitions leave this undefined and the
     *  engine snapshots the live canvas. */
    preSnapshot?: ImageBitmap,
    /** Optional offscreen canvas the transition should paint onto
     *  instead of the DOM overlay. Handout reveal pathway supplies
     *  the renderer's in-scene reveal-overlay canvas so the filter
     *  applies to BOTH halves of the reveal. Map→map transitions
     *  leave this undefined and paint to the DOM overlay above the
     *  WebGL canvas — outside the filter pipeline. */
    overlayOverride?: HTMLCanvasElement,
  ): Promise<void> {
    const id  = config?.transitionId ?? 'none';
    const def = transitionRegistry.getOrFallback(id);
    const params = config?.params ?? transitionRegistry.defaultParams(id);
    const canvas = document.querySelector<HTMLCanvasElement>('#renderer-canvas')!;
    await this.transitionEngine.run(def, params, canvas, applyChange, preSnapshot, overlayOverride);
  }

  // ─── UI ───────────────────────────────────────────────────────────────────

  private showConnectPanel(): void {
    this.connectPanel.hidden = false;
    this.setStatus('Enter room code to connect');
  }

  private setStatus(msg: string): void {
    // v2.17.20 — route to the quiet (i) activity log instead of a toast over
    // the map. Infer a severity from the text so errors/reconnects tint the
    // twinkle (the old bar had no level on the player side).
    const t = msg.toLowerCase();
    const level: 'ok' | 'warn' | 'error' =
      t.startsWith('error') || t.includes('error') ? 'error'
      : t.includes('reconnect') || t.includes('disconnect') || t.includes('waiting') || t.includes('lost') ? 'warn'
      : 'ok';
    this.messageLog?.push(msg, level);
  }
}

// Pre-warm filter registry so shaders are compiled on load
filterRegistry.getAll();
