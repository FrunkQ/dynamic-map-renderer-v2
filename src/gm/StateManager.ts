import type { SessionState, MapState, FilterState, FogState, ViewState } from '../types.ts';
import { defaultSessionState } from '../types.ts';
import { saveConfig, loadConfig } from '../storage/db.ts';
import { filterRegistry } from '../filters/FilterRegistry.ts';

type StateListener = (state: SessionState, changed: (keyof SessionState)[]) => void;

const AUTOSAVE_DEBOUNCE_MS = 1500;

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

  // ─── Load ─────────────────────────────────────────────────────────────────

  async loadForMap(map: MapState, mapBlob: ArrayBuffer): Promise<void> {
    const saved = await loadConfig(map.id);
    const base  = defaultSessionState();

    if (saved && saved.version === base.version) {
      this.state = {
        ...saved,
        map,
        // Ensure any new default fields added in later versions are present
        markers: saved.markers ?? base.markers,
        audio:   saved.audio   ?? base.audio,
      };
    } else {
      this.state = { ...base, map };
    }

    // Ensure filter defaults are seeded for filters that have no saved params
    this.seedFilterDefaults();

    this._notify(['map', 'view', 'filter', 'fog'], mapBlob);
  }

  // ─── Setters ──────────────────────────────────────────────────────────────

  setView(view: ViewState): void {
    this.state = { ...this.state, view };
    this._notify(['view']);
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

  // ─── Listeners ────────────────────────────────────────────────────────────

  onChange(fn: StateListener): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter((l) => l !== fn); };
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private _notify(changed: (keyof SessionState)[], mapBlob?: ArrayBuffer): void {
    for (const fn of this.listeners) fn(this.state, changed);
    this.scheduleAutosave();
    void mapBlob; // mapBlob is passed through to P2P layer via the listener; not saved here
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
