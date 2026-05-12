import { Guest } from '../p2p/Guest.ts';
import { Renderer } from '../rendering/Renderer.ts';
import { MarkerTexture } from '../rendering/MarkerTexture.ts';
import { MarkerSprites } from '../rendering/MarkerSprites.ts';
import { MarkerOverlay, type OverlayItem } from '../rendering/MarkerOverlay.ts';
import { getMarkerAspect } from '../rendering/MarkerLayer.ts';
import {
  type ProjectorSetup,
  getActiveSetup,
} from './calibrationStorage.ts';
import { ProjectorCalibrationModal } from '../gm/ProjectorCalibrationModal.ts';
import { bindFullscreenButton } from '../utils/fullscreen.ts';
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
  private markerTexture!: MarkerTexture;
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
  private mapPixelsPerSquare: number | null     = null;
  private mapImageWidth:     number             = 0;
  private mapImageHeight:    number             = 0;
  private projectorViewport: ProjectorViewport  = defaultProjectorViewport();
  private currentFog:        FogState           = { polygons: [] };
  private currentMarkers:    Marker[]           = [];
  private currentFilter:     FilterState | null = null;
  /** Background colour for letterbox / pillarbox bars on the projector view.
   *  Mirrors the per-map view.backgroundColor the GM picked for the player
   *  view, so the projection bezel matches the player aesthetic. Defaults
   *  to black if no view state has been received yet. */
  private currentBackgroundColor: string         = '#000000';
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

    // Renderer: filters off by default (D8 will gate this), no fog opacity reduction.
    this.renderer = new Renderer(this.rendererCanvas);
    this.renderer.setFilterEnabled(false);
    this.markerTexture = new MarkerTexture();
    this.markerSprites = new MarkerSprites();
    this.renderer.setMarkerCanvas(this.markerTexture.canvas);
    this.renderer.setMarkerSpriteGroup(this.markerSprites.group);

    const overlayEl = document.getElementById('marker-overlay');
    this.markerOverlay = new MarkerOverlay(overlayEl ?? document.body);
    this.renderer.onMapLoaded = (aspect) => {
      this.markerTexture.setAspectRatio(aspect);
      this.markerSprites.setAspectRatio(aspect);
      this._renderMarkers();
    };
    this.renderer.start();

    this._refreshSetup();

    // Re-apply view on window resize so the crop dimensions stay correct.
    window.addEventListener('resize', () => {
      this._sendHello();
      this._applyView();
    });

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
      this.monitorBadge.textContent = `Projector Monitor ${this.monitorIndex ?? ''}`.trim();
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
      onMessage: (msg, blob) => this._onMessage(msg, blob),
    });
    this.guest.connect(room);
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
  private _effectiveDims(): { w: number; h: number } {
    const rot = this.projectorViewport.rotation;
    if (rot === 90 || rot === 270) {
      return { w: window.innerHeight, h: window.innerWidth };
    }
    return { w: window.innerWidth, h: window.innerHeight };
  }

  // ─── Message handling ────────────────────────────────────────────────────

  private _onMessage(msg: GMMessage, blob?: ArrayBuffer): void {
    switch (msg.type) {
      case 'full_state': {
        const s = msg.payload;
        this.currentMarkers = s.markers ?? [];
        this.currentFog     = s.fog ?? { polygons: [] };
        this.currentFilter  = s.filter ?? null;
        if (s.view?.backgroundColor) this.currentBackgroundColor = s.view.backgroundColor;
        if (s.projectorViewport) this.projectorViewport = s.projectorViewport;
        if (msg.mapPixelsPerSquare !== undefined) this.mapPixelsPerSquare = msg.mapPixelsPerSquare;
        if (msg.mapImageWidth      !== undefined) this.mapImageWidth      = msg.mapImageWidth;
        if (msg.mapImageHeight     !== undefined) this.mapImageHeight     = msg.mapImageHeight;
        if (blob) this.mapBlob = blob;
        if (this.mapBlob) {
          void this.renderer.loadMap(this.mapBlob, this.currentFog);
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
        this.currentMarkers = msg.markers ?? [];
        this.currentFog     = msg.fog ?? { polygons: [] };
        // Filter belongs to the incoming map — update so we don't keep the
        // previous map's filter applied. undefined/null means "no filter".
        this.currentFilter  = msg.filter ?? null;
        if (msg.view?.backgroundColor) this.currentBackgroundColor = msg.view.backgroundColor;
        if (msg.mapPixelsPerSquare !== undefined) this.mapPixelsPerSquare = msg.mapPixelsPerSquare;
        if (msg.mapImageWidth      !== undefined) this.mapImageWidth      = msg.mapImageWidth;
        if (msg.mapImageHeight     !== undefined) this.mapImageHeight     = msg.mapImageHeight;
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
          this.mapBlob = blob;
          void this.renderer.loadMap(blob, this.currentFog);
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
        // Projector currently lacks a TransitionEngine + overlay canvas
        // (player has them; projector goes straight from blob → texture).
        // For now the projector cuts to the FINAL frame instantly on
        // reveal — the player view shows the full animation, the
        // projector just updates the displayed handout. Follow-up:
        // mirror the player's transition path on the projector by
        // adding an overlay canvas + TransitionEngine.
        if (blob) {
          this.mapBlob = blob;
          void this.renderer.loadMap(blob, this.currentFog);
        }
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
        this._showFaffOverlay(msg.show, msg.message);
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
        break;
      }
      // audio messages: intentionally ignored — audio plays on player / GM only.
    }
  }

  private _faffOverlayEl: HTMLElement | null = null;

  /** Renders the "Hold on while the GM faffs…" placeholder over the
   *  projector output. The map continues to update underneath so the
   *  resume is instant. */
  private _showFaffOverlay(show: boolean, message: string): void {
    if (!show) {
      this._faffOverlayEl?.remove();
      this._faffOverlayEl = null;
      return;
    }
    if (!this._faffOverlayEl) {
      const el = document.createElement('div');
      el.className = 'faff-overlay';
      el.innerHTML =
        '<img class="faff-overlay__logo" src="/icons/icon-192.png" alt="Mappadux" />' +
        '<div class="faff-overlay__message"></div>';
      document.body.appendChild(el);
      this._faffOverlayEl = el;
    }
    const msgEl = this._faffOverlayEl.querySelector<HTMLElement>('.faff-overlay__message');
    if (msgEl) msgEl.textContent = message;
  }

  /**
   * Apply (or skip) the current filter on the renderer based on the
   * projectorViewport.filterEnabled toggle. The renderer's setFilterEnabled
   * is a master gate — when off, the filter pass is bypassed regardless of
   * which filter is set, which matches our "default off" stance.
   */
  private _applyFilter(): void {
    if (!this.projectorViewport.filterEnabled) {
      this.renderer.setFilterEnabled(false);
      return;
    }
    this.renderer.setFilterEnabled(true);
    if (this.currentFilter) this.renderer.setFilter(this.currentFilter);
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
    const bg = this.currentBackgroundColor;
    const mode = this.projectorViewport.mode;

    // 'full' — show the entire map fit-to-window. The renderer's letterbox
    // / pillarbox already handles aspect; ViewNW=ViewNH=1 means full extent.
    if (mode === 'full') {
      return { centerX: 0.5, centerY: 0.5, viewNW: 1, viewNH: 1, backgroundColor: bg };
    }

    // Monitor mode — show the same crop as the primary, fit-to-window.
    // The primary's view fraction comes from the GM (projector_role).
    if (this.role === 'monitor') {
      return {
        centerX: this.projectorViewport.centerX,
        centerY: this.projectorViewport.centerY,
        viewNW:  this.primaryViewNW,
        viewNH:  this.primaryViewNH,
        backgroundColor: bg,
      };
    }

    // 'scaled' — derive from calibration. Falls back to fit-to-window if any
    // input is missing (which D9 will surface as a clear warning).
    if (this.setup && this.mapPixelsPerSquare && this.mapImageWidth > 0 && this.mapImageHeight > 0) {
      const eff    = this._effectiveDims();
      const ratio  = this.mapPixelsPerSquare / this.setup.pixelsPerSquare;
      const wMap   = eff.w * ratio;
      const hMap   = eff.h * ratio;
      const viewNW = Math.min(1, wMap / this.mapImageWidth);
      const viewNH = Math.min(1, hMap / this.mapImageHeight);
      return {
        centerX: this.projectorViewport.centerX,
        centerY: this.projectorViewport.centerY,
        viewNW,
        viewNH,
        backgroundColor: bg,
      };
    }
    // Fallback when we don't have everything yet — just show the full map.
    return { centerX: 0.5, centerY: 0.5, viewNW: 1, viewNH: 1, backgroundColor: bg };
  }

  /** Push the computed view to the renderer. */
  private _applyView(): void {
    // Reflect rotation onto body so CSS can rotate the canvas + grid.
    document.body.dataset['rot'] = String(this.projectorViewport.rotation);
    this._drawGrid();
    this._refreshErrorStates();
    const view = this._computeViewState();
    this.renderer.setView(view);
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

  /**
   * Draw the 1" grid overlay. The grid is anchored to the projector's
   * calibration only — it knows nothing about the map. Lines are spaced at
   * setup.pixelsPerSquare CSS pixels, centred on the window so the middle
   * of the projection always sits on a grid intersection.
   * Hidden when grid is disabled, no calibration, or projector is blacked out.
   */
  private _drawGrid(): void {
    const cv = this.gridCanvas;
    // Effective dims account for rotation — grid CSS box is sized like the
    // canvas so they share the same rotation transform and stay aligned.
    const eff = this._effectiveDims();
    const w  = eff.w;
    const h  = eff.h;
    const dpr = window.devicePixelRatio || 1;
    cv.width  = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.width  = `${w}px`;
    cv.style.height = `${h}px`;

    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (!this.projectorViewport.gridEnabled) return;
    if (this.role === 'monitor') return; // monitors don't show the calibration grid
    if (!this.setup) return;

    const spacing = this.setup.pixelsPerSquare;
    if (spacing < 2) return; // sanity

    ctx.strokeStyle = this.projectorViewport.gridColor;
    ctx.lineWidth = 1;
    ctx.beginPath();

    const cx = w / 2;
    const cy = h / 2;
    // Vertical lines, walking out from the centre in both directions.
    for (let x = cx; x <= w + spacing; x += spacing) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, h);
    }
    for (let x = cx - spacing; x >= -spacing; x -= spacing) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, h);
    }
    // Horizontal lines.
    for (let y = cy; y <= h + spacing; y += spacing) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(w, Math.round(y) + 0.5);
    }
    for (let y = cy - spacing; y >= -spacing; y -= spacing) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(w, Math.round(y) + 0.5);
    }
    ctx.stroke();
  }

  private _showStatus(text: string, visible: boolean = true): void {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    this.statusEl.hidden = !visible || !text;
  }
}
