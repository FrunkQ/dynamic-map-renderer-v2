// ─── Map & View ──────────────────────────────────────────────────────────────

export interface MapState {
  /** Stable ID (UUID) used as the IndexedDB key for the map blob */
  id: string;
  /** Original filename, shown in the selector UI */
  name: string;
}

export interface ViewState {
  /** Normalised 0–1 horizontal centre of the player's visible region */
  centerX: number;
  /** Normalised 0–1 vertical centre of the player's visible region */
  centerY: number;
  /** Zoom multiplier; 1.0 = fit-to-screen */
  scale: number;
}

// ─── Fog of War ──────────────────────────────────────────────────────────────

export interface FogVertex {
  x: number; // 0–1 normalised
  y: number; // 0–1 normalised
}

export interface FogPolygon {
  id: string;
  vertices: FogVertex[];
  /** Fill colour for this fog patch (default black) */
  color: string;
}

export interface FogState {
  polygons: FogPolygon[];
}

// ─── Filters ─────────────────────────────────────────────────────────────────

export type FilterParamValues = Record<string, number | boolean | string>;

export interface FilterState {
  /** ID of the active filter definition */
  filterId: string;
  /** Current param values keyed by param id, per filter */
  params: Record<string, FilterParamValues>;
}

// ─── Markers (stub — fully typed for future use) ──────────────────────────────

export type MarkerType = 'icon' | 'token' | 'note' | 'zone';

export interface Marker {
  id: string;
  type: MarkerType;
  position: { x: number; y: number }; // 0–1 normalised
  label?: string;
  /** Emoji, URL, or asset ID */
  icon?: string;
  /** Relative size; 1.0 = default */
  size: number;
  color: string;
  /** If true, only the GM sees this marker */
  gmOnly: boolean;
  /** Audio asset ID to use as a motion-tracker source */
  linkedAudioId?: string;
}

// ─── Audio (stub — fully typed for future use) ───────────────────────────────

export interface AudioState {
  activeAmbientId: string | null;
  volume: number;
  motionTracker: {
    enabled: boolean;
    sourceMarkerId: string | null;
    playerMarkerId: string | null;
  } | null;
}

// ─── Transitions ─────────────────────────────────────────────────────────────

export type TransitionType = 'fade' | 'static' | 'scan' | 'none';

export interface TransitionConfig {
  type: TransitionType;
  /** Duration in milliseconds */
  duration: number;
  /** Fade-to colour (used by 'fade' type) */
  color?: string;
}

// ─── Full Session State ───────────────────────────────────────────────────────

/** Increment when breaking changes are made to the schema */
export const STATE_VERSION = 1;

export interface SessionState {
  version: typeof STATE_VERSION;
  map: MapState | null;
  view: ViewState;
  filter: FilterState;
  fog: FogState;
  /** Populated in future; always an empty array in v1 */
  markers: Marker[];
  /** Populated in future; null values signal "not yet configured" */
  audio: AudioState;
}

export function defaultSessionState(): SessionState {
  return {
    version: STATE_VERSION,
    map: null,
    view: { centerX: 0.5, centerY: 0.5, scale: 1.0 },
    filter: { filterId: 'none', params: {} },
    fog: { polygons: [] },
    markers: [],
    audio: {
      activeAmbientId: null,
      volume: 1.0,
      motionTracker: null,
    },
  };
}

// ─── P2P Message Protocol ────────────────────────────────────────────────────

/** Sent once when a player first connects — full snapshot */
export interface MsgFullState {
  type: 'full_state';
  payload: SessionState;
  /** Raw map image included on initial connect */
  mapBlob?: ArrayBuffer;
}

export interface MsgViewUpdate {
  type: 'view_update';
  payload: ViewState;
}

export interface MsgFogUpdate {
  type: 'fog_update';
  payload: FogState;
}

export interface MsgFilterUpdate {
  type: 'filter_update';
  payload: FilterState;
  transition?: TransitionConfig;
}

export interface MsgMapChange {
  type: 'map_change';
  payload: MapState;
  mapBlob: ArrayBuffer;
  transition?: TransitionConfig;
}

/** Stub: wired in protocol but not yet acted on by player */
export interface MsgMarkerUpdate {
  type: 'marker_update';
  payload: Marker[];
}

/** Stub: wired in protocol but not yet acted on by player */
export interface MsgAudioUpdate {
  type: 'audio_update';
  payload: AudioState;
}

export type GMMessage =
  | MsgFullState
  | MsgViewUpdate
  | MsgFogUpdate
  | MsgFilterUpdate
  | MsgMapChange
  | MsgMarkerUpdate
  | MsgAudioUpdate;

// ─── Storage types ───────────────────────────────────────────────────────────

export interface StoredMap {
  id: string;
  name: string;
  blob: Blob;
  addedAt: number;
}

export interface StoredSession {
  /** Fixed key — only one session record */
  key: 'current';
  /** PeerJS peer ID — persisted for session resumption */
  peerId: string;
  /** ID of the last active map */
  lastMapId: string | null;
}
