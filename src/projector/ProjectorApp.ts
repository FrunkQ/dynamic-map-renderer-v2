import { Guest } from '../p2p/Guest.ts';
import { Renderer } from '../rendering/Renderer.ts';
import { MarkerTexture } from '../rendering/MarkerTexture.ts';
import {
  type ProjectorSetup,
  getActiveSetup,
} from './calibrationStorage.ts';
import { ProjectorCalibrationModal } from '../gm/ProjectorCalibrationModal.ts';
import { bindFullscreenButton } from '../utils/fullscreen.ts';
import {
  type GMMessage, type ViewState, type FogState, type Marker, type MarkerIconData,
  type ProjectorViewport,
  defaultProjectorViewport,
} from '../types.ts';

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
  private guest: Guest | null = null;
  private setup: ProjectorSetup | null = null;
  private renderer!: Renderer;
  private markerTexture!: MarkerTexture;

  private statusEl!:        HTMLElement;
  private connectPanel!:    HTMLElement;
  private roomInput!:       HTMLInputElement;
  private calibratePrompt!: HTMLElement;
  private controlsEl!:      HTMLElement;
  private setupLabelEl!:    HTMLElement;
  private blackoutEl!:      HTMLElement;
  private rendererCanvas!:  HTMLCanvasElement;

  // Cached pieces of state needed to compute our viewport.
  private mapBlob:           ArrayBuffer | null = null;
  private mapPixelsPerSquare: number | null     = null;
  private mapImageWidth:     number             = 0;
  private mapImageHeight:    number             = 0;
  private projectorViewport: ProjectorViewport  = defaultProjectorViewport();
  private currentFog:        FogState           = { polygons: [] };
  private currentMarkers:    Marker[]           = [];
  private playerIconCache    = new Map<string, ImageBitmap>();

  async init(): Promise<void> {
    this.statusEl        = document.getElementById('status')!;
    this.connectPanel    = document.getElementById('connect-panel')!;
    this.roomInput       = document.getElementById('room-input') as HTMLInputElement;
    this.calibratePrompt = document.getElementById('calibration-prompt')!;
    this.controlsEl      = document.getElementById('projector-controls')!;
    this.setupLabelEl    = this.controlsEl.querySelector<HTMLElement>('.projector-setup-label')!;
    this.rendererCanvas  = document.getElementById('renderer-canvas') as HTMLCanvasElement;

    // Black-out overlay — covers the full window when projectorViewport.mode === 'black'.
    this.blackoutEl = document.createElement('div');
    this.blackoutEl.className = 'projector-blackout';
    this.blackoutEl.hidden = true;
    document.body.appendChild(this.blackoutEl);

    document.getElementById('calibrate-btn')?.addEventListener('click',  () => void this._openCalibration());
    document.getElementById('recalibrate-btn')?.addEventListener('click', () => void this._openCalibration());
    document.getElementById('connect-btn')?.addEventListener('click', () => this._connectFromInput());
    this.roomInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._connectFromInput(); });

    const fsBtn = document.getElementById('fullscreen-btn');
    if (fsBtn) bindFullscreenButton(fsBtn);

    // Renderer: filters off by default (D8 will gate this), no fog opacity reduction.
    this.renderer = new Renderer(this.rendererCanvas);
    this.renderer.setFilterEnabled(false);
    this.markerTexture = new MarkerTexture();
    this.renderer.setMarkerCanvas(this.markerTexture.canvas);
    this.renderer.onMapLoaded = (aspect) => {
      this.markerTexture.setAspectRatio(aspect);
      this._renderMarkers();
    };
    this.renderer.start();

    this._refreshSetup();

    // Re-apply view on window resize so the crop dimensions stay correct.
    window.addEventListener('resize', () => {
      this._sendHello();
      this._applyView();
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
    const calibrated = !!this.setup;
    this.calibratePrompt.hidden = calibrated;
    this.controlsEl.hidden      = !calibrated;
    if (this.setup) {
      this.setupLabelEl.textContent = `${this.setup.name} · ${this.setup.pixelsPerSquare.toFixed(1)} px/sq`;
    }
    this._applyView();
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
    if (!this.setup) return;
    this.guest?.send({
      type:            'projector_hello',
      setupName:       this.setup.name,
      pixelsPerSquare: this.setup.pixelsPerSquare,
      canvasWidth:     window.innerWidth,
      canvasHeight:    window.innerHeight,
    });
  }

  // ─── Message handling ────────────────────────────────────────────────────

  private _onMessage(msg: GMMessage, blob?: ArrayBuffer): void {
    switch (msg.type) {
      case 'full_state': {
        const s = msg.payload;
        this.currentMarkers = s.markers ?? [];
        this.currentFog     = s.fog ?? { polygons: [] };
        if (s.projectorViewport) this.projectorViewport = s.projectorViewport;
        if (msg.mapPixelsPerSquare !== undefined) this.mapPixelsPerSquare = msg.mapPixelsPerSquare;
        if (msg.mapImageWidth      !== undefined) this.mapImageWidth      = msg.mapImageWidth;
        if (msg.mapImageHeight     !== undefined) this.mapImageHeight     = msg.mapImageHeight;
        if (blob) this.mapBlob = blob;
        if (this.mapBlob) {
          void this.renderer.loadMap(this.mapBlob, this.currentFog);
        }
        if (msg.iconData?.length) void this._decodeIconData(msg.iconData);
        this._renderMarkers();
        this._applyView();
        break;
      }
      case 'map_change': {
        this.currentMarkers = msg.markers ?? [];
        this.currentFog     = msg.fog ?? { polygons: [] };
        if (msg.mapPixelsPerSquare !== undefined) this.mapPixelsPerSquare = msg.mapPixelsPerSquare;
        if (msg.mapImageWidth      !== undefined) this.mapImageWidth      = msg.mapImageWidth;
        if (msg.mapImageHeight     !== undefined) this.mapImageHeight     = msg.mapImageHeight;
        if (blob) {
          this.mapBlob = blob;
          void this.renderer.loadMap(blob, this.currentFog);
        }
        if (msg.iconData?.length) void this._decodeIconData(msg.iconData);
        this._renderMarkers();
        this._applyView();
        break;
      }
      case 'fog_update': {
        this.currentFog = msg.payload;
        this.renderer.updateFog(msg.payload);
        break;
      }
      case 'marker_update': {
        this.currentMarkers = msg.payload;
        this._renderMarkers();
        break;
      }
      case 'projector_viewport_update': {
        this.projectorViewport = msg.payload;
        this._applyView();
        break;
      }
      // view_update / filter_update / audio messages: intentionally ignored
      // by the projector. View comes from our own calibration. Filters are
      // off (D8 will toggle). Audio plays on the player / GM device only.
    }
  }

  private _renderMarkers(): void {
    if (!this.currentMarkers) return;
    const view = this._computeViewState();
    this.markerTexture.setViewHeight(view.viewNH);
    this.markerTexture.render(this.currentMarkers, this.playerIconCache);
    this.renderer.markMarkersDirty();
  }

  private async _decodeIconData(iconData: MarkerIconData[]): Promise<void> {
    await Promise.all(
      iconData
        .filter(({ key }) => !this.playerIconCache.has(key))
        .map(async ({ key, dataUrl }) => {
          try {
            const res  = await fetch(dataUrl);
            const blob = await res.blob();
            const bmp  = await createImageBitmap(blob);
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
    const bg = '#000000';
    const mode = this.projectorViewport.mode;

    // 'full' — show the entire map fit-to-window. The renderer's letterbox
    // / pillarbox already handles aspect; ViewNW=ViewNH=1 means full extent.
    if (mode === 'full') {
      return { centerX: 0.5, centerY: 0.5, viewNW: 1, viewNH: 1, backgroundColor: bg };
    }

    // 'scaled' — derive from calibration. Falls back to fit-to-window if any
    // input is missing (which D9 will surface as a clear warning).
    if (this.setup && this.mapPixelsPerSquare && this.mapImageWidth > 0 && this.mapImageHeight > 0) {
      const ratio  = this.mapPixelsPerSquare / this.setup.pixelsPerSquare;
      const wMap   = window.innerWidth  * ratio;
      const hMap   = window.innerHeight * ratio;
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

  /** Push the computed view to the renderer + show/hide the black-out overlay. */
  private _applyView(): void {
    const mode = this.projectorViewport.mode;
    this.blackoutEl.hidden = mode !== 'black';
    if (mode === 'black') return;
    const view = this._computeViewState();
    this.renderer.setView(view);
    this.markerTexture.setViewHeight(view.viewNH);
    this.markerTexture.render(this.currentMarkers, this.playerIconCache);
    this.renderer.markMarkersDirty();
  }

  private _showStatus(text: string, visible: boolean = true): void {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    this.statusEl.hidden = !visible || !text;
  }
}
