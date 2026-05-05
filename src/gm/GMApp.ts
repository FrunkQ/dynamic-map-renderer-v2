import { StateManager } from './StateManager.ts';
import { MapManager } from './MapManager.ts';
import { FogEditor } from './FogEditor.ts';
import { Renderer } from '../rendering/Renderer.ts';
import { FilterPanel } from '../filters/FilterPanel.ts';
import { filterRegistry } from '../filters/FilterRegistry.ts';
import { Host } from '../p2p/Host.ts';
import { generateRoomCode } from '../p2p/roomCode.ts';
import { saveSession, loadSession, getAllMaps, deleteMap } from '../storage/db.ts';
import { seedDefaultMaps } from '../storage/seedMaps.ts';
import { exportBundle, importBundle } from '../storage/bundleIO.ts';
import type { SessionState, StoredMap } from '../types.ts';
import QRCode from 'qrcode';

/**
 * Discover the machine's LAN IP via WebRTC ICE candidate inspection.
 * Falls back to null if detection fails or times out (e.g. in a deployed env
 * where location.hostname is already a real address).
 */
async function detectLanIp(): Promise<string | null> {
  try {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel('');
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    return new Promise((resolve) => {
      const done = (ip: string | null) => { pc.close(); resolve(ip); };
      const timer = setTimeout(() => done(null), 2000);

      pc.onicecandidate = ({ candidate }) => {
        if (!candidate) return;
        const m = candidate.candidate.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
        if (m && !m[1].startsWith('127.') && !m[1].startsWith('169.254.')) {
          clearTimeout(timer);
          done(m[1]);
        }
      };
    });
  } catch {
    return null;
  }
}

/**
 * GMApp — top-level orchestrator for the GM interface.
 *
 * Wires together: StateManager ↔ Renderer ↔ FilterPanel ↔ FogEditor ↔ P2P Host
 */
export class GMApp {
  private state   = new StateManager();
  private maps    = new MapManager();
  private host:   Host;
  private renderer!: Renderer;
  private fogEditor!: FogEditor;
  private filterPanel!: FilterPanel;

  // DOM references (assigned in init)
  private mapSelect!:         HTMLSelectElement;
  private filterSelect!:      HTMLSelectElement;
  private filterParamsContainer!: HTMLElement;
  private viewCenterX!:       HTMLInputElement;
  private viewCenterY!:       HTMLInputElement;
  private viewScale!:         HTMLInputElement;
  private viewCenterXNum!:    HTMLInputElement;
  private viewCenterYNum!:    HTMLInputElement;
  private viewScaleNum!:      HTMLInputElement;
  private viewBgColour!:      HTMLInputElement;
  private roomCodeEl!:        HTMLElement;
  private qrContainer!:       HTMLElement;
  private playerCountEl!:     HTMLElement;
  private statusEl!:          HTMLElement;
  private currentMapBlob:     ArrayBuffer | null = null;
  private fogDrawing = false;
  private activeFilterId:     string = '';
  private playerOrigin:       string = location.origin; // replaced with LAN IP when on localhost

  constructor() {
    this.host = new Host({
      onReady: (code) => this.onHostReady(code),
      onPeerConnected:    (id) => this.onPeerConnected(id),
      onPeerDisconnected: (id) => this.onPeerDisconnected(id),
      onError: (err) => this.setStatus(`P2P error: ${err.message}`, 'error'),
    });
  }

  async init(): Promise<void> {
    this.bindDOMRefs();
    this.bindRenderer();
    this.bindFogEditor();
    this.bindFilterPanel();
    this.bindUIControls();

    // Register the state listener BEFORE loading maps so that the initial
    // populateMapList() → loadMap() → state.loadForMap() → _notify() chain
    // correctly populates host.lastState.  Without this, any player that
    // connects before the first user interaction would get no full_state
    // and therefore no map texture or fog mesh — making live fog_update
    // messages invisible (they update lastFogState but nothing renders).
    this.state.onChange((s, changed) => this.onStateChange(s, changed));

    await seedDefaultMaps();
    await this.populateMapList();
    await this.startHost();

    this.renderer.start();
    this.setStatus('Ready', 'ok');
  }

  // ─── Host lifecycle ───────────────────────────────────────────────────────

  private async startHost(): Promise<void> {
    const session = await loadSession();
    // Re-use the persisted code so returning GMs keep the same room,
    // otherwise generate a fresh human-friendly word code.
    const peerId = session?.peerId ?? generateRoomCode();
    this.host.start(peerId);
  }

  private async onHostReady(roomCode: string): Promise<void> {
    this.roomCodeEl.textContent = roomCode;

    // On localhost, replace with the real LAN IP so QR/URL works for other devices
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      const lanIp = await detectLanIp();
      if (lanIp) {
        this.playerOrigin = `${location.protocol}//${lanIp}:${location.port}`;
      }
    }

    const playerUrl = `${this.playerOrigin}/player#${roomCode}`;
    try {
      await QRCode.toCanvas(
        this.qrContainer.querySelector('canvas') as HTMLCanvasElement,
        playerUrl,
        { width: 120, color: { dark: '#c8d8e8', light: '#0a0e1a' } }
      );
    } catch { /* QR non-critical */ }

    await saveSession({ key: 'current', peerId: roomCode, lastMapId: null });
  }

  private onPeerConnected(id: string): void {
    this.playerCountEl.textContent = String(this.host.connectedCount);
    this.setStatus(`Player connected (${id.slice(0, 8)}…)`, 'ok');
    // Host.handleConnection already sends full_state directly to the new peer.
    // No broadcast here — that would redundantly re-send to all existing players.
  }

  private onPeerDisconnected(id: string): void {
    this.playerCountEl.textContent = String(this.host.connectedCount);
    this.setStatus(`Player disconnected (${id.slice(0, 8)}…)`, 'warn');
  }

  // ─── State change → propagate to renderer + P2P ───────────────────────────

  private onStateChange(state: SessionState, changed: (keyof SessionState)[]): void {
    // View state is player-only — GM always sees the full map unzoomed

    // Only send fog_update for live edits (changed = ['fog']).
    // During a map switch, loadForMap fires _notify(['map','view','filter','fog']).
    // That case is intentionally excluded here: the fog for the new map travels
    // atomically inside the map_change broadcast (sent in loadMap below), so a
    // separate fog_update is not only redundant but harmful — it arrives at the
    // player independently of map_change and can be applied to the wrong map.
    if (changed.includes('fog') && !changed.includes('map')) {
      this.renderer.updateFog(state.fog);
      this.host.broadcast({
        type: 'fog_update',
        payload: state.fog,
        ...(state.map ? { mapId: state.map.id } : {}),
      });
    }

    if (changed.includes('filter')) {
      this.renderer.setFilter(state.filter);
      const filterId = state.filter.filterId;
      if (filterId !== this.activeFilterId) {
        // Filter switched — rebuild the panel for the new filter
        this.activeFilterId = filterId;
        this.filterPanel.render(
          filterRegistry.getOrFallback(filterId),
          state.filter.params[filterId] ?? {}
        );
      } else {
        // Same filter, params changed — update values in-place (no DOM rebuild)
        this.filterPanel.setValues(state.filter.params[filterId] ?? {});
      }
      this.host.broadcast({ type: 'filter_update', payload: state.filter });
    }

    if (changed.includes('view')) {
      this.renderer.setBackgroundColour(state.view.backgroundColor);
      this.host.broadcast({ type: 'view_update', payload: state.view });
    }

    this.host.updateState(state, this.currentMapBlob ?? undefined);
  }

  // ─── Map selection ────────────────────────────────────────────────────────

  private async populateMapList(): Promise<void> {
    const maps = await this.maps.getAll();
    this.mapSelect.innerHTML = '';
    if (maps.length === 0) {
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = '— Select map —';
      this.mapSelect.appendChild(placeholder);
    }
    for (const m of maps) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      this.mapSelect.appendChild(opt);
    }
    if (maps.length > 0) {
      this.mapSelect.value = maps[0]!.id;
      await this.loadMap(maps[0]!);
    }
  }

  private async loadMap(map: StoredMap): Promise<void> {
    // Flush any unsaved state from the previous map before switching
    await this.state.flushSave();
    this.setStatus(`Loading ${map.name}…`, 'ok');
    this.activeFilterId = ''; // force panel rebuild for new map's saved filter
    const blob = await this.maps.getBlob(map.id);
    if (!blob) { this.setStatus('Map blob not found', 'error'); return; }

    this.currentMapBlob = blob;

    // Clear old-map fog immediately so it never appears on the new map's
    // texture, even during the async decode window.  The correct fog for the
    // new map is redrawn once the texture decode completes inside renderer.loadMap.
    this.renderer.clearFog();

    // Load state BEFORE starting the texture load so lastFogState is already
    // correct when the texture callback fires and recreates the FogCompositor.
    // Note: _notify(['map','view','filter','fog']) fires here, but onStateChange
    // deliberately skips fog_update broadcasts when 'map' is in changed (above).
    await this.state.loadForMap({ id: map.id, name: map.name }, blob);

    // Auto-sample the top-left pixel of the map image and use it as the
    // background colour whenever there is no saved preference (i.e. still black).
    if (this.state.getState().view.backgroundColor === '#000000') {
      const colour = await this.sampleTopLeftPixel(blob);
      const v = this.state.getState().view;
      this.state.setView({ ...v, backgroundColor: colour });
    }

    this.fogEditor.loadState(this.state.getState().fog);
    this.syncViewSliders(this.state.getState());
    this.filterSelect.value = this.state.getState().filter.filterId;

    // Capture fog state after loadForMap so the correct state is used everywhere
    const fog = this.state.getState().fog;

    // Update fog aspect ratio once the texture dimensions are known
    this.renderer.onMapLoaded = (aspect) => {
      this.fogEditor.setMapAspect(aspect);
    };

    // Pass fog explicitly so the texture-load callback always redraws the right
    // fog even if another loadMap call races ahead of this one's decode.
    this.renderer.loadMap(blob, fog);

    this.setStatus(map.name, 'ok');

    // Broadcast new map to all connected players, fog carried atomically so the
    // player doesn't need to rely on a separately-timed fog_update message.
    this.host.broadcast({
      type: 'map_change',
      payload: { id: map.id, name: map.name },
      fog,
      mapBlob: blob,
    });
  }

  // ─── DOM binding ──────────────────────────────────────────────────────────

  private bindDOMRefs(): void {
    const q = <T extends HTMLElement>(sel: string): T =>
      document.querySelector<T>(sel)!;

    this.mapSelect              = q<HTMLSelectElement>('#map-select');
    this.filterSelect           = q<HTMLSelectElement>('#filter-select');
    this.filterParamsContainer  = q('#filter-params');
    this.viewCenterX            = q<HTMLInputElement>('#view-center-x');
    this.viewCenterY            = q<HTMLInputElement>('#view-center-y');
    this.viewScale              = q<HTMLInputElement>('#view-scale');
    this.viewCenterXNum         = q<HTMLInputElement>('#view-center-x-num');
    this.viewCenterYNum         = q<HTMLInputElement>('#view-center-y-num');
    this.viewScaleNum           = q<HTMLInputElement>('#view-scale-num');
    this.viewBgColour           = q<HTMLInputElement>('#view-bg-colour');
    this.roomCodeEl             = q('#room-code');
    this.qrContainer            = q('#qr-container');
    this.playerCountEl          = q('#player-count');
    this.statusEl               = q('#status');
  }

  private bindRenderer(): void {
    const canvas = document.querySelector<HTMLCanvasElement>('#renderer-canvas')!;
    this.renderer = new Renderer(canvas);
    this.renderer.setFilterEnabled(false); // GM sees raw unfiltered scene
    this.renderer.enableGMOverlay();
    this.renderer.setFogOpacity(0.35);     // GM sees through fog; players get full opacity
  }

  private bindFogEditor(): void {
    const canvas = document.querySelector<HTMLCanvasElement>('#fog-canvas')!;
    this.fogEditor = new FogEditor(canvas, (fog) => this.state.setFog(fog));

    // Start in select mode so the canvas is interactive immediately
    this.fogEditor.disable();

    // Wire context-sensitive toolbar
    this.fogEditor.setOnModeChange(({ drawing, hasSelection }) => {
      this.fogDrawing = drawing;
      const drawBtn = document.querySelector<HTMLButtonElement>('#fog-draw-btn');
      if (drawBtn) {
        drawBtn.classList.toggle('btn--active', drawing);
      }
      const deleteBtn = document.querySelector<HTMLButtonElement>('#fog-delete-btn');
      if (deleteBtn) deleteBtn.hidden = !hasSelection;
    });

    // Draw button toggles draw / select mode
    document.querySelector('#fog-draw-btn')?.addEventListener('click', () => {
      if (this.fogDrawing) {
        this.fogEditor.disable();
      } else {
        this.fogEditor.enable();
      }
    });

    document.querySelector('#fog-delete-btn')?.addEventListener('click', () => {
      this.fogEditor.deleteSelected();
    });

    document.querySelector<HTMLInputElement>('#fog-colour')?.addEventListener('input', (e) => {
      this.fogEditor.setColor((e.target as HTMLInputElement).value);
    });
  }

  private bindFilterPanel(): void {
    this.filterPanel = new FilterPanel(this.filterParamsContainer, (values) => {
      const filterId = this.state.getState().filter.filterId;
      this.state.setFilterParams(filterId, values);
      this.renderer.updateFilterParams(filterId, values);
    });

    // Populate filter dropdown
    const filters = filterRegistry.getAll();
    this.filterSelect.innerHTML = '';
    for (const f of filters) {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.name;
      this.filterSelect.appendChild(opt);
    }

    this.filterSelect.addEventListener('change', () => {
      this.state.setFilter(this.filterSelect.value);
    });
  }

  private bindUIControls(): void {
    // Map selection
    this.mapSelect.addEventListener('change', async () => {
      const id = this.mapSelect.value;
      if (!id) return;
      const all = await this.maps.getAll();
      const map = all.find((m) => m.id === id);
      if (map) await this.loadMap(map);
    });

    // Map delete
    document.querySelector('#delete-map-btn')?.addEventListener('click', async () => {
      const id = this.mapSelect.value;
      if (!id) return;
      const name = this.mapSelect.selectedOptions[0]?.text ?? 'this map';
      if (!confirm(`Delete "${name}"?\nThis cannot be undone.`)) return;
      try {
        await this.state.flushSave(); // commit any pending saves before wiping
        await this.maps.delete(id);
        await this.populateMapList();
        const remaining = await this.maps.getAll();
        if (remaining.length === 0) {
          this.setStatus('No maps — upload one to get started', 'warn');
        }
      } catch (err) {
        this.setStatus(`Delete failed: ${(err as Error).message}`, 'error');
      }
    });

    // Map upload
    document.querySelector('#map-upload')?.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const stored = await this.maps.importFile(file);
        const opt = document.createElement('option');
        opt.value = stored.id;
        opt.textContent = stored.name;
        this.mapSelect.appendChild(opt);
        this.mapSelect.value = stored.id;
        await this.loadMap(stored);
      } catch (err) {
        this.setStatus((err as Error).message, 'error');
      }
    });

    // Export all maps + configs
    document.querySelector('#export-btn')?.addEventListener('click', async () => {
      try {
        this.setStatus('Exporting…', 'ok');
        await exportBundle();
        this.setStatus('Maps exported', 'ok');
      } catch (err) {
        this.setStatus(`Export failed: ${(err as Error).message}`, 'error');
      }
    });

    // Load maps file — replaces all current maps after confirmation
    document.querySelector<HTMLInputElement>('#bundle-import')?.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      (e.target as HTMLInputElement).value = ''; // reset early so same file can be re-selected
      const ok = confirm(
        'Load Maps File\n\nThis will delete ALL current maps and replace them with the contents of the selected file.\n\nMake sure you have saved a backup first.\n\nContinue?'
      );
      if (!ok) return;
      try {
        this.setStatus('Replacing maps…', 'ok');
        // Flush any unsaved state before wiping, then delete every existing map
        await this.state.flushSave();
        const existing = await getAllMaps();
        for (const m of existing) await deleteMap(m.id);
        const { added } = await importBundle(file);
        await this.populateMapList();
        this.setStatus(`Loaded — ${added} map${added !== 1 ? 's' : ''} imported`, 'ok');
      } catch (err) {
        this.setStatus(`Load failed: ${(err as Error).message}`, 'error');
      }
    });

    // View controls — range and number inputs kept in sync
    const makeSliderPair = (
      range: HTMLInputElement,
      num: HTMLInputElement,
      onChange: (v: number) => void
    ): void => {
      range.addEventListener('input', () => {
        const v = parseFloat(range.value);
        num.value = String(v);
        onChange(v);
      });
      num.addEventListener('input', () => {
        const min = parseFloat(range.min);
        const max = parseFloat(range.max);
        const v = Math.max(min, Math.min(max, parseFloat(num.value) || 0));
        range.value = String(v);
        onChange(v);
      });
      num.addEventListener('blur', () => {
        // Re-clamp and reformat on blur
        const v = parseFloat(range.value);
        num.value = String(v);
      });
    };

    const applyView = () => {
      this.state.setView({
        centerX:         parseFloat(this.viewCenterX.value),
        centerY:         parseFloat(this.viewCenterY.value),
        scale:           parseFloat(this.viewScale.value),
        backgroundColor: this.viewBgColour.value,
      });
    };

    makeSliderPair(this.viewCenterX, this.viewCenterXNum, () => applyView());
    makeSliderPair(this.viewCenterY, this.viewCenterYNum, () => applyView());
    makeSliderPair(this.viewScale,   this.viewScaleNum,   () => applyView());
    this.viewBgColour.addEventListener('input', () => applyView());

    // Open local player window as a real popup
    document.querySelector('#open-player-btn')?.addEventListener('click', () => {
      const code = this.roomCodeEl.textContent?.trim() ?? '';
      const w = Math.min(1600, screen.width  - 80);
      const h = Math.min(1000, screen.height - 80);
      const l = Math.round((screen.width  - w) / 2);
      const t = Math.round((screen.height - h) / 2);
      window.open(
        `/player#${code}`,
        'dmr-player',
        `noopener,width=${w},height=${h},left=${l},top=${t}`
      );
    });

    // Copy player URL
    document.querySelector('#copy-url-btn')?.addEventListener('click', () => {
      const code = this.roomCodeEl.textContent?.trim() ?? '';
      void navigator.clipboard.writeText(`${this.playerOrigin}/player#${code}`);
      this.setStatus('Player URL copied!', 'ok');
    });

    // Collapsible panel sections
    document.querySelectorAll<HTMLElement>('.panel-title[aria-expanded]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!expanded));
        const body = btn.nextElementSibling as HTMLElement | null;
        if (body) body.hidden = expanded;
      });
    });
  }

  /** Sample the top-left pixel of a map image blob and return a CSS hex colour. */
  private async sampleTopLeftPixel(blob: ArrayBuffer): Promise<string> {
    const bmp = await createImageBitmap(new Blob([blob]));
    const cv  = document.createElement('canvas');
    cv.width  = 1;
    cv.height = 1;
    cv.getContext('2d')!.drawImage(bmp, 0, 0, 1, 1);
    bmp.close();
    const d = cv.getContext('2d')!.getImageData(0, 0, 1, 1).data;
    return '#' + [d[0]!, d[1]!, d[2]!].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  private syncViewSliders(state: SessionState): void {
    this.viewCenterX.value    = String(state.view.centerX);
    this.viewCenterY.value    = String(state.view.centerY);
    this.viewScale.value      = String(state.view.scale);
    this.viewCenterXNum.value = String(state.view.centerX);
    this.viewCenterYNum.value = String(state.view.centerY);
    this.viewScaleNum.value   = String(state.view.scale);
    this.viewBgColour.value   = state.view.backgroundColor;
  }

  private setStatus(msg: string, level: 'ok' | 'warn' | 'error'): void {
    this.statusEl.textContent = msg;
    this.statusEl.dataset['level'] = level;
  }
}
