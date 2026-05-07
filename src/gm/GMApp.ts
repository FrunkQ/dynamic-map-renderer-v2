import { StateManager } from './StateManager.ts';
import { MapManager } from './MapManager.ts';
import { FogEditor } from './FogEditor.ts';
import { ViewportEditor } from './ViewportEditor.ts';
import { MarkerEditor } from './MarkerEditor.ts';
import { IconPicker } from './IconPicker.ts';
import { SoundboardPanel, type SoundboardBroadcast } from './SoundboardPanel.ts';
import { SoundboardEngine } from '../audio/SoundboardEngine.ts';
import { Renderer } from '../rendering/Renderer.ts';
import { FilterPanel } from '../filters/FilterPanel.ts';
import { filterRegistry } from '../filters/FilterRegistry.ts';
import { TransitionPanel } from '../transitions/TransitionPanel.ts';
import { transitionRegistry } from '../transitions/TransitionRegistry.ts';
import { Host } from '../p2p/Host.ts';
import { generateRoomCode } from '../p2p/roomCode.ts';
import { saveSession, loadSession, getAllMaps, deleteMap } from '../storage/db.ts';
import { seedDefaultMaps } from '../storage/seedMaps.ts';
import { exportBundle, importBundle } from '../storage/bundleIO.ts';
import { AudioAssetStore } from '../audio/AudioAssetStore.ts';
import { PositionalAudioEngine } from '../audio/PositionalAudioEngine.ts';
import type { SessionState, StoredMap, TransitionConfig, Marker, MarkerIconData, AudioAsset, MarkerRole } from '../types.ts';
import QRCode from 'qrcode';

const REMOTE_AUDIO_KEY = 'dmr_remote_audio';


/**
 * GMApp — top-level orchestrator for the GM interface.
 *
 * Wires together: StateManager ↔ Renderer ↔ FilterPanel ↔ FogEditor ↔ P2P Host
 */
export class GMApp {
  private state   = new StateManager();
  private maps    = new MapManager();
  private host:   Host;
  private renderer!:       Renderer;
  private fogEditor!:      FogEditor;
  private viewportEditor!: ViewportEditor;
  private markerEditor!:   MarkerEditor;
  private filterPanel!:     FilterPanel;
  private transitionPanel!: TransitionPanel;

  private iconPicker!:       IconPicker;
  private soundboardEngine!: SoundboardEngine;
  private soundboardPanel!:  SoundboardPanel;

  private positionalAudio  = new PositionalAudioEngine();
  /** assetId → dataUrl — cached for inclusion in positional_play broadcasts */
  private _assetDataUrls   = new Map<string, string>();
  /** markerId → last-broadcast state for active positional sources */
  private _activePositional = new Map<string, { loop: boolean; lastVolume: number }>();
  private selectedMarkerId: string | null = null;
  private mapAspectRatio = 1;
  private remoteAudioEnabled = localStorage.getItem(REMOTE_AUDIO_KEY) !== 'false';

  // DOM references (assigned in init)
  private mapSelect!:               HTMLSelectElement;
  private transitionSelect!:        HTMLSelectElement;
  private transitionParamsContainer!: HTMLElement;
  private filterSelect!:            HTMLSelectElement;
  private filterParamsContainer!:   HTMLElement;
  private viewBgColour!:           HTMLInputElement;
  private viewDefaultActions!:     HTMLElement;
  private editViewportBtn!:        HTMLButtonElement;
  private editViewportActions!:    HTMLElement;
  private fogDrawBtn!:             HTMLButtonElement;
  private fogDeleteBtn!:           HTMLButtonElement;
  private roomCodeEl!:             HTMLElement;
  private qrContainer!:            HTMLElement;
  private playerCountEl!:          HTMLElement;
  private statusEl!:               HTMLElement;
  private markerSelect!:           HTMLSelectElement;
  private markerLabelInput!:       HTMLInputElement;
  private markerIconBtn!:          HTMLButtonElement;
  private markerColorInput!:       HTMLInputElement;
  private markerSizeInput!:        HTMLInputElement;
  private markerSizeVal!:          HTMLElement;
  private markerHiddenToggle!:     HTMLInputElement;
  private markerShowLabelToggle!:  HTMLInputElement;
  private currentMapBlob:          ArrayBuffer | null = null;
  private fogDrawing            = false;
  private activeFilterId        = '';
  private activeTransitionId    = 'none';
  /** Per-transition saved params — persisted in-memory for the session */
  private allTransitionParams: Record<string, Record<string, number | string>> = {};
  private playerOrigin   = location.origin; // replaced with LAN IP when on localhost

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
    this.bindViewportEditor();
    this.bindFilterPanel();
    this.bindTransitionPanel();
    this.bindUIControls();
    this.bindMarkerEditor();
    this.bindSoundboardPanel();

    // Wire positional audio callbacks BEFORE loading maps — onSourceStart fires
    // during _preloadMarkerAudio which is called inside populateMapList/loadMap.
    // If the callbacks were set after that, the initial positional_play broadcasts
    // would never happen and lastPositionalActive would stay empty forever.
    const resumePA = () => this.positionalAudio.tryResume();
    document.addEventListener('click',      resumePA);
    document.addEventListener('keydown',    resumePA);
    document.addEventListener('touchstart', resumePA, { passive: true });

    this.positionalAudio.onSourceStart = (markerId, assetId, loop, gain) => {
      const dataUrl = this._assetDataUrls.get(assetId);
      console.log(`[GM] onSourceStart markerId=${markerId} assetId=${assetId} loop=${loop} gain=${gain.toFixed(4)} hasUrl=${!!dataUrl}`);
      if (!dataUrl) return;
      this._activePositional.set(markerId, { loop, lastVolume: gain });
      this.host.broadcast({ type: 'positional_play', markerId, assetId, loop, volume: gain, dataUrl });
    };
    this.positionalAudio.onSourceStop = (markerId) => {
      if (this._activePositional.has(markerId)) {
        this._activePositional.delete(markerId);
        this.host.broadcast({ type: 'positional_stop', markerId });
      }
    };

    // Register the state listener BEFORE loading maps so that the initial
    // populateMapList() → loadMap() → state.loadForMap() → _notify() chain
    // correctly populates host.lastState.
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

    // On localhost, replace with the real LAN IP so QR/URL works for other devices.
    // __DEV_LAN_IP__ is injected at build time by vite.config.ts (null in prod).
    if ((location.hostname === 'localhost' || location.hostname === '127.0.0.1')
        && __DEV_LAN_IP__) {
      this.playerOrigin = `${location.protocol}//${__DEV_LAN_IP__}:${location.port}`;
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

  private _collectIconData(markers: Marker[]): MarkerIconData[] {
    const seen: Set<string> = new Set();
    const result: MarkerIconData[] = [];
    for (const m of markers) {
      if (m.icon.startsWith('asset:') && !seen.has(m.icon)) {
        const dataUrl = this.iconPicker.iconDataUrls.get(m.icon);
        if (dataUrl) result.push({ key: m.icon, dataUrl });
        seen.add(m.icon);
      }
    }
    return result;
  }

  private onStateChange(state: SessionState, changed: (keyof SessionState)[]): void {
    // View state is player-only — GM always sees the full map unzoomed
    const visibleMarkers = state.markers.filter((m) => !m.hidden);
    // Audio-source markers must be broadcast even when hidden — a hidden marker
    // can represent an invisible ambient sound source (e.g. attached to a room).
    const broadcastMarkers = state.markers.filter((m) => !m.hidden || m.role === 'audio_source');
    const iconData         = this._collectIconData(visibleMarkers); // icons only for visible

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
      // During a map switch, filter travels atomically inside map_change (below)
      // so a separate filter_update would arrive before the transition starts and
      // corrupt the snapshot.  Only broadcast standalone filter changes.
      if (!changed.includes('map')) {
        this.host.broadcast({ type: 'filter_update', payload: state.filter });
      }
    }

    if (changed.includes('view')) {
      this.renderer.setBackgroundColour(state.view.backgroundColor);
      // During a map switch, view travels inside map_change — same reasoning as
      // filter above.  Live viewport-editor drags only have 'view' in changed.
      if (!changed.includes('map')) {
        this.host.broadcast({ type: 'view_update', payload: state.view });
      }
    }

    if (changed.includes('markers')) {
      this.markerEditor.update(state.markers, this.mapAspectRatio);
      this.updateMarkerPanel();
      this._syncPositionalAudio();
      this.host.broadcast({
        type: 'marker_update',
        payload: broadcastMarkers,
        ...(iconData.length > 0 ? { iconData } : {}),
      });
    }

    if (changed.includes('audio') && !changed.includes('map')) {
      this.soundboardPanel.update(state.audio.slots);
      this.host.broadcast({ type: 'audio_update', payload: state.audio });
    }

    void this.soundboardPanel.getActiveSlots().then((active) => {
      this.host.updateState(state, this.currentMapBlob ?? undefined, iconData, active);
    });
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
    this.syncView(this.state.getState());
    this.filterSelect.value = this.state.getState().filter.filterId;

    // Capture fog state after loadForMap so the correct state is used everywhere
    const fog = this.state.getState().fog;

    // Update fog + viewport + marker aspect ratios once the texture dimensions are known
    this.renderer.onMapLoaded = (aspect) => {
      this.mapAspectRatio = aspect;
      this.fogEditor.setMapAspect(aspect);
      this.viewportEditor.setMapAspect(aspect);
      this.markerEditor.update(this.state.getState().markers, aspect);
      this.updateMarkerPanel();
    };

    // Pass fog explicitly so the texture-load callback always redraws the right
    // fog even if another loadMap call races ahead of this one's decode.
    this.renderer.loadMap(blob, fog);

    this.setStatus(map.name, 'ok');

    // Stop positional and soundboard audio from the previous map
    this.positionalAudio.setSources([]);
    this._activePositional.clear();
    this._assetDataUrls.clear();
    this.soundboardPanel.stopAll();
    this.soundboardPanel.update(this.state.getState().audio.slots);

    // Broadcast new map to all connected players.
    // fog, filter, view, markers, and audio all travel atomically inside map_change.
    const allMarkers        = this.state.getState().markers;
    const visibleMarkers    = allMarkers.filter((m) => !m.hidden);
    const broadcastMarkers2 = allMarkers.filter((m) => !m.hidden || m.role === 'audio_source');
    const markerIconData    = this._collectIconData(visibleMarkers);
    const soundboardActive  = await this.soundboardPanel.getActiveSlots();
    this.host.broadcast({
      type: 'map_change',
      payload:    { id: map.id, name: map.name },
      fog,
      filter:     this.state.getState().filter,
      view:       this.state.getState().view,
      markers:    broadcastMarkers2,
      audio:      this.state.getState().audio,
      ...(markerIconData.length > 0    ? { iconData:         markerIconData    } : {}),
      ...(soundboardActive.length > 0  ? { soundboardActive: soundboardActive } : {}),
      mapBlob:    blob,
      transition: this.buildTransitionConfig(),
    });

    // Preload and broadcast audio buffers for audio_source markers on this map.
    // This populates the Host cache so late-joining players also receive the buffers.
    void this._preloadMarkerAudio(this.state.getState().markers);
  }

  // ─── DOM binding ──────────────────────────────────────────────────────────

  private bindDOMRefs(): void {
    const q = <T extends HTMLElement>(sel: string): T =>
      document.querySelector<T>(sel)!;

    this.mapSelect                  = q<HTMLSelectElement>('#map-select');
    this.transitionSelect           = q<HTMLSelectElement>('#transition-select');
    this.transitionParamsContainer  = q('#transition-params');
    this.filterSelect               = q<HTMLSelectElement>('#filter-select');
    this.filterParamsContainer = q('#filter-params');
    this.viewBgColour          = q<HTMLInputElement>('#view-bg-colour');
    this.viewDefaultActions    = q('#view-default-actions');
    this.editViewportBtn       = q<HTMLButtonElement>('#edit-viewport-btn');
    this.editViewportActions   = q('#edit-viewport-actions');
    this.fogDrawBtn            = q<HTMLButtonElement>('#fog-draw-btn');
    this.fogDeleteBtn          = q<HTMLButtonElement>('#fog-delete-btn');
    this.roomCodeEl            = q('#room-code');
    this.qrContainer           = q('#qr-container');
    this.playerCountEl         = q('#player-count');
    this.statusEl              = q('#status');
    this.markerSelect          = q<HTMLSelectElement>('#marker-select');
    this.markerLabelInput      = q<HTMLInputElement>('#marker-label');
    this.markerIconBtn         = q<HTMLButtonElement>('#marker-icon-btn');
    this.markerColorInput      = q<HTMLInputElement>('#marker-color');
    this.markerSizeInput       = q<HTMLInputElement>('#marker-size');
    this.markerSizeVal         = q('#marker-size-val');
    this.markerHiddenToggle    = q<HTMLInputElement>('#marker-hidden');
    this.markerShowLabelToggle = q<HTMLInputElement>('#marker-show-label');
  }

  private bindRenderer(): void {
    const canvas = document.querySelector<HTMLCanvasElement>('#renderer-canvas')!;
    this.renderer = new Renderer(canvas);
    this.renderer.setFilterEnabled(false); // GM sees raw unfiltered scene
    this.renderer.enableGMOverlay();
    this.renderer.setFogOpacity(0.35);     // GM sees through fog; players get full opacity
  }

  private bindViewportEditor(): void {
    const canvas = document.querySelector<HTMLCanvasElement>('#viewport-canvas')!;
    this.viewportEditor = new ViewportEditor(canvas);

    // Live drag → push view to state (and on to players via P2P)
    this.viewportEditor.onChange((view) => {
      this.state.setView(view);
    });

    // Toggle edit-mode UI
    this.viewportEditor.onEditMode((editing) => {
      this.viewDefaultActions.hidden  =  editing;
      this.editViewportActions.hidden = !editing;
      // Disable fog tools while editing viewport so they don't conflict
      this.fogDrawBtn.disabled   = editing;
      this.fogDeleteBtn.disabled = editing;
      if (editing && this.fogDrawing) {
        this.fogDrawing = false;
        this.fogEditor.disable();
        this.fogDrawBtn.classList.remove('active');
      }
      this.markerEditor?.setPointerCapture(!editing);
    });

    this.editViewportBtn.addEventListener('click', () => {
      this.viewportEditor.startEdit();
      // Expand the panel if it's collapsed
      const panel = document.querySelector('#view-panel .panel-body') as HTMLElement | null;
      const title = document.querySelector('#view-panel .panel-title') as HTMLElement | null;
      if (panel?.hidden) {
        panel.hidden = false;
        title?.setAttribute('aria-expanded', 'true');
      }
    });

    document.querySelector('#viewport-ok-btn')?.addEventListener('click', () => {
      this.viewportEditor.commitEdit();
    });

    document.querySelector('#viewport-cancel-btn')?.addEventListener('click', () => {
      this.viewportEditor.cancelEdit();
    });

    document.querySelector('#reset-viewport-btn')?.addEventListener('click', () => {
      this.viewportEditor.resetToFullMap();
    });
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
      // Restore marker interaction whenever draw mode ends (covers both the Draw
      // button and auto-exit after polygon completion via closePolygon).
      this.markerEditor?.setPointerCapture(!drawing);
      // Auto-open the Fog panel when a polygon is selected or draw mode activates
      if (drawing || hasSelection) {
        const body  = document.querySelector<HTMLElement>('#fog-panel .panel-body');
        const title = document.querySelector<HTMLElement>('#fog-panel .panel-title');
        if (body?.hidden) {
          body.hidden = false;
          title?.setAttribute('aria-expanded', 'true');
        }
      }
    });

    // Draw button toggles draw / select mode
    document.querySelector('#fog-draw-btn')?.addEventListener('click', () => {
      if (this.fogDrawing) {
        this.fogEditor.disable();
        this.markerEditor?.setPointerCapture(true);
      } else {
        this.fogEditor.enable();
        this.markerEditor?.setPointerCapture(false);
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

  private bindTransitionPanel(): void {
    this.transitionPanel = new TransitionPanel(
      this.transitionParamsContainer,
      (params) => {
        this.allTransitionParams[this.activeTransitionId] = params;
      },
    );

    // Seed default params for all transitions
    for (const def of transitionRegistry.getAll()) {
      this.allTransitionParams[def.id] = transitionRegistry.defaultParams(def.id);
    }

    // Populate transition dropdown
    this.transitionSelect.innerHTML = '';
    for (const def of transitionRegistry.getAll()) {
      const opt = document.createElement('option');
      opt.value = def.id;
      opt.textContent = def.label;
      this.transitionSelect.appendChild(opt);
    }

    this.transitionSelect.addEventListener('change', () => {
      this.activeTransitionId = this.transitionSelect.value;
      const def    = transitionRegistry.getOrFallback(this.activeTransitionId);
      const saved  = this.allTransitionParams[this.activeTransitionId] ?? transitionRegistry.defaultParams(this.activeTransitionId);
      this.transitionPanel.render(def, saved);
    });

    // Render initial panel (none — no params)
    this.transitionPanel.render(
      transitionRegistry.getOrFallback('none'),
      this.allTransitionParams['none'] ?? {},
    );
  }

  /** Returns the current transition config to include in a map_change broadcast. */
  private buildTransitionConfig(): TransitionConfig {
    return {
      transitionId: this.activeTransitionId,
      params: this.allTransitionParams[this.activeTransitionId] ?? transitionRegistry.defaultParams(this.activeTransitionId),
    };
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

    // Background colour (still a direct colour picker — not part of viewport editor)
    this.viewBgColour.addEventListener('input', () => {
      const v = this.state.getState().view;
      this.state.setView({ ...v, backgroundColor: this.viewBgColour.value });
    });

    // Open local player window as a real popup
    document.querySelector('#open-player-btn')?.addEventListener('click', () => {
      const code = this.roomCodeEl.textContent?.trim() ?? '';
      const w = Math.min(1600, screen.width  - 80);
      const h = Math.min(1000, screen.height - 80);
      const l = Math.round((screen.width  - w) / 2);
      const t = Math.round((screen.height - h) / 2);
      window.open(
        `${this.playerOrigin}/player#${code}`,
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

  private syncView(state: SessionState): void {
    this.viewportEditor.setView(state.view);
    this.viewBgColour.value = state.view.backgroundColor;
  }

  private setStatus(msg: string, level: 'ok' | 'warn' | 'error'): void {
    this.statusEl.textContent = msg;
    this.statusEl.dataset['level'] = level;
  }

  // ─── Marker editor ────────────────────────────────────────────────────────

  private bindMarkerEditor(): void {
    const canvas    = document.querySelector<HTMLCanvasElement>('#gm-markers-canvas')!;
    const ctxMenuEl = document.querySelector<HTMLElement>('#marker-context-menu')!;

    this.iconPicker = new IconPicker();
    void this.iconPicker.load();

    this.markerEditor = new MarkerEditor(
      canvas,
      ctxMenuEl,
      (markers) => this.state.setMarkers(markers),
      (marker) => {
        this.selectedMarkerId = marker?.id ?? null;
        this.updateMarkerPanel();
        if (marker) {
          const body  = document.querySelector<HTMLElement>('#markers-panel .panel-body');
          const title = document.querySelector<HTMLElement>('#markers-panel .panel-title');
          if (body?.hidden) {
            body.hidden = false;
            title?.setAttribute('aria-expanded', 'true');
          }
        }
      },
      () => this.iconPicker.iconCache,
    );

    this.markerEditor.setFogSelectCallback((pos) => this.fogEditor.trySelectAt(pos));

    document.querySelector('#add-marker-btn')?.addEventListener('click', () => {
      this.markerEditor.addMarker(0.5, 0.5);
    });

    document.querySelector('#ctx-add-marker')?.addEventListener('click', () => {
      const { x, y } = this.markerEditor.ctxPos;
      this.markerEditor.addMarker(x, y);
      ctxMenuEl.hidden = true;
    });

    document.querySelector('#delete-marker-btn')?.addEventListener('click', () => {
      if (!this.selectedMarkerId) return;
      const markers = this.state.getState().markers.filter((m) => m.id !== this.selectedMarkerId);
      this.selectedMarkerId = null;
      this.markerEditor.selectById(null);
      this.state.setMarkers(markers);
    });


    this.markerSelect.addEventListener('change', () => {
      const id = this.markerSelect.value || null;
      this.selectedMarkerId = id;
      this.markerEditor.selectById(id);
      this.updateMarkerPanel();
    });

    this.markerLabelInput.addEventListener('input', () => {
      this.updateSelectedMarker({ label: this.markerLabelInput.value });
    });

    this.markerIconBtn.addEventListener('click', () => {
      const currentIcon = this.state.getState().markers.find(
        (m) => m.id === this.selectedMarkerId
      )?.icon ?? '◆';
      this.iconPicker.open(this.markerIconBtn, currentIcon, (icon) => {
        this.updateSelectedMarker({ icon });
      });
    });

    this.markerColorInput.addEventListener('input', () => {
      this.updateSelectedMarker({ color: this.markerColorInput.value });
    });

    this.markerSizeInput.addEventListener('input', () => {
      const val = parseFloat(this.markerSizeInput.value);
      this.markerSizeVal.textContent = `${val.toFixed(1)}×`;
      this.updateSelectedMarker({ size: val });
    });

    this.markerHiddenToggle.addEventListener('change', () => {
      this.updateSelectedMarker({ hidden: this.markerHiddenToggle.checked });
    });

    this.markerShowLabelToggle.addEventListener('change', () => {
      this.updateSelectedMarker({ showLabel: this.markerShowLabelToggle.checked });
    });

    // Role selector
    document.querySelectorAll<HTMLElement>('.marker-role-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.selectedMarkerId) return;
        const role = btn.dataset['role'] as MarkerRole;
        // Enforce single listener — demote any other listener in the same pass
        const markers = this.state.getState().markers.map((m) => {
          if (m.id === this.selectedMarkerId) return { ...m, role };
          if (role === 'listener' && m.role === 'listener') return { ...m, role: 'default' as MarkerRole };
          return m;
        });
        this.state.setMarkers(markers);
      });
    });

    // Sound assignment
    document.querySelector('#marker-sound-btn')?.addEventListener('click', () => {
      this.soundboardPanel.audioModal.open((asset) => {
        void this._assignMarkerAudio(asset);
      });
    });

    // Volume slider
    const audioVolInput = document.querySelector<HTMLInputElement>('#marker-audio-volume');
    audioVolInput?.addEventListener('input', () => {
      const val = parseFloat(audioVolInput!.value);
      this.updateSelectedMarker({ audioVolume: val });
    });

    // Playback mode buttons — exclusive 3-way selection
    document.querySelector('#marker-once-btn')?.addEventListener('click', () => {
      this.updateSelectedMarker({ audioLoop: false, audioRandom: false });
    });
    document.querySelector('#marker-loop-btn')?.addEventListener('click', () => {
      this.updateSelectedMarker({ audioLoop: true, audioRandom: false });
    });
    document.querySelector('#marker-random-btn')?.addEventListener('click', () => {
      this.updateSelectedMarker({ audioLoop: false, audioRandom: true });
    });

    // Random frequency slider
    const randomFreqInput = document.querySelector<HTMLInputElement>('#marker-random-freq');
    const randomFreqVal   = document.querySelector<HTMLElement>('#marker-random-freq-val');
    randomFreqInput?.addEventListener('input', () => {
      const val = parseInt(randomFreqInput!.value);
      if (randomFreqVal) randomFreqVal.textContent = `~${val} / 10 min`;
      this.updateSelectedMarker({ audioRandomFreq: val });
    });

    // Audio muted toggle
    document.querySelector<HTMLInputElement>('#marker-audio-muted')?.addEventListener('change', (e) => {
      this.updateSelectedMarker({ audioMuted: (e.target as HTMLInputElement).checked });
    });

    // Max range slider
    const maxDistInput = document.querySelector<HTMLInputElement>('#marker-max-dist');
    const maxDistVal   = document.querySelector<HTMLElement>('#marker-max-dist-val');
    maxDistInput?.addEventListener('input', () => {
      const val = parseFloat(maxDistInput.value);
      if (maxDistVal) maxDistVal.textContent = val.toFixed(2);
      this.updateSelectedMarker({ audioMaxDistance: val });
    });
  }

  private updateSelectedMarker(patch: Partial<Marker>): void {
    if (!this.selectedMarkerId) return;
    const markers = this.state.getState().markers.map((m) =>
      m.id === this.selectedMarkerId ? { ...m, ...patch } : m
    );
    this.state.setMarkers(markers);
  }

  private async _assignMarkerAudio(asset: AudioAsset): Promise<void> {
    if (!this.selectedMarkerId) return;
    this.updateSelectedMarker({ audioTrackId: asset.id });
    const blob = await AudioAssetStore.getBlob(asset);
    if (!blob) return;
    const [arrayBuf, dataUrl] = await Promise.all([
      blob.arrayBuffer(),
      this._blobToDataUrl(blob),
    ]);
    this._assetDataUrls.set(asset.id, dataUrl);
    await this.positionalAudio.storeBuffer(asset.id, arrayBuf);
    this._syncPositionalAudio();
  }

  private _blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  }

  private async _preloadMarkerAudio(markers: Marker[]): Promise<void> {
    const all = await AudioAssetStore.getAll();
    for (const m of markers) {
      if (m.role !== 'audio_source' || !m.audioTrackId) continue;
      const asset = all.find((a) => a.id === m.audioTrackId);
      if (!asset) continue;
      const blob = await AudioAssetStore.getBlob(asset);
      if (!blob) continue;
      const [arrayBuf, dataUrl] = await Promise.all([
        blob.arrayBuffer(),
        this._blobToDataUrl(blob),
      ]);
      this._assetDataUrls.set(m.audioTrackId, dataUrl);
      await this.positionalAudio.storeBuffer(m.audioTrackId, arrayBuf);
    }
    // All buffers loaded — engine starts sources; onSourceStart fires positional_play
    this._syncPositionalAudio();
  }

  private bindSoundboardPanel(): void {
    this.soundboardEngine = new SoundboardEngine();

    this.soundboardPanel = new SoundboardPanel(
      this.soundboardEngine,
      // Slots changed: persist to state
      (slots) => {
        const audio = this.state.getState().audio;
        this.state.setAudio({ ...audio, slots });
      },
      // Broadcast play/stop to players
      (msg: SoundboardBroadcast) => {
        if (!this.remoteAudioEnabled) return;
        if (msg.type === 'play') {
          this.host.broadcast({
            type:    'soundboard_play',
            slotId:  msg.data.slotId,
            assetId: msg.data.assetId,
            loop:    msg.data.loop,
            volume:  msg.data.volume,
            dataUrl: msg.data.dataUrl,
          });
        } else if (msg.type === 'stop') {
          this.host.broadcast({ type: 'soundboard_stop', slotId: msg.slotId });
        } else if (msg.type === 'volume') {
          this.host.broadcast({ type: 'soundboard_volume', slotId: msg.slotId, volume: msg.volume });
        } else {
          this.host.broadcast({ type: 'soundboard_mute_all', muted: msg.muted });
        }
      },
    );

    this.soundboardPanel.onAssetsLoaded = () => {
      this.host.updateSoundboardAssets(this.soundboardPanel.getLoadedAssets());
    };

    // Remote audio toggle
    const remoteToggle = document.querySelector<HTMLInputElement>('#remote-audio-toggle');
    if (remoteToggle) {
      remoteToggle.checked = this.remoteAudioEnabled;
      remoteToggle.addEventListener('change', () => {
        this.remoteAudioEnabled = remoteToggle.checked;
        localStorage.setItem(REMOTE_AUDIO_KEY, String(this.remoteAudioEnabled));
        if (!this.remoteAudioEnabled) {
          // Stop all currently playing slots on remote players
          const { slots } = this.state.getState().audio;
          for (const slot of slots) {
            if (this.soundboardEngine.isPlaying(slot.id)) {
              this.host.broadcast({ type: 'soundboard_stop', slotId: slot.id });
            }
          }
        }
      });
    }
  }

  private _syncPositionalAudio(): void {
    const markers = this.state.getState().markers;
    const listener = markers.find((m) => m.role === 'listener');

    if (!listener) {
      // Stop all active positional sources on players
      for (const markerId of this._activePositional.keys()) {
        this.host.broadcast({ type: 'positional_stop', markerId });
      }
      this._activePositional.clear();
      this.positionalAudio.clearListener();
    } else {
      this.positionalAudio.setListenerPosition(listener.position.x, listener.position.y);
    }

    this.positionalAudio.setSources(markers);

    // Send volume updates for active loop sources as listener moves
    if (listener) {
      for (const [markerId, state] of this._activePositional.entries()) {
        if (!state.loop) continue;
        const marker = markers.find((m) => m.id === markerId);
        if (!marker) continue;
        const gain = this.positionalAudio.calcGainForMarker(marker);
        if (Math.abs(gain - state.lastVolume) > 0.01) {
          state.lastVolume = gain;
          this.host.broadcast({ type: 'positional_volume', markerId, volume: gain });
        }
      }
    }
  }

  private updateMarkerPanel(): void {
    const markers = this.state.getState().markers;
    const sel     = markers.find((m) => m.id === this.selectedMarkerId) ?? null;

    // Rebuild dropdown
    this.markerSelect.innerHTML = '<option value="">— No marker selected —</option>';
    for (const m of markers) {
      const opt = document.createElement('option');
      opt.value       = m.id;
      opt.textContent = m.label || '(unnamed)';
      this.markerSelect.appendChild(opt);
    }
    if (sel) this.markerSelect.value = sel.id;

    const controlsEl = document.querySelector<HTMLElement>('#marker-controls');
    if (controlsEl) controlsEl.hidden = !sel;

    if (sel) {
      this.markerLabelInput.value     = sel.label;
      this.markerColorInput.value     = sel.color;
      this.markerSizeInput.value      = String(sel.size);
      this.markerSizeVal.textContent  = `${sel.size.toFixed(1)}×`;
      this.markerHiddenToggle.checked    = sel.hidden;
      this.markerShowLabelToggle.checked = sel.showLabel ?? false;

      // Update icon button display
      this.markerIconBtn.innerHTML = '';
      if (sel.icon.startsWith('asset:') || sel.icon.startsWith('data:')) {
        const bmp = this.iconPicker.iconCache.get(sel.icon);
        const img = document.createElement('img');
        if (bmp) {
          const cv = document.createElement('canvas');
          cv.width = 20; cv.height = 20;
          cv.getContext('2d')!.drawImage(bmp, 0, 0, 20, 20);
          img.src = cv.toDataURL();
        }
        this.markerIconBtn.appendChild(img);
      } else {
        this.markerIconBtn.textContent = sel.icon;
      }

      // Role buttons
      document.querySelectorAll<HTMLElement>('.marker-role-btn').forEach((btn) => {
        btn.classList.toggle('marker-role-btn--active', btn.dataset['role'] === sel.role);
      });

      // Audio controls — only visible for audio_source role
      const audioControlsEl = document.querySelector<HTMLElement>('#marker-audio-controls');
      if (audioControlsEl) audioControlsEl.hidden = sel.role !== 'audio_source';

      if (sel.role === 'audio_source') {
        const soundRow      = document.querySelector<HTMLElement>('#marker-sound-row');
        const soundBtn      = document.querySelector<HTMLButtonElement>('#marker-sound-btn');
        const soundControls = document.querySelector<HTMLElement>('#marker-sound-controls');
        const onceBtn       = document.querySelector<HTMLButtonElement>('#marker-once-btn');
        const loopBtn       = document.querySelector<HTMLButtonElement>('#marker-loop-btn');
        const randomBtn     = document.querySelector<HTMLButtonElement>('#marker-random-btn');
        const audioVolInput = document.querySelector<HTMLInputElement>('#marker-audio-volume');
        const randomRow     = document.querySelector<HTMLElement>('#marker-random-row');
        const randomFreqInput = document.querySelector<HTMLInputElement>('#marker-random-freq');
        const randomFreqVal   = document.querySelector<HTMLElement>('#marker-random-freq-val');
        const mutedToggle   = document.querySelector<HTMLInputElement>('#marker-audio-muted');
        const maxDistInput  = document.querySelector<HTMLInputElement>('#marker-max-dist');
        const maxDistVal    = document.querySelector<HTMLElement>('#marker-max-dist-val');

        if (sel.audioTrackId) {
          // Show name-button style (same as a filled soundboard slot)
          if (soundRow)      soundRow.className = 'sb-slot-name-row';
          if (soundBtn) {
            soundBtn.className   = 'sb-name-btn';
            soundBtn.textContent = '…';
            void AudioAssetStore.get(sel.audioTrackId).then((asset) => {
              const btn = document.querySelector<HTMLButtonElement>('#marker-sound-btn');
              if (btn) btn.textContent = asset?.name ?? 'Unknown Sound';
            });
          }
          if (soundControls) soundControls.hidden = false;
        } else {
          // Show assign-button style (same as an empty soundboard slot)
          if (soundRow)      soundRow.className = 'sb-slot-empty';
          if (soundBtn) {
            soundBtn.className   = 'sb-assign-btn btn btn--ghost btn--sm btn--full';
            soundBtn.textContent = '+ Assign Sound';
          }
          if (soundControls) soundControls.hidden = true;
        }

        if (audioVolInput)    audioVolInput.value         = String(sel.audioVolume ?? 1);
        if (onceBtn)          onceBtn.classList.toggle('sb-mode-btn--active', !sel.audioLoop && !(sel.audioRandom ?? false));
        if (loopBtn)          loopBtn.classList.toggle('sb-mode-btn--active', sel.audioLoop);
        if (randomBtn)        randomBtn.classList.toggle('sb-mode-btn--active', !!(sel.audioRandom));
        if (randomRow)        randomRow.hidden             = !(sel.audioRandom);
        if (randomFreqInput)  randomFreqInput.value        = String(sel.audioRandomFreq ?? 10);
        if (randomFreqVal)    randomFreqVal.textContent    = `~${sel.audioRandomFreq ?? 10} / 10 min`;
        if (mutedToggle)      mutedToggle.checked          = sel.audioMuted;
        if (maxDistInput)     maxDistInput.value           = String(sel.audioMaxDistance);
        if (maxDistVal)       maxDistVal.textContent       = sel.audioMaxDistance.toFixed(2);
      }
    }
  }
}
