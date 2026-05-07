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
  /**
   * Fraction of the map's width that is visible (1.0 = full map width).
   * Screen-aspect-ratio-independent — the player letterboxes / pillarboxes
   * to fit this rectangle into their own window.
   */
  viewNW: number;
  /**
   * Fraction of the map's height that is visible (1.0 = full map height).
   */
  viewNH: number;
  /** CSS hex colour rendered behind the map image — default #000000 */
  backgroundColor: string;
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

// ─── Markers ──────────────────────────────────────────────────────────────────

export type MarkerRole = 'default' | 'listener' | 'audio_source';

export interface Marker {
  id: string;
  role: MarkerRole;
  position: { x: number; y: number }; // 0–1 normalised map coords

  // Visual
  label: string;
  icon:  string;   // emoji (1–2 chars)
  color: string;   // hex
  size:  number;   // 1.0 = default

  // Visibility
  hidden:            boolean; // hides from players; GM sees with ghost opacity
  hiddenFromTracker: boolean; // Phase 4: suppress from tracker sonar pings
  showLabel:         boolean; // show name text on the player map (default false)

  // Audio source fields (Phase 3+)
  audioTrackId:     string | null;
  audioLoop:        boolean;
  audioMuted:       boolean;
  audioMaxDistance: number;   // normalised map units
  audioVolume:      number;   // 0–1 base volume (multiplied by positional attenuation)
  audioRandom:      boolean;  // random play mode — fires one-shots at randomised intervals
  audioRandomFreq:  number;   // target plays per 10 minutes (1–100) when audioRandom is true

  // Listener fields (Phase 3+)
  trackerEnabled: boolean;
  trackerScale:   number;     // 0.2–2.0
}

export function defaultMarker(id: string, x = 0.5, y = 0.5): Marker {
  return {
    id,
    role:     'default',
    position: { x, y },
    label:    'New Marker',
    icon:     '◆',
    color:    '#e03e3e',
    size:     1.0,
    hidden:            false,
    hiddenFromTracker: false,
    showLabel:         false,
    audioTrackId:      null,
    audioLoop:         false,
    audioMuted:        false,
    audioMaxDistance:  0.3,
    audioVolume:       1.0,
    audioRandom:       false,
    audioRandomFreq:   10,
    trackerEnabled:    false,
    trackerScale:      1.0,
  };
}

// ─── Audio / Soundboard ──────────────────────────────────────────────────────

export const SOUNDBOARD_PAGE_SIZE = 8;

/** A single slot in the per-map soundboard (up to N per page). */
export interface SoundboardSlot {
  id:      string;
  assetId: string | null; // references AudioAsset.id in global audioAssets store
  label:   string;        // display name; defaults to asset name on assign
  loop:    boolean;
  volume:  number;        // 0–1
  /** Random auto-play mode — fires one-shots at a randomised interval. */
  random?:     boolean;
  /** Target plays per 10 minutes (1–100) when random=true. */
  randomFreq?: number;
  /** Persisted active state — loop: should auto-resume on map load; random: scheduler should restart on map load. */
  playing?: boolean;
}

export interface AudioState {
  slots: SoundboardSlot[];
  motionTracker: {
    enabled:        boolean;
    sourceMarkerId: string | null;
    playerMarkerId: string | null;
  } | null;
}

/** Global audio asset (lives in audioAssets IDB store — not per-map). */
export interface AudioAsset {
  id:                  string;
  name:                string;
  source:              'freesound' | 'upload';
  freesoundId?:        number;
  freesoundPreviewUrl?: string; // preview-hq-mp3 — used for re-download
  freesoundPageUrl?:   string;  // canonical Freesound page
  username?:           string;
  license?:            string;  // human-readable, e.g. "CC0" or "CC-BY"
  attribution?:        string;  // "Sound: [name] by [username] via Freesound"
  durationSecs?:       number;
  addedAt:             number;
}

/** Carries a playing slot's audio data over P2P for new joiners / map changes. */
export interface SoundboardAudioData {
  slotId:  string;
  assetId: string;
  loop:    boolean;
  volume:  number;
  dataUrl: string; // data:audio/mpeg;base64,…
}

// ─── Transitions ─────────────────────────────────────────────────────────────

export interface TransitionConfig {
  /** ID of the active transition definition (e.g. 'none', 'fade', 'wipe') */
  transitionId: string;
  /** Flat param values for the selected transition */
  params: Record<string, number | string>;
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
    view: { centerX: 0.5, centerY: 0.5, viewNW: 1.0, viewNH: 1.0, backgroundColor: '#000000' },
    filter: { filterId: 'none', params: {} },
    fog: { polygons: [] },
    markers: [],
    audio: {
      slots: [],
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
  /** Custom icon blobs for any asset: icons in the session's markers */
  iconData?: MarkerIconData[];
  /** Audio data for slots that are currently playing */
  soundboardActive?: SoundboardAudioData[];
  /** All loaded audio assets — preloaded so sounds start instantly on first play */
  soundboardAssets?: { assetId: string; dataUrl?: string }[];
}

export interface MsgViewUpdate {
  type: 'view_update';
  payload: ViewState;
}

export interface MsgFogUpdate {
  type: 'fog_update';
  payload: FogState;
  /**
   * ID of the map this fog state belongs to.
   * Players use this to discard stale fog_update messages that arrive out of
   * order when BC and PeerJS deliver duplicates with different latencies.
   * Absent on very old messages — treated as always-applicable.
   */
  mapId?: string;
}

export interface MsgFilterUpdate {
  type: 'filter_update';
  payload: FilterState;
  transition?: TransitionConfig;
}

export interface MsgMapChange {
  type: 'map_change';
  payload: MapState;
  /** Fog state for the incoming map — applied atomically when texture finishes loading */
  fog?: FogState;
  /**
   * Filter, view, markers, icon data, and audio for the incoming map — all carried here
   * so the player can apply them atomically at the transition midpoint.
   */
  filter?: FilterState;
  view?: ViewState;
  markers?: Marker[];
  iconData?: MarkerIconData[];
  /** Soundboard slot configuration for the incoming map */
  audio?: AudioState;
  /** Audio data for slots that are currently playing on the incoming map */
  soundboardActive?: SoundboardAudioData[];
  /** All loaded audio assets for the incoming map — preloaded for instant playback */
  soundboardAssets?: { assetId: string; dataUrl?: string }[];
  mapBlob: ArrayBuffer;
  transition?: TransitionConfig;
}

export interface MarkerIconData {
  /** Full 'asset:uuid' key matching the marker.icon field */
  key: string;
  /** data:image/png;base64,… blob encoded inline */
  dataUrl: string;
}

export interface MsgMarkerUpdate {
  type: 'marker_update';
  payload: Marker[];
  /** Custom icon blobs for any asset: icons referenced in payload */
  iconData?: MarkerIconData[];
}

/** Slot configuration update (assign/unassign, loop/volume changes — not play/stop) */
export interface MsgAudioUpdate {
  type: 'audio_update';
  payload: AudioState;
}

/** GM started playing a soundboard slot; players should start audio */
export interface MsgSoundboardPlay {
  type: 'soundboard_play';
  slotId:  string;
  assetId: string;
  loop:    boolean;
  volume:  number;
  /** Data URL for the audio; omitted if player already has it cached by assetId */
  dataUrl?: string;
}

/** GM stopped a soundboard slot */
export interface MsgSoundboardStop {
  type: 'soundboard_stop';
  slotId: string;
}

/** GM started a positional audio source; player plays it at the given volume */
export interface MsgPositionalPlay {
  type:     'positional_play';
  markerId: string;
  assetId:  string;
  loop:     boolean;
  volume:   number;
  dataUrl?: string; // stripped for PeerJS binary delivery; inline for BroadcastChannel
}

/** Update volume for an active positional source (listener moved) */
export interface MsgPositionalVolume {
  type:     'positional_volume';
  markerId: string;
  volume:   number;
}

/** Stop a positional audio source on the player */
export interface MsgPositionalStop {
  type:     'positional_stop';
  markerId: string;
}

/** GM toggled master mute — all player audio should pause/resume accordingly */
export interface MsgSoundboardMuteAll {
  type: 'soundboard_mute_all';
  muted: boolean;
}

/** GM changed volume on a playing slot — update without interrupting playback */
export interface MsgSoundboardVolume {
  type: 'soundboard_volume';
  slotId: string;
  volume: number;
}

/** Preloads an audio asset on the player without starting playback */
export interface MsgSoundboardAsset {
  type: 'soundboard_asset';
  assetId: string;
  /** Data URL for audio; absent on PeerJS path where data arrives as binary */
  dataUrl?: string;
}

export type GMMessage =
  | MsgFullState
  | MsgViewUpdate
  | MsgFogUpdate
  | MsgFilterUpdate
  | MsgMapChange
  | MsgMarkerUpdate
  | MsgAudioUpdate
  | MsgSoundboardPlay
  | MsgSoundboardStop
  | MsgSoundboardMuteAll
  | MsgSoundboardVolume
  | MsgSoundboardAsset
  | MsgPositionalPlay
  | MsgPositionalVolume
  | MsgPositionalStop;

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
