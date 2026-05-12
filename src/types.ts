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

export type AudioRole  = 'source' | 'listener';
export type MotionRole = 'source' | 'tracker';

/**
 * A marker can hold a role in any number of independent interaction systems.
 * Each system enforces its own constraints (e.g. one listener, one tracker per map).
 * Adding a new system is a new key here — markers carry every role they participate in.
 */
export interface MarkerRoles {
  audio?:  AudioRole;
  motion?: MotionRole;
}

export interface Marker {
  id: string;
  roles: MarkerRoles;
  position: { x: number; y: number }; // 0–1 normalised map coords

  // Visual
  label: string;
  icon:  string;   // emoji or 'asset:<uuid>' / 'data:...' for image icons
  color: string;   // hex
  size:  number;   // 1.0 = default

  // Visibility
  hidden:    boolean; // hides from players; GM sees with ghost opacity
  showLabel: boolean; // show name text on the player map (default false)

  // Audio fields (used when roles.audio is set)
  audioTrackId:     string | null;
  audioLoop:        boolean;
  audioMuted:       boolean;
  audioMaxDistance: number;   // normalised map units
  audioVolume:      number;   // 0–1 base volume (multiplied by positional attenuation)
  audioRandom:      boolean;  // random play mode — fires one-shots at randomised intervals
  audioRandomFreq:  number;   // target plays per 10 minutes (1–100) when audioRandom is true

  // Motion fields (used when roles.motion is set)
  motionMuted: boolean; // source: tracker ignores it; tracker: scanner is silent
  /** Per-source: how blobs are drawn when this source is detected.
   *   - 'single':         one blob the size of the marker icon
   *   - 'multi-few':      3–5 medium blobs scattered within the icon area
   *   - 'multi-many':     7–13 small blobs scattered, similar overall footprint */
  motionBlobMode: 'single' | 'multi-few' | 'multi-many';

  // Interaction lock — side-panel only; dims icon, blocks canvas selection
  locked: boolean;
}

export function defaultMarker(id: string, x = 0.5, y = 0.5): Marker {
  return {
    id,
    roles:    {},
    position: { x, y },
    label:    'New Marker',
    icon:     '◆',
    color:    '#e03e3e',
    size:     1.0,
    hidden:           false,
    showLabel:        false,
    audioTrackId:     null,
    audioLoop:        true,
    audioMuted:       false,
    audioMaxDistance: 0.3,
    audioVolume:      1.0,
    audioRandom:      false,
    audioRandomFreq:  10,
    motionMuted:      false,
    motionBlobMode:   'single',
    locked:           false,
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
}

/**
 * Motion-tracker config — one per map; settings follow whichever marker
 * currently holds the 'tracker' role. New maps inherit defaults from the
 * previously-active map's tracker config.
 */
export interface MotionTrackerConfig {
  /** Detection radius in normalised Y-axis map units. Can extend off-map. */
  range:    number;
  /** Seconds between scan starts. */
  rate:     number;
  /** Seconds the ring takes to expand from 0 to `range`. */
  speed:    number;
  /** When true, suppress the visual blobs — audio cues only ("Aliens" mode). */
  hideBlobs: boolean;
  /** Ring + blob colour (hex). */
  colour:   string;
  /** Audio asset played when a scan begins. */
  outgoingPingAssetId: string | null;
  /** Audio asset played when a source is detected. */
  returnPingAssetId:   string | null;
  /** 0–1 volume for the outgoing ping. */
  outgoingPingVolume:  number;
  /** 0–1 volume for the return ping. */
  returnPingVolume:    number;
}

export function defaultMotionTrackerConfig(): MotionTrackerConfig {
  return {
    range:    0.5,
    rate:     4,
    speed:    3,
    hideBlobs: false,
    colour:   '#f59e0b', // amber, matches the tracker role accent
    // Bundled CC0 sounds seeded by storage/seedAudioAssets.ts on first run.
    outgoingPingAssetId: 'builtin-mt-ping',
    returnPingAssetId:   'builtin-mt-return',
    outgoingPingVolume:  0.8,
    returnPingVolume:    0.8,
  };
}

/** Global audio asset (lives in audioAssets IDB store — not per-map). */
export interface AudioAsset {
  id:                  string;
  name:                string;
  /**
   * Where the asset originated. Drives the tag pill shown in My Library and
   * which playback path is used.
   *   • upload    — user uploaded a local file; blob stored in IDB
   *   • freesound — imported via the Freesound API; blob stored after import
   *   • web-link  — user pasted a URL; streamed at runtime, blob NOT stored
   *                 unless `locallyStored` becomes true via the Store button
   */
  source:              'freesound' | 'upload' | 'web-link';
  /** True when the asset's blob is persisted in the local `assets` IDB store.
   *  Always true for upload + freesound (after import). True for web-link only
   *  after the user explicitly clicks Store. */
  locallyStored:       boolean;
  /** Original URL for web-link assets (and reserved for any future API
   *  connector that returns a stable URL). Used both for runtime streaming
   *  and for re-fetching when the user later clicks Store. */
  sourceUrl?:          string;
  freesoundId?:        number;
  freesoundPreviewUrl?: string; // preview-hq-mp3 — used for re-download
  freesoundPageUrl?:   string;  // canonical Freesound page
  username?:           string;
  license?:            string;  // human-readable, e.g. "CC0" or "CC-BY"
  attribution?:        string;  // "Sound: [name] by [username] via Freesound"
  /** User-editable link added via the My Library attribution editor. Falls back
   *  to freesoundPageUrl / sourceUrl when not set, when displaying attributions. */
  attributionLink?:    string;
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

/** Increment when breaking changes are made to the schema. Add a migrator in storage/migrations.ts. */
export const STATE_VERSION = 2;

/**
 * GM-controlled position of the projector viewport rectangle on the active map.
 * The size of the rectangle is NOT stored here — it's derived per-frame from
 * the projector's reported canvas size + projector calibration + map calibration.
 * Stored: only the centre and rotation (which the GM directly controls).
 */
/**
 * Projector display mode.
 *  - 'scaled': default — render the calibrated crop at true table scale.
 *  - 'full':   ignore calibration; show the entire map fit-to-window.
 *  - 'black':  render solid black, e.g. while the GM resets the table.
 * Mutually exclusive.
 */
export type ProjectorMode = 'scaled' | 'full' | 'black';

export interface ProjectorViewport {
  /** Centre of the projector view, normalised 0..1 over the map. */
  centerX: number;
  centerY: number;
  /** Display rotation applied at the projector end. 0 / 90 / 180 / 270. */
  rotation: 0 | 90 | 180 | 270;
  /** Render mode — see ProjectorMode docs. */
  mode: ProjectorMode;
  /** When true, the projector overlays a 1" grid (anchored to projector
   *  calibration only — independent of map scale). */
  gridEnabled: boolean;
  /** CSS hex colour for the grid lines. */
  gridColor: string;
  /** When true, the projector applies the GM's active visual filter to its
   *  output. On by default — projector mirrors what players see; the GM can
   *  opt out via the "Disable Filters" toggle when projecting battlemaps that
   *  should stay unfiltered regardless of mood filter. */
  filterEnabled: boolean;
}

export function defaultProjectorViewport(): ProjectorViewport {
  return {
    centerX: 0.5, centerY: 0.5, rotation: 0, mode: 'scaled',
    gridEnabled: false, gridColor: '#ffffff',
    filterEnabled: true,
  };
}

/**
 * Live info about a connected projector window. Reported by the projector
 * via `projector_hello` on connect (and on resize). Cleared when the
 * projector window disconnects. Used by the GM to size the projector
 * viewport rectangle on the map.
 */
export interface ProjectorConnection {
  /** Human-readable setup name from the projector's localStorage. */
  setupName: string;
  /** Projector device's CSS pixels per 1"/25 mm physical square. */
  pixelsPerSquare: number;
  /** Projector window's current canvas size, CSS pixels. */
  canvasWidth: number;
  canvasHeight: number;
}

export interface SessionState {
  version: typeof STATE_VERSION;
  map: MapState | null;
  view: ViewState;
  filter: FilterState;
  fog: FogState;
  markers: Marker[];
  audio: AudioState;
  /** Persisted transition selection and parameters for this map */
  transition?: TransitionConfig;
  /** Per-map motion tracker config — controls whichever marker holds the tracker role. */
  motionTracker: MotionTrackerConfig;
  /** Projector viewport position + rotation (per-map). Optional — only set
   *  once a projector has connected at least once. */
  projectorViewport?: ProjectorViewport;
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
    },
    motionTracker: defaultMotionTrackerConfig(),
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
  /** Map asset metadata needed by the projector view to size its viewport. */
  mapPixelsPerSquare?: number;
  mapImageWidth?:      number;
  mapImageHeight?:     number;
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
  /** Map asset metadata needed by the projector view to size its viewport. */
  mapPixelsPerSquare?: number;
  mapImageWidth?:      number;
  mapImageHeight?:     number;
  /** Projector viewport for the incoming map (rotation, mode, grid, filter
   *  toggle, etc.). Carried in map_change so the projector window applies
   *  the new map's saved viewport instead of holding over the prior map's. */
  projectorViewport?: ProjectorViewport;
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

/** Sent when a tracker scan begins. Player kicks a local ring animation on receipt. */
export interface MsgTrackerScan {
  type:      'tracker_scan';
  centre:    { x: number; y: number };
  range:     number;
  speedSecs: number;
  colour:    string;
  audioAssetId?:  string;
  audioDataUrl?:  string;
  audioVolume?:   number;
}

/** Sent when the expanding ring has crossed a source marker — player draws a return blob. */
export interface MsgTrackerBlob {
  type:     'tracker_blob';
  position: { x: number; y: number };
  fadeMs:   number;
  mode:     'single' | 'multi-few' | 'multi-many';
  sourceId: string;
  colour:   string;
  audioAssetId?:  string;
  audioDataUrl?:  string;
  audioVolume?:   number;
}

/**
 * Projector → GM identification message. Sent by the projector window on
 * connect (and on its own resize) so the GM knows the projector is live and
 * can size the projector viewport rectangle correctly on its canvas.
 *
 * `clientId` is a per-window uuid generated on load — the GM uses it to
 * decide which projector is the primary (first to connect) and which are
 * monitors (everyone after), and to address per-projector role messages
 * back via broadcast (see MsgProjectorRole).
 */
export interface MsgProjectorHello {
  type: 'projector_hello';
  clientId:        string;
  setupName:       string;
  pixelsPerSquare: number;
  canvasWidth:     number;
  canvasHeight:    number;
}

/**
 * Projector → GM clean disconnect notification. Sent on window unload so the
 * GM can drop the entry from its connection map and re-shuffle monitor roles
 * without waiting for transport-level disconnect (BroadcastChannel never
 * signals close on its own).
 */
export interface MsgProjectorBye {
  type: 'projector_bye';
  clientId: string;
}

/**
 * GM → Projector shutdown. Broadcast — projectors ignore unless `targetId`
 * matches their own clientId. Sent to every monitor when the primary
 * disconnects: closing the primary window is the canonical "turn off
 * projection" gesture, and monitors should follow.
 */
export interface MsgProjectorShutdown {
  type: 'projector_shutdown';
  targetId: string;
}

/**
 * GM → Projector role assignment. Broadcast — projectors ignore unless
 * `targetId` matches their own clientId. Sent on every projector_hello and
 * re-sent to monitors when their primary's view fraction changes (primary
 * resize, map calibration change, primary swap).
 *
 * Monitors render the primary's crop fit-to-window with a bezel frame —
 * they do not use their own projector calibration. `primaryViewNW/NH` is
 * the fraction of the map shown by the primary; monitors combine that with
 * `projectorViewport.centerX/Y` to render the same crop.
 */
export interface MsgProjectorRole {
  type: 'projector_role';
  targetId: string;
  role: 'primary' | 'monitor';
  monitorIndex?: number;
  primaryViewNW?: number;
  primaryViewNH?: number;
  /** Primary projector window's CSS-pixel aspect ratio (canvasWidth / canvasHeight).
   *  Monitors use this to letterbox/pillarbox their own canvas so what's
   *  rendered inside the bezel matches the primary's viewport exactly. */
  primaryAspect?: number;
}

/**
 * GM → Projector update of the projector viewport (centre + rotation) so the
 * projector can compute its own crop on the map.
 */
export interface MsgProjectorViewportUpdate {
  type: 'projector_viewport_update';
  payload: ProjectorViewport;
}

/**
 * GM → all clients: the active map's calibration / intrinsic dimensions
 * changed (typically a "Recalibrate this Map…" run while the map is live).
 * The primary projector uses these to re-compute its viewNW/viewNH crop;
 * monitors get refreshed view fractions via projector_role separately.
 *
 * Plain players ignore this — their player view doesn't depend on map
 * calibration; their viewport is the GM's own view rectangle.
 */
export interface MsgMapMetaUpdate {
  type: 'map_meta_update';
  mapPixelsPerSquare?: number;
  mapImageWidth?:      number;
  mapImageHeight?:     number;
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
  | MsgPositionalStop
  | MsgTrackerScan
  | MsgTrackerBlob
  | MsgProjectorHello
  | MsgProjectorBye
  | MsgProjectorRole
  | MsgProjectorShutdown
  | MsgProjectorViewportUpdate
  | MsgMapMetaUpdate;

// ─── Storage types ───────────────────────────────────────────────────────────

/**
 * A named map instance the GM picks from the dropdown. Owns its own per-map
 * config (fog, markers, audio, tracker etc.) but does NOT own its image data —
 * that's stored once in a MapAsset that any number of map instances can point at.
 */
export interface StoredMap {
  id:         string;
  name:       string;
  /** Points at the MapAsset whose image this map renders. */
  mapAssetId: string;
  addedAt:    number;
}

/**
 * A reusable map image — or a text-only handout. Multiple StoredMap instances
 * can share one MapAsset (e.g. the same dungeon image used for two different
 * encounters with their own fog, markers, and tracker configs).
 *
 * Source values:
 *   • upload    — user uploaded a local file; blob present in IDB
 *   • web-link  — user pasted a URL; blob fetched at runtime; blob in IDB
 *                 only after the user clicks Store
 *   • text-map  — Stream C text handout. No blob — `textMap` carries the
 *                 body HTML + aspect + font; renderer rasterises it to a
 *                 canvas at display time. Always locallyStored.
 */
export interface MapAsset {
  id:            string;
  /** Display name — derived from the original file or URL, user-renameable. */
  filename:      string;
  source:        'upload' | 'web-link' | 'text-map';
  /** True when the blob is in IDB (and travels in bundle exports). For
   *  text-map assets this is always true (the body lives in `textMap`). */
  locallyStored: boolean;
  /** Set for web-link assets; the URL the blob is fetched from. */
  sourceUrl?:    string;
  /** The image bytes. Present iff locallyStored=true. */
  blob?:         Blob;
  /** Cached on first load — used by the missing-asset placeholder so fog/marker
   *  coords stay correct when an asset goes missing. */
  imageWidth?:   number;
  imageHeight?:  number;
  /** Optional editable attribution metadata, mirroring AudioAsset. */
  attribution?:     string;
  attributionLink?: string;
  license?:         string;
  /**
   * Map-image pixels per 1"/25 mm grid square. Set via the Calibrate flow in
   * the asset editor (drag two endpoints, type the distance in squares). Used
   * by the Projector view to render at true table scale. Undefined = uncalibrated.
   */
  pixelsPerSquare?: number;
  /**
   * Last-saved positions of the two calibration endpoints in NATURAL image
   * coordinates, plus the squares value the user typed. Stored so the user
   * can reopen the calibration UI and tweak from where they left off rather
   * than restart from the default centered line.
   */
  calibrationLine?: {
    ax: number; ay: number;
    bx: number; by: number;
    squares: number;
  };
  /**
   * Provenance + confidence behind `pixelsPerSquare`. Drives the library
   * badge and retrofit behaviour:
   *   • 'manual'      — user calibrated by hand via the two-endpoint flow.
   *                     Highest trust; never overridden by the auto-detector.
   *   • 'scaled'      — auto-detector confident (multiple signals aligned).
   *                     Auto-applied without prompting.
   *   • 'auto-scaled' — auto-detector best-guess, or user picked from the
   *                     candidate dialog. Lower confidence — orange badge.
   *   undefined on a calibrated asset that predates this field — treated as
   *   'manual' for benefit-of-the-doubt and rendered the same green badge.
   */
  scaleConfidence?: 'manual' | 'scaled' | 'auto-scaled';
  /**
   * User explicitly opted this map out of scaling — it has no grid (a
   * handout, world map, stat block, etc.). The auto-detector skips it on
   * retrofit passes, and the library shows a "No grid" badge instead of
   * prompting for calibration.
   */
  noGrid?: boolean;
  /**
   * Stream C text-map payload. Present iff source='text-map'. The renderer
   * combines the body HTML, font family, font-size scale, aspect, and
   * background colour to produce a canvas-rendered image at display time.
   */
  textMap?:      TextMapConfig;
  addedAt:       number;
}

/** Stream C handout configuration — the body and presentation settings for
 *  a text-map. Animation runs on the player side using the same body. */
export interface TextMapConfig {
  /**
   * Aspect-ratio width / height. These are NOT a fixed render resolution —
   * they exist to express the ratio (so the editor preview and the
   * eventual rasteriser both know whether to draw A4 portrait or 16:9).
   * The rasteriser picks an actual resolution per use case.
   */
  width:        number;
  height:       number;
  /** Default font-family applied to text elements that don't override. */
  fontFamily:   string;
  /** Multiplier on the base font-size (anchored to page width). 0.5–4.0 typical. */
  fontScale:    number;
  /** CSS hex colour for the page background. */
  backgroundColor: string;
  /** Default text colour applied to text elements that don't override. */
  textColor:    string;
  /**
   * Free-positioned elements (text boxes + image boxes) that compose the
   * handout. Each element's geometry is expressed as % of the page so the
   * layout is resolution-independent. Drawn in array order (later items
   * paint on top).
   *
   * Optional for back-compat: if absent AND `bodyHtml` is set, the
   * editor / rasteriser treat the legacy bodyHtml as a single full-page
   * text element.
   */
  elements?:    TextMapElement[];
  /**
   * LEGACY (pre-element-canvas): a single sanitised HTML body that took
   * up the whole page. Carried for round-trip of older saved packs.
   * Migrated to `elements` on first open via ensureTextMapElements().
   */
  bodyHtml?:    string;
  /** Animation behaviour. */
  animation?:   TextMapAnimation;
}

/** Union of all element kinds that can live on a text-map page. */
export type TextMapElement = TextMapTextElement | TextMapImageElement;

interface TextMapElementBase {
  /** Stable id — used for selection state and React-style reconciliation. */
  id:    string;
  /** Geometry as PERCENTAGES of the page (0..100). Lets the same layout
   *  render correctly at any rasterisation resolution. */
  x:     number;
  y:     number;
  w:     number;
  h:     number;
  /** When true, this element is part of the handout's STARTING frame —
   *  it shows immediately when the map appears and is not transitioned
   *  in. The reveal animation runs from "background + noAnimate
   *  elements" to "background + all elements". Defaults to false
   *  (everything animates in). */
  noAnimate?: boolean;
}

export interface TextMapTextElement extends TextMapElementBase {
  type:        'text';
  /** Sanitised rich-text body for this box. Same whitelist as the splash
   *  editor (plus inline SVG icon spans). */
  html:        string;
  /** Optional per-element overrides — when absent the page-level value
   *  from TextMapConfig is used. fontScale here is a multiplier on the
   *  page-level fontScale. */
  fontFamily?: string;
  fontScale?:  number;
  color?:      string;
  textAlign?:  'left' | 'center' | 'right' | 'justify';
}

export interface TextMapImageElement extends TextMapElementBase {
  type:    'image';
  /** ImageAssetStore id. The rasteriser resolves to inline SVG / blob URL. */
  assetId: string;
  /** Optional tint colour for monochrome SVG icons. */
  tint?:   string;
}

export interface TextMapAnimation {
  /** Master switch. When false, the handout shows its final frame
   *  immediately on map load — no reveal. */
  enabled:      boolean;
  /** When true, the reveal runs automatically on map load. When false,
   *  the player + projector show the starting frame statically until
   *  the GM triggers the reveal via the GM-side Start button. */
  autoReveal:   boolean;
  /** Transition id from the shared registry (filtered to
   *  `forHandout: true`). Drives the reveal animation between
   *  "background + noAnimate elements" (snapshot) and "background +
   *  all elements" (final). */
  transitionId: string;
  /** Per-transition params (duration, line width, direction, etc.). */
  params:       Record<string, number | string>;
}

/* ── Image Assets ────────────────────────────────────────────────────────────
 * Third first-class asset library alongside MapAsset and AudioAsset. Holds
 * the icons available to markers and to text-map inline insertions, plus
 * future image-like assets (e.g. handout decorations).
 *
 *   • Unicode glyph entries (source='unicode')        — visual is the char
 *   • SVG icons (source='upload' | 'game-icons')      — markup in svgSource
 *   • Raster icons (source='upload' | 'lucide')       — blob in record
 *
 * Categories are also first-class records (see ImageCategory) so users can
 * add their own. System categories are pinned and uneditable. */

export type ImageAssetSource =
  | 'unicode'    // Built-in or user-added Unicode glyph (no blob/SVG needed)
  | 'upload'     // User-uploaded PNG / SVG file
  | 'game-icons' // Imported from game-icons.net via the source connector
  | 'lucide'     // Imported from Lucide via the source connector
  | 'font';      // Google Font reference — fontFamily set, no blob/SVG/glyph

export interface ImageAsset {
  id:           string;
  /** Display name shown in the library and used as a fallback in attribution. */
  name:         string;
  source:       ImageAssetSource;
  /** id of the ImageCategory this asset belongs to. */
  categoryId:   string;
  /**
   * Can this image be recoloured at render time? True for Unicode glyphs and
   * single-fill SVGs (e.g. game-icons.net assets). False for arbitrary PNGs
   * and user-uploaded multi-colour SVGs. Consumers (marker renderer, text-
   * map inline insertion) pick a colour at usage time when tintable=true.
   */
  tintable:     boolean;
  /** For source='unicode' — the glyph itself. */
  unicodeChar?: string;
  /** For SVG sources — the raw SVG markup, so consumers can swap the fill
   *  attribute when rendering tintable icons. */
  svgSource?:   string;
  /** For raster sources — the image bytes. */
  blob?:        Blob;
  /** MIME type when blob is present (image/png, image/webp, image/svg+xml). */
  mimeType?:    string;
  /** For source='font' — the CSS font-family string. Used to construct the
   *  Google Fonts CSS request that loads the family at runtime. */
  fontFamily?:  string;
  license?:         string;
  attribution?:     string;
  attributionLink?: string;
  /** Canonical source URL on the origin host (e.g. the game-icons.net page).
   *  Used for attribution display and to re-fetch the asset if needed. */
  sourceUrl?:   string;
  /** Free-text tags from the source manifest (e.g. ['weapon','sword']) — used
   *  for keyword search within the library modal. */
  tags?:        string[];
  addedAt:      number;
}

export interface ImageCategory {
  id:   string;
  name: string;
  /** System categories ship with Mappadux and can't be deleted / renamed.
   *  User-defined categories are isSystem=false. */
  isSystem: boolean;
  /** Display order — system categories use 0..99, user categories 100+ to
   *  keep system rows pinned at the top of the sidebar. */
  sortOrder: number;
}

/** IDs of the six system categories — referenced by code that needs to
 *  funnel newly-imported icons into a specific category (e.g. the Text Map
 *  editor "insert icon" flow auto-targets the Textmap category). */
export const SYSTEM_CATEGORY_IDS = {
  unicode:       'sys-unicode',
  abstract:      'sys-abstract',
  fantasy:       'sys-fantasy',
  scifi:         'sys-scifi',
  contemporary:  'sys-contemporary',
  textmap:       'sys-textmap',
  uncategorised: 'sys-uncategorised',
  fonts:         'sys-fonts',
} as const;

export interface StoredSession {
  /** Fixed key — only one session record */
  key: 'current';
  /** PeerJS peer ID — persisted for session resumption */
  peerId: string;
  /** ID of the last active map */
  lastMapId: string | null;
  /** Optional human-friendly pack name (set in the customisation area).
   *  Used as the default save filename and travels with the bundle. */
  packName?: string;
  /** Optional creator-customisable splash / About content for this pack.
   *  Travels with the bundle so packs can be branded. The Mappadux footer
   *  (Discord / Ko-fi / licence / repo) is appended at render time and
   *  cannot be customised. */
  splash?: SplashConfig;
  /** Optional UI theme for this pack — light/dark + custom accent colour.
   *  Applies to chrome only (sidebar, panels, modals, controls); the map
   *  render area is unaffected. Travels with the bundle so creators can
   *  ship a branded look. */
  theme?: ThemeConfig;
}

/** Per-pack UI theme. Both fields optional — unset = Mappadux defaults
 *  (dark mode, cyan accent). */
export interface ThemeConfig {
  mode?:   'dark' | 'light';
  /** CSS color string (`#rrggbb` or named). Used as `--accent`. */
  accent?: string;
}

/** A single labelled link shown in the splash/About dialog (Patreon,
 *  creator social, Kickstarter, etc.). */
export interface SplashLink {
  label: string;
  url:   string;
}

/** Per-pack splash/About content. All fields optional — when none are set,
 *  the About dialog falls back to a generic "what is Mappadux" view. */
export interface SplashConfig {
  /** Creator's title for the pack. Defaults to the pack name. */
  title?:        string;
  /** Legacy plain-text description, line breaks preserved. Older bundles
   *  use this; newer ones write `bodyHtml` from the rich editor. Display
   *  prefers `bodyHtml` when both are present. */
  body?:         string;
  /** Rich-text description (a sanitised subset of HTML — bold, italic,
   *  underline, alignment, bullets, colour, a small font allow-list). */
  bodyHtml?:     string;
  /** Optional banner image as a data URL (base64-encoded). Kept inline so
   *  the splash is fully self-contained inside the bundle. */
  imageDataUrl?: string;
  /** CSS `object-position` value for the banner image (e.g. "50% 30%").
   *  Lets the creator pick which slice of an off-aspect image is visible
   *  in the banner crop. Defaults to "50% 50%" (centre) when unset. */
  imagePosition?: string;
  /** Creator-supplied links shown above the always-on Mappadux footer. */
  links?:        SplashLink[];
}
