import type { SessionState, MapState, FilterState, FogState, ViewState, Marker, AudioState, TransitionConfig, MotionTrackerConfig, ProjectorViewport } from '../types.ts';
import { defaultSessionState } from '../types.ts';
import { saveConfig, loadConfig } from '../storage/db.ts';
import { migrateSessionState } from '../storage/migrations.ts';
import { filterRegistry } from '../filters/FilterRegistry.ts';

type StateListener = (state: SessionState, changed: (keyof SessionState)[]) => void;

const AUTOSAVE_DEBOUNCE_MS = 400;

/**
 * StateManager — single source of truth for the GM session.
 *
 * Holds the authoritative SessionState, exposes typed setters for each
 * sub-state, debounces autosave to IndexedDB, and notifies listeners
 * on every change so the UI, renderer, and P2P layer can react.
 */
export class StateManager {
  private state: SessionState = defaultSessionState();
  private listeners: StateListener[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  getState(): SessionState {
    return this.state;
  }

  /** Call after wiping IDB (e.g. bundle import) to prevent a subsequent loadMap
   *  from flushing the stale in-memory state back over the freshly written configs. */
  resetForImport(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.state = defaultSessionState();
  }

  // ─── Load ─────────────────────────────────────────────────────────────────

  async loadForMap(map: MapState, mapBlob: ArrayBuffer): Promise<void> {
    const saved     = await loadConfig(map.id);
    const migrated  = saved ? migrateSessionState(saved) : null;
    const base      = defaultSessionState();
    // Carry-forward: when arriving on a map with no saved config, inherit the
    // currently-loaded map's tracker config so a GM doesn't have to reconfigure
    // their preferred range/rate/colour every time they add a new map.
    const carriedTracker = this.state.motionTracker;

    this.state = migrated
      ? { ...migrated, map }
      : { ...base, map, motionTracker: { ...carriedTracker } };

    // Ensure filter defaults are seeded for filters that have no saved params
    this.seedFilterDefaults();

    this._notify(['map', 'view', 'filter', 'fog'], mapBlob);
  }

  // ─── Setters ──────────────────────────────────────────────────────────────

  setView(view: ViewState): void {
    this.state = { ...this.state, view };
    this._notify(['view']);
  }

  setProjectorViewport(vp: ProjectorViewport): void {
    // Migrate the retired 'black' mode to 'full' on the way in so legacy
    // bundles + IndexedDB entries don't leave the projector in a dead
    // state (the blackout overlay + button were removed in v2.11/A8.3
    // because the broadcast-toggle's faff overlay covers the same need).
    const normalised: ProjectorViewport = (vp.mode as string) === 'black'
      ? { ...vp, mode: 'full' }
      : vp;
    this.state = { ...this.state, projectorViewport: normalised };
    this._notify(['projectorViewport']);
  }

  /** Read-only access to the current state. */
  snapshot(): SessionState {
    return this.state;
  }

  setFilter(filterId: string): void {
    const current = this.state.filter;
    this.seedFilterDefaults();
    this.state = {
      ...this.state,
      filter: { ...current, filterId },
    };
    this._notify(['filter']);
  }

  setFilterParams(filterId: string, values: Record<string, number | boolean | string>): void {
    const current = this.state.filter;
    this.state = {
      ...this.state,
      filter: {
        ...current,
        params: { ...current.params, [filterId]: values },
      },
    };
    this._notify(['filter']);
  }

  setFog(fog: FogState): void {
    this.state = { ...this.state, fog };
    this._notify(['fog']);
  }

  setMarkers(markers: Marker[]): void {
    this.state = { ...this.state, markers };
    this._notify(['markers'], undefined, true);
  }

  /** Apply a partial patch to a single marker by id. */
  updateMarker(id: string, patch: Partial<Marker>): void {
    this.setMarkers(this.state.markers.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  /** Atomically transform the marker array — useful for multi-marker passes (e.g. role mutex). */
  updateMarkers(updater: (markers: Marker[]) => Marker[]): void {
    this.setMarkers(updater(this.state.markers));
  }

  setAudio(audio: AudioState): void {
    this.state = { ...this.state, audio };
    this._notify(['audio'], undefined, true);
  }

  setTransition(config: TransitionConfig): void {
    this.state = { ...this.state, transition: config };
    this._notify(['transition'], undefined, true);
  }

  setMotionTracker(config: MotionTrackerConfig): void {
    this.state = { ...this.state, motionTracker: config };
    this._notify(['motionTracker'], undefined, true);
  }

  // ─── Listeners ────────────────────────────────────────────────────────────

  onChange(fn: StateListener): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter((l) => l !== fn); };
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private _notify(changed: (keyof SessionState)[], mapBlob?: ArrayBuffer, immediate = false): void {
    for (const fn of this.listeners) fn(this.state, changed);
    // Discrete mutations (markers, audio, transition) pass immediate=true so the
    // write goes to IDB right away rather than waiting for the debounce window.
    if (immediate) void this.flushSave();
    else this.scheduleAutosave();
    void mapBlob; // mapBlob is passed through to P2P layer via the listener; not saved here
  }

  /** Flush any pending debounced save immediately. Call before switching maps. */
  async flushSave(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.state.map) {
      await saveConfig(this.state.map.id, this.state);
    }
  }

  private scheduleAutosave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      if (this.state.map) {
        void saveConfig(this.state.map.id, this.state);
      }
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  private seedFilterDefaults(): void {
    const filter = this.state.filter;
    const allFilters = filterRegistry.getAll();
    const seeded: FilterState['params'] = { ...filter.params };

    for (const fd of allFilters) {
      if (!seeded[fd.id]) {
        seeded[fd.id] = filterRegistry.defaultParams(fd.id);
      }
    }

    this.state = { ...this.state, filter: { ...filter, params: seeded } };
  }
}
