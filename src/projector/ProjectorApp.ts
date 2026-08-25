import { Guest } from '../p2p/Guest.ts';
import { cssApproxForFilter } from '../filters/cssApproximations.ts';
import { Renderer } from '../rendering/Renderer.ts';
import { MarkerSprites } from '../rendering/MarkerSprites.ts';
import { MarkerOverlay, type OverlayItem } from '../rendering/MarkerOverlay.ts';
import { getMarkerAspect } from '../rendering/MarkerLayer.ts';
import { PlayerMarkerLayer } from '../rendering/PlayerMarkerLayer.ts';
import { PingLayer } from '../rendering/PingLayer.ts';
import { PlayerInitiativeRail } from '../player/PlayerInitiativeRail.ts';
import { ClocksLayer } from '../annotate/ClocksLayer.ts';
import { TimersLayer } from '../annotate/TimersLayer.ts';
import { NotesLayer } from '../annotate/NotesLayer.ts';
import { WhiteboardLayer } from '../annotate/WhiteboardLayer.ts';
import { TextMapVideoLayer } from '../rendering/TextMapVideoLayer.ts';
import { StarMapLayer } from '../rendering/StarMapLayer.ts';
import { parseIceParam } from '../p2p/iceConfig.ts';
import {
  type ProjectorSetup,
  getActiveSetup,
} from './calibrationStorage.ts';
import { ProjectorCalibrationModal } from '../gm/ProjectorCalibrationModal.ts';
import { bindFullscreenButton } from '../utils/fullscreen.ts';
import { Viewer } from '../viewers/Viewer.ts';
import { PROFILE_SCALED } from '../viewers/profiles.ts';
import { computeView } from '../viewers/strategies/computeView.ts';
import { drawGrid } from '../viewers/strategies/drawGrid.ts';
import { isScaledViewTransitionsEnabled, getDiceDetailPreference } from '../storage/localSettings.ts';
import { DiceLayer } from '../rendering/DiceLayer.ts';
import { reduceDetail } from '../dice/dicePolicy.ts';
import { transitionRegistry } from '../transitions/TransitionRegistry.ts';
import type { TransitionConfig, CompositeWirePayload } from '../types.ts';
import { decodeImageBitmap } from '../utils/decodeImageBitmap.ts';
import { generateId } from '../utils/id.ts';
import {
  type GMMessage, type ViewState, type FogState, type Marker, type MarkerIconData,
  type FilterState, type ProjectorViewport,
  defaultProjectorViewport,
} from '../types.ts';

type ProjectorRole = 'primary' | 'monitor';

/**
 * ProjectorApp — top-level orchestrator for the projector view.
 *
 * Joins as a P2P Guest (BroadcastChannel for same-browser GM, PeerJS for
 * remote). Receives the GM's full session state and renders a calibration-
 * driven crop of the active map at true table scale. Supports three modes:
 *   - 'scaled': crop derived from projector calibration + map calibration
 *   - 'full':   ignore calibration, show entire map fit-to-window
 *   - 'black':  solid black overlay (e.g. while the GM resets between scenes)
 *
 * Filters off by default (D8 will add a toggle). Transitions skipped — they
 * don't make sense at the table. Audio not played here — the player window /
 * GM device handle audio output.
 */
export class ProjectorApp {
  private clientId = generateId();
  /** v2.17.17 — true when this projector is the GM's own same-machine window
   *  (launched with ?gmLocal=1). Such windows ride LocalChannel only and skip
   *  the PeerJS loopback, which browser background-throttling kept tearing down
   *  + reconnecting. Remote tablet projectors (no flag) still use PeerJS. */
  private _gmLocalFlag = (() => {
    try { return new URLSearchParams(location.search).has('gmLocal'); }
    catch { return false; }
  })();
  private role: ProjectorRole | null = null;     // null = role not yet assigned by GM
  private monitorIndex: number | null = null;
  /** Fraction of the map width/height the primary projector currently shows.
   *  Only meaningful when role === 'monitor' — drives the monitor's crop. */
  private primaryViewNW: number = 1;
  private primaryViewNH: number = 1;
  /** Primary's canvas aspect ratio. When in monitor mode, the canvas is
   *  constrained to this aspect so what's inside the bezel matches the
   *  primary's viewport exactly — bars (white) fill the rest. */
  private primaryAspect: number | null = null;

  private guest: Guest | null = null;
  private setup: ProjectorSetup | null = null;
  private renderer!: Renderer;
  // markerTexture is owned by Viewer and pushed into the renderer's
  // internals on construction; ProjectorApp never touches it directly
  // (only markerSprites is needed for the sprite-render path).
  private markerSprites!: MarkerSprites;
  private markerOverlay!: MarkerOverlay;

  private statusEl!:        HTMLElement;
  private connectPanel!:    HTMLElement;
  private roomInput!:       HTMLInputElement;
  private calibratePrompt!: HTMLElement;
  private controlsEl!:      HTMLElement;
  private setupLabelEl!:    HTMLElement;
  private gridCanvas!:      HTMLCanvasElement;
  private monitorBadge!:    HTMLElement;
  private noMapEl!:         HTMLElement;
  private uncalWarnEl!:     HTMLElement;
  private rendererCanvas!:  HTMLCanvasElement;
  /** v2.15 — shared chrome (lifecycle close, faff hold-screen with
   *  QR). Fullscreen + monitor-badge / calibration-warning stay
   *  ProjectorApp-local for now because of the rebind-on-monitor
   *  quirk and the projector-specific overlay surface. */
  private viewer!: Viewer;
  private fsUnbind:         (() => void) | null = null;
  private fsBtn:            HTMLElement | null = null;
  private idleTimer:        ReturnType<typeof setTimeout> | null = null;
  // Per-warning fade state — both noMap and uncal banners fade after 5s
  // since the GM has the equivalent warning persistently on their side.
  private noMapShowing  = false;
  private noMapFadeTimer:  ReturnType<typeof setTimeout> | null = null;
  private uncalShowing  = false;
  private uncalFadeTimer:  ReturnType<typeof setTimeout> | null = null;

  // Cached pieces of state needed to compute our viewport.
  private mapBlob:           ArrayBuffer | null = null;
  /** v2.14.16 — last loaded map blob, kept for the handout_reveal
   *  starting-frame snapshot when Scaled View transitions are on.
   *  Mirrors PlayerApp.lastMapBlob's purpose. */
  private lastMapBlob:       ArrayBuffer | null = null;
  /** v2.14.16 — promise chain that serialises in-flight map loads so a
   *  follow-up handout_reveal awaits the preceding map_change's
   *  texture decode before swapping again. Same mechanism PlayerApp
   *  added in v2.14.0 to fix the "reveal snaps to end" race. Only
   *  used when Scaled View transitions are enabled; cut-to-frame
   *  path doesn't need serialisation. */
  private _pendingMapLoad: Promise<void> = Promise.resolve();
  /** v2.12.x — current map id, tracked off map_change so the two-phase
   *  video_bundle follow-up can guard against stale deliveries after
   *  the GM has swapped to a different map mid-transfer. */
  private currentMapId: string | null = null;
  private mapPixelsPerSquare: number | null     = null;
  private mapImageWidth:     number             = 0;
  private mapImageHeight:    number             = 0;
  // v2.17 Player Voice — token / ping / initiative rendering, mirroring PlayerApp.
  private playerMarkerLayer: PlayerMarkerLayer | null = null;
  private pingLayer:         PingLayer         | null = null;
  /** v2.19 — the table screen is a dice TARGET: when the policy says the table
   *  shows rolls in full, the dice land here rather than on five phones. */
  private diceLayer:         DiceLayer         | null = null;
  private initiativeRail:    PlayerInitiativeRail | null = null;
  private _annotateClocks:   ClocksLayer | null = null;
  private _annotateTimers:   TimersLayer | null = null;
  private _annotateNotes:    NotesLayer | null = null;
  private _annotateBoard:    WhiteboardLayer | null = null;
  private _textMapVideos:    TextMapVideoLayer | null = null;
  /** v2.18 — StarMap: full-bleed SSE view (calibration/crop/rotation do not apply). */
  private _starMap: StarMapLayer | null = null;
  private _starMapActive = false;
  private _playerIcons   = new Map<string, string>();
  private _lastPlayerMarkers: Array<{ playerId: string; name: string; color: string; x: number; y: number; iconChar?: string; hasIcon?: boolean; tokenSize?: import('../types.ts').TokenSize }> = [];
  /** Icons currently being requested via `player_icon_request` — debounce so a
   *  single missing icon doesn't spawn a request per render frame. Cleared on
   *  the icon's arrival or after 5 s. v2.16.25. */
  private _pendingIconRequests = new Map<string, ReturnType<typeof setTimeout>>();
  /** v2.14.18 — grid offset for the active map (border-nudge alignment). */
  private gridOffsetX:       number             = 0;
  private gridOffsetY:       number             = 0;
  /** v2.14.31 — per-map shared grid colour (replaces the per-view
   *  ProjectorViewport.gridColor for this device). Falls back to
   *  projectorViewport.gridColor if the asset hasn't set one. */
  private gridColor:         string | null      = null;
  private projectorViewport: ProjectorViewport  = defaultProjectorViewport();
  private currentFog:        FogState           = { polygons: [] };
  private currentMarkers:    Marker[]           = [];
  private currentFilter:     FilterState | null = null;
  /** Background colour for letterbox / pillarbox bars on the projector view.
   *  Mirrors the per-map view.backgroundColor the GM picked for the player
   *  view, so the projection bezel matches the player aesthetic. Defaults
   *  to black if no view state has been received yet. */
  private currentBackgroundColor: string         = '#000000';
  /** v2.12.x — per-map animated backdrop the GM picked (Settings →
   *  Backdrop FX next to bg colour). Null = solid bg only. Tracked
   *  per ProjectorApp so _applyView can push it back into the
   *  renderer every refresh. */
  private currentBackdrop: import('../types.ts').BackdropConfig | null = null;
  private playerIconCache    = new Map<string, ImageBitmap>();

  async init(): Promise<void> {
    this.statusEl        = document.getElementById('status')!;
    this.connectPanel    = document.getElementById('connect-panel')!;
    this.roomInput       = document.getElementById('room-input') as HTMLInputElement;
    this.calibratePrompt = document.getElementById('calibration-prompt')!;
    this.controlsEl      = document.getElementById('projector-controls')!;
    this.setupLabelEl    = this.controlsEl.querySelector<HTMLElement>('.projector-setup-label')!;
    this.rendererCanvas  = document.getElementById('renderer-canvas') as HTMLCanvasElement;

    // 1" grid overlay — sits above the renderer, below the black-out.
    this.gridCanvas = document.createElement('canvas');
    this.gridCanvas.className = 'projector-grid';
    document.body.appendChild(this.gridCanvas);

    // Monitor identification badge — only shown when this window is a monitor.
    this.monitorBadge = document.createElement('div');
    this.monitorBadge.className = 'monitor-badge';
    this.monitorBadge.hidden = true;
    document.body.appendChild(this.monitorBadge);

    // "No map yet" overlay — centred message when GM hasn't loaded a map.
    this.noMapEl = document.createElement('div');
    this.noMapEl.className = 'projector-overlay-msg';
    this.noMapEl.textContent = 'Waiting for GM to load a map…';
    this.noMapEl.hidden = true;
    document.body.appendChild(this.noMapEl);

    // Uncalibrated-map warning — small banner pinned to top.
    this.uncalWarnEl = document.createElement('div');
    this.uncalWarnEl.className = 'projector-warn-banner';
    this.uncalWarnEl.textContent = '⚠ Map not calibrated — projection is fit-to-window, not at table scale';
    this.uncalWarnEl.hidden = true;
    document.body.appendChild(this.uncalWarnEl);

    // Blackout overlay retired in v2.11/A8.3 — the projector-broadcast
    // toggle on the GM panel (with its faff placeholder) covers the
    // "hide what players see" need with a friendlier UX.

    document.getElementById('calibrate-btn')?.addEventListener('click',  () => void this._openCalibration());
    document.getElementById('recalibrate-btn')?.addEventListener('click', () => void this._openCalibration());
    document.getElementById('connect-btn')?.addEventListener('click', () => this._connectFromInput());
    this.roomInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._connectFromInput(); });

    this.fsBtn = document.getElementById('fullscreen-btn');
    if (this.fsBtn) this.fsUnbind = bindFullscreenButton(this.fsBtn);

    // Auto-fade the controls panel after 10 s of mouse inactivity. Any mouse
    // movement on the page brings it back. The CSS .idle class drives a slow
    // opacity transition; :hover always wins so the user can still grab the
    // panel by hovering over its corner even when fully faded.
    const wakeControls = () => {
      this.controlsEl.classList.remove('idle');
      if (this.idleTimer) clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => this.controlsEl.classList.add('idle'), 10_000);
    };
    window.addEventListener('mousemove',   wakeControls);
    window.addEventListener('pointermove', wakeControls);
    window.addEventListener('keydown',     wakeControls);
    wakeControls();

    // v2.15 — Viewer owns the chrome (lifecycle, faff overlay) AND the
    // rendering pipeline (Renderer, marker layer). ProjectorApp drives
    // the P2P + message dispatch + projector-specific overlays (grid,
    // calibration warning, monitor badge). Fullscreen stays
    // ProjectorApp-local because of the monitor-mode rebind quirk;
    // pass fullscreenBtn: null so Viewer skips its own binding.
    //
    // Renderer config differs from the player profile:
    //   - initialFilterEnabled=false → Disable-Filter is opt-in on
    //     projector (the Scaled View should default to clean output).
    //   - videoStallEscalation=false → at the table, a stuttering
    //     animated map beats a "tap fullscreen" banner.
    //   - transitionCanvas=null → cut-to-frame per profile.
    // v2.14.16 — Scaled View transitions are opt-in via Settings. When
    // enabled, pass the transition canvas to Viewer so the engine gets
    // constructed; the message handlers below check viewer.transitionEngine
    // and delegate to it for handout_reveal / map_change.
    const transitionsOn = isScaledViewTransitionsEnabled();
    const transitionCanvas = transitionsOn
      ? document.querySelector<HTMLCanvasElement>('#transition-canvas') ?? null
      : null;
    // PROFILE_SCALED defaults to cut-to-frame; flip to 'full' for this
    // session when the opt-in is on. Viewer requires both
    // profile.transitions.mode === 'full' AND a transitionCanvas to
    // actually instantiate a TransitionEngine.
    const profile = transitionsOn
      ? { ...PROFILE_SCALED, transitions: { mode: 'full' as const } }
      : PROFILE_SCALED;

    this.viewer = new Viewer(profile, {
      fullscreenBtn:        null,
      rendererCanvas:       this.rendererCanvas,
      markerOverlayEl:      document.getElementById('marker-overlay'),
      transitionCanvas,
      initialFilterEnabled: false,
      videoStallEscalation: false,
    });
    this.viewer.init();

    // Alias the pipeline pieces locally so existing call sites in the
    // rest of this file (this.renderer.X / this.markerSprites.X /
    // etc.) keep working without touching them all.
    this.renderer       = this.viewer.renderer;
    this.markerSprites  = this.viewer.markerSprites;
    this.markerOverlay  = this.viewer.markerOverlay;

    // v2.17 Player Voice — token / ping / initiative layers (mirroring PlayerApp).
    const pmEl = document.getElementById('player-marker-layer');
    if (pmEl) {
      this.playerMarkerLayer = new PlayerMarkerLayer(pmEl, {
        project:   (x, y) => this.renderer.mapNormToCanvasCss(x, y),
        unproject: () => null,           // projector is read-only; no drag
        canDrag:   () => false,
        getPxPerSquare: () => this._tokenPxPerSquare(),
      });
    }
    const pingEl = document.getElementById('ping-layer');
    if (pingEl) {
      this.pingLayer = new PingLayer(
        pingEl,
        (x, y) => this.renderer.mapNormToCanvasCss(x, y),
        { showLabel: false, persistent: false, ttlMs: 10000 },
      );
    }
    const initEl = document.getElementById('player-initiative');
    if (initEl) this.initiativeRail = new PlayerInitiativeRail(initEl);
    // v2.16.76 — read-only progress clocks mirrored from the GM.
    const anchor = { project: (x: number, y: number) => this.renderer.mapNormToCanvasCss(x, y), unproject: () => null };
    const clocksEl = document.getElementById('annotate-clocks');
    const diceLayerEl = document.getElementById('dice-layer');
    if (diceLayerEl) this.diceLayer = new DiceLayer(diceLayerEl, 'table');
    if (clocksEl) this._annotateClocks = new ClocksLayer(clocksEl, false, anchor);
    const timersEl = document.getElementById('annotate-timers');
    if (timersEl) this._annotateTimers = new TimersLayer(timersEl, false, anchor);
    const notesEl = document.getElementById('annotate-notes');
    if (notesEl) this._annotateNotes = new NotesLayer(notesEl, false, anchor);
    const videoLayerEl = document.getElementById('textmap-video-layer');
    // v2.16.102 — skip in-map video on touch devices (doesn't render on
    // mobile; see PlayerApp + backlog). Desktop projectors are unaffected.
    const isMobileViewer = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    if (videoLayerEl && !isMobileViewer) {
      this._textMapVideos = new TextMapVideoLayer(videoLayerEl, (x, y) => this.renderer.mapNormToCanvasCss(x, y), { mode: 'viewer' });
      // v2.16.97 — rebuild the iframe after a fullscreen toggle blanks it.
      document.addEventListener('fullscreenchange', () => {
        window.setTimeout(() => this._textMapVideos?.refresh(), 250);
      });
    }
    // v2.18 — StarMap layer (full-bleed; the projector shows the same live view as players).
    const starMapEl = document.getElementById('starmap-layer');
    if (starMapEl) this._starMap = new StarMapLayer(starMapEl, 'viewer');
    // v2.16.77 — read-only whiteboard mirrored from the GM.
    const boardEl = document.getElementById('annotate-whiteboard') as HTMLCanvasElement | null;
    if (boardEl) this._annotateBoard = new WhiteboardLayer(boardEl, (x, y) => this.renderer.mapNormToCanvasCss(x, y));

    // Post-map-load: render markers + re-apply calibrated view now
    // that the renderer knows the new map's aspect ratio. _applyView
    // also fires synchronously inside the map_change handler, but at
    // that point the texture is still decoding and renderer.aspectRatio
    // still carries the previous map's aspect — that's the v2.14.8 fix.
    this.viewer.onMapLoaded(() => {
      this._renderMarkers();
      this._applyView();
    });

    this._refreshSetup();

    // Re-apply view on window resize so the crop dimensions stay correct.
    window.addEventListener('resize', () => {
      this._sendHello();
      this._applyView();
    });
    // v2.14.8 — also recompute on every canvas resize. The window
    // 'resize' event may be debounced or fire AFTER the Renderer's
    // own ResizeObserver, in which case the renderer's refreshCamera
    // re-applies a stale viewNW (computed from the old window dims)
    // against the new canvas size — that's player-style fit-to-window
    // scaling and defeats the whole point of calibrated Scaled View.
    // Listening here makes viewNW recompute synchronously alongside
    // every canvas size change so calibration holds during interactive
    // drags.
    try {
      const ro = new ResizeObserver(() => this._applyView());
      ro.observe(this.rendererCanvas);
    } catch { /* ResizeObserver unsupported — window.resize fallback still fires */ }

    // Notify the GM on window close so it can drop our slot from its
    // connection map and re-shuffle monitor roles cleanly (BroadcastChannel
    // never signals its own close).
    window.addEventListener('beforeunload', () => {
      this.guest?.send({ type: 'projector_bye', clientId: this.clientId });
    });

    // Read room code from fragment; show connect panel if missing.
    const room = window.location.hash.replace(/^#/, '').trim();
    if (room) {
      this._connectToRoom(room);
    } else {
      this.connectPanel.hidden = false;
    }
  }

  private _refreshSetup(): void {
    this.setup = getActiveSetup();
    this._refreshChromeForRole();
    this._applyView();
  }

  /**
   * Show / hide the calibration prompt and pick the right setup label based on
   * current role. Monitors don't need calibration; their badge says
   * "Projector Monitor N" instead of the calibration info.
   */
  private _refreshChromeForRole(): void {
    const recalBtn = document.getElementById('recalibrate-btn') as HTMLElement | null;
    if (this.role === 'monitor') {
      this.calibratePrompt.hidden = true;
      this.controlsEl.hidden      = false;
      // Monitors don't need calibration — recalibrate button + setup label are
      // both hidden. The big red badge identifies the window separately.
      if (recalBtn) recalBtn.hidden = true;
      this.setupLabelEl.hidden = true;
      this.monitorBadge.hidden = false;
      this.monitorBadge.textContent = `Scaled View Monitor ${this.monitorIndex ?? ''}`.trim();
      document.body.classList.add('projector-view--monitor');
      // Constrain the canvas to the primary's aspect ratio so what's inside
      // the bezel matches the primary's viewport exactly. White surround
      // visible outside the canvas is the body bg.
      if (this.primaryAspect && this.primaryAspect > 0) {
        document.body.style.setProperty('--monitor-aspect', String(this.primaryAspect));
      }
      this._rebindFullscreen(true);
      return;
    }
    document.body.classList.remove('projector-view--monitor');
    document.body.style.removeProperty('--monitor-aspect');
    if (recalBtn) recalBtn.hidden = false;
    this.setupLabelEl.hidden = false;
    this.monitorBadge.hidden = true;
    const calibrated = !!this.setup;
    this.calibratePrompt.hidden = calibrated;
    this.controlsEl.hidden      = !calibrated;
    if (this.setup) {
      this.setupLabelEl.textContent = `${this.setup.name} · ${this.setup.pixelsPerSquare.toFixed(1)} px/sq`;
    }
    this._rebindFullscreen(false);
  }

  /** Re-wire the fullscreen button so monitor windows always show just the
   *  ⛶ icon, regardless of the localStorage minimised flag. */
  private _rebindFullscreen(forceMinimised: boolean): void {
    if (!this.fsBtn) return;
    this.fsUnbind?.();
    this.fsUnbind = bindFullscreenButton(this.fsBtn, { forceMinimised });
  }

  private async _openCalibration(): Promise<void> {
    const cal = new ProjectorCalibrationModal();
    await cal.open();
    this._refreshSetup();
    this._sendHello();
  }

  private _connectFromInput(): void {
    const code = this.roomInput.value.trim().toLowerCase();
    if (!code) return;
    window.location.hash = code;
    this._connectToRoom(code);
  }

  private _connectToRoom(room: string): void {
    this.connectPanel.hidden = true;
    this._showStatus(`Connecting to ${room}…`);
    this.guest?.destroy();
    this.guest = new Guest({
      onConnected:    () => { this._showStatus('', false); this._sendHello(); },
      onDisconnected: () => this._showStatus('Disconnected — waiting for GM…'),
      onReconnecting: (attempt, delayMs) => {
        const secs = Math.round(delayMs / 1000);
        this._showStatus(`Reconnecting… (${secs}s, attempt ${attempt})`);
      },
      onError:   (err) => this._showStatus(`Error: ${err.message}`),
      onIceState: (st) => { if (st === 'ice-failed') this._showStatus('Connection blocked by this network (UDP blocked, no relay). Ask the GM for a link with a relay.'); },
      onMessage: (msg, blob) => this._onMessage(msg, blob),
    });
    this.guest.setIceServers(parseIceParam(new URLSearchParams(location.search).get('ice')));
    // v2.17.17 — same-machine GM projector: LocalChannel only (no loopback).
    if (this._gmLocalFlag) {
      this.guest.connectLocalOnly();
    } else {
      this.guest.connect(room);
    }
    this._sendHello();
  }

  private _sendHello(): void {
    // Monitors don't need their own calibration — fall back to dummy values
    // so the GM can still register the connection and assign a role.
    const eff = this._effectiveDims();
    this.guest?.send({
      type:            'projector_hello',
      clientId:        this.clientId,
      setupName:       this.setup?.name ?? '(uncalibrated)',
      pixelsPerSquare: this.setup?.pixelsPerSquare ?? 0,
      // Effective dimensions account for 90/270° rotation: a portrait map
      // projected onto a landscape window has effective dims = (H, W).
      // The GM sizes its rectangle from these so it stays correct.
      canvasWidth:     eff.w,
      canvasHeight:    eff.h,
    });
  }

  /** Effective projection-area dimensions in CSS px, accounting for rotation. */
  /** v2.14.54 — composite payload handling. See PlayerApp's twin. */
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
    // v2.14.70 — Reveal-layer backing (composite minus topmost
    // tile). Lets the Reveal Map Layer brush's alpha holes expose
    // the layer below rather than the backdrop. Skip for single-
    // tile composites — nothing underneath.
    if (inputs.length < 2) return { renderable };
    // v2.15.16 — Backing = tiles that have something drawn over
    // them (shared rule with the GM-side rasterizeRevealBacking).
    // See PlayerApp's twin for the full reasoning.
    const { backingTileIndices } = await import('../maps/compositeOverlap.ts');
    const covered = backingTileIndices(
      inputs.map((i) => i.tile),
      (id) => inputs.find((i) => i.asset.id === id)?.asset,
      composite.aspect,
    );
    if (covered.size === 0) return { renderable };
    const drawnInputs = inputs.filter((_, idx) => covered.has(idx));
    const backingResult = await rasterizeFromTiles(drawnInputs, composite.aspect, inputs);
    if (!backingResult) return { renderable };
    const backing = await backingResult.blob.arrayBuffer();
    return { renderable, backing };
  }

  private _effectiveDims(): { w: number; h: number } {
    const rot = this.projectorViewport.rotation;
    if (rot === 90 || rot === 270) {
      return { w: window.innerHeight, h: window.innerWidth };
    }
    return { w: window.innerWidth, h: window.innerHeight };
  }

  // ─── Message handling ────────────────────────────────────────────────────

  /** Current screen-pixels-per-map-square at the active zoom, or null when
   *  uncalibrated. Mirrors PlayerApp / GMApp so player-token footprints scale
   *  identically across all viewer surfaces. */
  private _tokenPxPerSquare(): number | null {
    if (!this.mapPixelsPerSquare || !this.mapImageHeight) return null;
    const scale = this.renderer.worldToScreenScale();
    return (this.mapPixelsPerSquare / this.mapImageHeight) * scale.pxPerWorldY;
  }

  /** Re-merge cached icons into the last received markers and push to the layer. */
  private _reRenderPlayerMarkers(): void {
    const merged = this._lastPlayerMarkers.map((m) => {
      const cached = this._playerIcons.get(m.playerId);
      return cached ? { ...m, iconDataUrl: cached } : m;
    });
    this.playerMarkerLayer?.setMarkers(merged);
  }

  /** Ask the GM to resend a specific player's icon — fired when a player_markers
   *  entry says `hasIcon: true` but the local cache is empty. Debounced per
   *  playerId so the same missing icon can't spawn a request per render frame.
   *  Cleared on the icon's arrival or after 5 s. v2.16.25 self-heal. */
  private _requestMissingIcon(playerId: string): void {
    if (this._pendingIconRequests.has(playerId)) return;
    if (!this.guest) return;
    this.guest.send({ type: 'player_icon_request', playerId });
    const timer = setTimeout(() => this._pendingIconRequests.delete(playerId), 5000);
    this._pendingIconRequests.set(playerId, timer);
  }

  private _onMessage(msg: GMMessage, blob?: ArrayBuffer): void {
    switch (msg.type) {
      case 'full_state': {
        const s = msg.payload;
        this.currentMarkers = s.markers ?? [];
        this.currentFog     = s.fog ?? { polygons: [] };
        this.currentFilter  = s.filter ?? null;
        if (s.view?.backgroundColor) this.currentBackgroundColor = s.view.backgroundColor;
        this.currentBackdrop = s.view?.backdrop ?? null;
        if (s.projectorViewport) this.projectorViewport = s.projectorViewport;
        // v2.16.100 — videos ride in full_state so a fresh projector gets them
        // on connect, not only via the discrete textmap_videos message.
        this._textMapVideos?.setVideos(msg.textMapVideos ?? []);
        // v2.18 — StarMap: pre-warm + enter/exit on the active map's kind.
        // v2.18.10 — prewarm ONLY when the active map is not itself a StarMap: this same
        // full_state carries the one we are about to show, and mounting it presetless first only
        // costs a wasted frame (and used to cost the right view entirely).
        if (msg.starMapPrewarm && !msg.starMap) this._starMap?.preload(msg.starMapPrewarm);
        if (msg.starMap) this._enterStarMap(msg.starMap);
        else if (this._starMapActive) this._exitStarMap();
        if (msg.mapPixelsPerSquare !== undefined) this.mapPixelsPerSquare = msg.mapPixelsPerSquare;
        if (msg.mapImageWidth      !== undefined) this.mapImageWidth      = msg.mapImageWidth;
        if (msg.mapImageHeight     !== undefined) this.mapImageHeight     = msg.mapImageHeight;
        if (msg.gridOffsetX        !== undefined) this.gridOffsetX        = msg.gridOffsetX;
        if (msg.gridOffsetY        !== undefined) this.gridOffsetY        = msg.gridOffsetY;
        if (msg.gridColor          !== undefined) this.gridColor          = msg.gridColor;
        if (blob) this.mapBlob = blob;
        if (this.mapBlob) {
          // v2.14.54 — composite payload → local rasterise.
          const composite = msg.composite;
          const buf = this.mapBlob;
          void (async () => {
            const { renderable, backing } = await this._maybeRasterizeComposite(buf, composite);
            await this.renderer.loadMap(renderable, this.currentFog, backing);
          })();
        }
        // Decode-then-render so the icon bitmaps are in cache by the
        // time _renderMarkers reads them. Fire-and-forget left markers
        // showing fallback circles on the projector until something
        // else nudged the canvas; the player has always awaited the
        // decode, this matches that pattern.
        void (async () => {
          if (msg.iconData?.length) await this._decodeIconData(msg.iconData);
          this._renderMarkers();
        })();
        this._applyView();
        this._applyFilter();
        break;
      }
      case 'map_change': {
        if (this._starMapActive) this._exitStarMap(); // v2.18 — any ordinary map ends StarMap mode
        this.currentMapId   = msg.payload.id;
        this.currentMarkers = msg.markers ?? [];
        this.currentFog     = msg.fog ?? { polygons: [] };
        // Filter belongs to the incoming map — update so we don't keep the
        // previous map's filter applied. undefined/null means "no filter".
        this.currentFilter  = msg.filter ?? null;
        if (msg.view?.backgroundColor) this.currentBackgroundColor = msg.view.backgroundColor;
        this.currentBackdrop = msg.view?.backdrop ?? null;
        if (msg.mapPixelsPerSquare !== undefined) this.mapPixelsPerSquare = msg.mapPixelsPerSquare;
        if (msg.mapImageWidth      !== undefined) this.mapImageWidth      = msg.mapImageWidth;
        if (msg.mapImageHeight     !== undefined) this.mapImageHeight     = msg.mapImageHeight;
        if (msg.gridOffsetX        !== undefined) this.gridOffsetX        = msg.gridOffsetX;
        if (msg.gridOffsetY        !== undefined) this.gridOffsetY        = msg.gridOffsetY;
        if (msg.gridColor          !== undefined) this.gridColor          = msg.gridColor;
        // Viewport (rotation / mode / grid / filterEnabled) also belongs to
        // the incoming map. Apply the same way projector_viewport_update
        // would so we don't hold over the prior map's rotation.
        if (msg.projectorViewport) {
          const prevRot           = this.projectorViewport.rotation;
          const prevFilterEnabled = this.projectorViewport.filterEnabled;
          this.projectorViewport  = msg.projectorViewport;
          if (prevRot !== this.projectorViewport.rotation) this._sendHello();
          if (prevFilterEnabled !== this.projectorViewport.filterEnabled) this._applyFilter();
        }
        if (blob) {
          const finalBlob = blob;
          const composite = msg.composite;
          this.mapBlob = finalBlob;
          // v2.14.16 — when Scaled View transitions are enabled, route
          // through the TransitionEngine + serialise behind any
          // in-flight load. When disabled, cut straight to new texture.
          // v2.14.54 — composite payload → local rasterise inside the
          // load step so the renderer receives a final image buffer.
          if (this.viewer.transitionEngine) {
            const fog = this.currentFog;
            const prior = this._pendingMapLoad;
            this._pendingMapLoad = (async () => {
              await prior;
              const { renderable, backing } = await this._maybeRasterizeComposite(finalBlob, composite);
              await this._runTransition(msg.transition, async () => {
                await this.renderer.loadMap(renderable, fog, backing);
              });
              this.lastMapBlob = renderable;
            })();
          } else {
            void (async () => {
              const { renderable, backing } = await this._maybeRasterizeComposite(finalBlob, composite);
              await this.renderer.loadMap(renderable, this.currentFog, backing);
              this.lastMapBlob = renderable;
            })();
          }
        }
        void (async () => {
          if (msg.iconData?.length) await this._decodeIconData(msg.iconData);
          this._renderMarkers();
        })();
        this._applyView();
        this._applyFilter();
        break;
      }
      case 'handout_reveal': {
        // v2.14.16 — when Scaled View transitions are enabled, use the
        // same in-scene reveal-overlay path PlayerApp uses (snapshot
        // the previous map's frame, paint the transition above it,
        // swap to the new texture under the cover). When disabled,
        // cut to the final frame as before.
        if (!blob) break;
        if (msg.mapId !== this.currentMapId) break; // stale message
        const finalBlob = blob;
        if (this.viewer.transitionEngine) {
          const startBlob = this.lastMapBlob;
          const fog = this.currentFog;
          this.mapBlob = finalBlob;
          const prior = this._pendingMapLoad;
          this._pendingMapLoad = (async () => {
            await prior;
            let preSnap: ImageBitmap | undefined;
            if (startBlob) {
              try {
                preSnap = await createImageBitmap(new Blob([startBlob], { type: 'image/png' }));
              } catch { preSnap = undefined; }
            }
            const rendererCanvas = document.querySelector<HTMLCanvasElement>('#renderer-canvas')!;
            const revealCanvas = this.renderer.beginRevealOverlay(
              rendererCanvas.clientWidth  || window.innerWidth,
              rendererCanvas.clientHeight || window.innerHeight,
            );
            try {
              await this._runTransition(msg.transition, async () => {
                await this.renderer.loadMap(finalBlob, fog);
              }, preSnap, revealCanvas);
            } finally {
              this.renderer.endRevealOverlay();
            }
            this.lastMapBlob = finalBlob;
          })();
        } else {
          this.mapBlob = finalBlob;
          void this.renderer.loadMap(finalBlob, this.currentFog);
          this.lastMapBlob = finalBlob;
        }
        break;
      }
      case 'video_bundle': {
        // v2.12.x — phase 2 of animated-map delivery. Snapshot
        // arrived earlier via map_change; this carries the full
        // video bytes. Swap renderer texture from still image to
        // VideoTexture by re-loading. Guard against stale bundles
        // when the GM has moved on already.
        if (!blob) break;
        if (msg.mapId !== this.currentMapId) break;
        this.mapBlob = blob;
        void this.renderer.loadMap(blob, this.currentFog);
        break;
      }
      case 'fog_update': {
        this.currentFog = msg.payload;
        this.renderer.updateFog(msg.payload);
        break;
      }
      case 'marker_update': {
        this.currentMarkers = msg.payload;
        // marker_update messages carry iconData for any libAsset bitmaps
        // the GM just rendered (see _rebroadcastMarkersWithFreshIconData
        // in GMApp). The projector previously ignored that payload here
        // so colour changes / freshly picked tintable icons never
        // reached the projector cache. Mirror the player's path.
        void (async () => {
          if (msg.iconData?.length) await this._decodeIconData(msg.iconData);
          this._renderMarkers();
        })();
        break;
      }
      case 'projector_viewport_update': {
        const prevRot = this.projectorViewport.rotation;
        const prevFilterEnabled = this.projectorViewport.filterEnabled;
        this.projectorViewport = msg.payload;
        this._applyView();
        // Rotation flips effective dims, so the GM needs an updated hello to
        // resize the orange/green rectangle correctly.
        if (prevRot !== this.projectorViewport.rotation) this._sendHello();
        // Filter on/off changed → re-apply (or strip) filter.
        if (prevFilterEnabled !== this.projectorViewport.filterEnabled) this._applyFilter();
        break;
      }
      case 'filter_update': {
        // Track latest filter even when disabled so toggling on uses current.
        this.currentFilter = msg.payload;
        this._applyFilter();
        break;
      }
      case 'map_meta_update': {
        // Map calibration / intrinsic dims changed (typically a Recalibrate
        // this Map run while the map is live). Re-crop at the new scale.
        if (msg.mapPixelsPerSquare !== undefined) this.mapPixelsPerSquare = msg.mapPixelsPerSquare;
        if (msg.mapImageWidth      !== undefined) this.mapImageWidth      = msg.mapImageWidth;
        if (msg.mapImageHeight     !== undefined) this.mapImageHeight     = msg.mapImageHeight;
        if (msg.gridOffsetX        !== undefined) this.gridOffsetX        = msg.gridOffsetX;
        if (msg.gridOffsetY        !== undefined) this.gridOffsetY        = msg.gridOffsetY;
        if (msg.gridColor          !== undefined) this.gridColor          = msg.gridColor;
        this._applyView();
        break;
      }
      case 'projector_role': {
        if (msg.targetId !== this.clientId) break; // not for us
        this.role         = msg.role;
        this.monitorIndex = msg.monitorIndex ?? null;
        if (msg.primaryViewNW !== undefined) this.primaryViewNW = msg.primaryViewNW;
        if (msg.primaryViewNH !== undefined) this.primaryViewNH = msg.primaryViewNH;
        if (msg.primaryAspect !== undefined) this.primaryAspect = msg.primaryAspect;
        this._refreshChromeForRole();
        this._applyView();
        break;
      }
      case 'projector_shutdown': {
        if (msg.targetId !== this.clientId) break; // not for us
        // Closing the primary projector tears down the whole projection;
        // monitors close themselves to follow. window.close only works for
        // windows opened via window.open (which is how the GM launches us).
        window.close();
        break;
      }
      case 'view_placeholder': {
        if (msg.target !== 'projector') break;
        this.viewer.showFaffOverlay(msg.show, msg.message);
        break;
      }
      case 'view_update': {
        // The projector computes its own crop from calibration and ignores
        // the player's centre / viewN dimensions, but the background colour
        // (used to fill letterbox / pillarbox bars on the projection) DOES
        // follow the GM's per-map choice so the projector bezel matches the
        // player aesthetic. Live edits to the background colour in the GM
        // UI propagate here without waiting for a map swap.
        if (msg.payload.backgroundColor) {
          const changed = this.currentBackgroundColor !== msg.payload.backgroundColor;
          this.currentBackgroundColor = msg.payload.backgroundColor;
          if (changed) this._applyView();
        }
        // v2.12.x — backdrop is per-view too. Live edits propagate
        // without waiting for a map swap.
        const newBackdrop = msg.payload.backdrop ?? null;
        const backdropChanged =
          (this.currentBackdrop?.kind ?? null) !== (newBackdrop?.kind ?? null) ||
          (this.currentBackdrop?.speed ?? 1) !== (newBackdrop?.speed ?? 1);
        if (backdropChanged) {
          this.currentBackdrop = newBackdrop;
          this._applyView();
        }
        break;
      }
      // audio messages: intentionally ignored — audio plays on player / GM only.

      case 'player_markers': {
        // v2.17 Player Voice — tokens placed on the active map. Icon images
        // arrive separately via player_icon_update; merge cache in.
        this._lastPlayerMarkers = msg.markers;
        this._reRenderPlayerMarkers();
        // v2.16.25 self-heal — any marker the GM flagged hasIcon but we
        // have nothing cached for → ask the GM to resend it. Covers the
        // case where the chunked binary delivery was dropped or arrived
        // before the layer was mounted.
        for (const m of msg.markers) {
          if (m.hasIcon && !this._playerIcons.has(m.playerId)) {
            this._requestMissingIcon(m.playerId);
          }
        }
        break;
      }
      case 'player_icon_update': {
        // PeerJS path → blob arg has the assembled PNG bytes. BC path → dataUrl
        // inline on the message. Either way, cache something an <img> can use.
        let url: string | undefined;
        if (blob) {
          url = URL.createObjectURL(new Blob([blob], { type: 'image/png' }));
        } else if (msg.dataUrl) {
          url = msg.dataUrl;
        }
        const prev = this._playerIcons.get(msg.playerId);
        if (url) this._playerIcons.set(msg.playerId, url);
        else     this._playerIcons.delete(msg.playerId);
        if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
        // Clear any pending self-heal request — the icon just arrived.
        const pending = this._pendingIconRequests.get(msg.playerId);
        if (pending) { clearTimeout(pending); this._pendingIconRequests.delete(msg.playerId); }
        // v2.16.24 diagnostic — log on every arrival so the projector
        // console reports which transport delivered (or didn't).
        console.info(
          '[projector] player_icon_update',
          msg.playerId,
          'via',
          blob ? `peerjs-blob(${blob.byteLength}B)` : msg.dataUrl ? `bc-dataurl(${msg.dataUrl.length}ch)` : 'CLEAR',
          'layer?', !!this.playerMarkerLayer,
          'markersKnown?', this._lastPlayerMarkers.length,
        );
        this._reRenderPlayerMarkers();
        break;
      }
      case 'dice_show': {
        // v2.19 Dice — the GM already resolved the policy; this screen only
        // reduces it against its own setting (a stick PC under a table may be
        // set to text). Dice land in screen space and stay until that person
        // rolls again, because a table behaves like a table.
        const detail = reduceDetail(msg.detailTable, getDiceDetailPreference());
        const show = {
          rollId: msg.rollId,
          label: msg.label,
          outcome: msg.roll,
          rollerKey: msg.fromPlayerId ?? 'gm',
          rollerName: msg.fromName,
          rollerColor: msg.fromColor,
          whisper: msg.whisper,
        };
        if (detail === 'full') this.diceLayer?.showFull(show);
        else if (detail === 'line') this.diceLayer?.showLine(show);
        break;
      }
      case 'ping_show': {
        // v2.17 Player Voice — show ping pulses on the table screen too.
        this.pingLayer?.add({ id: msg.pingId, x: msg.x, y: msg.y, color: msg.color, name: msg.name });
        break;
      }
      case 'initiative_update': {
        // v2.17 Player Voice — atmospheric initiative rail. Same face the
        // players see (giant numbers / threat letters stay GM-only).
        this.initiativeRail?.setState(msg.state);
        break;
      }
      case 'annotate_clocks': {
        // v2.16.76 — mirror the GM's progress clocks (read-only).
        this._annotateClocks?.setClocks(msg.clocks);
        break;
      }
      case 'annotate_stroke': {
        this._annotateBoard?.addStroke(msg.stroke);
        break;
      }
      case 'annotate_clear': {
        this._annotateBoard?.clear();
        break;
      }
      case 'annotate_timers': {
        this._annotateTimers?.setTimers(msg.timers);
        break;
      }
      case 'annotate_notes': {
        this._annotateNotes?.setNotes(msg.notes);
        break;
      }
      case 'textmap_videos': {
        this._textMapVideos?.setVideos(msg.videos);
        break;
      }
      case 'starmap_show': {
        // v2.18 — full-bleed SSE view; the projector's own calibration and crop
        // are meaningless for a live external view (decision Q5).
        this._enterStarMap(msg.payload);
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
      // player_features, player_roster, player_marker_move, message_deliver,
      // initiative_call, initiative_roll, player_identify, player_bye,
      // player_forget_me — projector is read-only / not a participant, ignore.
    }
  }

  // v2.15 — _showFaffOverlay + _faffOverlayEl lifted into Viewer.
  // PROFILE_SCALED.chrome.qrTarget = 'player' so the QR points at
  // /player#room, just like the local implementation used to.

  /**
   * Apply (or skip) the current filter on the renderer based on the
   * projectorViewport.filterEnabled toggle. The renderer's setFilterEnabled
   * is a master gate — when off, the filter pass is bypassed regardless of
   * which filter is set, which matches our "default off" stance.
   */
  // ── v2.18 StarMap mode ─────────────────────────────────────────────────────
  private _enterStarMap(t: { origin: string; sessionId: string; presetId: string; backgroundColor?: string }): void {
    if (!this._starMap) return;
    this._starMapActive = true;
    document.body.classList.add('starmap-active');
    this._starMap.show({ origin: t.origin, sessionId: t.sessionId, presetId: t.presetId });
    this.renderer.setPaused(true);
    this._textMapVideos?.clear();
  }
  private _exitStarMap(): void {
    if (!this._starMapActive) return;
    this._starMapActive = false;
    document.body.classList.remove('starmap-active');
    this._starMap?.hide();
    this.renderer.setPaused(false);
  }

  private _applyFilter(): void {
    if (!this.projectorViewport.filterEnabled) {
      this.renderer.setFilterEnabled(false);
      this._applyMarkerLayerFilter(true);
      return;
    }
    this.renderer.setFilterEnabled(true);
    if (this.currentFilter) this.renderer.setFilter(this.currentFilter);
    this._applyMarkerLayerFilter(false);
  }

  /** Patch E v2.16.30 — apply the active filter's CSS approximation to the
   *  player-marker-layer DOM overlay when the GM has enabled the per-map
   *  "Affect Player Markers" toggle AND the projector's own filter gate
   *  is on. Clears the filter otherwise. */
  private _applyMarkerLayerFilter(forceOff: boolean): void {
    const layer = document.getElementById('player-marker-layer');
    if (!layer) return;
    if (!forceOff && this.currentFilter?.affectPlayerMarkers) {
      const css = cssApproxForFilter(this.currentFilter.filterId);
      layer.style.filter = css || '';
    } else {
      layer.style.filter = '';
    }
    // v2.16.94 — the in-map YouTube video layer ALWAYS participates in the
    // scene look (no per-map toggle, unlike markers), but still respects the
    // projector's master filter gate (forceOff). GM removes it by turning the
    // visual filter off.
    const videoLayer = document.getElementById('textmap-video-layer');
    if (videoLayer) {
      videoLayer.style.filter = (!forceOff && this.currentFilter)
        ? cssApproxForFilter(this.currentFilter.filterId)
        : '';
    }
  }

  private _renderMarkers(): void {
    if (!this.currentMarkers) return;
    this.markerSprites.render(this.currentMarkers, this.playerIconCache);
    this._updateMarkerOverlay();
    this.renderer.markMarkersDirty();
  }

  /** Sync the HTML overlay so each marker's label sits below the icon. */
  private _updateMarkerOverlay(): void {
    if (!this.currentMarkers) { this.markerOverlay.update([]); return; }
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
      });
    }
    this.markerOverlay.update(items);
  }

  private async _decodeIconData(iconData: MarkerIconData[]): Promise<void> {
    await Promise.all(
      iconData
        .filter(({ key }) => !this.playerIconCache.has(key))
        .map(async ({ key, dataUrl }) => {
          try {
            const bmp = await decodeImageBitmap(dataUrl);
            this.playerIconCache.set(key, bmp);
          } catch {
            /* shrug — skip this icon */
          }
        }),
    );
    this._renderMarkers();
  }

  // ─── View math ───────────────────────────────────────────────────────────

  /**
   * Compute the ViewState the renderer should display, based on the current
   * mode + projector calibration + map calibration.
   */
  private _computeViewState(): ViewState {
    // v2.15 Phase 3b — dispatched via the shared computeView strategies.
    // Source picked dynamically from `this.role` since a projector window
    // may flip between primary (calibrated) and monitor (mirror-primary)
    // at runtime via projector_role. Profile swapping arrives in a later
    // refactor pass; until then the dispatch lives here.
    const eff = this._effectiveDims();
    const result = computeView({
      source:             this.role === 'monitor' ? 'mirror-primary' : 'calibrated',
      projectorViewport:  this.projectorViewport,
      mapPixelsPerSquare: this.mapPixelsPerSquare,
      mapImageWidth:      this.mapImageWidth,
      mapImageHeight:     this.mapImageHeight,
      setup:              this.setup,
      effectiveW:         eff.w,
      effectiveH:         eff.h,
      backgroundColor:    this.currentBackgroundColor,
      primaryViewNW:      this.primaryViewNW,
      primaryViewNH:      this.primaryViewNH,
      broadcastView:      null,
    });
    // 'calibrated' and 'mirror-primary' always return a ViewState; the
    // null case is reserved for 'broadcast' (which Player uses, not
    // Projector). Coerce-or-fallback so the type checker is happy.
    return result ?? {
      centerX: 0.5, centerY: 0.5, viewNW: 1, viewNH: 1,
      backgroundColor: this.currentBackgroundColor,
    };
  }

  /** Push the computed view to the renderer. */
  private _applyView(): void {
    // Reflect rotation onto body so CSS can rotate the canvas + grid.
    document.body.dataset['rot'] = String(this.projectorViewport.rotation);
    // v2.14.32 — push the view to the renderer FIRST. The grid now
    // rides the renderer's projection (mapNormToCanvasCss), so its
    // gridline positions are only correct once the camera reflects
    // the new view. Drawing before setView would project against the
    // PRIOR view and produce a frame-stale grid.
    this._refreshErrorStates();
    const view = this._computeViewState();
    this.renderer.setView(view);
    this._drawGrid();
    // v2.12.x — per-map animated backdrop follows from the GM's view
    // state. Projector inherits the same backdrop the GM picked so
    // the bars area on the table screen carries the same vibe.
    this.renderer.setBackdrop(this.currentBackdrop);
    this.markerSprites.render(this.currentMarkers, this.playerIconCache);
    this.renderer.markMarkersDirty();
  }

  /**
   * Decide which overlay messages should show right now:
   *   - "Waiting for GM to load a map…" if no map blob has arrived yet
   *   - "Map not calibrated…" banner if map exists but no pixelsPerSquare
   *     (only when the primary is in 'scaled' mode — full-map mode is fine
   *     uncalibrated, and monitors don't care since they mirror primary).
   */
  private _refreshErrorStates(): void {
    const noMap   = !this.mapBlob;
    const uncal   = !!this.mapBlob
                    && this.role !== 'monitor'
                    && this.projectorViewport.mode === 'scaled'
                    && (!this.mapPixelsPerSquare || !this.setup);

    this._setFadingWarning(
      this.noMapEl,
      noMap,
      () => this.noMapShowing,
      (v) => { this.noMapShowing = v; },
      () => this.noMapFadeTimer,
      (v) => { this.noMapFadeTimer = v; },
    );
    this._setFadingWarning(
      this.uncalWarnEl,
      uncal,
      () => this.uncalShowing,
      (v) => { this.uncalShowing = v; },
      () => this.uncalFadeTimer,
      (v) => { this.uncalFadeTimer = v; },
    );
  }

  /** Common transition logic for projector overlay warnings: show on the
   *  rising edge, then add the `is-faded` class after 5s so CSS fades it
   *  out. Hide immediately on the falling edge. The GM has the equivalent
   *  warning on their UI persistently, so the projector window can let go
   *  of the message rather than blocking the visible projection area. */
  private _setFadingWarning(
    el: HTMLElement,
    shouldShow: boolean,
    getShowing: () => boolean,
    setShowing: (v: boolean) => void,
    getTimer: () => ReturnType<typeof setTimeout> | null,
    setTimer: (v: ReturnType<typeof setTimeout> | null) => void,
  ): void {
    const showing = getShowing();
    if (shouldShow && !showing) {
      el.hidden = false;
      el.classList.remove('is-faded');
      const existing = getTimer();
      if (existing !== null) clearTimeout(existing);
      setTimer(setTimeout(() => {
        el.classList.add('is-faded');
        setTimer(null);
      }, 5000));
      setShowing(true);
    } else if (!shouldShow && showing) {
      const existing = getTimer();
      if (existing !== null) clearTimeout(existing);
      setTimer(null);
      el.hidden = true;
      el.classList.remove('is-faded');
      setShowing(false);
    }
  }

  /** v2.15 Phase 3c — grid drawing dispatched to the shared
   *  drawGrid strategy. Primary uses 'projector-calibrated', monitor
   *  uses 'monitor-proportional'. The strategy handles canvas sizing,
   *  clearing, the gridEnabled gate, and the actual line stroking. */
  private _drawGrid(): void {
    const eff = this._effectiveDims();
    // v2.14.32 — drawGrid rides the renderer's projection
    // (mapNormToCanvasCss), so the same camera that draws the map
    // also positions the gridlines. No more parallel maths.
    drawGrid(this.gridCanvas, {
      effectiveW:         eff.w,
      effectiveH:         eff.h,
      enabled:            this.projectorViewport.gridEnabled,
      color:              this.gridColor ?? this.projectorViewport.gridColor,
      mapPixelsPerSquare: this.mapPixelsPerSquare,
      mapImageWidth:      this.mapImageWidth,
      mapImageHeight:     this.mapImageHeight,
      gridOffsetX:        this.gridOffsetX,
      gridOffsetY:        this.gridOffsetY,
      renderer:           this.renderer,
    });
  }

  private _showStatus(text: string, visible: boolean = true): void {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    this.statusEl.hidden = !visible || !text;
  }

  /** v2.14.16 — Run a transition through the Viewer's TransitionEngine.
   *  Mirrors PlayerApp.runTransition with the same engine API. Only
   *  called when transitions are enabled (otherwise the caller cuts to
   *  the final frame and skips this entirely). No-ops gracefully if
   *  the engine isn't set up. */
  private async _runTransition(
    config: TransitionConfig | undefined,
    applyChange: () => Promise<void>,
    preSnapshot?: ImageBitmap,
    overlayOverride?: HTMLCanvasElement,
  ): Promise<void> {
    if (!this.viewer.transitionEngine) {
      await applyChange();
      return;
    }
    const id     = config?.transitionId ?? 'none';
    const def    = transitionRegistry.getOrFallback(id);
    const params = config?.params ?? transitionRegistry.defaultParams(id);
    const canvas = document.querySelector<HTMLCanvasElement>('#renderer-canvas')!;
    await this.viewer.transitionEngine.run(def, params, canvas, applyChange, preSnapshot, overlayOverride);
  }
}
