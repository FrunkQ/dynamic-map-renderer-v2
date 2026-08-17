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
  /**
   * v2.12 — per-map animated effect rendered in the letterbox /
   * pillarbox area around the map. Sits next to backgroundColor in
   * the Map panel so the GM picks both at the same moment. Unset =
   * solid backgroundColor (default).
   */
  backdrop?: BackdropConfig;
  /**
   * v2.13.x — per-backdrop-kind param drafts. When the GM tweaks a
   * live backdrop's sliders the values land both into the active
   * `backdrop.params` AND here keyed by kind. Switching to a
   * different kind reads its draft (if any) as the starting values
   * instead of registry defaults, so "I tuned Aurora last time and
   * now I want it back" works without re-dialling.
   *
   * Param ids are kind-scoped (Aurora's 'colorA' has nothing to do
   * with Ocean's 'waveHeight'), so keying by kind is the natural
   * unit. Mirrors `FogState.shaderParams[kind]` on the MapFX side.
   */
  backdropDrafts?: Record<string, Record<string, number | string>>;
  /**
   * v2.14.3 — Player View aspect-ratio lock. When true, the resize
   * handle on the player viewport rect preserves the current W:H
   * ratio (computed in physical / map-aspect-aware space so it
   * matches what the player sees). When false / unset, resize is
   * free. Toggled via the lock icon in the rect's chrome cluster.
   */
  aspectLocked?: boolean;
  /**
   * v2.14.17 — Player-side 1″ grid overlay. When true, the player
   * window draws a calibrated 1″ grid scaled to its current view
   * (map-relative — the grid moves with the map as the GM zooms or
   * the browser resizes). Only meaningful when the active map is
   * calibrated; viewers skip the draw if mapPixelsPerSquare isn't
   * set. Toggled via the Show Grid icon in the Player rect chrome.
   */
  playerGridEnabled?: boolean;
  /** v2.14.17 — Colour of the player-side grid. Defaults to white
   *  when unset (matches the projector-side grid default). */
  playerGridColor?: string;
}

// ─── Fog of War / Overlay (v2.12 unified system) ─────────────────────────────

export interface FogVertex {
  x: number; // 0–1 normalised
  y: number; // 0–1 normalised
}

/**
 * All overlay kinds. Drives fill / blend mode / animation / selector-icon
 * glyph in the renderer + overlay. 'fog' is just another kind in the registry
 * — opaque fill, normal blend, no animation, interior-click selectable.
 * Adding a new kind: append here + add an entry in `mapfx/overlayKindRegistry.ts`.
 */
export type OverlayKind =
  | 'fog'
  | 'fire'
  | 'firestorm'
  | 'river'
  | 'ocean'
  | 'light'
  | 'starfield'
  | 'portal'
  | 'thundercloud'
  | 'mist'
  | 'aurora'
  | 'embers'
  | 'noise'
  | 'transparent'
  /** v2.14.69 — Reveals the map tile DIRECTLY UNDERNEATH on a layered
   *  composite, rather than the backdrop. On non-layered maps + non-
   *  composites it falls through to backdrop reveal (same as
   *  'transparent'). v1 behaves identically to 'transparent' everywhere;
   *  the per-tile reveal pipeline (rasteriser backing PNG + renderer
   *  backing plane) lands in a follow-up. */
  | 'reveal_layer';

/**
 * The unified polygon used by the overlay system. Every shape that renders
 * onto the map (fog patches, fire pools, blood splatters, …) is one of
 * these. Sharp polygons come from the polygon-mode click flow; rounded
 * "blob" polygons come from the brush-mode drag flow (a polyline offset at
 * the brush radius). The renderer doesn't distinguish — only the kind
 * decides how it draws.
 */
export interface FogPolygon {
  id:        string;
  /** Drives fill / blend / animation in the renderer. */
  kind:      OverlayKind;
  /** Outer ring of the polygon. */
  vertices:  FogVertex[];
  /** Optional inner rings that punch holes in the fill. Renders with the
   *  even-odd fill rule (canvas2D `fill('evenodd')`); each hole stroke
   *  inherits the same marching-ants treatment as the outer ring so the
   *  GM can see the boundary clearly. */
  holes?:    FogVertex[][];
  /** Optional colour override — for fog the GM picks via the colour input,
   *  for other kinds the kind's default colour is used unless this is set. */
  color?:    string;
  /** Optional GM-set label for the selector icon hover text. */
  label?:    string;
  /**
   * v2.12 — per-polygon shader-param values (e.g. river flow direction).
   * Only values for polygon-scoped params live here; kind-scoped params
   * (intensity, scale, …) stay on FogState.shaderParams[kind]. Renderer
   * resolves a uniform by reading poly.shaderParams[id] first, then
   * fog.shaderParams[kind][id], then the param's registry default.
   *
   * Value union: `number` for slider/toggle params, `'#rrggbb'` hex
   * string for `'color'` params. The renderer + GM panel dispatch on
   * the matching ShaderParamDef's `type`.
   */
  shaderParams?: Record<string, number | string>;
  /**
   * v2.12 — universal edge-fade amount, 0..1. Applied as a Gaussian
   * blur to the polygon's alpha mask when it's rasterised. 0 = hard
   * edge (default; original behaviour); 1 = blur radius equal to
   * 15% of the mask's shorter side (very soft fade). Works for fog
   * AND every MapFX shader kind because the mask is what each
   * effect samples for coverage — soft mask → soft visible edge.
   */
  edgeFade?: number;
  /** Creation timestamp (ms epoch) — stable sort + z-order key. */
  createdAt: number;
}

export interface FogState {
  polygons: FogPolygon[];
  /**
   * Per-kind shader parameter values (v2.12). Only kinds with `shader` and
   * `shaderParams` in the registry have entries here. The renderer reads
   * these on every fog update and pushes them as uniforms into the
   * matching kind's shader plane. Unset / partially-set keys fall back to
   * the kind's registry defaults — so omitting the field entirely on a
   * pre-existing FogState is fine (the renderer applies defaults).
   */
  shaderParams?: Partial<Record<OverlayKind, Record<string, number | string>>>;
}

// ─── Filters ─────────────────────────────────────────────────────────────────

export type FilterParamValues = Record<string, number | boolean | string>;

export interface FilterState {
  /** ID of the active filter definition */
  filterId: string;
  /** Current param values keyed by param id, per filter */
  params: Record<string, FilterParamValues>;
  /** Per-map opt-in: when true, the player + projector views also apply a
   *  CSS-filter approximation of the active filter to the player-marker
   *  DOM overlay, so tokens visually participate in the scene's look
   *  (night-vision green, candlelight warmth, etc.). Default off — the
   *  GLSL filter never touches the screen-space DOM layer otherwise.
   *  v2.16.30 Patch E. */
  affectPlayerMarkers?: boolean;
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
  label:    string;
  icon:     string;   // emoji or 'asset:<uuid>' / 'data:...' for image icons
  color:    string;   // hex
  size:     number;   // 1.0 = default
  /** Clockwise rotation in degrees applied to the icon body, around its centre.
   *  Range [0, 360); 0 = upright as drawn in the source image. Set via the
   *  overlay rotate handle (v2.11/A3b5); travels through broadcast like any
   *  other marker field. Selection ring + label + handles stay un-rotated
   *  (screen-fixed) — only the icon itself spins. */
  rotation: number;
  /** v2.14.109 — mirror flags applied to the icon body. Same
   *  semantics as the Composite + Text Map editors: scale(±1, ±1)
   *  inside the rotation transform so chrome stays un-mirrored.
   *  Optional + default false for backward compatibility. */
  flipH?: boolean;
  flipV?: boolean;

  // Visibility
  hidden:    boolean; // hides from players; GM sees with ghost opacity
  showLabel: boolean; // show name text on the player map (default false)
  /** v2.14.2 — show the marker's name on the GM map, independent of
   *  showLabel and of the `hidden` flag. Defaults true so GMs can
   *  track positions of hidden-from-player markers; locked markers
   *  fade their name to dim chrome to keep background-prop names
   *  quiet. Optional for backward compatibility (load coerces). */
  showLabelOnGM?: boolean;

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
    rotation:         0,
    hidden:           false,
    showLabel:        false,
    showLabelOnGM:    true,
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
/** Projector display mode. 'black' was retired in v2.11/A8.3 — the
 *  side-panel broadcast toggle (with its faff-overlay placeholder) is
 *  the new "hide what players see" affordance. Legacy saves are
 *  normalised on load (see StateManager.setProjectorViewport). */
export type ProjectorMode = 'scaled' | 'full';

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
  /** v2.16.84 — per-map annotations (progress clocks, timers, notes,
   *  whiteboard strokes). Part of the map's saved data: persists in IDB
   *  and travels in the .mappadux pack. */
  annotate?: AnnotateState;
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

// ─── Players (v2.17 Player Voice) ────────────────────────────────────────────

/**
 * A persistent player known to the GM. Created when a connected player
 * self-identifies, or added manually by the GM for offline players (those
 * at the table without their own device). Lives in the global `players`
 * IDB store — NOT per-map — so identities + colours + assigned markers
 * survive map switches and sessions.
 *
 * Security is intentionally absent (LAN trust model, same as the rest of
 * P2P): `id` is a device-persisted token the player hands over on connect.
 */
/** Token footprint sizes (width × height in map squares). Square sizes render
 *  as circles; non-square as rounded rectangles. Patch D adds rotation/facing,
 *  which will rotate the image by 90° for non-square footprints to keep it
 *  upright relative to the rectangle's long axis. */
export type TokenSize = '1x1' | '1x2' | '2x2' | '2x3' | '3x3';

export interface PersistentPlayer {
  /** Stable id. For device players this is persisted on their machine and
   *  re-sent on every reconnect; for GM-managed offline players the GM mints it. */
  id: string;
  playerName:    string;  // the human's name
  characterName: string;  // their character's name
  /** Hex identity colour. Never black / near-black — that range is reserved
   *  for the GM + initiative threats. */
  color: string;
  /** Per-map placements of this player's token, keyed by mapId. The token is a
   *  circular marker edged in the player's colour. Browser-only — deliberately
   *  NOT written to the .mappadux save file (maps aren't connected; the GM
   *  places tokens per map but never has to recreate them). A map id present
   *  here means the token is on that map at the given normalised position.
   *  `facing` is degrees clockwise from north (0–359), snap-to-45° at the UI
   *  layer; absent / undefined = facing north (0). */
  placements?: Record<string, { x: number; y: number; facing?: number }>;
  /** Optional icon for the token. Reference to the picked image-library asset
   *  (kept so the GM can re-tint / re-pick later); the rendered form is
   *  cached alongside as iconChar (unicode glyph) or iconDataUrl (image).
   *  Tintable SVGs are recoloured to white at pick-time so they contrast
   *  with the disc's coloured background; raster assets are stored as-is. */
  iconAssetId?: string;
  iconChar?:    string;
  iconDataUrl?: string;
  /** Token footprint in map squares (W×H). Only applied on calibrated maps —
   *  on uncalibrated maps the token stays at its constant CSS pixel size so
   *  it remains readable independent of zoom. Square footprints render as
   *  circles; non-square footprints render as rounded rectangles. Defaults
   *  to '1x1' when absent. */
  tokenSize?: TokenSize;
  /** True for GM-managed offline players (no device of their own). They never
   *  connect; the GM acts on their behalf. */
  managedByGm?: boolean;
  createdAt: number;
  updatedAt: number;
}

// ─── Initiative Tracker (v2.17 Player Voice) ─────────────────────────────────

export type InitiativeCardType = 'player' | 'enemy' | 'round-marker';

/**
 * A single card in the initiative deck. The sort metric is intentionally a
 * polymorphic `value: string` so the same tracker handles d20 integers, speed
 * priorities, popcorn initiative ("Fast" / "Ace"), and so on without hard-
 * coded edition math.
 */
export interface InitiativeCard {
  id: string;
  name: string;
  type: InitiativeCardType;
  /** Player identity colour for player cards; charcoal for enemies/threats;
   *  neutral muted tone for the ROUND END marker. */
  color: string;
  /** Player cards: optional token / portrait. */
  markerUrl?: string;
  /** Enemy cards: discrete tracking letter (A, B, C…) the GM sees on screen
   *  and references against physical scratch notes. */
  threatLetter?: string;
  /** v2.17.32 — TRANSIENT association to a map marker (its id). When set, the
   *  card adopts the marker's name (and, players-side, image) instead of the
   *  generic threat letter / "!". Not persisted across a new initiative — the
   *  decks are rebuilt on reset, so the link naturally clears each combat. */
  associatedMarkerId?: string;
  /** Optional player id for player cards — lets the GM unallocate / re-place
   *  the same player without re-typing names. */
  playerId?: string;
  /** Sort metric — string so it handles numbers, words, anything. */
  value: string;
  /** True once the card has acted this round; faded + dim until ROUND END
   *  passes through index 0 and resets everyone. */
  isSpent: boolean;
}

export type InitiativeSortMode = 'high-to-low' | 'low-to-high' | 'manual';

export type InitiativeEdge = 'top' | 'right' | 'bottom' | 'left';

export interface InitiativeState {
  /** Active rail — index 0 is the current actor. */
  activeDeck: InitiativeCard[];
  /** Player profiles not currently in combat (ghosted; click to enter a roll). */
  unallocated: InitiativeCard[];
  /** Reserve threat letters for the GM to inject as enemies appear. */
  threatBench: InitiativeCard[];
  /** v2.16.58 — Discard pile. Cards dragged here are out of THIS combat
   *  entirely (won't return to bench / tray). End Combat clears it along
   *  with everything else. Player view never renders this zone. */
  discarded: InitiativeCard[];
  /** Sort mode — drives where new cards land when they arrive. */
  sortMode: InitiativeSortMode;
  /** v2.16.60 — Remembers the last numeric direction (high-to-low or
   *  low-to-high) the GM chose. When sortMode flips to 'manual' via a
   *  drag-reorder, this stays put so type-to-inject still knows which
   *  way the GM was sorting numerically. Always one of the two numeric
   *  modes — manual is never written here. */
  lastNumericSortMode: 'high-to-low' | 'low-to-high';
  /** Which edge of the GM/player view the tracker is pinned to. Horizontal
   *  fan on top/bottom; vertical fan on left/right. */
  edge: InitiativeEdge;
  /** Is the tracker UI visible. */
  visible: boolean;
  /** v2.17.5 — Fixed-initiative mode. Some systems set an order once and
   *  reuse it every combat. When true: Reroll Initiative is disabled, End
   *  Combat preserves the current order (clears spent flags + parks ROUND
   *  END at the back) instead of wiping, and Call for Initiative won't
   *  re-prompt players once an order exists. */
  preserveOrder?: boolean;
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
  /** v2.14.18 — grid offset for the active map. Drives 1″ overlay
   *  alignment in every viewer that draws the grid. */
  gridOffsetX?:        number;
  gridOffsetY?:        number;
  /** v2.14.31 — shared grid colour, per-map. */
  gridColor?:          string;
  /** v2.14.54 — composite payload. See MsgMapChange.composite. */
  composite?:          CompositeWirePayload;
  /** v2.16.100 — live YouTube video elements for the active text-map.
   *  Carried in full_state (not just the discrete textmap_videos message)
   *  so EVERY new connection — same-browser preview / pop-out included —
   *  gets them on initial connect, the same way it gets the map. Absent /
   *  empty on maps with no video. */
  textMapVideos?:      TextMapVideoElement[];
  /** v2.18 — the active map IS a StarMap: viewers show the SSE iframe instead
   *  of a map texture. Same shape as starmap_show's payload. */
  starMap?:            MsgStarMapShow['payload'];
  /** v2.18 — the pack contains at least one StarMap: viewers pre-warm a hidden
   *  SSE iframe at connect so a later starmap_show is an instant show/hide,
   *  not a cold boot (design section 6). */
  starMapPrewarm?:     { origin: string; sessionId: string };
  /** v2.17.27 — accessibility content for the active text-map: each text
   *  block's words and each image's alt (resolved by the GM), so a viewer's
   *  screen-reader region can announce the handout. Carried in full_state for
   *  every new connection, the same as textMapVideos. Absent on non-text-maps. */
  textMapAlt?:         TextMapAltItem[];
}

/** v2.14.54 — wire payload for a composite map. Viewers unpack the
 *  message's mapBlob (a packed concatenation of tile bytes) using
 *  tileAssets[].blobOffset / blobSize, then call rasterizeFromTiles
 *  to produce the final composite image — bandwidth scales with
 *  unique tile bytes rather than the rasterised composite PNG. */
export interface CompositeWirePayload {
  /** Tile placements in compositor-norm 0..1 space (CompositeTile). */
  tiles: CompositeTile[];
  /** Unique tile assets referenced by `tiles`. Same asset id used
   *  more than once is listed once; viewers resolve tile.mapAssetId
   *  to the matching entry. */
  tileAssets: Array<{
    id:               string;
    imageWidth:       number;
    imageHeight:      number;
    pixelsPerSquare?: number;
    /** v2.14.55 — master tile's calibration nudge. Used by viewer
     *  rasterise to compute composite gridOffset. */
    gridOffsetX?:     number;
    gridOffsetY?:     number;
    mimeType:         string;
    /** Byte offset into the bundled mapBlob where this tile begins. */
    blobOffset:       number;
    /** Length in bytes. */
    blobSize:         number;
  }>;
  /** Aspect (W / H) the editor canvas was at on Save. The rasteriser
   *  uses this to reproduce the editor's layout geometry exactly. */
  aspect: number;
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
  /** v2.14.18 — grid offset for the incoming map. */
  gridOffsetX?:        number;
  gridOffsetY?:        number;
  /** v2.14.31 — shared grid colour for the incoming map. */
  gridColor?:          string;
  /** Projector viewport for the incoming map (rotation, mode, grid, filter
   *  toggle, etc.). Carried in map_change so the projector window applies
   *  the new map's saved viewport instead of holding over the prior map's. */
  projectorViewport?: ProjectorViewport;
  mapBlob: ArrayBuffer;
  /** v2.14.54 — composite payload. When set, mapBlob is a packed
   *  bundle of tile blobs (per tileAssets[].blobOffset / blobSize),
   *  NOT a single PNG. Viewers unpack + locally rasterise via
   *  rasterizeFromTiles so the heavy composite PNG never crosses
   *  the wire. Absent for normal single-image maps. */
  composite?: CompositeWirePayload;
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

/** GM toggled the master mute on the Markers panel — silences positional
 *  audio sources without affecting soundboard playback. */
export interface MsgPositionalMuteAll {
  type:  'positional_mute_all';
  muted: boolean;
}

/** GM paused / resumed broadcasting visuals to a downstream view. Players
 *  / projectors render a full-screen "Hold on while the GM faffs…"
 *  placeholder when `show` is true; underlying map state still updates
 *  beneath the overlay so resuming is instant. */
export interface MsgViewPlaceholder {
  type:    'view_placeholder';
  target:  'player' | 'projector';
  show:    boolean;
  message: string;
}

/**
 * Liveness ping sent by player views every few seconds. BroadcastChannel
 * has no built-in "who's listening" mechanism, so the GM tracks same-
 * machine player presence by buffering recent clientIds and expiring
 * them when heartbeats stop. PeerJS-connected players don't need this
 * (Host.connections already tracks them via the conn lifecycle).
 */
export interface MsgPlayerHeartbeat {
  type:     'player_heartbeat';
  clientId: string;
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
 * v2.16.43 — PiP iframe / pop-out window → GM identification. PlayerApp
 * sends this when the URL carries `?gmPreview=1`, so the GM can show
 * "GM Player View disconnected" instead of a generic "Player (peerid…)
 * disconnected" when the GM minimises / closes the preview.
 *
 * v2.17.16 — GM previews are always same-browser, so they now run over
 * LocalChannel only (the PeerJS loopback was redundant and dropped
 * constantly under browser background-throttling). LocalChannel carries
 * no peer id, so the hello includes the preview's clientId — the GM keys
 * its preview tracking + the matching player_bye on it.
 */
export interface MsgGmPreviewHello {
  type: 'gm_preview_hello';
  clientId?: string;
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
  /** v2.14.18 — grid offset; refreshed alongside pps when the GM
   *  recalibrates a live map. */
  gridOffsetX?:        number;
  gridOffsetY?:        number;
  /** v2.14.31 — shared grid colour; refreshed when the GM changes
   *  the per-map colour swatch. */
  gridColor?:          string;
}

/**
 * Triggers a handout reveal animation on the player + projector. Sent
 * by the GM after a text-map has been loaded — either automatically
 * (autoReveal=true, fired a moment after map_change) or manually (GM
 * clicks Start Animation).
 *
 * The receiver:
 *   1. Captures the current frame (which is the handout's STARTING
 *      frame — sent earlier via map_change for this map).
 *   2. Loads `mapBlob` (the FINAL frame, full handout) as the new
 *      texture underneath.
 *   3. Runs the configured transition.
 *
 * Both the starting frame (already on screen) and the final frame
 * are rendered through the live filter pipeline, so the reveal is
 * subject to whatever effect the player has on at the moment.
 */
export interface MsgHandoutReveal {
  type: 'handout_reveal';
  /** Which map this reveal applies to. Receiver guards on
   *  mapId === currentMapId to defend against late-arriving messages
   *  after the GM has switched maps. */
  mapId: string;
  /** Transition picked in the editor — must be one tagged forHandout. */
  transition: TransitionConfig;
  /** FINAL frame bytes — gets chunked over the wire via the same
   *  mapBlob pathway as MsgMapChange. The receiver pulls this in via
   *  the second arg of handleMessage(msg, mapBlob). */
  mapBlob: ArrayBuffer;
}

/**
 * v2.12.x — two-phase animated-map delivery follow-up.
 *
 * For video MapAssets (webm / mp4) the GM sends the first-frame
 * snapshot in the regular map_change message so receivers get a
 * usable static map within seconds. The full video bytes follow as
 * this MsgVideoBundle on the same channel — once it lands the
 * receiver swaps its renderer texture from static to VideoTexture
 * and the map starts animating.
 *
 * Receivers ignore the bundle if mapId !== currentMapId (the GM
 * already switched away).
 */
export interface MsgVideoBundle {
  type: 'video_bundle';
  /** Map this video is for — receiver guards against late delivery
   *  after the GM has moved on to another map. */
  mapId: string;
  /** Source MIME of the original blob (video/webm or video/mp4) so
   *  the receiver can wrap it back into a Blob with the right type
   *  before handing it to the renderer. */
  mimeType: string;
  /** The full video bytes — travels via the chunked binary path
   *  the same way map_change's mapBlob does. */
  mapBlob: ArrayBuffer;
}

/**
 * Player → GM: self-identification, sent on every (re)connect once the
 * player has chosen / restored an identity. The GM upserts a
 * PersistentPlayer keyed by playerId and binds this live connection
 * (clientId) to it.
 */
export interface MsgPlayerIdentify {
  type: 'player_identify';
  playerId:      string;
  clientId:      string;
  playerName:    string;
  characterName: string;
  color:         string;
  /** v2.16.103 — true when this viewer is a touch / mobile device
   *  (matchMedia '(hover: none) and (pointer: coarse)'). Lets the GM's
   *  Player connections summary split remote windows into PC vs mobile.
   *  Absent = treat as desktop. */
  mobile?:       boolean;
}

/**
 * Player → GM: clean disconnect (sent on window unload). Lets the GM drop
 * the live binding immediately rather than waiting on transport teardown —
 * BroadcastChannel never signals close, mirroring projector_bye.
 */
export interface MsgPlayerBye {
  type: 'player_bye';
  clientId: string;
}

/**
 * Player → GM: "wipe my record". Used by the Forget-me button on the player
 * identify modal — removes the PersistentPlayer entry from the GM's registry
 * along with any placed tokens, so the player can re-introduce themselves
 * from scratch. The player will follow up by clearing their own localStorage
 * and reloading.
 */
export interface MsgPlayerForgetMe {
  type: 'player_forget_me';
  playerId: string;
  clientId: string;
}

/**
 * GM → all players: current roster snapshot so player views know who else
 * is in the session (drives player→player messaging targets and the
 * initiative tracker). GM-only fields (markerId, managedByGm) are omitted.
 */
export interface MsgPlayerRoster {
  type: 'player_roster';
  players: Array<{
    id:            string;
    playerName:    string;
    characterName: string;
    color:         string;
    connected:     boolean;
  }>;
}

/**
 * Player → GM: the player pinged a point on their map. Carries normalised map
 * coords; the GM resolves the player's colour + name from its roster binding
 * and relays a ping_show to everyone.
 */
export interface MsgPlayerPing {
  type: 'player_ping';
  /** Client-generated id — lets the GM dedupe the duplicate that same-machine
   *  players deliver over both BroadcastChannel and PeerJS, and doubles as the
   *  broadcast ping id. */
  pingId: string;
  playerId: string;
  clientId: string;
  x: number; // 0..1 normalised map coord
  y: number;
}

/**
 * GM → all players: show a ping pulse. Sent when the GM relays a player ping
 * (or originates one). Self-contained — carries colour + name so receivers
 * render without needing the roster.
 */
export interface MsgPingShow {
  type: 'ping_show';
  pingId: string;
  x: number;
  y: number;
  color: string;
  name: string;
}

/**
 * GM → all players: which Player-Voice interactions are currently enabled, so
 * player views can hide affordances the GM has switched off. Fields are
 * optional; an absent field means "unchanged / keep default (enabled)".
 */
export interface MsgPlayerFeatures {
  type: 'player_features';
  pings?:          boolean;
  messaging?:      boolean;
  movableMarkers?: boolean;
  /** v2.17.10 — distance scale for the "Measure from here" ruler, so remote
   *  player views measure on the GM's units. `measureUnitValue` per grid
   *  square, `measureUnitSuffix` tagged on the result (e.g. 5 + "'"). */
  measureUnitValue?:  number;
  measureUnitSuffix?: string;
}

/**
 * Player → GM: a chat message. `toPlayerId` omitted = addressed to the GM;
 * otherwise addressed to another player (and always copied to the GM).
 */
export interface MsgPlayerMessage {
  type: 'player_message';
  messageId:    string;
  fromPlayerId: string;
  clientId:     string;
  toPlayerId?:  string; // undefined = to GM
  text:         string;
}

/**
 * GM → players: deliver a message to a player view. Used to relay
 * player→player messages and to send GM replies. Broadcast — each player
 * shows only messages whose `toPlayerId` matches their own id. Carries the
 * sender's display identity so the receiver can render without the roster.
 */
export interface MsgMessageDeliver {
  type: 'message_deliver';
  messageId:   string;
  fromKind:    'gm' | 'player';
  fromName:    string;
  fromColor:   string;
  toPlayerId:  string;
  text:        string;
}

/**
 * GM → players: the player tokens on the CURRENTLY ACTIVE map. The GM sends
 * only the active map's set (it owns per-map placement), so player views just
 * render whatever arrives. Re-sent on placement change, drag, map change, and
 * when a new player joins.
 */
export interface MsgPlayerMarkers {
  type: 'player_markers';
  markers: Array<{
    playerId: string;
    name:     string;
    color:    string;
    x:        number; // 0..1 normalised map coord
    y:        number;
    /** Facing in degrees clockwise from north (0–359), snap-to-45° at the UI
     *  layer. Drives the edge pointer + 90°-step image rotation for non-square
     *  tokens. Undefined = facing north. */
    facing?:  number;
    /** Optional inline glyph (unicode char). Always small. Image-form icons
     *  ride a separate `player_icon_update` message keyed by playerId so they
     *  don't bloat this message past the PeerJS DataChannel size limit. */
    iconChar?:  string;
    /** True when the GM has a stored image-form icon for this player. The
     *  bytes don't ride on player_markers — they come via player_icon_update.
     *  Receivers use this as a self-heal signal: if hasIcon is set but the
     *  local cache lacks an entry for this playerId, they send an upstream
     *  `player_icon_request` so the GM resends the icon. Covers the case
     *  where a chunked binary icon broadcast was dropped or arrived before
     *  the receiver was ready. */
    hasIcon?:   boolean;
    /** Token footprint W×H in map squares. Only honoured on calibrated maps. */
    tokenSize?: TokenSize;
  }>;
}

/**
 * GM → players: the icon image (data URL) for a specific player's token.
 * Sent separately from `player_markers` because raster / SVG data URLs can
 * easily exceed the PeerJS DataChannel ~16KB message limit — bundling them
 * inline with the marker list would silently break the whole channel.
 * Players cache by playerId; absent `dataUrl` = clear (fall back to glyph
 * or initial). The Host chunks `dataUrl` over the wire like soundboard assets.
 */
export interface MsgPlayerIconUpdate {
  type: 'player_icon_update';
  playerId: string;
  /** Optional — omit to clear the cached icon. PNG / WebP data URLs are
   *  routed through the chunked binary path; small unicode glyphs are
   *  delivered inline via `player_markers` instead. */
  dataUrl?: string;
}

/**
 * Player / projector → GM: I'm rendering a token whose markers payload says
 * `hasIcon: true` but I have nothing in my icon cache for this playerId — the
 * chunked binary delivery for this icon must have been dropped or arrived
 * before I was ready. Please send it again. Cheap to over-fire; the GM just
 * re-emits a `player_icon_update` for the requested playerId. v2.16.25.
 */
export interface MsgPlayerIconRequest {
  type: 'player_icon_request';
  /** The player whose icon we're missing. */
  playerId: string;
}

/**
 * Player → GM: I dragged my own token. The GM validates it's my marker and
 * that movable markers are enabled, updates the placement, and rebroadcasts.
 * `done` marks the end of a drag so the GM can finalise (and offer cancel-move).
 */
export interface MsgPlayerMarkerMove {
  type: 'player_marker_move';
  playerId: string;
  clientId: string;
  x: number;
  y: number;
  /** Optional facing update — present when the player rotated their token.
   *  Position can also be unchanged (only facing edited); the GM accepts
   *  whichever fields are provided. */
  facing?: number;
  done: boolean;
}

/**
 * GM → players: current initiative tracker state. The whole state ships every
 * time it changes so the player view is a pure mirror — no client-side state
 * machine, no drift. Players render an atmospheric face (portraits + colours
 * for players, "???" + "Opposition" for enemies); the GM renders the
 * mechanical face (giant numbers + threat letters).
 */
export interface MsgInitiativeUpdate {
  type: 'initiative_update';
  state: InitiativeState;
}

/**
 * GM → all players: roll-call broadcast. Player views pop an input prompt for
 * the player to type their initiative result and send it back. `message` is
 * an optional explanatory line (system / situation hint).
 */
export interface MsgInitiativeCall {
  type: 'initiative_call';
  message?: string;
}

/**
 * Player → GM: the player's typed initiative value. The GM creates / updates
 * the player's card and slots it into the active deck per current sort mode.
 */
export interface MsgInitiativeRoll {
  type: 'initiative_roll';
  playerId: string;
  clientId: string;
  /** Polymorphic — "18", "Fast", "Ace" all OK. Sorted lexically/numerically
   *  depending on tracker sort mode. */
  value: string;
}

// ─── Annotate (v2.16.76) — per-map GM annotations: clocks + whiteboard ───────

/** A Blades-in-the-Dark style progress clock: a segmented circle the GM
 *  fills as a situation advances (red = danger, green = racing, etc.).
 *  Tied to a map; shared live to players + projector. */
export interface ProgressClock {
  id: string;
  name: string;
  /** Total wedges. */
  segments: number;
  /** Wedges currently filled, 0..segments. */
  filled: number;
  /** Hex colour for filled wedges + accents. */
  color: string;
  /** v2.16.82 — anchor + size in normalised MAP coords (0..1), so the clock
   *  sits at a fixed map location and pans / zooms with the map, 1:1 on GM
   *  and player. (Was a screen fraction pre-v2.16.82.) */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Rotation in degrees (v2.16.82). */
  rot?: number;
}

/** A real-time timer / countdown overlay (v2.16.78). Running state is
 *  expressed as absolute epoch anchors so every surface ticks locally
 *  from the same numbers — no per-second broadcast. */
export interface AnnotateTimer {
  id: string;
  name: string;
  mode: 'countup' | 'countdown';
  color: string;
  /** HUD position as a fraction (0..1) of the view. */
  x: number;
  y: number;
  /** Countdown total in ms (ignored for count-up). */
  durationMs: number;
  running: boolean;
  /** Epoch (ms) the current run segment started; valid while running. */
  startedAt: number;
  /** Elapsed ms accumulated from previous run segments (before current). */
  baseElapsedMs: number;
  /** v2.16.82 — anchor + size in normalised MAP coords (see ProgressClock). */
  w: number;
  h: number;
  rot?: number;
}

/** A free text note overlay (v2.16.80). Audience 'gm' shows only on the
 *  GM view; 'player' shows on player + projector + GM. The text auto-fits
 *  the box, so shrinking the box shrinks the font. v2.16.82 — position +
 *  size are now normalised MAP coords (anchored 1:1). */
export interface AnnotateNote {
  id: string;
  text: string;
  color: string;
  audience: 'gm' | 'player';
  x: number;
  y: number;
  w: number;
  h: number;
  rot?: number;
}

/** One freehand whiteboard stroke. Points are normalised map coordinates
 *  (0..1) so the drawing pans / zooms with the map on every surface. */
export interface AnnotateStroke {
  id: string;
  color: string;
  width: number;
  points: Array<{ x: number; y: number }>;
}

/** Per-map annotation state. Persisted per mapId (localStorage) and
 *  broadcast to viewers. */
export interface AnnotateState {
  clocks: ProgressClock[];
  strokes: AnnotateStroke[];
  timers: AnnotateTimer[];
  notes: AnnotateNote[];
}

/** GM → viewers: the full clocks list for the active map (small payload,
 *  sent whole on every change). */
export interface MsgAnnotateClocks {
  type: 'annotate_clocks';
  clocks: ProgressClock[];
}

/** GM → viewers: append a single whiteboard stroke. Sent one-per-message
 *  (never the whole board at once) to stay under the DataChannel
 *  single-frame limit. */
export interface MsgAnnotateStroke {
  type: 'annotate_stroke';
  stroke: AnnotateStroke;
}

/** GM → viewers: clear the whole whiteboard. Also used as the first step
 *  of a full resync (clear, then re-send each stroke). */
export interface MsgAnnotateClear {
  type: 'annotate_clear';
}

/** GM → viewers: the full timers list for the active map. Absolute epoch
 *  anchors let each surface tick locally, so this is only re-sent on a
 *  GM edit (add / start / pause / reset / move / remove). */
export interface MsgAnnotateTimers {
  type: 'annotate_timers';
  timers: AnnotateTimer[];
}

/** GM → viewers: the player-visible notes for the active map. GM-only
 *  notes are never broadcast. */
export interface MsgAnnotateNotes {
  type: 'annotate_notes';
  notes: AnnotateNote[];
}

/** GM → viewers: the live YouTube video elements for the active text-map
 *  (geometry + ids), so players + projector render the iframes as a live
 *  overlay tracking the map. Empty list on non-text-maps / no videos. */
export interface MsgTextMapVideos {
  type: 'textmap_videos';
  videos: TextMapVideoElement[];
}

/** v2.18 — the StarMap map kind's descriptor (on MapAsset.starMap). Identity
 *  anchors for the "is the right starmap loaded?" prompt plus the Player View
 *  this map shows on activation. `sessionId` is SSE's persistent per-starmap
 *  broadcastId, so it survives GM restarts and PC moves. */
export interface StarMapConfig {
  /** SSE origin, e.g. https://starsystemx.com (beta/dev origins allowed). */
  origin:      string;
  sessionId:   string;
  starmapId:   string;
  starmapName: string;
  presetId:    string;
  presetName:  string;
}

/** v2.18 — "show this StarMap". Sent WHERE map_change would have gone when the
 *  activated map is a StarMap: viewers hide the WebGL canvas, pause the
 *  renderer and show the SSE player view in a full-bleed iframe that
 *  connects itself to the SSE session (parallel channel — Mappadux carries
 *  no SSE data). Any later map_change ends StarMap mode. Small, single frame. */
export interface MsgStarMapShow {
  type: 'starmap_show';
  payload: {
    origin: string;
    sessionId: string;
    presetId: string;
    backgroundColor?: string;
  };
}

/** One handout element reduced to its accessible text plus the top-left
 *  position used to read the list in page order. The GM resolves image alt
 *  (authored, else the asset name) so viewers don't need the source assets. */
export interface TextMapAltItem {
  /** Geometry as PERCENTAGES of the page (0..100) — top-left + size. Used to
   *  read in page order and to place the focusable a11y overlay over the box. */
  x:    number;
  y:    number;
  w:    number;
  h:    number;
  text: string;
}

/** GM → viewers: the active text-map's screen-reader content (text + image
 *  alt). Viewers feed it to a visually-hidden region; no visual effect. Empty
 *  list on non-text-maps. */
export interface MsgTextMapAlt {
  type: 'textmap_alt';
  items: TextMapAltItem[];
}

/** GM → viewers: playback state for ONE in-map YouTube video. The GM owns
 *  the controls; viewers have none and reconcile their own iframe to this
 *  (match play/pause, seek if drift > ~0.5s, set volume). Sent on every YT
 *  state change plus a periodic tick so late joiners + drift converge.
 *  `state` is the raw YouTube IFrame player state (1 playing, 2 paused,
 *  0 ended, 3 buffering, 5 cued); `seconds` is the GM's current position;
 *  `volume` is 0..100. Not frame-accurate by design. */
export interface MsgVideoPlayback {
  type: 'video_playback';
  id: string;
  videoId: string;
  state: number;
  seconds: number;
  volume: number;
}

export type GMMessage =
  | MsgFullState
  | MsgViewUpdate
  | MsgFogUpdate
  | MsgFilterUpdate
  | MsgMapChange
  | MsgVideoBundle
  | MsgHandoutReveal
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
  | MsgPositionalMuteAll
  | MsgViewPlaceholder
  | MsgPlayerHeartbeat
  | MsgTrackerScan
  | MsgTrackerBlob
  | MsgProjectorHello
  | MsgGmPreviewHello
  | MsgProjectorBye
  | MsgProjectorRole
  | MsgProjectorShutdown
  | MsgProjectorViewportUpdate
  | MsgMapMetaUpdate
  | MsgPlayerIdentify
  | MsgPlayerBye
  | MsgPlayerForgetMe
  | MsgPlayerRoster
  | MsgPlayerPing
  | MsgPingShow
  | MsgPlayerFeatures
  | MsgPlayerMessage
  | MsgMessageDeliver
  | MsgPlayerMarkers
  | MsgPlayerIconUpdate
  | MsgPlayerIconRequest
  | MsgPlayerMarkerMove
  | MsgInitiativeUpdate
  | MsgInitiativeCall
  | MsgInitiativeRoll
  | MsgAnnotateClocks
  | MsgAnnotateStroke
  | MsgAnnotateClear
  | MsgAnnotateTimers
  | MsgAnnotateNotes
  | MsgTextMapVideos
  | MsgTextMapAlt
  | MsgVideoPlayback
  | MsgStarMapShow;

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
/**
 * v2.14.3 — Map Compositor (v2.15 headline) data model foundation.
 * A composite map is built from N child map assets arranged on a
 * shared canvas. Two modes:
 *
 *   • Modular   — children sit side-by-side (tile-set layouts:
 *                 Dwarven Forge, Heroquest, sci-fi corridor packs).
 *                 First tile down sets the master square size;
 *                 subsequent scaled tiles re-scale to align.
 *
 *   • Layered   — children stack on top of one another (roof /
 *                 interior, day / night, before / after). Only 2
 *                 layers; z-order via the "push to back" affordance
 *                 in the editor.
 *
 * Editor + renderer come in a later release; the type lives here
 * now so storage / bundle export / migration code can be staged
 * without churn later. Until the editor lands, no caller writes
 * compositeTiles, and code paths that read it should fall back to
 * the single-asset behaviour (mapAssetId continues to drive).
 */
export interface CompositeTile {
  /** Stable per-tile id, unique within the composite. */
  id:           string;
  /** Map asset rendered for this tile. Must resolve to an existing
   *  MapAsset; missing assets show the standard "Fix Missing Map"
   *  placeholder. */
  mapAssetId:   string;
  /** Centre x in the composite's normalised 0..1 space. */
  x:            number;
  /** Centre y in the composite's normalised 0..1 space. */
  y:            number;
  /** Rotation in degrees (0..360). Editor offers free rotate + snaps
   *  to common tile-set angles (0/90/180/270 ±5° and 30/45/60 ±2°
   *  off the nearest right angle). */
  rotation:     number;
  /** Optional uniform scale multiplier (1.0 = native size). Modular
   *  mode auto-scales scaled-grid tiles to match the master tile's
   *  square size; this captures that result and any user override.
   *  v2.14.62 — also the WIDTH-fraction-of-canvas used by the
   *  Composite Editor when aspect-lock is on (height derives from
   *  the asset's native aspect). When aspect-lock is off + the user
   *  drags height, scaleY is set to the height-fraction-of-canvas
   *  override. Absent scaleY = lock aspect to native (default). */
  scale?:       number;
  /** v2.14.62 — independent vertical scale (fraction of canvas
   *  HEIGHT) for free-aspect resizes. Absent = derive from native
   *  asset aspect (the locked-aspect default). Editor's
   *  lock-aspect toggle controls whether dragging the resize handle
   *  writes this field. */
  scaleY?:      number;
  /** v2.14.62 — per-tile aspect-ratio lock for the resize handle.
   *  Defaults to true (locked). When false, the resize handle
   *  scales width + height independently and persists scaleY. */
  lockAspect?:  boolean;
  /** v2.14.59 — horizontal mirror (flip the tile left/right). */
  flipH?:       boolean;
  /** v2.14.59 — vertical mirror (flip the tile top/bottom). */
  flipV?:       boolean;
  /** Layered-mode only — z-order. Lower draws under higher. Defaults
   *  to insertion order. */
  layer?:       number;
}

export interface MapAsset {
  id:            string;
  /** Display name — derived from the original file or URL, user-renameable. */
  filename:      string;
  source:        'upload' | 'web-link' | 'text-map' | 'composite-map' | 'starmap';
  /** True when the blob is in IDB (and travels in bundle exports). For
   *  text-map assets this is always true (the body lives in `textMap`);
   *  likewise for starmap assets (the body lives in `starMap`). */
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
   * Optional whole-map grid dimensions in 1"/25 mm squares. Set when the user
   * calibrated via the "by grid" path (typing H × V squares) rather than the
   * ruler. Re-opening calibration pre-fills these. Stored separately from
   * calibrationLine so the ruler still has its own memory.
   */
  gridSquares?: { h: number; v: number };
  /**
   * v2.14.18 — Grid offset in map pixels, applied to every viewer's
   * 1″ overlay so the gridlines align with a map's drawn border or
   * pre-existing grid. (0, 0) = grid starts on the map's centre (the
   * default); positive values shift the grid right / down by that
   * many map-pixels. The visible result is mod-pps anyway — viewers
   * reduce the offset to its canonical [0, pps) range when drawing.
   *
   * Set in the Map Calibration modal via arrow-key nudge (or
   * drag-nudge later); persists alongside calibrationLine /
   * gridSquares. Broadcast in the same map metadata payload that
   * carries mapPixelsPerSquare to player + projector viewers.
   */
  gridOffsetX?: number;
  gridOffsetY?: number;
  /**
   * v2.14.31 — Shared grid colour for ALL viewers (player + scaled
   * primary + scaled monitors) of this map. Replaces the per-view
   * ProjectorViewport.gridColor + ViewState.playerGridColor — the
   * GM picks one colour once (in the Map panel next to Backdrop),
   * every viewer drawing this map's grid uses it. Falls back to
   * '#ffffff' when unset. Travels in map_meta_update / full_state /
   * map_change broadcasts.
   */
  gridColor?: string;
  /**
   * Provenance + confidence behind `pixelsPerSquare`. Drives the library
   * badge and retrofit behaviour:
   *   • 'manual'      — user calibrated by hand via the two-endpoint flow.
   *                     Highest trust; never overridden by the auto-detector.
   *   • 'scaled'      — auto-detector confident (multiple signals aligned).
   *                     Auto-applied without prompting.
   *   • 'auto-scaled' — auto-detector best-guess, or user picked from the
   *                     candidate dialog. Lower confidence — orange badge.
   *   • 'inferred'    — derived solely from a filename WxH hint when the
   *                     image dimensions don't divide cleanly. pps is
   *                     rounded to the nearest integer. Distinct pill
   *                     (amber) so the GM can verify by eye — close
   *                     enough to be useful at the table without claiming
   *                     surveyor accuracy. v2.14.40.
   *   undefined on a calibrated asset that predates this field — treated as
   *   'manual' for benefit-of-the-doubt and rendered the same green badge.
   */
  scaleConfidence?: 'manual' | 'scaled' | 'auto-scaled' | 'inferred';
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
  /**
   * v2.18 — StarMap payload. Present iff source='starmap'. A StarMap has NO
   * image: activating it shows viewers a live Star System Explorer player view
   * (the full 3D app in an iframe) that the GM drives from the SSE tab.
   * Mappadux carries only this descriptor; view data flows over SSE's own
   * channel. See docs/starmap-map-kind-design.md.
   */
  starMap?:      StarMapConfig;
  /**
   * v2.14.3 — composite-map tile list. Present iff source='composite-map'.
   * The renderer composites these tiles into a single output canvas; see
   * CompositeTile for the per-tile shape. Modular vs layered behaviour
   * is captured by `compositeMode`. Empty during the brief moment between
   * "user picked New Composite Map" and "user dropped the first tile";
   * the editor blocks save when the list is empty.
   */
  compositeTiles?: CompositeTile[];
  /** v2.14.51 — aspect ratio (W / H) of the compositor canvas at the
   *  time of Save. tile.x/y are normalised 0..1 in compositor space;
   *  that space's aspect determines whether (0.5, 0.5) lands at a
   *  square or a wide / tall point. Persist so the rasteriser
   *  reproduces the editor's geometry exactly. Defaults to 4/3 when
   *  unset (legacy composites). */
  compositeAspect?: number;
  /** v2.14.3 — composite-map mode. 'modular' = side-by-side tile
   *  layout; 'layered' = stacked. Drives editor + renderer behaviour. */
  compositeMode?:  'modular' | 'layered';
  /** v2.14.70 — composite-only "minus topmost tile" rasterise. Generated
   *  alongside the main blob when the composite has overlapping tiles.
   *  The renderer hosts it as a backing plane behind the main map so
   *  the Reveal Map Layer brush punches alpha holes that expose the
   *  tile-below content rather than the backdrop. Absent for non-
   *  layered composites (the brush falls through to backdrop reveal
   *  same as Make Transparent in that case). */
  revealBackingBlob?: Blob;
  /** v2.16 — Stagecraft per-map assignments. Travels in `.mappadux`.
   *  Keys are stable connection ids from stagecraftStorage (WLED
   *  endpoint id, the literal "ha" for the Home Assistant link,
   *  future "spotify" / "youtube"). Values discriminate by `kind`. */
  stagecraft?: Record<string, StagecraftAssignment>;
  addedAt:       number;
}

/** Per-map preset/scene assignment for a single Stagecraft connection.
 *  Discriminated by `kind` so we can extend without reshaping existing
 *  entries. WLED fires a preset id; HA calls a scene or script; QLC+
 *  fires a Function (scene / chaser / sequence / collection) by id. */
export type StagecraftAssignment =
  | { kind: 'wled'; presetId: number }
  | { kind: 'ha';   service: 'scene' | 'script'; entity: string }
  | { kind: 'qlc';  functionId: number };

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
export type TextMapElement = TextMapTextElement | TextMapImageElement | TextMapVideoElement;

interface TextMapElementBase {
  /** Stable id — used for selection state and React-style reconciliation. */
  id:    string;
  /** Geometry as PERCENTAGES of the page (0..100). Lets the same layout
   *  render correctly at any rasterisation resolution. */
  x:     number;
  y:     number;
  w:     number;
  h:     number;
  /** v2.14.101 — rotation in degrees about the element's centre.
   *  Editor + rasteriser apply this as a CSS / canvas transform.
   *  Absent = 0. */
  rotation?: number;
  /** v2.14.101 — mirror flags. Same semantics as the Composite Editor:
   *  applied as scale(±1, ±1) on the inner content so chrome (move
   *  handle, rotation ball, etc.) doesn't mirror with the content. */
  flipH?:    boolean;
  flipV?:    boolean;
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
  /** v2.17.26 — accessibility alt text announced for this image by the
   *  handout's screen-reader region. When absent/blank, the referenced
   *  asset's name is used as the fallback. */
  alt?:    string;
  /** Optional tint colour for monochrome SVG icons. */
  tint?:   string;
  /** v2.14.102 — When true (the default), resizing preserves the
   *  current width:height ratio so the image doesn't squash. Toggle
   *  off via the lock button in the element chrome to free-resize
   *  (matches the Composite Editor's lock-aspect behaviour). Absent
   *  treated as true. Text elements ignore this — handout text
   *  boxes are designed for free reflow at any aspect. */
  lockAspect?: boolean;
}

/** v2.16.90 — A live YouTube video embedded on a text-map page. Unlike
 *  text/image it is NOT rasterised into the page image — it renders as a
 *  live iframe overlay (GM editor + player + projector) tracking the
 *  element's geometry. Borderless; uses YT's own player controls when the
 *  GM interacts with it (after selecting via the move handle). */
export interface TextMapVideoElement extends TextMapElementBase {
  type:    'video';
  /** YouTube video id (parsed from the pasted URL via extractVideoId). */
  videoId: string;
  /** v2.16.96 — As TextMapImageElement.lockAspect. ON by default for
   *  video (clips are almost always 16:9, so keeping the ratio while
   *  resizing avoids letterboxing). The reset button snaps the box back
   *  to a true 16:9 at the current width. Toggle off to stretch freely. */
  lockAspect?: boolean;
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
  /** v2.16 — Pack-level Stagecraft Soundtracks. Lives on StoredSession
   *  so it survives map switches and travels with the bundle. */
  soundtracks?: SoundtracksConfig;
}

/** v2.16 — Pack-level Soundtracks. Survives map switches; long-term
 *  layer underneath the per-map Audio panel. Mutually-exclusive
 *  playback — only ONE slot can play at a time. Selecting a
 *  different slot crossfades from the current to the new one.
 *
 *  The first slot is always a "silent" anchor — selecting it
 *  crossfades to nothing, the elegant way to stop the music.
 *  Subsequent slots are user-defined.
 *
 *  v2.15.12 redesign: replaced the fixed Pre-setup/Theme/Outro/
 *  Playlist shape with an N-slot model (like the Soundboard) so
 *  GMs can author per-scene labelled cues. Migration in
 *  src/stagecraft/soundtracksMigrate.ts. */
export interface SoundtracksConfig {
  /** Ordered list of slots. By convention slots[0] is silent; the
   *  migration helper guarantees this. */
  slots: SoundtrackSlot[];
  /** Crossfade duration in milliseconds when switching slots.
   *  Default 1500 ms. */
  crossfadeMs?: number;
}

/** A single Soundtrack slot — holds AT MOST one thing: one track,
 *  or one playlist URL, or nothing (silent / empty).
 *
 *  v2.15.20 — collapsed from a mode-picker + multi-track-array
 *  design. Variety comes from having more slots, not from packing
 *  multiple items into one slot.
 *
 *  Behaviour is inferred from the track's kind:
 *   - empty / kind='silent': selecting this slot stops the music.
 *   - track is a single video / single Spotify track: single-track
 *     playback. Loop toggles loop. startSec / endSec trim the
 *     range.
 *   - track is a YouTube playlist / Spotify playlist / album:
 *     playlist-style playback (the engine iterates internally).
 *     Loop toggles whether the playlist cycles. Shuffle randomises
 *     the order.
 *
 *  No mode picker, no manual multi-track lists. */
export interface SoundtrackSlot {
  id: string;
  label: string;
  /** 'silent' = anchor slot (always empty, selecting stops the
   *  music). 'normal' = a user slot whose content is in `track`. */
  kind: 'silent' | 'normal';
  /** The one thing in this slot. Undefined = empty slot. */
  track?: SoundtrackTrack;
  /** Loop the slot's content. Default false. Universal — applies
   *  to single tracks and playlists alike. */
  loop?: boolean;
  /** Shuffle the playlist order. Default true once a playlist-
   *  content track lands in the slot; ignored for single-track
   *  content. */
  shuffle?: boolean;
  /** v2.15.34 — Restart-vs-resume on switch-back. When true, the
   *  slot starts from the beginning every time it's selected;
   *  when false, it resumes from where it left off. Missing =
   *  use the per-content default: single tracks default to
   *  Restart, loops + playlists default to Resume (those are
   *  the cases where carrying on where you left off feels
   *  natural). User toggle stores the explicit value. */
  restart?: boolean;
  /** Trim — only meaningful when `track` is a single track. */
  startSec?: number;
  endSec?:   number;
  /** Volume 0..100. Default 80. */
  volume?: number;
}

/** A single track reference. Discriminated by `kind` so Spotify
 *  can land alongside YouTube without reshaping.
 *
 *  - youtube:          one video by id.
 *  - youtube-playlist: a whole YouTube / YouTube Music playlist by
 *                      list id. The IFrame Player iterates the
 *                      playlist internally (with its own shuffle /
 *                      loop hooks); the slot treats the playlist as
 *                      a single playable entity.
 *  - spotify:          one track / album / playlist / episode via
 *                      the Web Playback SDK. */
export type SoundtrackTrack =
  | { kind: 'youtube';          videoId:  string; label?: string }
  | { kind: 'youtube-playlist'; listId:   string; label?: string }
  | { kind: 'spotify';          trackUri: string; label?: string };

/** Per-pack UI theme. Both fields optional — unset = Mappadux defaults
 *  (dark mode, cyan accent). */
export interface ThemeConfig {
  mode?:   'dark' | 'light';
  /** CSS color string (`#rrggbb` or named). Used as `--accent`. */
  accent?: string;
}

/** A choice of animated backdrop + tuning knobs. */
export interface BackdropConfig {
  /** Backdrop id from `src/rendering/backdrops/backdropRegistry.ts`.
   *  'none' = solid bg colour (default). */
  kind:   string;
  /** Optional speed scalar 0..2; backdrop registry decides what it means.
   *  Defaults to 1.0 if unset. */
  speed?: number;
  /** v2.12 — per-backdrop shader parameter values (sliders, toggles,
   *  colour pickers). Keys match the matching BackdropEntry's
   *  `params[].id`; values are numbers for slider/toggle, '#rrggbb'
   *  hex for color. Unset / partial entries fall back to the
   *  registered default for that param. */
  params?: Record<string, number | string>;
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
