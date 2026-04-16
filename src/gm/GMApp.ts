import { StateManager } from './StateManager.ts';
import { MapManager } from './MapManager.ts';
import { FogEditor } from './FogEditor.ts';
import { Renderer } from '../rendering/Renderer.ts';
import { FilterPanel } from '../filters/FilterPanel.ts';
import { filterRegistry } from '../filters/FilterRegistry.ts';
import { Host } from '../p2p/Host.ts';
import { saveSession, loadSession } from '../storage/db.ts';
import type { SessionState, StoredMap } from '../types.ts';
import QRCode from 'qrcode';

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
  private roomCodeEl!:        HTMLElement;
  private qrContainer!:       HTMLElement;
  private playerCountEl!:     HTMLElement;
  private statusEl!:          HTMLElement;
  private currentMapBlob:     ArrayBuffer | null = null;

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
    await this.populateMapList();
    await this.startHost();

    this.state.onChange((s, changed) => this.onStateChange(s, changed));
    this.renderer.start();
    this.setStatus('Ready', 'ok');
  }

  // ─── Host lifecycle ───────────────────────────────────────────────────────

  private async startHost(): Promise<void> {
    const session = await loadSession();
    this.host.start(session?.peerId);
  }

  private async onHostReady(roomCode: string): Promise<void> {
    this.roomCodeEl.textContent = roomCode;

    const playerUrl = `${location.origin}/player#${roomCode}`;
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

    // Send current state to new joiner
    if (this.currentMapBlob) {
      this.host.broadcast({
        type: 'full_state',
        payload: this.state.getState(),
        mapBlob: this.currentMapBlob,
      });
    }
  }

  private onPeerDisconnected(id: string): void {
    this.playerCountEl.textContent = String(this.host.connectedCount);
    this.setStatus(`Player disconnected (${id.slice(0, 8)}…)`, 'warn');
  }

  // ─── State change → propagate to renderer + P2P ───────────────────────────

  private onStateChange(state: SessionState, changed: (keyof SessionState)[]): void {
    if (changed.includes('view')) {
      this.renderer.setView(state.view);
    }

    if (changed.includes('fog')) {
      this.renderer.updateFog(state.fog);
      this.host.broadcast({ type: 'fog_update', payload: state.fog });
    }

    if (changed.includes('filter')) {
      this.renderer.setFilter(state.filter);
      this.filterPanel.render(
        filterRegistry.getOrFallback(state.filter.filterId),
        state.filter.params[state.filter.filterId] ?? {}
      );
      this.host.broadcast({ type: 'filter_update', payload: state.filter });
    }

    if (changed.includes('view')) {
      this.host.broadcast({ type: 'view_update', payload: state.view });
    }

    this.host.updateState(state, this.currentMapBlob ?? undefined);
  }

  // ─── Map selection ────────────────────────────────────────────────────────

  private async populateMapList(): Promise<void> {
    const maps = await this.maps.getAll();
    this.mapSelect.innerHTML = '<option value="">— Select map —</option>';
    for (const m of maps) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      this.mapSelect.appendChild(opt);
    }
    if (maps.length > 0) await this.loadMap(maps[0]!);
  }

  private async loadMap(map: StoredMap): Promise<void> {
    this.setStatus(`Loading ${map.name}…`, 'ok');
    const blob = await this.maps.getBlob(map.id);
    if (!blob) { this.setStatus('Map blob not found', 'error'); return; }

    this.currentMapBlob = blob;
    this.renderer.loadMap(blob);
    await this.state.loadForMap({ id: map.id, name: map.name }, blob);
    this.fogEditor.loadState(this.state.getState().fog);
    this.syncViewSliders(this.state.getState());
    this.filterSelect.value = this.state.getState().filter.filterId;
    this.setStatus(map.name, 'ok');

    // Broadcast new map to all connected players
    this.host.broadcast({
      type: 'map_change',
      payload: { id: map.id, name: map.name },
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
    this.roomCodeEl             = q('#room-code');
    this.qrContainer            = q('#qr-container');
    this.playerCountEl          = q('#player-count');
    this.statusEl               = q('#status');
  }

  private bindRenderer(): void {
    const canvas = document.querySelector<HTMLCanvasElement>('#renderer-canvas')!;
    this.renderer = new Renderer(canvas);
    this.renderer.enableGMOverlay();
  }

  private bindFogEditor(): void {
    const canvas = document.querySelector<HTMLCanvasElement>('#fog-canvas')!;
    this.fogEditor = new FogEditor(canvas, (fog) => this.state.setFog(fog));

    document.querySelector('#fog-draw-btn')?.addEventListener('click', () => {
      this.fogEditor.enable();
    });
    document.querySelector('#fog-select-btn')?.addEventListener('click', () => {
      this.fogEditor.disable();
    });
    document.querySelector('#fog-delete-btn')?.addEventListener('click', () => {
      this.fogEditor.deleteSelected();
    });
    document.querySelector('#fog-clear-btn')?.addEventListener('click', () => {
      if (confirm('Clear all fog? This cannot be undone.')) this.fogEditor.clearAll();
    });
    document.querySelector<HTMLInputElement>('#fog-color')?.addEventListener('input', (e) => {
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

    // View controls
    const updateView = () => {
      this.state.setView({
        centerX: parseFloat(this.viewCenterX.value),
        centerY: parseFloat(this.viewCenterY.value),
        scale:   parseFloat(this.viewScale.value),
      });
    };
    this.viewCenterX.addEventListener('input', updateView);
    this.viewCenterY.addEventListener('input', updateView);
    this.viewScale.addEventListener('input', updateView);

    // Open local player window
    document.querySelector('#open-player-btn')?.addEventListener('click', () => {
      const code = this.roomCodeEl.textContent ?? '';
      window.open(`/player#${code}`, '_blank', 'noopener');
    });

    // Copy player URL
    document.querySelector('#copy-url-btn')?.addEventListener('click', () => {
      const code = this.roomCodeEl.textContent ?? '';
      void navigator.clipboard.writeText(`${location.origin}/player#${code}`);
      this.setStatus('Player URL copied!', 'ok');
    });
  }

  private syncViewSliders(state: SessionState): void {
    this.viewCenterX.value = String(state.view.centerX);
    this.viewCenterY.value = String(state.view.centerY);
    this.viewScale.value   = String(state.view.scale);
  }

  private setStatus(msg: string, level: 'ok' | 'warn' | 'error'): void {
    this.statusEl.textContent = msg;
    this.statusEl.dataset['level'] = level;
  }
}
