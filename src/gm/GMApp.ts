import { StateManager } from './StateManager.ts';
import { MapManager } from './MapManager.ts';
import { CanvasUndoManager } from './CanvasUndoManager.ts';
import { FogEditor } from './FogEditor.ts';
import { OVERLAY_KIND_REGISTRY, OVERLAY_KIND_ORDER, overlayKind, DEFAULT_EDGE_FADE } from '../mapfx/overlayKindRegistry.ts';
import { confirmDialog } from './confirmDialog.ts';
import { MessageLog } from '../ui/MessageLog.ts';
import type { OverlayKind, FogPolygon } from '../types.ts';
import { offsetPolyline } from '../mapfx/polylineOffset.ts';
import { subtractFromAll, cleanRibbonToBlobs } from '../mapfx/polygonOps.ts';
import { floodFillToPolygon } from '../mapfx/floodFill.ts';
import { wireSliderTooltip } from '../utils/sliderReadout.ts';
import { buildColorRow, buildSliderRow, buildToggleRow } from './sideParamRows.ts';
import { ViewportEditor } from './ViewportEditor.ts';
import { MarkerEditor } from './MarkerEditor.ts';
import { MapAssetModal } from './MapAssetModal.ts';
import { MapAssetStore } from '../maps/MapAssetStore.ts';
import { extractFirstFrameSnapshot } from '../maps/videoSnapshot.ts';
import { TextMapEditor } from './TextMapEditor.ts';
import { MapCalibrationModal } from './MapCalibrationModal.ts';
import { ProjectorViewportEditor } from './ProjectorViewportEditor.ts';
import { HamburgerMenu } from './HamburgerMenu.ts';
// v2.16.34 — appendAddOption retired (the sentinel option at the bottom
// of each picker was replaced by an adjacent "+" icon button). The
// SELECT_ADD_SENTINEL constant is still imported because the change
// handlers keep a defensive branch in case a cached UI emits it.
import { SELECT_ADD_SENTINEL } from './selectAdd.ts';
import { EditableSelect } from './EditableSelect.ts';
import { getAllSetups, setActiveSetupId, saveSetup } from '../projector/calibrationStorage.ts';
import { SoundboardPanel, type SoundboardBroadcast } from './SoundboardPanel.ts';
import { PlayersPanel } from './PlayersPanel.ts';
import { MessageThreads } from './MessageThreads.ts';
import { buildMessageThreadPanel } from './MessageThreadPanel.ts';
import { PlayerRegistry } from '../players/PlayerRegistry.ts';
import { assetToPlayerIcon } from '../players/playerIcon.ts';
import { PingLayer } from '../rendering/PingLayer.ts';
import { glyphToDataUrl } from '../rendering/glyphIcon.ts';
import { PlayerMarkerLayer } from '../rendering/PlayerMarkerLayer.ts';
import { MeasureTool, squaresBetweenNorm } from '../rendering/MeasureTool.ts';
import { LLMClient } from '../ai/LLMClient.ts';
import { InitiativeTracker } from './InitiativeTracker.ts';
import { loadInitiativeState, stripInitiativeForWire } from '../initiative/initiativeState.ts';
import { AnnotateController } from './AnnotateController.ts';
import { emptyAnnotateState } from '../annotate/annotateState.ts';
import { isAnnotateMuted, setAnnotateMuted } from '../storage/localSettings.ts';
import { SoundboardEngine } from '../audio/SoundboardEngine.ts';
import { Renderer } from '../rendering/Renderer.ts';
import { FilterPanel } from '../filters/FilterPanel.ts';
import { filterRegistry } from '../filters/FilterRegistry.ts';
import { cssApproxForFilter } from '../filters/cssApproximations.ts';
import { TransitionPanel } from '../transitions/TransitionPanel.ts';
import { transitionRegistry } from '../transitions/TransitionRegistry.ts';
import { Host } from '../p2p/Host.ts';
import { generateRoomCode, generateInstanceId } from '../p2p/roomCode.ts';
import { saveSession, loadSession, getAllMaps, getMap, saveMap, deleteMap, clearAssetLibraries, clearEverything, getActiveInstanceId } from '../storage/db.ts';
import { clearAllLocalSettings, SUPPRESS_DEFAULT_SEED_KEY, DEFAULT_SEED_DONE_KEY, arePingsEnabled, isMessagingEnabled, arePlayerMarkersMovable, getInitiativeSortDirection, isInitiativeAnonymised, getMeasureUnitValue, getMeasureUnitSuffix, getWelcomePackSeededVersion, getWelcomePackOfferDismissedVersion, setWelcomePackOfferDismissedVersion, setWelcomePackRefreshedFlag, consumeWelcomePackRefreshedFlag } from '../storage/localSettings.ts';
import { seedDefaultMaps, reseedWelcomePack, WELCOME_PACK_VERSION } from '../storage/seedMaps.ts';
import { seedAudioAssets } from '../storage/seedAudioAssets.ts';
import { migrateLegacyMaps } from '../storage/seedMapAssets.ts';
import { seedImageAssetsIfNeeded } from '../images/seedImageAssets.ts';
import { migrateLegacyIconsIfNeeded } from '../images/migrateLegacyIcons.ts';
import { renderLibIcon, renderLibIconFromAsset } from '../images/libIconRender.ts';
import { ImageAssetStore } from '../images/ImageAssetStore.ts';
import { ImageAssetModal } from '../images/ImageAssetModal.ts';
import { generateId } from '../utils/id.ts';
import { exportBundle, importBundleText } from '../storage/bundleIO.ts';
import { retrofitMapScales } from '../maps/retrofitMapScales.ts';
import { isEncryptedBundleEnvelope } from '../storage/bundleCrypto.ts';
import { gunzipToString, startsWithGzipMagic } from '../storage/bundleCompression.ts';
import { EncryptSaveDialog } from './EncryptSaveDialog.ts';
import { PasswordPromptDialog } from './PasswordPromptDialog.ts';
import { AboutDialog } from './AboutDialog.ts';
import { NewPackDialog } from './NewPackDialog.ts';
import { SettingsDialog } from './SettingsDialog.ts';
import { StagecraftPanel } from './StagecraftPanel.ts';
import { SoundtracksPanel } from './SoundtracksPanel.ts';
import { fireStagecraftForAsset } from '../stagecraft/stagecraftDispatcher.ts';
import { BundleUrlPromptDialog } from './BundleUrlPromptDialog.ts';
import { BundleUrlFallbackDialog } from './BundleUrlFallbackDialog.ts';
import { saveBlob } from '../utils/saveBlob.ts';
import { labelControl } from '../utils/controlLabel.ts';
import { TextMapAltText, plainText } from '../rendering/TextMapAltText.ts';
import type { TextMapAltItem } from '../types.ts';
import { applyTheme } from '../utils/applyTheme.ts';
import { AudioAssetStore } from '../audio/AudioAssetStore.ts';
import { MarkerInteractionRegistry, type InteractionContext } from './markerInteractions/MarkerInteraction.ts';
import { PositionalAudioInteraction } from './markerInteractions/PositionalAudioInteraction.ts';
import { MotionTrackerInteraction } from './markerInteractions/MotionTrackerInteraction.ts';
import { TrackerAudioPlayer } from '../audio/TrackerAudioPlayer.ts';
import { randomFaffMessage } from '../utils/faffMessages.ts';
import { blobToDataUrl } from '../utils/blob.ts';
import type { MotionOverlay } from '../rendering/MarkerLayer.ts';
import { MarkerOverlay } from '../rendering/MarkerOverlay.ts';
import { CanvasTransform } from '../utils/CanvasTransform.ts';
import { attachGestures } from '../utils/Gestures.ts';
import type { SessionState, StoredMap, TransitionConfig, FilterState, Marker, MarkerIconData, AudioAsset, AudioRole, MotionRole, ProjectorConnection, ProjectorViewport, ViewState, GMMessage } from '../types.ts';
import { defaultProjectorViewport } from '../types.ts';
// v2.16.103 — QRCode back for the Player Views → Player connections
// subpanel (scan to open a remote player window over the LAN). The hold
// screen + player connect UI still do their own QR rendering too.
import QRCode from 'qrcode';
import { StarMapLayer } from '../rendering/StarMapLayer.ts';
import { encodeIceParam, loadStoredIce } from '../p2p/iceConfig.ts';
import { sse2Bridge, Sse2Bridge, type SseAnnounce } from './Sse2Bridge.ts';
import { StarMapDialog } from './StarMapDialog.ts';

const REMOTE_AUDIO_KEY = 'dmr_remote_audio';

// Logarithmic mapping for the tracker range slider — slider 0..1 → range 0.05..4.
// Gives much finer control at the low end where most useful values live.
const TRACKER_RANGE_MIN = 0.05;
const TRACKER_RANGE_MAX = 4.0;
function sliderToRange(s: number): number {
  return TRACKER_RANGE_MIN * Math.pow(TRACKER_RANGE_MAX / TRACKER_RANGE_MIN, Math.max(0, Math.min(1, s)));
}
function rangeToSlider(r: number): number {
  return Math.log(r / TRACKER_RANGE_MIN) / Math.log(TRACKER_RANGE_MAX / TRACKER_RANGE_MIN);
}


/**
 * GMApp — top-level orchestrator for the GM interface.
 *
 * Wires together: StateManager ↔ Renderer ↔ FilterPanel ↔ FogEditor ↔ P2P Host
 */
const DRAWING_MODE_LS_KEY = 'mappadux:drawingMode';

/** Leading markers for map rows in the dropdown selector. Each kind
 *  carries a single monochrome glyph so names align in the same
 *  column and the visual width is roughly identical regardless of
 *  font. Survives the closed <select> view where browsers strip
 *  option styling.
 *
 *    ▣  still-image maps  (square with inner square = framed image)
 *    ▶  animated maps     (play triangle = "this thing plays")
 *    ▤  text-map handouts (square with horizontal lines = text on page)
 *
 *  Glyphs are never persisted to StoredMap.name — populateMapList +
 *  _insertMapOptionSorted prepend on render; _cleanMapDisplayName
 *  strips on read so legacy data with old decorations baked into
 *  storage still displays cleanly. */
const IMAGE_MAP_PREFIX     = '▣ ';
const ANIMATED_MAP_PREFIX  = '▶ ';
// v2.14.39 — ¶ (paragraph mark) reads as "text" instantly and is
// visually unambiguous against ▣ / ▦ . Previously used ▤ (square
// with horizontal lines) which was confusable with the composite
// ▦, and a bracketed [T] which Alex flagged as "not an icon".
const TEXT_MAP_PREFIX      = '¶ ';
const COMPOSITE_MAP_PREFIX = '▦ ';
// v2.14.60 — Hazard prefix for map rows whose underlying MapAsset
// can't be resolved (orphaned by a delete from the library, or a
// bundle import that didn't carry the asset). Paired with orange
// text in EditableSelect so the GM spots the broken row before
// loading it.
const MISSING_MAP_PREFIX   = '⚠ ';
// v2.18 — ✦ for a StarMap: a live Star System Explorer view, not an image.
const STARMAP_PREFIX       = '✦ ';

type MapDropdownKind = 'image' | 'animated' | 'text' | 'composite' | 'starmap' | 'missing';
/** The ONE place a dropdown kind becomes its glyph prefix (was duplicated in
 *  two render paths, which is exactly how a new kind gets one and not the other). */
function _prefixForKind(kind: MapDropdownKind): string {
  return kind === 'missing'   ? MISSING_MAP_PREFIX   :
         kind === 'starmap'   ? STARMAP_PREFIX       :
         kind === 'composite' ? COMPOSITE_MAP_PREFIX :
         kind === 'text'      ? TEXT_MAP_PREFIX      :
         kind === 'animated'  ? ANIMATED_MAP_PREFIX  :
                                IMAGE_MAP_PREFIX;
}

/** Strip every decoration that has ever been put on a map's display
 *  name — current "▣ " / "▶ " / "▤ " prefixes, the brief "≡ " trial
 *  run, and the legacy " [T]" suffix — so localeCompare,
 *  EditableSelect, and storage all see the raw name. */
function _cleanMapDisplayName(name: string): string {
  return name
    // Strip any decorative leading prefix: the legacy "[T] " variant
    // first, then any glyph in the set we've ever used.
    .replace(/^\[T\]\s+/, '')
    .replace(/^[▣▶▤▦¶≡⚠✦]\s+/, '')
    // Legacy trailing " [T]" decoration.
    .replace(/(?: \[T\])+$/, '')
    .trim();
}

/** Resolve a MapAsset (or undefined) to the dropdown's kind enum.
 *  Single source of truth for how the map selector glyph is picked —
 *  populateMapList builds its own map of these eagerly; the Add /
 *  Clone / Rename paths use this helper on a single asset. Order of
 *  checks matches populateMapList: text-map wins over animated wins
 *  over image, so a hypothetical "video text-map" still reads as
 *  text. */
function _dropdownKindForAsset(asset: import('../types.ts').MapAsset | undefined): MapDropdownKind {
  // v2.14.60 — undefined means the StoredMap references a MapAsset
  // that's been removed (manual library delete, or a bundle import
  // that didn't carry it). Surface it as 'missing' so the dropdown
  // shows the hazard prefix + orange tint rather than silently
  // falling back to the image glyph and failing on load.
  if (!asset) return 'missing';
  if (asset.source === 'starmap') return 'starmap';
  if (asset.source === 'composite-map') return 'composite';
  if (asset.source === 'text-map') return 'text';
  if ((asset.blob?.type ?? '').startsWith('video/')) return 'animated';
  return 'image';
}

/** Cheap magic-byte sniff — true when the buffer is webm or mp4.
 *  Matches the Renderer's loadMap sniff so GMApp paths that branch on
 *  media kind (auto-bg sampler etc.) agree with the renderer about
 *  which assets are video. Conservative: anything that doesn't match
 *  either signature is treated as not-video (i.e. image), matching
 *  the renderer's image-fallback default. */
function _sniffIsVideo(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 12) return false;
  const a = new Uint8Array(buffer, 0, 12);
  // WebM (EBML magic 1A 45 DF A3)
  if (a[0] === 0x1a && a[1] === 0x45 && a[2] === 0xdf && a[3] === 0xa3) return true;
  // MP4 / MOV — ftyp atom at offset 4
  if (a[4] === 0x66 && a[5] === 0x74 && a[6] === 0x79 && a[7] === 0x70) return true;
  return false;
}

// v2.16.35 — _toUnicodeBold (Mathematical Sans-Serif Bold via Unicode)
// previously highlighted the "Fog of War" entry inside the popover's
// kind picker. With the kind picker promoted to a real <select> on the
// row, we can leave that style decision to CSS / option-default styling
// instead of leaning on Unicode tricks. Helper retired.

export class GMApp {
  private state   = new StateManager();
  private maps    = new MapManager();
  /** v2.14.108 — GM-canvas undo / redo for fog + markers. Wired in
   *  init(); cleared on every map switch (snapshots from the
   *  outgoing map shouldn't paste onto the incoming one). */
  private undoMgr!: CanvasUndoManager;
  private undoBtn:  HTMLButtonElement | null = null;
  private redoBtn:  HTMLButtonElement | null = null;
  /** v2.16 — Stagecraft (lighting + automation) panel. Lazily
   *  constructed in init(); show/hide is decided live based on
   *  whether the user has configured a WLED endpoint or HA link. */
  private stagecraftPanel: StagecraftPanel | null = null;
  /** v2.16 — Soundtracks panel. Hidden by default; opt-in via
   *  Settings → Stagecraft → Soundtracks toggle. Pack-level — the
   *  configured tracks live on StoredSession.soundtracks and travel
   *  in `.mappadux` exports. */
  private soundtracksPanel: SoundtracksPanel | null = null;
  /** v2.16 — Cached StoredSession for the Soundtracks panel's sync
   *  getConfig. Loaded lazily in init, updated on every saveConfig. */
  private _session: import('../types.ts').StoredSession | null = null;
  /** v2.16 — Track which map last had its Stagecraft assignments
   *  fired so a same-map state refresh doesn't re-trigger lighting. */
  private _lastStagecraftFiredMapId: string | null = null;
  private host:   Host;
  private renderer!:       Renderer;
  private fogEditor!:      FogEditor;
  /** v2.12 — currently selected overlay polygon id (or null). Non-fog kinds
   *  select via the selector-icon overlay; fog kinds select via interior
   *  click. Same field for both. */
  private selectedOverlayId: string | null = null;
  /** Tracks the last selection id we already pushed into the kind
   *  dropdown so an unchanged selection doesn't re-fire kind-change side
   *  effects (which would, for instance, reset the colour swatch). */
  private _lastSelectedSyncedId: string | null = null;
  /** v2.12 — properties snapshotted from the polygon that was selected
   *  when Paint was clicked. Used by _commitOverlay* so the new polygon
   *  inherits the selected exemplar's colour + shaderParams ("paint
   *  another like this"). Set in _startAction('paint'), cleared in
   *  _endAction. Null when paint started with no selection. */
  private _pendingPaintInherit: { color: string; shaderParams: Record<string, number | string>; edgeFade: number } | null = null;
  /** v2.12 — kind picked in the FoW & MapFX panel for new strokes/polygons. */
  private activeOverlayKind: OverlayKind = 'fog';
  /** v2.12 — sticky Drawing Mode preference (persisted to localStorage). */
  private drawingMode: 'polygon' | 'brush' | 'fill' = 'polygon';
  /** v2.12 Magic Wand — last fill polygon's state so the Tolerance
   *  slider can re-run the flood-fill and replace its vertices
   *  without committing a new polygon. Cleared when the GM clicks
   *  again (new fill), changes drawing mode, or commits via the
   *  action buttons. */
  private _lastFillState: { polyId: string; seedX: number; seedY: number; action: 'paint' | 'erase' } | null = null;
  private viewportEditor!: ViewportEditor;
  private projectorEditor!: ProjectorViewportEditor;

  /**
   * GM workspace pan/zoom — wheel scrolls zoom (around the cursor),
   * arrow keys pan, R resets. Default identity = behaviour pre-v2.11/A4.
   * Editors track it via the Renderer (FogEditor / ViewportEditor /
   * ProjectorViewportEditor) or via direct setter (MarkerLayer).
   */
  private gmTransform = new CanvasTransform({ minScale: 0.5, maxScale: 8 });
  /** v2.16.31 — GM workspace default zoom. Slightly < 1 so the map sits
   *  inside the canvas with a small breathing margin, making the panel
   *  icons at the edges easier to reach. GM only — the player + projector
   *  views still fill their canvases. Used on first paint AND on "Reset
   *  View". */
  private static readonly GM_DEFAULT_SCALE = 0.95;

  /** Reference to the shared overlay layer so non-marker code paths
   *  (viewport rect chrome, workspace pan, etc.) can push updates. */
  private _markerOverlay: MarkerOverlay | null = null;

  /** Active overlay-handle drag for a viewport rectangle. Records the
   *  cursor position in map-norm space + the rect's centre at start so
   *  the rect tracks the cursor offset (matches the marker drag pattern). */
  private _rectMoveDrag: {
    kind: 'player' | 'projector';
    startNorm: { x: number; y: number };
    startCenter: { x: number; y: number };
  } | null = null;

  /** Active overlay-handle resize drag for the player rectangle. The
   *  bottom-right corner follows the cursor; top-left stays fixed.
   *  v2.14.3 — also tracks the drag-start aspect ratio so the ratio-lock
   *  toggle can constrain the resize when engaged. */
  private _rectResizeDrag: {
    /** Top-left corner in map-norm at drag start — anchor for the resize. */
    anchor: { x: number; y: number };
    /** Drag-start W:H ratio (viewNW / viewNH). Used when aspectLocked is on. */
    aspectAtStart: number;
  } | null = null;

  /** Which viewport rect (if any) is currently selected. Mutual-exclusive
   *  with the marker selection: selecting a rect deselects any marker,
   *  and selecting a marker deselects any rect. */
  private _selectedViewport: 'player' | 'projector' | null = null;

  /**
   * Snapshots taken when the user applies a one-shot snap action so a
   * second click on the same button restores the previous state.
   * Cleared on rect deselect, on a manual move/resize, and whenever
   * the snap is reverted. Player has both an aspect-lock undo (16:9
   * snap) and a maximise undo (full-map snap); projector only has a
   * maximise undo (snap to full-map projection mode).
   */
  private _playerAspectUndo:    ViewState         | null = null;
  private _playerMaxRestore:    ViewState         | null = null;
  private _projectorMaxRestore: ProjectorViewport | null = null;
  /**
   * Connected projectors keyed by their per-window clientId. The first entry
   * (insertion order) is the primary; everyone after is a monitor. The map
   * preserves order (Map iterator is FIFO), so promoting the next-oldest
   * projector if the primary disconnects is just "first key in the map".
   */
  private projectorConnections = new Map<string, ProjectorConnection & { clientId: string }>();
  /** Maps projector clientId → PeerJS peerId for projectors that connected
   *  remotely. Used to: (a) exclude projectors from the "X players connected"
   *  count, (b) tear down stale projectorConnections entries when the
   *  underlying PeerJS connection drops before projector_bye is delivered.
   *  Local-BC projectors are absent from this map (no peerId) and likewise
   *  absent from host.connectedCount, so the counting math just works. */
  private _projectorPeerByClientId = new Map<string, string>();
  /** Active map's asset metadata, mirrored for projector-role math. Null when no map / no calibration. */
  private _lastMapAssetMeta: { pixelsPerSquare: number; imageWidth: number; imageHeight: number } | null = null;
  private markerEditor!:   MarkerEditor;
  /** Transient on-map ruler ("Measure from here"). Lazily created in bindMarkerEditor. */
  private measureTool: MeasureTool | null = null;
  /** v2.16.37 — FilterPanel instance is now constructed inside the side
   *  panel each open. Kept as nullable so callers (state sync) can probe
   *  for "is the side panel currently rendering controls?". */
  private _filterPanelInstance: FilterPanel | null = null;
  /** v2.16.37 — handle to the open Visual Filter side panel, or null. */
  private _filterSidePanel: import('./SidePanel.ts').SidePanelHandle | null = null;
  /** v2.16.38 — handle to the open Map Transition side panel, or null.
   *  TransitionPanel itself is constructed inside the body each open;
   *  refresh() rebuilds from scratch which is cheap for this surface. */
  private _transitionSidePanel: import('./SidePanel.ts').SidePanelHandle | null = null;
  /** v2.16.40 — inline Player View PiP overlay (constructed lazily after
   *  the canvas-wrapper is in the DOM). */
  private _playerPip: import('./PlayerPip.ts').PlayerPip | null = null;
  /** v2.16.45 — true iff the active map is a multilayered composite
   *  (asset.revealBackingBlob present). Drives whether the MapFX kind
   *  dropdown enables / disables the "Reveal Layer" option — the kind
   *  has nothing to reveal under a single-layer map. Updated by
   *  _updateUpperLayerPanel on every map load. */
  private _activeMapIsLayered = false;
  /** v2.16.44 — cross-window audio mutual exclusion (BroadcastChannel
   *  based). When the GM page has audio enabled (default at startup
   *  until the user mutes everything), this window claims audio and
   *  any other Mappadux tab on this machine hears that and silences
   *  itself. When another window claims audio (e.g. a popped-out
   *  player), the coordinator force-mutes the GM's local engines so
   *  we don't get dual sound. Does NOT broadcast positional_mute_all
   *  to remote players — purely a same-browser concern. */
  private _audioCoord: import('../utils/AudioCoordinator.ts').AudioCoordinator | null = null;
  /** Fresh per-window id for the audio coordinator. The GM's existing
   *  identifiers (host.roomCode etc.) shift over the session; a stable
   *  per-window value keeps the dedupe simple. */
  private _audioCoordClientId = generateId();

  /** Pre-rendered bitmaps for marker icons. Keys follow the marker.icon
   *  string — bare 'libAsset:<id>' for raster, '<libAsset:id>#<color>'
   *  for tintable, plus a legacy 'asset:<id>' alias so pre-v2.11 saved
   *  bundles continue to resolve after the icon-store migration. */
  readonly iconCache    = new Map<string, ImageBitmap>();
  readonly iconDataUrls = new Map<string, string>();
  /** libAsset id → tintable flag. Populated during the picker's onPick
   *  callback and during _preloadLibIcons / _ensureLibIcons, used by
   *  updateMarkerPanel to decide synchronously whether to show the
   *  Colour row. Avoids the hide-then-show flicker that previously
   *  killed Chrome's native colour-picker dialog mid-interaction. */
  private _libAssetTintable = new Map<string, boolean>();
  private mapAssetModal!:    MapAssetModal;
  /** Last real (non-sentinel) value selected in #map-select — used to revert
   *  when the user picks the "+ Add" sentinel and we need to keep the dropdown
   *  showing the actual current map. */
  private _lastMapSelectValue = '';
  private soundboardEngine!: SoundboardEngine;
  private soundboardPanel!:  SoundboardPanel;

  // v2.17 Player Voice — persistent players roster + panel.
  private playerRegistry = new PlayerRegistry();
  private playersPanel!: PlayersPanel;
  /** v2.16.47 — per-player message thread store. Drives the per-row
   *  unread badges on the Players panel + populates the side panel
   *  when the GM clicks a badge. */
  private _messageThreads = new MessageThreads();
  /** The playerId whose thread side panel is currently open, or null.
   *  Read by addIncoming to skip unread bumps for the active thread. */
  private _openThreadPlayerId: string | null = null;
  /** Handle to the open thread SidePanel (one at a time). */
  private _threadSidePanel: import('./SidePanel.ts').SidePanelHandle | null = null;
  /** Ping pulses relayed from players — persist on the GM until dismissed. */
  private pingLayer: PingLayer | null = null;
  /** v2.16.91 — live YouTube videos placed on a text-map page. */
  private textMapVideoLayer: import('../rendering/TextMapVideoLayer.ts').TextMapVideoLayer | null = null;
  /** v2.18 — StarMap: GM preview of the live SSE view + "is it live?" state. */
  private starMapLayer: StarMapLayer | null = null;
  private _activeStarMap: import('../types.ts').StarMapConfig | null = null;
  private _starMapUnsub: (() => void) | null = null;
  private _currentTextMapVideos: import('../types.ts').TextMapVideoElement[] = [];
  /** v2.17.26 — screen-reader region exposing the handout's text + image alt
   *  (otherwise baked into the page image, invisible to assistive tech). */
  private textMapAltText: TextMapAltText | null = null;
  private _currentAltItems: TextMapAltItem[] = [];
  /** GM sender colour for message replies — a slate that reads clearly on
   *  player views without straying into the reserved near-black range. */
  private static readonly GM_MESSAGE_COLOR = '#64748b';
  /** Recently-seen upstream event ids (pings, messages). Same-machine players
   *  deliver upstream over BOTH BroadcastChannel and PeerJS, so non-idempotent
   *  events must be deduped on a client-supplied id. */
  private _seenUpstreamIds = new Set<string>();
  /** Player token layer (circular tokens edged in the player's colour). */
  private playerMarkerLayer: PlayerMarkerLayer | null = null;
  /** Transient token positions during an in-progress drag (not yet persisted). */
  private _liveMarkerPos = new Map<string, { x: number; y: number }>();
  /** Transient token facings during an in-progress rotation (not yet persisted). */
  private _liveMarkerFacing = new Map<string, number>();
  /** Pre-move token state, captured when a PLAYER starts changing their own
   *  token's position OR facing, so the GM's "cancel move" can send it back. */
  private _markerMoveOrigin = new Map<string, { x: number; y: number; facing?: number }>();
  /** Initiative tracker (fanned-deck rail, threat bench, unallocated tray). */
  private initiativeTracker: InitiativeTracker | null = null;
  /** v2.17.34 — last seen marker name/icon/colour signature, so the initiative
   *  tracker only re-renders when a LINKED marker's identity changes (not on
   *  position drags). */
  private _markerIdentitySig = '';
  /** v2.16.76 — per-map annotations (progress clocks + whiteboard). */
  private annotate: AnnotateController | null = null;

  private interactions   = new MarkerInteractionRegistry();
  private audio          = this.interactions.register(new PositionalAudioInteraction());
  private motionTracker  = this.interactions.register(new MotionTrackerInteraction());
  private trackerAudio   = new TrackerAudioPlayer();
  /** Cached data URLs for the currently-assigned tracker audio assets. Always
   *  embedded in tracker_scan / tracker_blob broadcasts so late-joining players
   *  can play immediately without a separate handshake. */
  private _outgoingDataUrl: string | null = null;
  private _returnDataUrl:   string | null = null;
  private _motionRafId:    number | null = null;
  private selectedMarkerId: string | null = null;
  private mapAspectRatio = 1;
  private remoteAudioEnabled = localStorage.getItem(REMOTE_AUDIO_KEY) !== 'false';

  // DOM references (assigned in init)
  private mapSelect!:               HTMLSelectElement;
  private mapEditableSelect!:       EditableSelect;
  private editTextMapBtn!:          HTMLButtonElement;
  private editCompositeBtn?:        HTMLButtonElement;
  private startAnimationBtn!:       HTMLButtonElement;
  private revealProgressEl!:        HTMLElement;
  private revealProgressBarEl!:     HTMLElement;
  /** Animation lifecycle on the active handout:
   *    idle    — at starting frame; click Start runs the reveal.
   *    running — reveal in flight; click Cancel skips to the end.
   *    done    — reveal complete; click Reset returns to starting. */
  private _animationButtonState: 'idle' | 'running' | 'done' = 'idle';
  /** setTimeout id for the "running → done" auto-progression; held
   *  so a manual Cancel can clear it before it fires. */
  private _animationDoneTimer: ReturnType<typeof setTimeout> | null = null;
  private packNameInput!:           HTMLInputElement;
  /** v2.16.88 — the white pack-name shown in the Map Pack panel header. */
  private packNameDisplay: HTMLElement | null = null;
  /** Debounce timer for the in-panel pack-name input. */
  private _packNameSaveTimer: number | null = null;
  private transitionSelect!:        HTMLSelectElement;
  // v2.16.38 — transitionParamsContainer retired alongside the inline
  // #transition-params div.
  private filterSelect!:            HTMLSelectElement;
  // v2.16.37 — filterParamsContainer + filterAffectMarkersToggle moved
  // into the side panel; both fields retired.
  // viewBgColour swatch removed in v2.12 — bg colour lives in the
  // backdrop popover's Background row now.
  private viewBgFxBtn!:            HTMLButtonElement;
  /** Sparkle button on the FoW panel (right of #fog-colour). Opens
   *  the same FxPopover style as the Backdrop FX button, populated
   *  with Edge Fade + the active kind's shader params. */
  private mapFxBtn!:               HTMLButtonElement;
  /** Live popover handle (open state) — null when nothing is shown.
   *  See src/gm/FxPopover.ts for the shared component shape. */
  private _bgFxPopover:    import('./SidePanel.ts').SidePanelHandle | null = null;
  /** MapFX sparkle popover handle — opened from the FoW panel's
   *  sparkle button. Shares the same FxPopover plumbing. */
  private _mapfxFxPopover: import('./SidePanel.ts').SidePanelHandle | null = null;
  /** Set true by the popover's own onChange handlers while a slider /
   *  swatch / toggle is dispatching state updates. Refresh hooks
   *  consult this and skip the rebuild — otherwise each slider tick
   *  re-renders the popover DOM mid-drag, the pointer capture is lost,
   *  and the slider stutters. Structural changes (kind switched,
   *  polygon selected) bypass the flag because they originate
   *  outside the popover. */
  private _suppressPopoverRefresh = false;
  // No backdrop-side suppress flag needed: the syncView path (which
  // runs on every state change) doesn't refresh the bg popover, so
  // bg slider drags don't lose pointer capture mid-stroke. If a
  // future refresh hook gets added there, mirror the MapFX pattern.
  /** v2.12.x — full video bytes waiting to be broadcast as a
   *  MsgVideoBundle follow-up after the map_change that carried the
   *  snapshot. Set in loadMap when the new map is a video asset;
   *  cleared once the bundle has been sent or the GM swaps away. */
  private _pendingVideoBundle: { mapId: string; buffer: ArrayBuffer; mimeType: string } | null = null;
  private roomCodeEl!:             HTMLElement;
  // v2.16.33 — qrContainer + playerCountEl fields retired alongside the
  // deleted Player Connection panel.
  private messageLog?:             MessageLog;
  private markerSelect!:           HTMLSelectElement;
  private markerEditableSelect!:   EditableSelect;
  private projectorEditableSelect: EditableSelect | null = null;
  private markerIconBtn!:          HTMLButtonElement;
  private markerColorInput!:       HTMLInputElement;
  // Marker size slider removed in v2.11/A3b4 — visual resize handle on the
  // selected marker (MarkerOverlay) replaces it.
  private markerHiddenToggle!:     HTMLInputElement;
  private markerShowLabelToggle!:  HTMLInputElement;
  private markerShowLabelGmToggle!: HTMLInputElement;
  private markerLockedToggle!:     HTMLInputElement;
  private currentMapBlob:          ArrayBuffer | null = null;
  private activeFilterId        = '';
  private activeTransitionId    = 'none';
  /** Per-transition saved params — persisted in-memory for the session */
  private allTransitionParams: Record<string, Record<string, number | string>> = {};
  private playerOrigin   = location.origin; // replaced with LAN IP when on localhost

  /** v2.14.92 — Build a player URL with the active instance carried
   *  along as ?instance=NAME (no-op for the default instance). Lets
   *  same-browser player windows tune in to the correct namespaced
   *  BroadcastChannel so two GM tabs don't cross-broadcast. */
  private _instanceQuery(): string {
    const inst = getActiveInstanceId();
    return inst ? `?instance=${encodeURIComponent(inst)}` : '';
  }
  private _buildPlayerUrl(code: string): string {
    // v2.14.95 — use /player.html directly. The Vercel rewrite
    // /player -> /player.html misfires when ?instance=NAME is in
    // the URL: the PWA's service-worker fallback was serving
    // index.html (the GM bundle) instead of the player. Bypassing
    // the rewrite entirely is simpler than chasing the misfire
    // through workbox + Vercel routing — and the projector URL
    // already takes this approach via /projector.html.
    // v2.18 — carry the GM's custom relay (?ice=) so a player on a locked-down network
    // knows about it BEFORE dialling. Absent when no custom relay is configured.
    const ice = encodeIceParam(loadStoredIce());
    const q = this._instanceQuery();
    const iceQ = ice ? `${q ? '&' : '?'}ice=${ice}` : '';
    return `${this.playerOrigin}/player.html${q}${iceQ}#${code}`;
  }
  private _buildProjectorUrl(code: string): string {
    // v2.17.17 — gmLocal=1 marks this as the GM's own same-machine projector
    // window (this URL is only ever used by the window.open launches below,
    // i.e. a second screen wired to the GM's PC). The projector reads the flag
    // and rides LocalChannel only, skipping the flaky PeerJS loopback — same
    // rationale as the Player View preview. A remote tablet projector (opened
    // from projector.html via the join code) never carries it, so it still
    // connects over PeerJS.
    const q = this._instanceQuery();
    return `/projector.html${q}${q ? '&' : '?'}gmLocal=1#${code}`;
  }
  private hamburger!: HamburgerMenu;
  /** Pack name suggested by `seedDefaultMaps()` on first run. Consumed by
   *  `onHostReady` once the session record actually exists. */
  private _seededPackName: string | null = null;
  /** True iff `seedDefaultMaps` actually imported anything on this run.
   *  Triggers the post-host-ready About auto-open (first-time intro). */
  private _didSeedDefault = false;

  /** v2.12 — tracks whether the AboutDialog is currently mounted. The
   *  MOTD startup check defers to the next session whenever this is
   *  true at the moment it'd fire — avoids stacking two popups on a
   *  new user. Set true by openAboutDialog before the dialog promise
   *  is awaited; cleared in a finally so abnormal resolutions still
   *  reset the flag. */
  private _aboutOpen = false;

  constructor() {
    this.host = new Host({
      onReady: (code) => this.onHostReady(code),
      onPeerConnected:    (id) => this.onPeerConnected(id),
      onPeerDisconnected: (id) => this.onPeerDisconnected(id),
      onError: (err) => this.onP2PError(err),
      onPeerMessage: (peerId, msg) => this.onPeerMessage(peerId, msg),
      // Same-browser preview / projector windows ask for state via
      // BroadcastChannel before they're known to the network side. The
      // cached full_state covers map + soundboard, but Player Voice
      // markers + per-player icons live in PlayerRegistry — re-broadcast
      // them here so a fresh local window sees identified tokens
      // (custom icons + facing) without waiting for the next live edit.
      onLocalRequestState: () => {
        this._refreshPlayerMarkers();
        this._broadcastAllPlayerIcons();
      },
    });
    // v2.12 — wire the dev-only FX dump helper. Exposes
    // `window.mappaduxDumpFx()` so the GM can capture their tuned
    // MapFX + backdrop param values from the browser console; see
    // src/gm/debugDumpFx.ts for the output shape.
    void import('./debugDumpFx.ts').then(({ setupFxDump }) => {
      setupFxDump(() => this.state.getState());
    });
  }

  /**
   * Route PeerJS errors. Broker-level failures (socket / network /
   * server) replace the QR with a clear "broker unreachable" notice
   * because the QR is meaningless when remote peers can't reach us.
   * Per-peer errors (peer-unavailable, webrtc) just go to the status
   * line as before.
   */
  private onP2PError(err: Error): void {
    const type = (err as unknown as { type?: string }).type;
    const isBrokerLevel =
      type === 'socket-error'  || type === 'socket-closed' ||
      type === 'server-error'  || type === 'network'       ||
      type === 'disconnected'  || type === 'ssl-unavailable';
    if (isBrokerLevel) {
      this._setBrokerErrorVisible(true);
      this.setStatus('Network broker unreachable — auto-retrying every minute', 'error');
      return;
    }
    this.setStatus(`P2P error: ${err.message}`, 'error');
  }

  /**
   * Bind wheel + keyboard + touch handlers that drive the workspace
   * pan/zoom transform. Wheel zooms around the cursor; arrow keys pan in
   * world units (smaller deltas when zoomed in so each keystroke feels
   * similar regardless of zoom); R resets to identity. Two-finger
   * pinch + pan does the same on touchscreens via the shared Gestures
   * helper (which also takes care of touch-action:none on the wrapper
   * so the browser doesn't fight the pinch). Inputs / textareas are
   * ignored so typing doesn't pan the map mid-word.
   *
   * Single-touch / single-finger taps are NOT consumed here — they
   * fall through to the existing canvas editors (marker overlay
   * handles, fog drawing, viewport editing). Only multi-touch and
   * wheel events drive the workspace.
   */
  private _bindWorkspacePanZoom(): void {
    const wrapper = document.getElementById('canvas-wrapper');
    if (!wrapper) return;

    // Track in-flight two-finger gesture state so we can apply per-frame
    // incremental zoom + pan from cumulative scale + midpoint deltas.
    let twoLast = { midX: 0, midY: 0, scale: 1 };
    // Snapshot of the camera transform + world-px scale taken at the
    // start of a mouse drag-pan; on each pointermove we recompute the
    // offset from the cumulative dx/dy against this base so the cursor
    // stays glued to the world point it grabbed.
    let mouseDragBase: { scale: number; offsetX: number; offsetY: number; pxPerWorldX: number; pxPerWorldY: number } | null = null;

    attachGestures(wrapper, {
      // v2.16.68 — Don't treat a pointerdown that landed inside the
      // initiative tracker (or any UI overlay) as the start of a pan.
      // Lets the GM drag cards / chrome inside the tracker without the
      // GM canvas grabbing the same gesture and panning the map.
      shouldStart: (e) => {
        const target = e.target as HTMLElement | null;
        return !target?.closest('.init-tracker, .side-panel, .modal-overlay, .modal-dialog, .panel, .hamburger-menu, .a-note, .clock, .a-timer');
      },
      // Mouse drag = pan the camera. Single-touch drags pass through
      // to the editors (fog draw, marker selection, etc.); we only
      // claim mouse here. The rect chrome's move/resize handles
      // stopPropagation upstream, so a drag that started on a handle
      // never reaches us.
      onDrag: (e) => {
        if (e.pointerType !== 'mouse') return;
        if (e.phase === 'start') {
          const s = this.renderer.worldToScreenScale();
          mouseDragBase = {
            scale:       this.gmTransform.scale,
            offsetX:     this.gmTransform.offsetX,
            offsetY:     this.gmTransform.offsetY,
            pxPerWorldX: s.pxPerWorldX,
            pxPerWorldY: s.pxPerWorldY,
          };
          wrapper.style.cursor = 'grabbing';
          return;
        }
        if (e.phase === 'end') {
          mouseDragBase = null;
          wrapper.style.cursor = '';
          return;
        }
        if (!mouseDragBase) return;
        // Cumulative screen-pixel delta → world delta. Apply against
        // the captured base so the cursor tracks the grabbed world
        // point. Screen-Y is down, world-Y is up — flip dy.
        if (mouseDragBase.pxPerWorldX <= 0 || mouseDragBase.pxPerWorldY <= 0) return;
        this.gmTransform.set(
          mouseDragBase.scale,
          mouseDragBase.offsetX - e.dx / mouseDragBase.pxPerWorldX,
          mouseDragBase.offsetY + e.dy / mouseDragBase.pxPerWorldY,
        );
        this._applyWorkspaceTransform();
      },

      onWheel: ({ clientX, clientY, factor }) => {
        const rect = wrapper.getBoundingClientRect();
        const world = this.renderer.screenToWorld(clientX - rect.left, clientY - rect.top);
        if (!world) return;
        // Gestures emits factor < 1 for zoom-in (scroll up); flip so
        // CanvasTransform's "factor > 1 zooms in" reads naturally here.
        this.gmTransform.zoomAround(1 / factor, world.x, world.y);
        this._applyWorkspaceTransform();
      },

      onTwoFinger: (e) => {
        if (e.phase === 'start') {
          twoLast = { midX: e.midX, midY: e.midY, scale: 1 };
          return;
        }
        if (e.phase !== 'move') return;
        // Incremental: per-frame zoom around current midpoint, then
        // pan by the per-frame midpoint delta. Mirrors the calibration
        // board's pinch math from v2.11/A1.
        const stepScale = e.scale / twoLast.scale;
        const dxClient  = e.midX  - twoLast.midX;
        const dyClient  = e.midY  - twoLast.midY;
        twoLast = { midX: e.midX, midY: e.midY, scale: e.scale };

        const rect = wrapper.getBoundingClientRect();
        const world = this.renderer.screenToWorld(e.midX - rect.left, e.midY - rect.top);
        if (world) this.gmTransform.zoomAround(stepScale, world.x, world.y);
        // Pan-by-output-px after zoom so the midpoint stays glued under
        // the fingers as they slide.
        const sScale = this.renderer.worldToScreenScale();
        if (sScale.pxPerWorldX > 0 && sScale.pxPerWorldY > 0) {
          this.gmTransform.panByWorld(
            -dxClient / sScale.pxPerWorldX,
             dyClient / sScale.pxPerWorldY,  // screen-Y down = world-Y up
          );
        }
        this._applyWorkspaceTransform();
      },
    });

    window.addEventListener('keydown', (e) => {
      // Skip when typing into form fields.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.target as HTMLElement | null)?.isContentEditable) return;

      // v2.14.108 — Ctrl/Cmd+Z = undo, Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z = redo.
      // Routed to the GM-canvas undo manager (fog + markers). Modal
      // editors install their own keydown stoppers when open.
      if (this.undoMgr && (e.ctrlKey || e.metaKey)) {
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) {
          this.undoMgr.undo();
          e.preventDefault();
          return;
        }
        if (k === 'y' || (k === 'z' && e.shiftKey)) {
          this.undoMgr.redo();
          e.preventDefault();
          return;
        }
      }

      const step = 0.1 / this.gmTransform.scale;
      let handled = true;
      switch (e.key) {
        case 'ArrowLeft':  this.gmTransform.panByWorld(-step, 0);  break;
        case 'ArrowRight': this.gmTransform.panByWorld( step, 0);  break;
        case 'ArrowUp':    this.gmTransform.panByWorld(0,  step);  break;
        case 'ArrowDown':  this.gmTransform.panByWorld(0, -step);  break;
        case 'r': case 'R': this._resetGmTransform(); break;
        default: handled = false;
      }
      if (handled) {
        e.preventDefault();
        this._applyWorkspaceTransform();
      }
    });
  }

  /** v2.14.108 — Wire the GM-canvas undo manager. Pushes a snapshot
   *  before each setFog / setMarkers mutation (coalesced by idle gap
   *  so brush strokes collapse to one entry). Two semi-transparent
   *  chrome buttons land top-centre of the canvas wrapper; their
   *  disabled state mirrors the stack depth via the onChange cb. */
  private _bindCanvasUndo(): void {
    this.undoMgr = new CanvasUndoManager({
      getFog:     () => this.state.getState().fog,
      applyFog:   (fog) => this.state.setFog(fog),
      getMarkers: () => this.state.getState().markers,
      applyMarkers: (m) => this.state.setMarkers(m),
      onChange: () => this._refreshUndoButtons(),
    });
    this.state.setUndoHook((kind) => this.undoMgr.recordIfNewAction(kind));

    const wrapper = document.getElementById('canvas-wrapper');
    if (!wrapper) return;
    const bar = document.createElement('div');
    bar.id = 'gm-canvas-undo-bar';
    bar.className = 'gm-canvas-undo-bar';

    const mkBtn = (label: string, icon: string, click: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'gm-canvas-undo-btn';
      b.title = label;
      b.setAttribute('aria-label', label);
      b.innerHTML = icon;
      b.addEventListener('click', click);
      return b;
    };

    const undoIcon =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M3 7v6h6"/>' +
        '<path d="M3 13a9 9 0 1 0 3-6.7L3 9"/>' +
      '</svg>';
    const redoIcon =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M21 7v6h-6"/>' +
        '<path d="M21 13a9 9 0 1 1-3-6.7L21 9"/>' +
      '</svg>';

    this.undoBtn = mkBtn('Undo (Ctrl+Z)', undoIcon, () => this.undoMgr.undo());
    this.redoBtn = mkBtn('Redo (Ctrl+Y)', redoIcon, () => this.undoMgr.redo());
    bar.appendChild(this.undoBtn);
    bar.appendChild(this.redoBtn);
    wrapper.appendChild(bar);
    this._refreshUndoButtons();
  }

  private _refreshUndoButtons(): void {
    if (this.undoBtn) this.undoBtn.disabled = !this.undoMgr.canUndo();
    if (this.redoBtn) this.redoBtn.disabled = !this.undoMgr.canRedo();
  }

  /** v2.16 — Wire the Stagecraft (Lighting / Automation) panel. The
   *  panel is hidden unless at least one connection (WLED endpoint or
   *  HA config) exists in Settings; refresh() is called on init + on
   *  every Settings close + on every map switch. */
  private _bindStagecraftPanel(): void {
    this.stagecraftPanel = new StagecraftPanel({
      getActiveMapAsset: async () => {
        const mapId = this.state.snapshot().map?.id;
        if (!mapId) return null;
        const { getMap } = await import('../storage/db.ts');
        const stored = await getMap(mapId);
        if (!stored) return null;
        const { MapAssetStore } = await import('../maps/MapAssetStore.ts');
        return (await MapAssetStore.get(stored.mapAssetId)) ?? null;
      },
      saveAssignment: async (connectionId, assignment) => {
        const mapId = this.state.snapshot().map?.id;
        if (!mapId) return;
        const { getMap } = await import('../storage/db.ts');
        const stored = await getMap(mapId);
        if (!stored) return;
        const { MapAssetStore } = await import('../maps/MapAssetStore.ts');
        const asset = await MapAssetStore.get(stored.mapAssetId);
        if (!asset) return;
        const next = { ...(asset.stagecraft ?? {}) };
        if (assignment === null) delete next[connectionId];
        else                     next[connectionId] = assignment;
        const updated = { ...asset, stagecraft: next };
        const { saveMapAsset } = await import('../storage/db.ts');
        await saveMapAsset(updated);
      },
      fireForActiveMap: async () => {
        const mapId = this.state.snapshot().map?.id;
        if (!mapId) return;
        const { getMap } = await import('../storage/db.ts');
        const stored = await getMap(mapId);
        if (!stored) return;
        const { MapAssetStore } = await import('../maps/MapAssetStore.ts');
        const asset = await MapAssetStore.get(stored.mapAssetId);
        if (!asset) return;
        await fireStagecraftForAsset(asset);
      },
    });
    void this.stagecraftPanel.refresh();
  }

  /** v2.16 — Wire the Soundtracks (pack-level music) panel. Hidden
   *  until isSoundtracksEnabled() is true. Track configuration lives
   *  on StoredSession.soundtracks so it travels in the bundle. */
  private _bindSoundtracksPanel(): void {
    // Prime the cached session so the synchronous getConfig has data.
    void (async () => {
      const { loadSession } = await import('../storage/db.ts');
      this._session = (await loadSession()) ?? null;
      this.soundtracksPanel?.refresh();
    })();
    this.soundtracksPanel = new SoundtracksPanel({
      getConfig: () => this._session?.soundtracks ?? { slots: [] },
      saveConfig: async (cfg) => {
        const { loadSession, saveSession } = await import('../storage/db.ts');
        const existing = (await loadSession()) ?? this._session;
        if (!existing) return;
        const next = { ...existing, soundtracks: cfg };
        this._session = next;
        await saveSession(next);
      },
    });
    this.soundtracksPanel.refresh();
  }

  /**
   * Push the current CanvasTransform out to every consumer: Three.js
   * camera (via Renderer), MarkerLayer's internal frustum, and trigger
   * re-renders on the editor canvases that draw with map-relative
   * positions (fog, viewport, projector-viewport). Also refreshes the
   * viewport rect overlay so handle positions track the camera.
   */
  private _applyWorkspaceTransform(): void {
    const t = this.gmTransform;
    this.renderer.setCameraTransform(t.scale, t.offsetX, t.offsetY);
    this.markerEditor?.layer.setCameraTransform(t.scale, t.offsetX, t.offsetY);
    // Trigger redraws — editors that ride the Renderer's worldToScreen
    // will pick up the new camera state in their next paint.
    this.markerEditor?.redraw();
    this.fogEditor?.redraw();
    this.viewportEditor?.redrawExternal();
    this.projectorEditor?.redrawExternal();
    this._refreshRectOverlays();
    this._updateResetViewBtn();
  }

  /** Lazily-built "reset view" button — appears at the bottom-right of
   *  the canvas wrapper whenever the GM workspace transform isn't at
   *  identity (scale=1, offset=0/0). Click resets the camera. Same
   *  visual idiom as the off-screen indicators: small dark pill that
   *  doesn't compete with the map. */
  private _resetViewBtn: HTMLButtonElement | null = null;

  private _updateResetViewBtn(): void {
    const wrapper = document.getElementById('canvas-wrapper');
    if (!wrapper) return;
    if (!this._resetViewBtn) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'reset-view-btn';
      // Icon-only when the rail is minimised (label span collapses to a glyph),
      // so pin a stable accessible name regardless of the visible label.
      labelControl(btn, 'Reset view', 'reset the workspace pan & zoom');
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<polyline points="1 4 1 10 7 10"/>' +
          '<path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>' +
        '</svg>' +
        '<span class="reset-view-btn__label">Reset view</span>';
      btn.addEventListener('click', () => {
        this._resetGmTransform();
        this._applyWorkspaceTransform();
      });
      btn.hidden = true;
      wrapper.appendChild(btn);
      this._resetViewBtn = btn;
    }
    this._resetViewBtn.hidden = this._isGmTransformAtDefault();
  }

  /** Apply the GM workspace's "reset" transform — slightly zoomed out
   *  (GM_DEFAULT_SCALE) so the map sits inside the canvas with a small
   *  breathing margin, making the side-panel icons easier to reach. */
  private _resetGmTransform(): void {
    this.gmTransform.set(GMApp.GM_DEFAULT_SCALE, 0, 0);
  }

  /** True when the GM workspace transform matches the "reset" state. Used
   *  to toggle the Reset View button's visibility (hidden at default). */
  private _isGmTransformAtDefault(): boolean {
    const eps = 1e-4;
    return Math.abs(this.gmTransform.scale - GMApp.GM_DEFAULT_SCALE) < eps
        && Math.abs(this.gmTransform.offsetX) < eps
        && Math.abs(this.gmTransform.offsetY) < eps;
  }

  /**
   * Resize the player viewport by dragging its bottom-right handle. The
   * top-left corner stays fixed (anchor); the rect grows / shrinks
   * toward / away from the cursor. Clamped to [5%, 100%] of map per axis.
   */
  private _handleRectResizeDrag(kind: 'player' | 'projector', clientX: number, clientY: number, phase: 'start' | 'move' | 'end'): void {
    // Only player resizes; projector size is fixed by calibration.
    if (kind !== 'player') return;
    const wrapper = document.getElementById('canvas-wrapper');
    if (!wrapper) return;
    const wrect = wrapper.getBoundingClientRect();
    const norm  = this.renderer.canvasCssToMapNorm(clientX - wrect.left, clientY - wrect.top);
    if (phase === 'start') {
      const v = this.viewportEditor.getView();
      this._rectResizeDrag = {
        anchor: {
          x: v.centerX - v.viewNW / 2,
          y: v.centerY - v.viewNH / 2,
        },
        aspectAtStart: v.viewNH > 1e-6 ? v.viewNW / v.viewNH : 1,
      };
      return;
    }
    if (phase === 'end') {
      this._rectResizeDrag = null;
      // A user-driven size change invalidates the aspect-lock undo
      // baseline and the maximise restore — both would return to a
      // state that's no longer what the user expects.
      this._clearSnapUndo('player');
      this._refreshRectOverlays();
      return;
    }
    if (!this._rectResizeDrag || !norm) return;
    const a = this._rectResizeDrag.anchor;
    // Cursor is the new bottom-right corner; clamp inside map bounds
    // and enforce minimum 5% rect to avoid pixel-vanish collapses.
    let brX = Math.max(a.x + 0.05, Math.min(1, norm.x));
    let brY = Math.max(a.y + 0.05, Math.min(1, norm.y));
    // v2.14.3 — aspect-ratio lock: constrain the new bottom-right corner
    // so viewNW / viewNH preserves the drag-start ratio. Whichever axis
    // moved further from anchor (in proportion) drives; the other is
    // derived. Re-clamp to [a.x+0.05, 1] / [a.y+0.05, 1] so we don't
    // ever fall under the 5% floor or run off the map.
    if (this.state.snapshot().view?.aspectLocked) {
      const ratio = this._rectResizeDrag.aspectAtStart;
      const dxN = (brX - a.x);
      const dyN = (brY - a.y);
      const drivenByX = (dxN / ratio) >= dyN;
      if (drivenByX) {
        brY = Math.max(a.y + 0.05, Math.min(1, a.y + dxN / ratio));
      } else {
        brX = Math.max(a.x + 0.05, Math.min(1, a.x + dyN * ratio));
      }
    }
    const newViewNW = brX - a.x;
    const newViewNH = brY - a.y;
    const newCx = (a.x + brX) / 2;
    const newCy = (a.y + brY) / 2;
    const v = this.viewportEditor.getView();
    const next = {
      ...v,
      centerX: newCx,
      centerY: newCy,
      viewNW:  newViewNW,
      viewNH:  newViewNH,
    };
    this.viewportEditor.setView(next);
    this.state.setView(next);
    this._refreshRectOverlays();
  }

  /**
   * Wrapper-level tap → soft deselect for viewport rects. Selection itself
   * is deliberate (handle-driven only) per the A8 design philosophy:
   * clicking the move / resize / aspect / maximise handle is the ONLY
   * way to select a rect. Casual taps anywhere else dismiss the chrome.
   *
   * Critically this is gated on movement so it doesn't fire during a
   * mouse drag-pan (A8.6) — without the threshold, every pan gesture
   * would clear the rect selection on its pointerdown, which is
   * surprising. We compare pointerdown / pointerup positions; a tiny
   * movement is a tap, anything larger is a drag and the deselect is
   * skipped.
   */
  private _bindRectSelection(): void {
    const wrapper = document.getElementById('canvas-wrapper');
    if (!wrapper) return;
    let downX = 0, downY = 0, downActive = false;
    wrapper.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      downX = e.clientX;
      downY = e.clientY;
      downActive = true;
    });
    wrapper.addEventListener('pointerup', (e) => {
      if (!downActive) return;
      downActive = false;
      const dx = e.clientX - downX;
      const dy = e.clientY - downY;
      // 5 CSS-px slop tolerates jitter; anything bigger is a drag.
      if (dx * dx + dy * dy > 25) return;
      if (this._selectedViewport !== null) this._selectViewport(null);
    });
  }

  /**
   * Sync the viewport-rectangle chrome (move handle now; resize / maximise
   * / aspect-lock later in A8.x) for both player + projector rects. Pulls
   * the current canvas-CSS-px bounds from each editor and pushes them to
   * the shared overlay; null bounds (e.g., no map / no projector) cause
   * the chrome to disappear.
   */
  private _refreshRectOverlays(): void {
    if (!this._markerOverlay) return;
    const playerSelected = this._selectedViewport === 'player';
    const projSelected   = this._selectedViewport === 'projector';
    // Player rect — always shown when a map is loaded. Selection-gated
    // chrome (resize / aspect / maximise) shows only while selected.
    const playerBounds = this.viewportEditor?.getRectBounds() ?? null;
    // v2.16.33 — single broadcast-bypass toggle (on the Player Views
    // panel) drives both player AND projector eye icons. Was two toggles
    // before; collapsed because the panels were really one audience.
    const sharedBroadcastEl = document.querySelector<HTMLInputElement>('#projection-broadcast-toggle');
    // v2.14.5 — the eye reflects three states: 'on' (broadcasting and
    // someone is connected), 'off' (broadcasting bypassed), 'no-target'
    // (no client connected, so broadcast state is moot — eye dims).
    // Player count = remote PeerJS players (excluding projector peers)
    // + local same-browser player windows.
    const projectorPeerIds = new Set(this._projectorPeerByClientId.values());
    const remotePlayers    = Math.max(0, this.host.connectedCount - projectorPeerIds.size);
    const totalPlayers     = remotePlayers + this.host.localPlayerCount;
    const playerBroadcast: 'on' | 'off' | 'no-target' = totalPlayers === 0
      ? 'no-target'
      : (sharedBroadcastEl?.checked === false ? 'off' : 'on');
    // v2.14.4 — does the player rect's current W:H match 16:9 in physical
    // (map-aspect-corrected) space? Drives the 16:9 button's colour state.
    // Use a forgiving tolerance because viewNW / viewNH are floats and a
    // pixel of slop on either side shouldn't drop the indicator.
    const playerView = this.state.snapshot().view;
    let playerIs16x9 = false;
    if (playerView && playerSelected) {
      const mapAspect = this.mapAspectRatio || 1;
      const physW = playerView.viewNW * mapAspect;
      const physH = playerView.viewNH;
      if (physH > 1e-6) {
        const ratio = physW / physH;
        playerIs16x9 = Math.abs(ratio - 16 / 9) < 0.01;
      }
    }
    // v2.14.17 — Show Grid icon on the Player View rect, only on
    // calibrated maps. Player-side grid (map-relative) is independent
    // of the Scaled View grid (calibrated CSS-px); they have their
    // own state and own icon toggle.
    // v2.14.23 — Show Grid icon gated by selection to match the Scaled
    // View rect's behaviour (the icon only appears on the selected
    // viewport — minimises chrome clutter when both rects are visible).
    const playerGridState: 'on' | 'off' | undefined = (playerSelected && this._isActiveMapCalibrated())
      ? ((playerView?.playerGridEnabled) ? 'on' : 'off')
      : undefined;
    this._markerOverlay.updateRect('player', playerBounds
      ? {
          ...playerBounds,
          color:      '#ff8c00',
          selected:   playerSelected,
          showResize: playerSelected,
          // v2.14.3 — eye icon shows regardless of selection; the
          // broadcast state matters at a glance.
          viewBroadcast: playerBroadcast,
          ...(playerGridState ? { showGrid: playerGridState } : {}),
          ...(playerSelected ? {
            aspectLock:      this._playerAspectUndo ? 'undo' : 'apply',
            aspectIs16x9:    playerIs16x9,
            maximise:        this._playerMaxRestore ? 'maximised' : 'normal',
            // v2.14.3 — continuous aspect-ratio lock toggle.
            aspectRatioLock: (playerView?.aspectLocked) ? 'locked' : 'unlocked',
          } : {}),
        }
      : null,
    );
    // Projector rect — only when a projector is connected + calibrated.
    // Maximise on the projector toggles projection mode ('full' ↔ 'scaled'),
    // so it's only meaningful when the map is calibrated (locked to 'full'
    // otherwise per A8.3).
    const projBounds = this.projectorEditor?.getRectBounds() ?? null;
    const projMaxAvailable = projSelected && this._isActiveMapCalibrated();
    // v2.14.5 — same three-state eye logic; 'no-target' when no
    // projector window is connected. Uses the same shared bypass
    // toggle as the player rect (v2.16.33).
    const projConnected = this.projectorConnections.size > 0;
    const projBroadcast: 'on' | 'off' | 'no-target' = !projConnected
      ? 'no-target'
      : (sharedBroadcastEl?.checked === false ? 'off' : 'on');
    // v2.14.3 — Show Grid icon on the Scaled View rect, only on calibrated
    // maps (a 1" grid is meaningless without a known pixels-per-square).
    // v2.14.23 — same selection gate as the player rect: chrome
    // clutter is worse on the smaller projector rect, so the icon
    // only shows when the projector rect is the selected viewport.
    const projGridState: 'on' | 'off' | undefined = (projSelected && this._isActiveMapCalibrated())
      ? ((this.state.snapshot().projectorViewport?.gridEnabled) ? 'on' : 'off')
      : undefined;
    this._markerOverlay.updateRect('projector', projBounds
      ? {
          ...projBounds,
          color:    '#22c55e',
          selected: projSelected,
          // v2.14.3 — eye icon also on the projector / Scaled View rect.
          viewBroadcast: projBroadcast,
          ...(projGridState ? { showGrid: projGridState } : {}),
          ...(projMaxAvailable ? {
            maximise: this._projectorMaxRestore ? 'maximised' : 'normal',
          } : {}),
        }
      : null,
    );
    this._updateOffscreenIndicators(playerBounds, projBounds);
    this._refreshMapFXSelectors();
  }

  /** v2.12 — kept as a no-op shim while callers still reference it. The
   *  centre-of-polygon selector icons were dropped: interior clicks
   *  select any kind, the trashcan-on-select handle gives a clear
   *  delete affordance, and the FoW panel opens automatically on
   *  selection (and presets the kind dropdown to the picked polygon's
   *  kind). The icons added clutter to the player + GM view for no
   *  remaining benefit. */
  private _refreshMapFXSelectors(): void {
    this._markerOverlay?.updateMapFXSelectors([]);
  }

  /** v2.12 — kind list is now in the MapFX FX popover (sparkle button
   *  on the FoW panel). The in-use green '●' prefix + colour live in
   *  the popover's kind-picker builder (_populateMapFxPopover). This
   *  function survives as a refresh hook so the legacy call sites
   *  (fog state change, map change) still nudge the popover when it's
   *  open. No-op when the popover is closed. */
  private _refreshKindSelectorUsage(): void {
    if (this._suppressPopoverRefresh) return;
    this._mapfxFxPopover?.refresh();
  }

  /** v2.12 — update the always-visible label on the FoW panel that
   *  shows which kind is currently active. Called whenever the kind
   *  changes (popover dropdown, polygon selection sync, etc.). */
  private _updateActiveKindDisplay(): void {
    // v2.16.35 — element is now an inline <select> (was a static label
    // before the kind-picker was promoted out of the popover). Set
    // .value so the dropdown shows the active kind.
    const el = document.getElementById('mapfx-kind-display') as HTMLSelectElement | null;
    if (!el) return;
    el.value = this.activeOverlayKind;
  }

  /** v2.12 — sibling to _updateActiveKindDisplay for the Backdrop
   *  side. Shows the active backdrop in the inline <select> on the Map
   *  panel so the GM can see + change kind at a glance without opening
   *  the side panel. v2.16.35 — element is now a <select>. */
  private _updateActiveBgDisplay(): void {
    const el = document.getElementById('view-bg-display') as HTMLSelectElement | null;
    if (!el) return;
    const kind = this.state.getState().view.backdrop?.kind ?? 'none';
    el.value = kind;
  }

  /** v2.14.77 — Map panel upper-layer-opacity row. Shows the GM-only
   *  fade slider when the active map is a layered composite (has a
   *  revealBackingBlob set), hides otherwise. Fires on every map
   *  load + on composite save. Resets the slider to 100 on each
   *  show so leaving + returning to a layered map starts opaque.
   *
   *  Called from _updateMapPanels alongside _updateMapGridPanel. */
  private async _updateUpperLayerPanel(): Promise<void> {
    const row    = document.getElementById('map-upper-layer-row');
    const slider = document.getElementById('map-upper-layer-opacity') as HTMLInputElement | null;
    if (!row || !slider) return;
    const mapState = this.state.snapshot().map;
    if (!mapState) { row.hidden = true; return; }
    const storedMap = await getMap(mapState.id);
    if (!storedMap) { row.hidden = true; return; }
    const asset = await MapAssetStore.get(storedMap.mapAssetId);
    const hasBacking = !!asset?.revealBackingBlob;
    row.hidden = !hasBacking;
    if (hasBacking) {
      slider.value = '100';
      this.renderer.setMainMapOpacity(1);
    }
    // v2.16.45 — same flag also gates the Reveal Layer MapFX kind.
    this._activeMapIsLayered = hasBacking;
    this._refreshMapFxKindOptionState();
  }

  /** v2.16.45 — disable / re-enable the Reveal Layer kind in the MapFX
   *  dropdown based on whether the active map is a multilayered
   *  composite. The kind has nothing to reveal under a single-layer
   *  map, so the option is greyed and unselectable until a layered
   *  map loads. Called from `_updateUpperLayerPanel` (per map load)
   *  and `_bindMapFxKindSelect` (initial population). */
  private _refreshMapFxKindOptionState(): void {
    const sel = document.getElementById('mapfx-kind-display') as HTMLSelectElement | null;
    if (!sel) return;
    const opt = sel.querySelector<HTMLOptionElement>('option[value="reveal_layer"]');
    if (!opt) return;
    opt.disabled = !this._activeMapIsLayered;
    opt.title = this._activeMapIsLayered
      ? ''
      : 'Reveal Layer only applies to multilayered composite maps. Add layers in the Composite Map editor to enable.';
  }

  /** v2.14.31 — Map panel grid-colour row. Shows a colour swatch when
   *  the active map is calibrated, or a "Calibrate first" button
   *  otherwise. Called whenever the active map (or its calibration)
   *  changes, and whenever the user picks a new colour. */
  private _updateMapGridPanel(): void {
    // Calibration just changed → keep the "Measure from here" item's ghost
    // state in sync (this runs in every refreshProjectorMapInfo branch).
    this._updateMeasureMenuItem();
    const row     = document.getElementById('map-grid-row');
    const colour  = document.getElementById('map-grid-colour') as HTMLInputElement | null;
    const calBtn  = document.getElementById('map-grid-calibrate-btn') as HTMLButtonElement | null;
    if (!row || !colour || !calBtn) return;

    const mapState = this.state.snapshot().map;
    const isCalibrated = this._isActiveMapCalibrated();
    const hasMap = !!mapState;

    if (hasMap && isCalibrated) {
      row.hidden = false;
      calBtn.hidden = true;
      // Asset's saved colour drives the swatch; default to white when unset.
      colour.value = this._lastMapAssetGridColor ?? '#ffffff';
    } else if (hasMap) {
      row.hidden = true;
      calBtn.hidden = false;
    } else {
      row.hidden = true;
      calBtn.hidden = true;
    }
  }

  /** Cached grid colour for the active map's asset so the Map panel
   *  swatch can populate without a fresh IDB read on every paint.
   *  Refreshed inside refreshProjectorMapInfo. */
  private _lastMapAssetGridColor: string | null = null;

  /** v2.14.31 — persist the new grid colour on the active map's
   *  asset and push it to live viewers via map_meta_update.
   *  v2.14.76 — was calling MapAssetStore.update with `mapState.id`,
   *  which is the StoredMap id, NOT the MapAsset id. update silently
   *  no-ops on unknown ids so the broadcast worked (colour visible
   *  in-session) but the persist never happened — on next map load
   *  the picked colour was gone. Now fetches the StoredMap first and
   *  passes its mapAssetId. */
  private async _setActiveMapGridColor(color: string): Promise<void> {
    const mapState = this.state.snapshot().map;
    if (!mapState) return;
    this._lastMapAssetGridColor = color;
    // v2.14.34 — keep Host's full_state cache in sync so a viewer
    // joining AFTER this colour pick sees it on initial connect
    // (without us having to wait for the next refreshProjectorMapInfo).
    this.host.setLastMapGridColor(color);
    const storedMap = await getMap(mapState.id);
    if (storedMap) {
      await MapAssetStore.update(storedMap.mapAssetId, { gridColor: color });
    }
    this.host.broadcast({
      type: 'map_meta_update',
      gridColor: color,
    });
  }

  /** Off-screen viewport indicators — small edge-pinned pills with a
   *  directional arrow that appear when the GM has panned / zoomed away
   *  far enough that a viewport rect's bounding box no longer overlaps
   *  the canvas. Click to recenter the camera on the rect. (A7) */
  private _offscreenIndicators: { player: HTMLDivElement | null; projector: HTMLDivElement | null } = { player: null, projector: null };

  private _updateOffscreenIndicators(
    playerBounds: { x: number; y: number; w: number; h: number } | null,
    projBounds:   { x: number; y: number; w: number; h: number } | null,
  ): void {
    this._updateOneOffscreenIndicator('player',    playerBounds);
    this._updateOneOffscreenIndicator('projector', projBounds);
  }

  private _updateOneOffscreenIndicator(
    kind: 'player' | 'projector',
    bounds: { x: number; y: number; w: number; h: number } | null,
  ): void {
    const wrapper = document.getElementById('canvas-wrapper');
    if (!wrapper) return;
    let el = this._offscreenIndicators[kind];
    if (!el) {
      el = document.createElement('div');
      el.className = `offscreen-indicator offscreen-indicator--${kind}`;
      el.hidden = true;
      const arrow = '<svg class="offscreen-indicator__arrow" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
      const label = `<span class="offscreen-indicator__label">${kind === 'player' ? 'Player view' : 'Projector view'}</span>`;
      el.innerHTML = arrow + label;
      el.title = `Recenter on ${kind} view`;
      el.addEventListener('click', () => this._centerOnRect(kind));
      wrapper.appendChild(el);
      this._offscreenIndicators[kind] = el;
    }
    if (!bounds) { el.hidden = true; return; }
    const wRect = wrapper.getBoundingClientRect();
    const offScreen =
      bounds.x + bounds.w < 0 ||
      bounds.x         > wRect.width ||
      bounds.y + bounds.h < 0 ||
      bounds.y         > wRect.height;
    if (!offScreen) { el.hidden = true; return; }
    const wCx = wRect.width  / 2;
    const wCy = wRect.height / 2;
    const rCx = bounds.x + bounds.w / 2;
    const rCy = bounds.y + bounds.h / 2;
    const dx = rCx - wCx;
    const dy = rCy - wCy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    // Clamp the indicator to the wrapper edge with a padding inset so
    // the pill doesn't get clipped by the wrapper bounds.
    const pad   = 36;
    const halfW = Math.max(1, wCx - pad);
    const halfH = Math.max(1, wCy - pad);
    const t = Math.min(
      halfW / Math.max(1e-6, Math.abs(ux)),
      halfH / Math.max(1e-6, Math.abs(uy)),
    );
    const ex = wCx + ux * t;
    const ey = wCy + uy * t;
    el.hidden = false;
    el.style.left = `${ex}px`;
    el.style.top  = `${ey}px`;
    const arrow = el.querySelector<SVGElement>('svg.offscreen-indicator__arrow');
    if (arrow) {
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      arrow.style.transform = `rotate(${angle}deg)`;
    }
  }

  /** Pan the camera so a viewport rect's centre sits at the workspace
   *  centre. Preserves the current zoom level. */
  private _centerOnRect(kind: 'player' | 'projector'): void {
    let normCx: number, normCy: number;
    if (kind === 'player') {
      const v = this.viewportEditor.getView();
      normCx = v.centerX; normCy = v.centerY;
    } else {
      const vp = this.projectorEditor.getViewport();
      normCx = vp.centerX; normCy = vp.centerY;
    }
    const worldX = (normCx - 0.5) * this.mapAspectRatio;
    const worldY = -(normCy - 0.5);
    this.gmTransform.set(this.gmTransform.scale, worldX, worldY);
    this._applyWorkspaceTransform();
  }

  /**
   * Set the active viewport selection. Enforces mutual exclusion with the
   * marker selection (selecting a viewport clears any selected marker).
   * Pass null to deselect. Deselecting also clears any pending snap-undo
   * state — per the spec, "if the marker is unselected it resets and the
   * 16:9 icon will be back."
   *
   * A8.5 — when the projector rect is deselected, auto-collapse the
   * Projection View side panel. Selecting it doesn't auto-expand
   * (deliberate: the GM might be working with the rect on the canvas
   * and not need the panel's deeper config every time).
   */
  private _selectViewport(kind: 'player' | 'projector' | null): void {
    if (this._selectedViewport === kind) return;
    const prev = this._selectedViewport;
    this._selectedViewport = kind;
    if (prev !== null) this._clearSnapUndo(prev);
    if (kind !== null) this.markerEditor?.selectById(null);
    if (kind === null && prev === 'projector') {
      const body  = document.querySelector<HTMLElement>('#projection-panel .panel-body');
      const title = document.querySelector<HTMLElement>('#projection-panel .panel-title');
      if (body && !body.hidden) {
        body.hidden = true;
        title?.setAttribute('aria-expanded', 'false');
      }
    }
    this._refreshRectOverlays();
  }

  /** Discard snap-undo / max-restore state for a rect — called when the
   *  rect is moved, resized, or deselected so the undo button doesn't
   *  promise to revert to a state the user has since changed. */
  private _clearSnapUndo(kind: 'player' | 'projector'): void {
    if (kind === 'player') {
      this._playerAspectUndo = null;
      this._playerMaxRestore = null;
    } else {
      this._projectorMaxRestore = null;
    }
  }

  /**
   * 16:9 snap (player only). First click: record the current view, snap
   * the rect to physical 16:9 keeping the short edge fixed. Second click:
   * revert to the recorded state. Any move/resize between clicks clears
   * the undo so the button starts fresh.
   */
  /** Delete a marker by id and clear selection if it was the active one.
   *  Shared between the side-panel Delete button and the overlay's trashcan
   *  handle so both code paths stay in lock-step. */
  private _deleteMarker(id: string): void {
    const markers = this.state.getState().markers.filter((m) => m.id !== id);
    if (this.selectedMarkerId === id) {
      this.selectedMarkerId = null;
      this.markerEditor.selectById(null);
    }
    this.state.setMarkers(markers);
  }

  /** v2.12 — Select / deselect an overlay polygon by id. Toggle behaviour:
   *  same id clicks again = deselect. */
  private _selectOverlayPolygon(id: string | null): void {
    this.selectedOverlayId = id === this.selectedOverlayId ? null : id;
    this._refreshMapFXSelectors();
  }

  /** v2.12 — Remove an overlay polygon from state + broadcast. Selection
   *  clears if the deleted polygon was the active one. */
  private _deleteOverlayPolygon(id: string): void {
    if (this.selectedOverlayId === id) this.selectedOverlayId = null;
    const fog = this.state.getState().fog;
    this.state.setFog({ polygons: fog.polygons.filter((p) => p.id !== id) });
  }

  private _handleRectAspect(kind: 'player' | 'projector'): void {
    if (kind !== 'player') return;
    const current = this.viewportEditor.getView();
    if (this._playerAspectUndo) {
      // Undo path — restore the pre-snap view.
      const restore = this._playerAspectUndo;
      this._playerAspectUndo = null;
      this.viewportEditor.setView(restore);
      this.state.setView(restore);
      this._refreshRectOverlays();
      return;
    }
    // Apply path. Compute 16:9 in PHYSICAL space (accounts for map aspect)
    // and keep the short edge fixed so the user gets a sensible-sized
    // rect either way around. centerX/Y stay put.
    const mapAspect = this.mapAspectRatio || 1;
    const physW = current.viewNW * mapAspect;
    const physH = current.viewNH;
    let newViewNW = current.viewNW;
    let newViewNH = current.viewNH;
    if (physW > physH) {
      // Wide rect — short edge is height; widen to 16:9. Cap so the rect
      // can't escape the map (clamp newViewNW ≤ 1).
      const targetPhysW = physH * 16 / 9;
      newViewNW = Math.min(1, targetPhysW / mapAspect);
    } else {
      // Tall (or square) rect — short edge is width; lengthen height.
      const targetPhysH = physW * 9 / 16;
      newViewNH = Math.min(1, targetPhysH);
    }
    this._playerAspectUndo = current;
    const next: ViewState = { ...current, viewNW: newViewNW, viewNH: newViewNH };
    this.viewportEditor.setView(next);
    this.state.setView(next);
    this._refreshRectOverlays();
  }

  /**
   * Maximise toggle. For the player rect: first click expands to full map
   * and saves the prior view; second click restores. For the projector
   * rect: first click flips projection mode to 'full' (saving prior mode);
   * second click restores. Calibration lock from A8.3 prevents the
   * restore from re-entering 'scaled' when calibration is missing — the
   * mode-button logic will quietly keep it on 'full' until the map is
   * calibrated.
   */
  /**
   * v2.14.17 — Show Grid icon click on a viewport rect.
   *
   *   - Scaled View rect (projector): mirrors the side-panel "Show
   *     grid" toggle by flipping projectorViewport.gridEnabled. The
   *     existing checkbox change handler does the broadcast.
   *   - Player View rect: flips ViewState.playerGridEnabled. State
   *     update broadcasts via the normal view path; PlayerApp's
   *     drawGrid call honours it on the receiving end.
   */
  private _handleRectShowGrid(kind: 'player' | 'projector'): void {
    if (kind === 'projector') {
      // v2.14.31 — projection-grid-toggle UI removed; flip
      // projectorViewport.gridEnabled directly and broadcast.
      const current = this.state.snapshot().projectorViewport ?? defaultProjectorViewport();
      const next: ProjectorViewport = { ...current, gridEnabled: !current.gridEnabled };
      this.state.setProjectorViewport(next);
      this.projectorEditor.setViewport(next);
      this.host.broadcast({ type: 'projector_viewport_update', payload: next });
      this._refreshRectOverlays();
      return;
    }
    if (kind === 'player') {
      const view = this.state.snapshot().view;
      if (!view) return;
      const next = { ...view, playerGridEnabled: !view.playerGridEnabled };
      this.state.setView(next);
      // Mirror into viewportEditor's local copy so subsequent
      // ...getView() spreads (resize, move) preserve the field —
      // same pattern as the aspectLocked fix in v2.14.10.
      this.viewportEditor.setView(next);
      this._refreshRectOverlays();
    }
  }

  /**
   * v2.14.3 — eye icon click on either viewport rect. Toggles the same
   * (single, post v2.16.33) broadcast bypass that the Player Views
   * panel-header switch controls; firing the checkbox's 'change' event
   * keeps the existing wiring (faff placeholder broadcast for both
   * audiences) intact and ensures the panel UI updates to match.
   * The `kind` arg is kept for call-site readability but both kinds
   * resolve to the same single toggle now.
   */
  private _handleRectViewBroadcast(_kind: 'player' | 'projector'): void {
    const cb = document.querySelector<HTMLInputElement>('#projection-broadcast-toggle');
    if (!cb) return;
    cb.checked = !cb.checked;
    cb.dispatchEvent(new Event('change'));
    this._refreshRectOverlays();
  }

  /**
   * v2.14.3 — toggle the Player View aspect-ratio lock. Locks the
   * current W:H so subsequent resize-handle drags preserve it. State
   * lives on ViewState so it persists per-map and broadcasts to
   * connected clients. No-op for the projector rect (its size is
   * locked to calibration anyway).
   */
  private _handleRectRatioLock(kind: 'player' | 'projector'): void {
    if (kind !== 'player') return;
    const view = this.state.snapshot().view;
    if (!view) return;
    const next = { ...view, aspectLocked: !view.aspectLocked };
    this.state.setView(next);
    // v2.14.10 — keep the viewportEditor's local copy of the view in
    // sync. Subsequent rect-drag handlers spread from
    // `viewportEditor.getView()` when building the new view; without
    // this sync the aspectLocked field is dropped on the first drag
    // and state.view.aspectLocked silently flips back to undefined —
    // hence Alex's "lock unselects itself the moment you resize".
    this.viewportEditor.setView(next);
    this._refreshRectOverlays();
  }

  private _handleRectMaximise(kind: 'player' | 'projector'): void {
    if (kind === 'player') {
      const current = this.viewportEditor.getView();
      if (this._playerMaxRestore) {
        const restore = this._playerMaxRestore;
        this._playerMaxRestore = null;
        this.viewportEditor.setView(restore);
        this.state.setView(restore);
      } else {
        this._playerMaxRestore = current;
        const next: ViewState = { ...current, centerX: 0.5, centerY: 0.5, viewNW: 1, viewNH: 1 };
        this.viewportEditor.setView(next);
        this.state.setView(next);
      }
      this._refreshRectOverlays();
      return;
    }
    // Projector
    const currentVp = this.projectorEditor.getViewport();
    if (this._projectorMaxRestore) {
      const restore = this._projectorMaxRestore;
      this._projectorMaxRestore = null;
      this.projectorEditor.setViewport(restore);
      this.state.setProjectorViewport(restore);
      this.host.broadcast({ type: 'projector_viewport_update', payload: restore });
    } else {
      this._projectorMaxRestore = currentVp;
      const next: ProjectorViewport = { ...currentVp, mode: 'full' };
      this.projectorEditor.setViewport(next);
      this.state.setProjectorViewport(next);
      this.host.broadcast({ type: 'projector_viewport_update', payload: next });
    }
    this.refreshProjectionModeButtons();
    this._refreshRectOverlays();
  }

  /**
   * Translate an overlay move-handle drag into a centre-shift on the
   * targeted viewport. Records cursor position + rect centre in
   * map-normalised space at start so the rect glides with the cursor
   * regardless of where the user grabbed it.
   */
  private _handleRectMoveDrag(kind: 'player' | 'projector', clientX: number, clientY: number, phase: 'start' | 'move' | 'end'): void {
    const wrapper = document.getElementById('canvas-wrapper');
    if (!wrapper) return;
    const wrect = wrapper.getBoundingClientRect();
    const norm  = this.renderer.canvasCssToMapNorm(clientX - wrect.left, clientY - wrect.top);
    if (phase === 'start') {
      if (!norm) return;
      // Dragging the move handle is also a selection gesture — matches
      // the marker move-handle pattern (drag = move + select).
      this._selectViewport(kind);
      // v2.14.61 — removed the "full-map → snap to 50% rect" pop
      // shortcut. It was a stopgap when the only way to recover a
      // resizable player rect from full-map view was to grab the
      // move handle, but the side-effect (handle teleports mid-drag,
      // cursor ends up nowhere near the new rect) was jarring. Now
      // dragging the move handle while at full-map is a no-op for
      // the drag itself — the rect stays put. Resize handles and
      // explicit "Player view" presets remain the proper paths to
      // shrink the view.
      const startCenter = kind === 'player'
        ? { x: this.viewportEditor.getView().centerX,    y: this.viewportEditor.getView().centerY    }
        : { x: this.projectorEditor.getViewport().centerX, y: this.projectorEditor.getViewport().centerY };
      this._rectMoveDrag = { kind, startNorm: norm, startCenter };
      return;
    }
    if (phase === 'end') {
      const dragKind = this._rectMoveDrag?.kind ?? kind;
      this._rectMoveDrag = null;
      // User-driven move invalidates the snap-back baselines (same
      // reasoning as the resize end path).
      this._clearSnapUndo(dragKind);
      this._refreshRectOverlays();
      return;
    }
    if (!this._rectMoveDrag || !norm) return;
    const dx = norm.x - this._rectMoveDrag.startNorm.x;
    const dy = norm.y - this._rectMoveDrag.startNorm.y;
    const newCx = Math.max(0, Math.min(1, this._rectMoveDrag.startCenter.x + dx));
    const newCy = Math.max(0, Math.min(1, this._rectMoveDrag.startCenter.y + dy));
    if (this._rectMoveDrag.kind === 'player') {
      const v = this.viewportEditor.getView();
      const next = { ...v, centerX: newCx, centerY: newCy };
      this.viewportEditor.setView(next);
      this.state.setView(next);
    } else {
      const vp = this.projectorEditor.getViewport();
      const next = { ...vp, centerX: newCx, centerY: newCy };
      this.projectorEditor.setViewport(next);
      this.state.setProjectorViewport(next);
      // Mirror the projectorEditor.onChange path — the broadcast doesn't
      // fan out from state.setProjectorViewport on its own, so the
      // projector wouldn't actually see the new viewport without this.
      this.host.broadcast({ type: 'projector_viewport_update', payload: next });
    }
    this._refreshRectOverlays();
  }

  private _setBrokerErrorVisible(_visible: boolean): void {
    // v2.16.33 — the broker error notice + QR both lived in the (now
    // deleted) Player Connection panel. The setStatus call upstream of
    // every caller already surfaces the failure to the GM via the
    // status overlay; no panel-specific UI to flip here. Kept as a
    // no-op stub so callers don't need to know the panel is gone.
  }

  async init(): Promise<void> {
    this.bindDOMRefs();
    // Apply persisted UI scale to the sidebar before anything else
    // measures itself — popovers + panels read offsetWidth during
    // first render, and reading them while the sidebar is still at
    // its unscaled size leads to one wrong-anchor frame on first
    // open. No-op (scale=1.0) for users who haven't touched it.
    void import('../storage/localSettings.ts').then(({ applyUiScale }) => applyUiScale());
    this.bindRenderer();
    this.bindFogEditor();
    this.bindViewportEditor();
    this.bindProjectorEditor();
    this.bindFilterPanel();
    this.bindTransitionPanel();
    this.bindUIControls();
    this.bindMarkerEditor();
    this.bindSoundboardPanel();
    this.bindPlayersPanel();
    this.bindMessageThreads();
    this.bindInitiativeTracker();
    this.bindAnnotate();
    this.bindHamburgerMenu();
    this._bindWorkspacePanZoom();
    this._bindCanvasUndo();
    this._bindStagecraftPanel();
    this._bindSoundtracksPanel();

    // Seed the workspace transform at the GM default (slightly zoomed out)
    // so first paint already shows the small breathing margin. Reset View
    // and 'R' key both return to this same default.
    this._resetGmTransform();
    this._applyWorkspaceTransform();

    // v2.16.44 — Audio mutual exclusion across Mappadux windows on
    // this machine. GM starts with audio enabled (the user mutes via
    // the marker-mute toggle if they want silence); claim immediately
    // so any open player tabs / pop-outs hear that and mute themselves.
    void import('../utils/AudioCoordinator.ts').then(({ AudioCoordinator }) => {
      this._audioCoord = new AudioCoordinator({
        clientId: this._audioCoordClientId,
        onForceMute: () => this._forceLocalAudioMuted(true),
      });
      this._audioCoord.claim();
    });

    // v2.16.49 — Drag-a-player-from-the-Players-row onto the map as an
    // alternative to clicking the marker pin in the row. PlayersPanel
    // marks its icon-button draggable + sets a custom MIME type; we
    // accept the drop here and convert the cursor's canvas-CSS coord
    // into a normalised map coord for the placement.
    const wrapper = document.getElementById('canvas-wrapper');
    if (wrapper) {
      const MIME = 'application/x-mappadux-player';
      wrapper.addEventListener('dragover', (e) => {
        if (!e.dataTransfer?.types.includes(MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        wrapper.classList.add('player-drop-active');
      });
      wrapper.addEventListener('dragleave', (e) => {
        // Leaving the wrapper itself (not just moving over a child)
        if (e.target === wrapper) wrapper.classList.remove('player-drop-active');
      });
      wrapper.addEventListener('drop', (e) => {
        wrapper.classList.remove('player-drop-active');
        const id = e.dataTransfer?.getData(MIME);
        if (!id) return;
        e.preventDefault();
        const canvas = document.querySelector<HTMLCanvasElement>('#renderer-canvas');
        if (!canvas) return;
        const r = canvas.getBoundingClientRect();
        const norm = this.renderer.canvasCssToMapNorm(e.clientX - r.left, e.clientY - r.top);
        if (!norm) return;
        void this._placePlayerAtNorm(id, norm.x, norm.y);
      });
    }

    // v2.16.40 — Inline PiP preview of the player view. Lives on the
    // canvas-wrapper; defaults to open on first session so a new GM
    // immediately sees what their players see. Pop-out replicates the
    // old "Open Player Window" flow as many times as wanted.
    void import('./PlayerPip.ts').then(({ PlayerPip }) => {
      const wrapper = document.getElementById('canvas-wrapper');
      if (!wrapper) return;
      this._playerPip = new PlayerPip({
        canvasWrapper: wrapper,
        getPlayerUrl: () => {
          const code = this.host.roomCode;
          if (!code) return '';
          const u = new URL(this._buildPlayerUrl(code));
          // Preview mode — suppresses the identify modal + player-only
          // chrome so the GM sees a clean viewer of the live state.
          u.searchParams.set('gmPreview', '1');
          return u.toString();
        },
      });
    });

    // Resume positional audio context on first user gesture (autoplay policy)
    const resumePA = () => this.audio.tryResume();
    document.addEventListener('click',      resumePA);
    document.addEventListener('keydown',    resumePA);
    document.addEventListener('touchstart', resumePA, { passive: true });

    // Motion-tracker rendering: redraw the GM marker layer every frame while
    // a scan ring is expanding or any return blob is still fading.
    this.motionTracker.onChange = () => this._kickMotionRaf();
    // Broadcast scan events so connected players can mirror the visuals + audio.
    this.motionTracker.onScanStart = (scan) => {
      // Play the outgoing ping locally
      this.trackerAudio.playOutgoing();
      const cfg          = this.motionTracker.getConfig();
      const audioAssetId = this.trackerAudio.getOutgoingAssetId() ?? undefined;
      const audioFields  = this._buildTrackerAudioFields(audioAssetId, this._outgoingDataUrl, cfg.outgoingPingVolume);
      this.host.broadcast({
        type:      'tracker_scan',
        centre:    scan.centre,
        range:     scan.range,
        speedSecs: scan.speedSecs,
        colour:    scan.colour,
        ...audioFields,
      });
    };
    this.motionTracker.onSourceHit = (source) => {
      const cfg = this.motionTracker.getConfig();
      // Play the return ping locally — fires even when blobs are hidden
      this.trackerAudio.playReturn();
      // Players don't render blobs when the GM has hidden them, but they still
      // get the audio so the "audio return only" mode works remotely too.
      const audioAssetId = this.trackerAudio.getReturnAssetId() ?? undefined;
      const audioFields  = this._buildTrackerAudioFields(audioAssetId, this._returnDataUrl, cfg.returnPingVolume);
      if (cfg.hideBlobs) {
        // Audio-only broadcast: send a blob message with no visible blob (use a sentinel
        // by skipping the message entirely if there's no audio either).
        if (!audioAssetId) return;
      }
      this.host.broadcast({
        type:     'tracker_blob',
        position: { ...source.position },
        fadeMs:   cfg.hideBlobs ? 0 : cfg.rate * 1000, // fadeMs=0 → player doesn't draw blob
        mode:     source.motionBlobMode,
        sourceId: source.id,
        colour:   cfg.colour,
        ...audioFields,
      });
    };

    // Register the state listener BEFORE loading maps so that the initial
    // populateMapList() → loadMap() → state.loadForMap() → _notify() chain
    // correctly populates host.lastState.
    this.state.onChange((s, changed) => this.onStateChange(s, changed));

    // Flush any pending debounced autosave before the page disappears.
    // Without this, a GM refresh within the 1500ms debounce window loses
    // any changes made since the last actual IDB write.
    const flushOnHide = () => { void this.state.flushSave(); };
    window.addEventListener('pagehide',           flushOnHide);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.state.flushSave();
    });

    // v2.14.2 — broadcast a `gm-closing` signal to spawned player /
    // projector / calibrate windows on pagehide so they self-close.
    // Uses a dedicated channel so we don't pollute the gameplay
    // state-sync channels. Popups listen on the same channel and
    // call window.close() — works even though we open them with
    // noopener (no Window ref to close from the opener side).
    //
    // v2.14.98 — channel name suffixed with the active instance id
    // so a second-instance GM only closes ITS own spawned windows,
    // not every viewer at the same origin. Same trap LocalChannel
    // had in v2.14.92.
    try {
      const inst = getActiveInstanceId();
      const lifecycle = new BroadcastChannel(`mappadux:lifecycle${inst ? ':' + inst : ''}`);
      window.addEventListener('pagehide', () => {
        try { lifecycle.postMessage({ kind: 'gm-closing' }); } catch { /* channel may already be closed */ }
      });
    } catch { /* BroadcastChannel unavailable — popups stay open on GM close, acceptable fallback */ }

    await seedAudioAssets();
    await migrateLegacyMaps();
    await seedImageAssetsIfNeeded();
    await migrateLegacyIconsIfNeeded();
    // Check for ?bundle=<URL> startup load. If the user came in via a
    // shared link, we load that pack instead of seeding the default.
    const handledByUrl = await this._maybeLoadBundleFromUrl();

    if (handledByUrl) {
      // URL-load already populated IDB and applied theme; skip default seed.
      this._seededPackName = null;
    } else if (localStorage.getItem(SUPPRESS_DEFAULT_SEED_KEY) === '1') {
      // One-shot "skip default seed" flag from Settings → Delete DB.
      localStorage.removeItem(SUPPRESS_DEFAULT_SEED_KEY);
      this._seededPackName = null;
    } else {
      this._seededPackName = await seedDefaultMaps();
    }
    this._didSeedDefault = this._seededPackName !== null;
    await this.populateMapList();
    await this.startHost();

    // Apply any persisted theme so the GM lands on the customised look from
    // the moment the UI is interactive.
    const initialSession = await loadSession();
    applyTheme(initialSession?.theme);

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

  /** v2.16.43 — peer ids known to be GM-spawned previews (PiP iframe or
   *  pop-out window). Identified via `gm_preview_hello`; consulted by
   *  the disconnect handler to swap the status message. */
  private _gmPreviewPeers = new Set<string>();

  /** v2.16.103 — per-peer device class (true = touch / mobile) reported on
   *  player_identify, so the Player connections summary can split remote
   *  windows into PC vs mobile. Cleared on disconnect. */
  private _peerIsMobile = new Map<string, boolean>();

  /** v2.16.44 — silence ALL local audio outputs without touching the
   *  marker-mute toggle UI or broadcasting positional_mute_all to
   *  players. Triggered by the AudioCoordinator when another window
   *  claims audio. Engines stay muted until the user explicitly
   *  re-enables via the marker-mute toggle (which calls claim() and
   *  un-mutes them all). */
  private _forceLocalAudioMuted(muted: boolean): void {
    this.audio.setMuteAll(muted);
    this.trackerAudio.setMuteAll(muted);
    this.soundboardEngine?.setMuteAll(muted);
  }

  private async onHostReady(roomCode: string): Promise<void> {
    // Broker just confirmed our peer id — any prior broker-down notice
    // is stale, restore the QR.
    this._setBrokerErrorVisible(false);
    this.roomCodeEl.textContent = roomCode;
    // v2.16.40 — room code is what the PiP URL needs. If the iframe was
    // mounted before this fired (host.roomCode returned '' from the
    // getPlayerUrl callback) refresh it now so the inline preview shows
    // the live state.
    this._playerPip?.refresh();

    // On localhost, replace with the real LAN IP so QR/URL works for other devices.
    // __DEV_LAN_IP__ is injected at build time by vite.config.ts (null in prod).
    if ((location.hostname === 'localhost' || location.hostname === '127.0.0.1')
        && __DEV_LAN_IP__) {
      this.playerOrigin = `${location.protocol}//${__DEV_LAN_IP__}:${location.port}`;
    }

    const playerUrl = this._buildPlayerUrl(roomCode);
    // v2.16.33 — QR + player-URL display moved out of the sidebar (the
    // Player Connection panel is gone). The hold-screen players see
    // when they can't reach the GM is now where they pick the URL up,
    // and Open Player Window relocated to the Player Views panel. The
    // _buildPlayerUrl call is preserved so other consumers (clipboard
    // copy, status messages) still resolve the right URL.
    void playerUrl;
    // v2.16.103 — render the Player connections QR now the room code is known.
    this._renderConnectionsQr();

    const existing = await loadSession();
    // Pack name precedence: existing session > bundle-seeded default > none.
    const packName = existing?.packName ?? this._seededPackName ?? '';
    this._seededPackName = null; // consume
    // v2.15.27 — Spread existing so we preserve fields this code
    // doesn't explicitly manage (theme, splash, soundtracks, ...).
    // The old shape wiped them on every host start, which is why
    // Soundtracks slots vanished on refresh.
    await saveSession({
      ...(existing ?? {}),
      key:       'current',
      peerId:    roomCode,
      lastMapId: existing?.lastMapId ?? null,
      ...(packName ? { packName } : {}),
    });
    void this._refreshPackNameInput();

    // v2.17.19 — confirmation toast after a welcome-pack refresh reload.
    if (consumeWelcomePackRefreshedFlag()) {
      this.setStatus('Updated your Getting Started tour — now with a walkthrough video.', 'ok');
    }

    // First-run intro: if the default bundle was just seeded, pop the About
    // dialog so a new user sees what they've landed on. Snapshot the flag
    // BEFORE clearing it so _maybeShowMotd can read it after the
    // auto-About kick-off.
    const wasSeeded = this._didSeedDefault;
    if (wasSeeded) {
      void this.openAboutDialog({});
    }
    // MOTD popup: one-off message gate driven by src/motd/motd.ts.
    // Runs after the seed/About decision so it can defer when About
    // is open. Internally checks _didSeedDefault to silently mark
    // first-installers as caught up. v2.17.19 — once MOTD has resolved,
    // offer the refreshed Getting Started tour if a newer one has shipped.
    void (async () => {
      try { await this._maybeShowMotd(); }
      finally { this._didSeedDefault = false; }
      await this._maybeOfferWelcomePackRefresh();
    })();
  }

  /**
   * v2.17.19 — Offer (never force) a refresh of the Getting Started tour when
   * a newer welcome-pack version has shipped. Gated tightly so we only ever
   * approach a user still sitting on the untouched default tour: they must
   * have been seeded, be behind the current version, not have already declined
   * this version, still carry the default pack name, and have no custom About
   * or theme (renaming or branding the pack = they've made it their own). The
   * refresh itself wipes + re-seeds, so it runs ONLY on explicit consent.
   */
  private async _maybeOfferWelcomePackRefresh(): Promise<void> {
    if (this._aboutOpen) return; // don't stack on the first-run About
    try { if (localStorage.getItem(DEFAULT_SEED_DONE_KEY) !== '1') return; } catch { return; }
    if (getWelcomePackOfferDismissedVersion() >= WELCOME_PACK_VERSION) return;
    // Installs seeded before versioning existed count as version 1.
    const seeded = getWelcomePackSeededVersion() ?? 1;
    if (seeded >= WELCOME_PACK_VERSION) return; // already on the latest tour

    const session = await loadSession();
    if (!session) return;
    if ((session.packName ?? '') !== 'Getting Started') return; // renamed → their own
    if (session.splash || session.theme) return;                // branded → their own

    const ok = await confirmDialog({
      title: 'A fresh Getting Started tour is ready',
      body: 'The walkthrough has been refreshed and now includes a short intro video. Load the new version? This replaces the current Getting Started pack in this browser.',
      confirmLabel: 'Load it',
      cancelLabel:  'Not now',
      confirmTone:  'primary',
    });
    if (!ok) {
      // Remember the decline so we don't re-ask until an even newer tour ships.
      setWelcomePackOfferDismissedVersion(WELCOME_PACK_VERSION);
      return;
    }

    this.setStatus('Loading the new Getting Started tour…', 'ok');
    const done = await reseedWelcomePack();
    if (!done) {
      // reseedWelcomePack clears before importing, so on failure a reload is
      // the cleanest recovery — startup re-seeds from the bundle on its own.
      this.setStatus('Re-seeding the tour — reloading…', 'warn');
    }
    setWelcomePackRefreshedFlag();
    location.reload();
  }

  private onPeerConnected(id: string): void {
    this._updatePlayerCount();
    this.setStatus(`Player connected (${id.slice(0, 8)}…)`, 'ok');
    // Host.handleConnection already sends full_state directly to the new peer.
    // No broadcast here — that would redundantly re-send to all existing players.
  }

  private onPeerDisconnected(id: string): void {
    // If this disconnecting peer was a projector, tear down the matching
    // projectorConnections entry — the projector_bye message might not have
    // been delivered before the data channel closed.
    for (const [clientId, peerId] of this._projectorPeerByClientId) {
      if (peerId === id) {
        this._projectorPeerByClientId.delete(clientId);
        this.projectorConnections.delete(clientId);
      }
    }
    this._peerIsMobile.delete(id); // v2.16.103 — drop device class on leave
    this.projectorEditor?.setConnection(this._primaryProjector() ?? null);
    this.refreshProjectorStatus();
    this._refreshProjectionPanelMode();
    // v2.16.43 — GM-spawned previews (PiP iframe or pop-out window) get a
    // friendlier status than the generic "Player (peerid…)…". The
    // gm_preview_hello tag stays valid for the connection's lifetime
    // and is consumed here.
    if (this._gmPreviewPeers.delete(id)) {
      this._refreshPlayersPanel();
      this._broadcastRoster();
      this._updatePlayerCount();
      this.setStatus('GM Player View disconnected', 'ok');
      return;
    }
    // v2.17 Player Voice — look up the player BEFORE clearing the binding so
    // we can use their real name in the status rather than the peer hash.
    const bound = this.playerRegistry.playerForPeer(id);
    this.playerRegistry.disconnectPeer(id);
    this._refreshPlayersPanel();
    this._broadcastRoster();
    this._updatePlayerCount();
    const who = bound ? (bound.characterName || bound.playerName || 'Player') : `Player (${id.slice(0, 8)}…)`;
    this.setStatus(`${who} disconnected`, 'warn');
  }

  private _updatePlayerCount(): void {
    // PeerJS connectedCount mixes network players and remote projectors —
    // strip the remote-projector subset to get the network-player count.
    const total            = this.host.connectedCount;
    const projectorPeerIds = new Set(this._projectorPeerByClientId.values());
    const remotePlayers    = Math.max(0, total - projectorPeerIds.size);
    // Same-machine player windows ping us over BroadcastChannel; the count
    // expires entries that haven't pinged in the last 10s.
    const localPlayers     = this.host.localPlayerCount;
    const totalPlayers     = remotePlayers + localPlayers;

    // v2.16.33 — the player-count / plural / suffix / projector-suffix
    // strings + the session-meta tooltip all lived in the deleted
    // Player Connection panel. The per-row green pulsing indicators on
    // the Players panel give the same feedback at a glance; no separate
    // count line needed anymore. Kept the local references commented
    // so future maintainers can find what was here.
    //   - this.playerCountEl, #player-count-plural, #player-total-suffix
    //   - #projector-count-suffix, .session-meta tooltip
    // Variables stay scoped so the no-connection greying below still
    // computes the right totals.
    const projTotal = this.projectorConnections.size;
    void localPlayers; void totalPlayers; void projTotal;

    // v2.17.0 — the Player Views panel header no longer fades when no
    // players / scaled views are connected. With the panel now hosting the
    // join QR + Show Player View (useful before anyone connects), the
    // "broadcast is moot" fade is redundant — keep it always bright. Clear
    // the class in case it was applied by an earlier build.
    document.querySelector('#projection-panel .panel-header')
      ?.classList.remove('panel-header--no-connection');

    // v2.14.5 — refresh the rect chrome so the eye-icon "no-target"
    // greying updates in lock-step with the panel-header fade.
    this._refreshRectOverlays();

    // v2.16.103 — keep the Player connections window/capability summary live.
    this._renderConnectionsSummary();
  }

  /** v2.16.103 — render the join QR + URL into the Player connections
   *  subpanel. Uses _buildPlayerUrl (LAN IP in dev / public URL in prod) so a
   *  phone on the same network can open a remote player window. No-op until
   *  the room code is known. Renders even while the subpanel is collapsed —
   *  the canvas keeps its bitmap, ready when the GM expands it. */
  private _renderConnectionsQr(): void {
    const canvas = document.getElementById('connections-qr') as HTMLCanvasElement | null;
    const urlEl  = document.getElementById('connections-url');
    const code   = this.host.roomCode;
    if (!code) { if (urlEl) urlEl.textContent = 'Waiting for room code…'; return; }
    // v2.16.106 — same canonical join URL everywhere: strip the ?instance
    // query so the QR matches the player/projector hold-screen QR exactly
    // (external scanners don't use the same-browser instance namespace).
    let url = this._buildPlayerUrl(code);
    try { const u = new URL(url); u.search = ''; url = u.toString(); } catch { /* keep as-is */ }
    // v2.17.0 — both the QR and the URL are click-to-copy. onclick (not
    // addEventListener) so repeated renders don't stack duplicate handlers.
    if (urlEl) {
      urlEl.textContent = url;
      urlEl.title = 'Click to copy the player URL';
      urlEl.style.cursor = 'pointer';
      urlEl.onclick = () => this._copyPlayerUrl(url);
    }
    if (canvas) {
      canvas.title = 'Click to copy the player URL';
      canvas.style.cursor = 'pointer';
      canvas.onclick = () => this._copyPlayerUrl(url);
      void QRCode.toCanvas(canvas, url, { width: 160, margin: 1 }).catch(() => { /* ignore */ });
    }
  }

  /** v2.17.0 — copy the canonical player URL to the clipboard with a
   *  status-bar confirmation. Used by the click-to-copy QR + URL. */
  private _copyPlayerUrl(url: string): void {
    void navigator.clipboard?.writeText(url)
      .then(() => this.setStatus('Player URL copied to clipboard', 'ok'))
      .catch(() => this.setStatus('Could not copy — select the URL to copy it manually', 'warn'));
  }

  /** v2.16.103 — window & capability summary for the Player connections
   *  subpanel: counts of connected player WINDOWS by type, NOT the player
   *  roster (that's the separate Players panel). Local windows = GM-spawned
   *  previews (Show Player View / pop-out) + same-machine player windows.
   *  Scaled views = projector windows. Remote = network player connections,
   *  split PC / mobile from the device class reported on identify. */
  private _renderConnectionsSummary(): void {
    const list = document.getElementById('connections-summary');
    if (!list) return;
    const projectorPeerIds = new Set(this._projectorPeerByClientId.values());
    const remotePeers  = this.host.connectedPeerIds.filter((id) => !projectorPeerIds.has(id));
    const remote       = remotePeers.length;
    const remoteMobile = remotePeers.filter((id) => this._peerIsMobile.get(id) === true).length;
    const remotePc     = remote - remoteMobile;
    const localWindows = this._gmPreviewPeers.size + this.host.localPlayerCount;
    const scaled       = this.projectorConnections.size;

    list.replaceChildren();
    if (localWindows + scaled + remote === 0) {
      const li = document.createElement('li');
      li.className = 'conn-empty';
      li.textContent = 'No player views connected yet';
      list.appendChild(li);
      return;
    }

    const rows: Array<{ label: string; count: number; sub?: string }> = [
      { label: 'Local windows', count: localWindows },
      { label: 'Scaled views',  count: scaled },
      { label: 'Remote',        count: remote,
        ...(remote > 0 ? { sub: `${remotePc} PC · ${remoteMobile} mobile` } : {}) },
    ];
    for (const r of rows) {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = r.label;
      const right = document.createElement('span');
      const count = document.createElement('span');
      count.className = 'conn-count';
      count.textContent = String(r.count);
      right.appendChild(count);
      if (r.sub) {
        const sub = document.createElement('span');
        sub.className = 'conn-sub';
        sub.textContent = '  ' + r.sub;
        right.appendChild(sub);
      }
      li.append(label, right);
      list.appendChild(li);
    }
  }

  // ─── State change → propagate to renderer + P2P ───────────────────────────

  private _collectIconData(markers: Marker[]): MarkerIconData[] {
    const seen: Set<string> = new Set();
    const result: MarkerIconData[] = [];
    for (const m of markers) {
      // Legacy 'asset:' icons: cached under the bare icon key.
      if (m.icon.startsWith('asset:') && !seen.has(m.icon)) {
        const dataUrl = this.iconDataUrls.get(m.icon);
        if (dataUrl) result.push({ key: m.icon, dataUrl });
        seen.add(m.icon);
      }
      // Small Asset Library icons: tintable variants live under the
      // compound key '<icon>#<color>' so a single asset used in two
      // colours broadcasts as two distinct bitmaps; raster variants
      // share the bare icon key. The player resolves whichever the GM
      // sent — no tintability knowledge needed on the receiving side.
      if (m.icon.startsWith('libAsset:')) {
        const compound = `${m.icon}#${m.color}`;
        if (!seen.has(compound)) {
          const compoundUrl = this.iconDataUrls.get(compound);
          if (compoundUrl) {
            result.push({ key: compound, dataUrl: compoundUrl });
            seen.add(compound);
            continue;
          }
          const plainUrl = this.iconDataUrls.get(m.icon);
          if (plainUrl && !seen.has(m.icon)) {
            result.push({ key: m.icon, dataUrl: plainUrl });
            seen.add(m.icon);
          }
        }
      }
    }
    return result;
  }

  /**
   * Walks the supplied markers, lazily rendering any Small Asset Library
   * icons that aren't yet in IconPicker's caches. Tintable assets render
   * one bitmap per (asset, colour) pair; raster assets render once.
   * Returns true if at least one new entry landed in the cache so the
   * caller can decide whether to re-broadcast. Also opportunistically
   * records each asset's tintability so updateMarkerPanel's Colour-row
   * decision stays synchronous on later renders.
   */
  private async _ensureLibIcons(markers: Marker[]): Promise<boolean> {
    let added = false;
    const seenPairs = new Set<string>();
    for (const m of markers) {
      if (!m.icon.startsWith('libAsset:')) continue;
      const pair = `${m.icon}#${m.color}`;
      if (seenPairs.has(pair)) continue;
      seenPairs.add(pair);
      if (this.iconCache.has(pair)) continue;
      if (this.iconCache.has(m.icon)) continue;
      const rendered = await renderLibIcon(m.icon, m.color);
      if (!rendered) continue;
      this.iconCache.set(rendered.key, rendered.bitmap);
      this.iconDataUrls.set(rendered.key, rendered.dataUrl);
      this._libAssetTintable.set(m.icon.slice('libAsset:'.length), rendered.tintable);
      added = true;
    }
    return added;
  }

  /**
   * Local + remote refresh after _ensureLibIcons has filled new bitmaps.
   * Both onStateChange branches that pre-render libAsset icons (map load,
   * markers change) call this so the player gets the freshly-decoded
   * bitmaps and the GM canvas + icon-button preview pick them up too.
   */
  private _rebroadcastMarkersWithFreshIconData(): void {
    const state = this.state.getState();
    const freshVisible   = state.markers.filter((m) => !m.hidden);
    const freshBroadcast = state.markers.filter((m) =>
      !m.hidden || m.roles.audio === 'source' || m.roles.motion === 'source');
    const freshIconData  = this._collectIconData(freshVisible);
    this.host.broadcast({
      type: 'marker_update',
      payload: freshBroadcast,
      ...(freshIconData.length > 0 ? { iconData: freshIconData } : {}),
    });
    this.markerEditor.redraw();
    this.updateMarkerPanel();
    this.renderer.markDirty();
  }

  /**
   * Prewarm iconCache + iconDataUrls with every raster library asset so
   * markers in saved bundles render immediately on first paint. Tintable
   * assets are skipped — those depend on per-marker colour and get
   * rendered lazily by _ensureLibIcons. Each raster asset is also cached
   * under the legacy 'asset:<id>' key as an alias so pre-v2.11 marker
   * icons in saved bundles keep resolving without rewriting marker.icon.
   */
  private async _preloadLibIcons(): Promise<void> {
    const all = await ImageAssetStore.getAll();
    // Tintability is cheap to remember for every library asset (regardless
    // of whether we pre-render the bitmap) — used synchronously by the
    // marker panel to decide whether to show the Colour row.
    for (const a of all) this._libAssetTintable.set(a.id, a.tintable);

    await Promise.all(all.map(async (asset) => {
      if (asset.tintable) return;
      if (asset.source === 'unicode' || asset.source === 'font') return;
      const libKey = 'libAsset:' + asset.id;
      if (this.iconCache.has(libKey)) return;
      const rendered = await renderLibIconFromAsset(asset, '#e03e3e');
      if (!rendered) return;
      this.iconCache.set(rendered.key, rendered.bitmap);
      this.iconDataUrls.set(rendered.key, rendered.dataUrl);
      const legacyKey = 'asset:' + asset.id;
      if (!this.iconCache.has(legacyKey)) {
        this.iconCache.set(legacyKey, rendered.bitmap);
        this.iconDataUrls.set(legacyKey, rendered.dataUrl);
      }
    }));
  }

  /** Drop caches and prewarm again — call after a bundle import / new pack. */
  private async _reloadLibIcons(): Promise<void> {
    this.iconCache.clear();
    this.iconDataUrls.clear();
    await this._preloadLibIcons();
  }

  /** Builds the per-call context handed to every MarkerInteraction. */
  private _interactionCtx(): InteractionContext {
    return {
      markers:   this.state.getState().markers,
      broadcast: (msg) => this.host.broadcast(msg),
    };
  }

  /** Build the current motion-tracker overlay snapshot (animated bits + static preview). */
  private _buildMotionOverlay(now: number): MotionOverlay {
    const scans = this.motionTracker.getActiveScans();
    const blobs = this.motionTracker.getActiveBlobs();
    const cfg   = this.motionTracker.getConfig();

    // Static preview ring: only when the selected marker is the tracker
    let trackerPreview: MotionOverlay['trackerPreview'] = null;
    if (this.selectedMarkerId) {
      const sel = this.state.getState().markers.find((m) => m.id === this.selectedMarkerId);
      if (sel?.roles.motion === 'tracker') {
        trackerPreview = { centre: sel.position, range: cfg.range, colour: cfg.colour };
      }
    }

    return {
      now,
      scans: scans.map((s) => ({
        startTime: s.startTime,
        centre:    s.centre,
        range:     s.range,
        speedSecs: s.speedSecs,
        colour:    s.colour,
      })),
      blobs: !cfg.hideBlobs ? blobs.map((b) => ({
        startTime: b.startTime,
        sourceId:  b.sourceId,
        position:  b.position,
        fadeMs:    b.fadeMs,
        mode:      b.mode,
        colour:    cfg.colour,
      })) : [],
      trackerPreview,
    };
  }

  /** Compose the optional audio fields for tracker_scan / tracker_blob messages.
   *  Drops fields entirely when remote audio is disabled. Always includes the
   *  dataUrl so that late-joining / refreshed players can play immediately —
   *  per-message overhead is small relative to the ping rate. */
  private _buildTrackerAudioFields(
    assetId: string | undefined,
    dataUrl: string | null,
    volume:  number,
  ): { audioAssetId?: string; audioDataUrl?: string; audioVolume?: number } {
    if (!assetId || !this.remoteAudioEnabled) return {};
    const out: { audioAssetId?: string; audioDataUrl?: string; audioVolume?: number } = {
      audioAssetId: assetId,
      audioVolume:  volume,
    };
    if (dataUrl) out.audioDataUrl = dataUrl;
    return out;
  }

  /** Load tracker ping audio from IDB, generate cached data URLs for broadcast,
   *  and feed them to the local TrackerAudioPlayer. Idempotent. */
  private async _loadTrackerAudio(): Promise<void> {
    const cfg = this.state.getState().motionTracker;
    const load = async (assetId: string | null): Promise<{ id: string | null; url: string | null }> => {
      if (!assetId) return { id: null, url: null };
      const asset = await AudioAssetStore.get(assetId);
      if (!asset) return { id: null, url: null };
      const blob = await AudioAssetStore.getBlob(asset);
      if (!blob) return { id: null, url: null };
      const url = await blobToDataUrl(blob);
      return { id: assetId, url };
    };
    const [outgoing, ret] = await Promise.all([
      load(cfg.outgoingPingAssetId),
      load(cfg.returnPingAssetId),
    ]);
    this._outgoingDataUrl = outgoing.url;
    this._returnDataUrl   = ret.url;
    this.trackerAudio.setOutgoing(outgoing.id, outgoing.url);
    this.trackerAudio.setReturn(ret.id, ret.url);
    this.trackerAudio.setOutgoingVolume(cfg.outgoingPingVolume);
    this.trackerAudio.setReturnVolume(cfg.returnPingVolume);
  }

  /** Update an Outgoing/Return ping assign button to reflect the current config. */
  private _refreshTrackerPingButton(rowSel: string, btnSel: string, assetId: string | null): void {
    const row = document.querySelector<HTMLElement>(rowSel);
    const btn = document.querySelector<HTMLButtonElement>(btnSel);
    if (!row || !btn) return;
    if (assetId) {
      row.className   = 'sb-slot-name-row';
      btn.className   = 'sb-name-btn';
      btn.textContent = '…';
      void AudioAssetStore.get(assetId).then((asset) => {
        if (btn.dataset['assetId'] === assetId || btn.textContent === '…') {
          btn.textContent = asset?.name ?? 'Unknown Sound';
        }
      });
      btn.dataset['assetId'] = assetId;
    } else {
      row.className   = 'sb-slot-empty';
      btn.className   = 'sb-assign-btn btn btn--ghost btn--sm btn--full';
      btn.textContent = '+ Assign Sound';
      delete btn.dataset['assetId'];
    }
  }

  /** One-shot overlay refresh — call when selection or tracker config changes. */
  private _pushMotionOverlay(): void {
    this.markerEditor.motionOverlay = this._buildMotionOverlay(performance.now());
    this.markerEditor.redraw();
  }

  /** Drive the motion-tracker overlay redraw loop. Idempotent — safe to call any time. */
  private _kickMotionRaf(): void {
    if (this._motionRafId !== null) return;
    const tick = (now: number) => {
      this.motionTracker.pruneFaded(now);
      const overlay = this._buildMotionOverlay(now);
      this.markerEditor.motionOverlay = overlay;
      this.markerEditor.redraw();

      // Continue while there's anything to animate
      if (overlay.scans.length > 0 || overlay.blobs.length > 0) {
        this._motionRafId = requestAnimationFrame(tick);
      } else {
        this._motionRafId = null;
        // Leave the static preview in place until selection/config changes
        if (!overlay.trackerPreview) {
          this.markerEditor.motionOverlay = null;
        }
        this.markerEditor.redraw();
      }
    };
    this._motionRafId = requestAnimationFrame(tick);
  }

  private onStateChange(state: SessionState, changed: (keyof SessionState)[]): void {
    // View state is player-only — GM always sees the full map unzoomed
    const visibleMarkers = state.markers.filter((m) => !m.hidden);
    // Audio-source markers must be broadcast even when hidden — a hidden marker
    // can represent an invisible ambient sound source (e.g. attached to a room).
    // Hidden audio sources still need to broadcast (they emit positional sound) and hidden
    // motion sources do too (the player needs the source's icon size to draw return blobs).
    const broadcastMarkers = state.markers.filter((m) =>
      !m.hidden || m.roles.audio === 'source' || m.roles.motion === 'source');
    const iconData         = this._collectIconData(visibleMarkers); // icons only for visible

    // Only send fog_update for live edits (changed = ['fog']).
    // During a map switch, loadForMap fires _notify(['map','view','filter','fog']).
    // That case is intentionally excluded here: the fog for the new map travels
    // atomically inside the map_change broadcast (sent in loadMap below), so a
    // separate fog_update is not only redundant but harmful — it arrives at the
    // player independently of map_change and can be applied to the wrong map.
    if (changed.includes('fog') && !changed.includes('map')) {
      this.renderer.updateFog(state.fog);
      // v2.12 — sync FogEditor's local polygon list so brushed polygons
      // get marching ants + interior-click selection without waiting for
      // the next map switch. Selection survives if still valid.
      this.fogEditor.syncPolygons(state.fog.polygons);
      // Selector icons for non-fog kinds redraw from state.
      this._refreshMapFXSelectors();
      // Mark in-use kinds in the dropdown with a green ● prefix.
      this._refreshKindSelectorUsage();
      this.host.broadcast({
        type: 'fog_update',
        payload: state.fog,
        ...(state.map ? { mapId: state.map.id } : {}),
      });
    }


    if (changed.includes('filter')) {
      // Honour the panel-header bypass switch — when off, the renderer
      // gets 'none' regardless of what's in state.filter.
      this.renderer.setFilter(this._effectiveFilter());
      const filterId = state.filter.filterId;
      const def = filterRegistry.getOrFallback(filterId);
      // v2.16.37 — sync the inline dropdown to match state.
      if (this.filterSelect.value !== filterId) this.filterSelect.value = filterId;
      if (filterId !== this.activeFilterId) {
        this.activeFilterId = filterId;
        // Filter switched. If the side panel is open, refresh its body
        // so the params section reflects the new filter + update title.
        this._filterSidePanel?.refresh();
        this._filterSidePanel?.setTitle(`Visual Filter — ${def.name}`);
      } else if (this._filterPanelInstance) {
        // Same filter, params changed — update values in-place on the
        // side-panel-hosted FilterPanel (no DOM rebuild).
        this._filterPanelInstance.setValues(state.filter.params[filterId] ?? {});
      }
      // Patch E — re-apply the marker-layer CSS filter on every filter
      // change (filter switch, params, toggle). Keeps the GM preview in
      // sync with what the player + projector will render.
      this._applyMarkerLayerFilter();
      // During a map switch, filter travels atomically inside map_change (below)
      // so a separate filter_update would arrive before the transition starts and
      // corrupt the snapshot.  Only broadcast standalone filter changes.
      if (!changed.includes('map')) {
        this.host.broadcast({ type: 'filter_update', payload: this._effectiveFilter() });
      }
    }

    if (changed.includes('view')) {
      this.renderer.setBackgroundColour(state.view.backgroundColor);
      // v2.16.41 — animated backdrop shader suppressed on the GM
      // canvas. It now renders only on the player + projector views
      // (where it matters) and inside the PiP preview (so the GM
      // sees what players see without running a second shader pass
      // for nothing on the main canvas). The basic background colour
      // above still applies. Drops CPU / GPU + cleans up the GM
      // workspace; the backdrop config still travels through
      // state.view.backdrop so the view_update broadcast below
      // carries it to the audience views unchanged.
      this.renderer.setBackdrop(null);
      this._refreshBgFxButtonState();
      this._updateActiveBgDisplay();
      // During a map switch, view travels inside map_change — same reasoning as
      // filter above.  Live viewport-editor drags only have 'view' in changed.
      if (!changed.includes('map')) {
        this.host.broadcast({ type: 'view_update', payload: state.view });
      }
    }

    if (changed.includes('map')) {
      // Restore the persisted transition for the newly loaded map.
      // Runs synchronously inside loadForMap's _notify call — before any subsequent
      // awaits in loadMap — so buildTransitionConfig() always sees the correct value.
      const savedTransition = state.transition;
      const newId = savedTransition?.transitionId ?? 'none';
      this.activeTransitionId = newId;
      if (savedTransition) {
        this.allTransitionParams[savedTransition.transitionId] = savedTransition.params;
      }
      this.transitionSelect.value = newId;
      // v2.16.38 — if the side panel is open, refresh its body so the
      // params section reflects the newly-loaded map's saved transition.
      const def = transitionRegistry.getOrFallback(newId);
      this._transitionSidePanel?.setTitle(`Map Transition — ${def.label}`);
      this._transitionSidePanel?.refresh();

      // Map loads bring their markers along, but loadForMap only emits a
      // ['map', 'view', 'filter', 'fog'] notify — no 'markers' — so the
      // pre-render below won't fire from the markers branch. Kick off
      // libAsset bitmap rendering here too, otherwise tintable icons
      // (which are colour-dependent and not in the preload pass) draw as
      // fallback circles until the user nudges the marker.
      void this._ensureLibIcons(broadcastMarkers).then((added) => {
        if (added) this._rebroadcastMarkersWithFreshIconData();
      });
      // v2.12 — clear any existing selection on map switch; the fog state
      // arrives via the 'fog' branch above.
      this.selectedOverlayId = null;
      // Map switch carries a fresh fog state inside the same notify
      // (which suppresses the standalone fog branch above), so the
      // kind-dropdown in-use markers won't refresh from there —
      // refresh them here instead.
      this._refreshKindSelectorUsage();
      // v2.16.49 — Players panel rows show per-player "placed-on-this-map"
      // state via info.placed. Re-render so the marker pin glyph reflects
      // the NEW map's placements; otherwise the icon read stale across
      // map switches.
      this._refreshPlayersPanel();
    }

    if (changed.includes('markers')) {
      this.markerEditor.update(state.markers, this.mapAspectRatio);
      this.updateMarkerPanel();
      this.interactions.notifyMarkersChanged(this._interactionCtx());
      // v2.17.34 — refresh the initiative tracker only when a marker's IDENTITY
      // (name / icon / colour) changes, so a linked threat card stays current
      // without churning on every position drag.
      const identitySig = state.markers.map((m) => `${m.id}:${m.label}:${m.icon}:${m.color}`).join('|');
      if (identitySig !== this._markerIdentitySig) {
        this._markerIdentitySig = identitySig;
        this.initiativeTracker?.refresh();
      }
      this.host.broadcast({
        type: 'marker_update',
        payload: broadcastMarkers,
        ...(iconData.length > 0 ? { iconData } : {}),
      });
      // libAsset: bitmaps render lazily. If any of the just-broadcast
      // markers reference a library icon that wasn't in cache yet, the
      // immediate broadcast will have missed it (the player will draw
      // a fallback circle). Kick off the async render and re-broadcast
      // once the cache has caught up so the player updates.
      void this._ensureLibIcons(broadcastMarkers).then((added) => {
        if (added) this._rebroadcastMarkersWithFreshIconData();
      });
    }

    if (changed.includes('audio') && !changed.includes('map')) {
      this.soundboardPanel.update(state.audio.slots);
      this.host.broadcast({ type: 'audio_update', payload: state.audio });
    }

    if (changed.includes('motionTracker') || changed.includes('map')) {
      this.motionTracker.setConfig(state.motionTracker);
      void this._loadTrackerAudio();
      this._pushMotionOverlay();
    }

    void this.soundboardPanel.getActiveSlots().then((active) => {
      this.host.updateState(state, this.currentMapBlob ?? undefined, iconData, active);
    });
  }

  // ─── Map selection ────────────────────────────────────────────────────────

  private async populateMapList(): Promise<void> {
    const [maps, session, mapAssets] = await Promise.all([
      this.maps.getAll(),
      loadSession(),
      MapAssetStore.getAll(),
    ]);
    // Per-asset kind lookup so we can flag text-map and animated
    // entries in the dropdown with the right leading glyph. Cheap
    // (small N) and saves a round-trip per option.
    // (v2.18: derived by _dropdownKindForAsset — the ONE kind rule — rather
    //  than a second inline copy that had to be kept in step with it.)
    const kindByAssetId = new Map<string, MapDropdownKind>();
    for (const a of mapAssets) kindByAssetId.set(a.id, _dropdownKindForAsset(a));
    // v2.18 — pre-warm hint: if the pack holds any StarMap, viewers mount the
    // SSE view hidden at connect so the first cut into it is instant.
    const firstStarMap = mapAssets.find((a) => a.source === 'starmap' && a.starMap)?.starMap;
    this.host.setLastStarMapPrewarm(firstStarMap
      ? { origin: Sse2Bridge.normaliseOrigin(firstStarMap.origin), sessionId: firstStarMap.sessionId }
      : null);
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
      // Text-map (handout) rows get a small monochrome "hamburger"
      // glyph (≡) before the name. The closed <select> view only
      // ever shows the selected option's plain text, so styling
      // (italic, colour) gets stripped by every browser; a glyph
      // inside the textContent survives that. Subtle, single
      // character, monospace-friendly, sorts neutrally (we strip it
      // before localeCompare).
      // Strip both the legacy " [T]" decoration AND any stray
      // leading "≡ " from m.name before re-adding — defensive against
      // any path that might have round-tripped the marker into
      // storage. Keeps the visual layer the only source of truth.
      // v2.14.60 — fallback to 'missing' (not 'image') when the asset
      // can't be resolved; surfaces broken rows with the hazard prefix
      // + orange tint via EditableSelect rather than masquerading as
      // a normal image map and failing on load.
      const kind = kindByAssetId.get(m.mapAssetId) ?? 'missing';
      const cleanName = _cleanMapDisplayName(m.name);
      const prefix = _prefixForKind(kind);
      opt.textContent = `${prefix}${cleanName}`;
      if (kind === 'missing') {
        opt.dataset['missing'] = 'true';
        opt.title = 'The map image for this entry is missing from your library — it was probably deleted, or this came from a bundle that didn\'t include the asset. Add the original image back to the library (same filename) to restore it.';
      }
      this.mapSelect.appendChild(opt);
    }

    // v2.16.34 — sentinel "+ Add New Map" option retired. The
    // discoverable "+" button beside the dropdown is the affordance now
    // (bound in bindUIControls → #add-map-btn). The SELECT_ADD_SENTINEL
    // branch in the change handler stays as a defensive no-op so any
    // cached UI that still emits it doesn't crash.

    if (maps.length > 0) {
      const last = session?.lastMapId ? (maps.find((m) => m.id === session.lastMapId) ?? maps[0]!) : maps[0]!;
      this.mapSelect.value = last.id;
      this._lastMapSelectValue = last.id;
      this.mapEditableSelect?.refresh();
      // v2.17.1 — only (re)load if the selected map isn't already active.
      // _editCurrentTextMap loadMap()s the edited handout and THEN calls
      // populateMapList to refresh the dropdown; without this guard that
      // second loadMap re-ran the reveal animation a second time.
      if (this.state.snapshot().map?.id !== last.id) {
        await this.loadMap(last);
      }
      this._setEmptyCanvasVisible(false);
    } else {
      this._lastMapSelectValue = '';
      this.mapEditableSelect?.refresh();
      // No maps in the workspace — the renderer leaves the last-opened map's
      // texture mounted, so cover it with the empty-canvas state rather than
      // stranding an orphaned map on the table.
      this._setEmptyCanvasVisible(true);
    }
  }

  /** Toggle the "no maps yet" empty-canvas overlay (Mappadux logo + a nudge
   *  toward the green + button). Opaque, so it masks whatever stale map
   *  texture the renderer still has mounted. */
  private _setEmptyCanvasVisible(show: boolean): void {
    const el = document.getElementById('empty-canvas');
    if (!el) return;
    el.hidden = !show;
    el.setAttribute('aria-hidden', show ? 'false' : 'true');
  }

  /** Single click handler for the Start / Cancel / Reset button.
   *  Dispatches to the right action based on the current animation
   *  lifecycle state. */
  private async _onAnimationButtonClick(): Promise<void> {
    switch (this._animationButtonState) {
      case 'idle':    return this._triggerHandoutReveal();
      case 'running': return this._cancelHandoutReveal();
      case 'done':    return this._resetHandoutReveal();
    }
  }

  /** Apply a button-state transition: update label + colour, store
   *  the new state, and clear any pending auto-progression timer. */
  private _setAnimationButtonState(state: 'idle' | 'running' | 'done'): void {
    this._animationButtonState = state;
    if (this._animationDoneTimer !== null) {
      clearTimeout(this._animationDoneTimer);
      this._animationDoneTimer = null;
    }
    const btn = this.startAnimationBtn;
    if (!btn) return;
    btn.classList.remove('btn--primary', 'btn--ghost');
    switch (state) {
      case 'idle':
        btn.textContent = '▶ Start Animation';
        btn.classList.add('btn--primary');
        btn.title = 'Trigger the handout reveal animation on the player + projector';
        break;
      case 'running':
        btn.textContent = '■ Cancel Animation';
        btn.classList.add('btn--ghost');
        btn.title = 'Skip to the end of the reveal (instant cut to final frame)';
        break;
      case 'done':
        btn.textContent = '↻ Reset Animation';
        btn.classList.add('btn--ghost');
        btn.title = 'Return to the starting frame so the reveal can play again';
        break;
    }
  }

  /** Skip the reveal: broadcast a handout_reveal with transition=none,
   *  which makes the receivers cut straight to the final frame. The
   *  bar disappears immediately. */
  private async _cancelHandoutReveal(): Promise<void> {
    const currentId = this.state.snapshot().map?.id;
    if (!currentId) return;
    const finalBlob = await this.maps.getBlob(currentId);
    if (!finalBlob) return;
    this.host.broadcast({
      type: 'handout_reveal',
      mapId: currentId,
      transition: { transitionId: 'none', params: {} },
      mapBlob: finalBlob,
    });
    if (this.revealProgressEl) this.revealProgressEl.hidden = true;
    this._setAnimationButtonState('done');
  }

  /** Send receivers back to the starting frame. Re-broadcasts the
   *  current map (which carries the starting frame for animated
   *  handouts via the loadMap broadcast/local divergence). Suppresses
   *  the autoReveal auto-fire so the GM has a chance to click Start
   *  again rather than getting an immediate replay. */
  private async _resetHandoutReveal(): Promise<void> {
    const currentId = this.state.snapshot().map?.id;
    if (!currentId) return;
    const storedMap = await getMap(currentId);
    if (!storedMap) return;
    this._suppressAutoReveal = true;
    await this.loadMap(storedMap);
    this._setAnimationButtonState('idle');
  }

  /** Kick off the handout reveal animation on every connected player +
   *  projector. The GM's own canvas already shows the FINAL frame so
   *  no local texture swap is needed — we just broadcast and show a
   *  progress bar that empties over the configured duration so the GM
   *  knows the animation is in flight. */
  private async _triggerHandoutReveal(): Promise<void> {
    const currentId = this.state.snapshot().map?.id;
    if (!currentId) return;
    const storedMap = await getMap(currentId);
    if (!storedMap) return;
    const asset = await MapAssetStore.get(storedMap.mapAssetId);
    if (!asset || asset.source !== 'text-map' || !asset.textMap?.animation?.enabled) return;

    const finalBlob = await this.maps.getBlob(currentId);
    if (!finalBlob) return;

    const anim = asset.textMap.animation;
    const transitionDef = transitionRegistry.getOrFallback(anim.transitionId);
    const transition: TransitionConfig = {
      transitionId: anim.transitionId,
      params: { ...transitionDef.params.reduce<Record<string, number | string>>((acc, p) => {
        acc[p.id] = p.default; return acc;
      }, {}), ...anim.params },
    };
    // Pull a duration from the picked transition's params for the local
    // progress bar — every handout-suitable transition exposes a
    // `duration` param in ms. Falls back to a sensible default if the
    // picked transition omits it.
    const durationMs = typeof transition.params['duration'] === 'number'
      ? transition.params['duration'] as number
      : 2000;

    this.host.broadcast({
      type: 'handout_reveal',
      mapId: currentId,
      transition,
      mapBlob: finalBlob,
    });
    this._showRevealProgress(durationMs);
    this._setAnimationButtonState('running');
    // Auto-progress to "done" when the reveal duration elapses, so the
    // button switches to Reset without GM input. Cancel clears this
    // timer in _setAnimationButtonState.
    this._animationDoneTimer = setTimeout(() => {
      this._setAnimationButtonState('done');
    }, durationMs + 50);
  }

  /** Show the GM-side progress bar for the reveal animation. The bar
   *  width animates from 100% → 0% over `durationMs`, then the whole
   *  overlay hides. Purely informational — Alex's spec: GM doesn't
   *  see the reveal itself, just a progress indicator. */
  private _showRevealProgress(durationMs: number): void {
    if (!this.revealProgressEl || !this.revealProgressBarEl) return;
    this.revealProgressEl.hidden = false;
    const bar = this.revealProgressBarEl;
    // Reset bar to 100% width with no transition, then animate to 0%
    // over the configured duration on the next frame.
    bar.style.transition = 'none';
    bar.style.width = '100%';
    requestAnimationFrame(() => {
      bar.style.transition = `width ${durationMs}ms linear`;
      bar.style.width = '0%';
    });
    setTimeout(() => {
      if (this.revealProgressEl) this.revealProgressEl.hidden = true;
    }, durationMs + 50);
  }

  /** Open the Text Map editor for the currently displayed handout.
   *  Wired to the inline Edit button next to the Name field — only
   *  visible when the active map is a text-map (set in loadMap below).
   *  On save the editor preserves the asset id and clears the
   *  rasterisation cache, so we just need to re-fetch the blob and
   *  repaint the texture. */
  /** v2.14.42 — open the Composite Map editor on the active map. */
  private async _editCurrentCompositeMap(): Promise<void> {
    const currentId = this.state.snapshot().map?.id;
    if (!currentId) return;
    const storedMap = await getMap(currentId);
    if (!storedMap) return;
    const asset = await MapAssetStore.get(storedMap.mapAssetId);
    if (!asset || asset.source !== 'composite-map') return;
    const { CompositeMapEditor } = await import('./CompositeMapEditor.ts');
    // v2.14.43 — wire "+ Add Map" through the existing MapAssetModal
    // in tile-add mode. Returns the picked MapAsset (or null on
    // cancel) to the editor, which appends a tile.
    const pickAsset = (opts?: { hasScaledMaster?: boolean }): Promise<typeof asset | null> => new Promise((resolve) => {
      this.mapAssetModal.openForCompositeAddTile((picked) => resolve(picked), opts);
    });
    const updated = await new CompositeMapEditor().open(asset, { pickAsset });
    if (!updated) return; // cancel — no mutation
    // v2.14.49 — re-rasterise the composite + persist its output
    // dimensions + pps so viewers' calibration math (Scaled View
    // crop, grid spacing) lines up. The blob itself is cached in
    // MapAssetStore.runtimeBlobs by rasterizeComposite, so this is
    // just metadata that lets the renderer + grid logic compute
    // correctly without going through the rasteriser themselves.
    const { rasterizeComposite, rasterizeRevealBacking } = await import('../maps/rasterizeComposite.ts');
    MapAssetStore.invalidateRuntimeCache(asset.id);
    const raster = await rasterizeComposite(updated);
    // v2.14.70 — also rasterise the reveal-layer backing (composite
    // minus the topmost tile) so the renderer can show it through
    // alpha holes punched by the Reveal Map Layer brush. Skipped
    // when the composite has only one tile (nothing to reveal).
    const backing = await rasterizeRevealBacking(updated);
    if (backing) updated.revealBackingBlob = backing.blob;
    else         delete updated.revealBackingBlob;
    if (raster) {
      MapAssetStore.runtimeBlobs.set(asset.id, raster.blob);
      updated.imageWidth      = raster.imageWidth;
      updated.imageHeight     = raster.imageHeight;
      // v2.14.55 — also persist the composite's grid origin offset
      // so viewer drawGrid aligns with the master tile's calibrated
      // grid (rather than starting at the output's top-left corner).
      updated.gridOffsetX     = raster.gridOffsetX;
      updated.gridOffsetY     = raster.gridOffsetY;
      if (raster.pixelsPerSquare !== null) {
        updated.pixelsPerSquare = raster.pixelsPerSquare;
        // v2.14.53 — full 'scaled' pill. The GM has actively placed +
        // saved the tiles via the editor; that's more deliberate than
        // an inference from a filename hint. Unscaled tile maps that
        // get placed into a scaled composite inherit the master pps
        // through composition — i.e. the GM HAS scaled them.
        updated.scaleConfidence = 'scaled';
      }
    }
    const { saveMapAsset } = await import('../storage/db.ts');
    await saveMapAsset(updated);

    // v2.14.88 — Inferred-scaling for every non-master tile in the
    // composite. Once a master tile is on the canvas its cell pitch
    // is known; every other tile's natural pixels-per-square can be
    // derived from the master + the tile's scale + image dimensions.
    // Write that back to each tile asset with scaleConfidence='inferred'
    // so the library row shows the amber "Inferred" pill — the GM
    // can verify or hand-calibrate any tile that looks off.
    // Skips tiles that already have manual/scaled confidence (don't
    // clobber the GM's own work) and tiles with unlocked aspect
    // (non-square source cells can't be expressed as a single pps).
    await this._inferTileScalesFromComposite(updated);

    // v2.14.53 — propagate the asset's filename into the StoredMap
    // so the dropdown + Name input reflect any rename done in the
    // editor. Mirrors the text-map edit flow.
    if (storedMap.name !== updated.filename) {
      await saveMap({ ...storedMap, name: updated.filename });
    }
    const refreshed = await getMap(currentId);
    if (refreshed) await this.loadMap(refreshed);
    // v2.14.54 — refresh the dropdown so a rename in the editor
    // shows up without a page reload. Mirrors the text-map flow.
    await this.populateMapList();
  }

  /** v2.14.88 — Walk every non-master tile of a composite map and
   *  persist an inferred pixelsPerSquare derived from the master
   *  tile's calibration + each tile's scale. Only touches tiles
   *  whose current scaleConfidence is undefined / inferred /
   *  auto-scaled (low-trust); tiles the GM manually calibrated keep
   *  their existing value. Tiles with unlocked aspect (scaleY set)
   *  are skipped — a single pps assumes square source cells. */
  private async _inferTileScalesFromComposite(asset: import('../types.ts').MapAsset): Promise<void> {
    const tiles = asset.compositeTiles ?? [];
    if (tiles.length < 2) return;
    // Find the first tile whose underlying asset has a pps — that's
    // the master (sets the composite's grid pitch).
    let masterTile: import('../types.ts').CompositeTile | null = null;
    let masterAsset: import('../types.ts').MapAsset | null = null;
    for (const t of tiles) {
      const a = await MapAssetStore.get(t.mapAssetId);
      if (a?.pixelsPerSquare && a.imageWidth) {
        masterTile = t;
        masterAsset = a;
        break;
      }
    }
    if (!masterTile || !masterAsset?.pixelsPerSquare || !masterAsset.imageWidth) return;
    const masterPps   = masterAsset.pixelsPerSquare;
    const masterScale = masterTile.scale ?? 1;
    const masterImgW  = masterAsset.imageWidth;
    for (const tile of tiles) {
      if (tile === masterTile) continue;
      // Unlocked-aspect tiles → non-square source cells in the
      // composite frame → can't be summarised as a single pps.
      if (tile.scaleY != null) continue;
      const tileAsset = await MapAssetStore.get(tile.mapAssetId);
      if (!tileAsset?.imageWidth) continue;
      // Preserve GM's manual / high-trust calibration.
      const conf = tileAsset.scaleConfidence;
      if (conf === 'manual' || conf === 'scaled') continue;
      // Formula: setting the tile's source-cell pitch to match the
      // master's cell pitch on the composite canvas gives
      //   pps_T = (scale_master * pps_master * imageWidth_T)
      //         / (scale_T      * imageWidth_master)
      const tileScale = tile.scale ?? 1;
      const inferred = (masterScale * masterPps * tileAsset.imageWidth)
                     / (Math.max(0.001, tileScale) * masterImgW);
      const rounded = Math.max(1, Math.round(inferred));
      await MapAssetStore.update(tileAsset.id, {
        pixelsPerSquare: rounded,
        scaleConfidence: 'inferred',
      });
    }
  }

  private async _editCurrentTextMap(): Promise<void> {
    const currentId = this.state.snapshot().map?.id;
    if (!currentId) return;
    const storedMap = await getMap(currentId);
    if (!storedMap) return;
    const asset = await MapAssetStore.get(storedMap.mapAssetId);
    if (!asset || asset.source !== 'text-map') return;
    const result = await new TextMapEditor().open({ existing: asset });
    if (!result) return;
    MapAssetStore.invalidateRuntimeCache(asset.id);
    // Propagate the asset's new filename into the StoredMap so the
    // dropdown + the Name input under it reflect the new name. The
    // editor only touches the asset record; the StoredMap.name is
    // what GMApp reads when rendering both surfaces.
    if (storedMap.name !== result.asset.filename) {
      await saveMap({ ...storedMap, name: result.asset.filename });
    }
    const refreshed = await getMap(currentId);
    if (refreshed) await this.loadMap(refreshed);
    await this.populateMapList();
  }

  private async loadMap(map: StoredMap): Promise<void> {
    // A real map is coming in — make sure the empty-canvas state is down.
    this._setEmptyCanvasVisible(false);
    // Abandon any in-flight ruler — its anchor belongs to the outgoing map.
    this.measureTool?.cancel();
    // Detect "same map reload" — e.g. after editing a handout, applying
    // a Fix Missing Map, or re-loading after a retarget. The broadcast
    // map_change shouldn't replay the entry transition in that case.
    const previousMapId = this.state.snapshot().map?.id;
    const isReload = previousMapId === map.id;
    if (isReload) this._suppressNextMapTransition = true;
    // v2.14.108 — Reset GM-canvas undo on every real map switch:
    // snapshots from the outgoing map can't safely re-apply onto
    // the incoming one. Same-map reloads keep history.
    if (!isReload && this.undoMgr) this.undoMgr.clear();
    // Compute the entry transition's duration NOW so the autoReveal
    // delay later in this function can wait the right amount of time
    // for the player to finish the map→map transition before the
    // handout reveal fires. buildTransitionConfig down in the
    // broadcast consumes the suppress flag, so reading it here keeps
    // the calculation honest.
    const entryTransitionMs = this._computeEntryTransitionDurationMs(isReload);
    // Flush any unsaved state from the previous map before switching
    await this.state.flushSave();
    this.setStatus(`Loading ${map.name}…`, 'ok');
    this.mapEditableSelect.refresh();
    this.activeFilterId = ''; // force panel rebuild for new map's saved filter
    // Show the inline "Edit" button next to the Name field iff this is a
    // text-map handout — gives a one-click route into the editor without
    // hunting through the Add Map library.
    const mapAssetForButton = await MapAssetStore.get(map.mapAssetId);
    const isTextMap = mapAssetForButton?.source === 'text-map';
    const isComposite = mapAssetForButton?.source === 'composite-map';
    const hasReveal = isTextMap && mapAssetForButton?.textMap?.animation?.enabled === true;
    // v2.16.91 — live YouTube video overlay for this map. Extract the
    // text-map's video elements (empty for non-text-maps), render them on
    // the GM, and broadcast to players + projector.
    this._currentTextMapVideos = (mapAssetForButton?.textMap?.elements ?? [])
      .filter((e): e is import('../types.ts').TextMapVideoElement => e.type === 'video');
    this.textMapVideoLayer?.setVideos(this._currentTextMapVideos);
    // v2.17.26 — build the handout's screen-reader content: each text block's
    // words, and each image's alt (authored, or the asset name as fallback).
    // Empty for non-text-maps. Positions ride along so the SR region can read
    // in page order.
    const altItems: TextMapAltItem[] = [];
    for (const e of (mapAssetForButton?.textMap?.elements ?? [])) {
      if (e.type === 'text') {
        altItems.push({ x: e.x, y: e.y, w: e.w, h: e.h, text: plainText(e.html) });
      } else if (e.type === 'image') {
        let alt = (e.alt ?? '').trim();
        if (!alt) alt = (await ImageAssetStore.get(e.assetId))?.name ?? '';
        if (alt) altItems.push({ x: e.x, y: e.y, w: e.w, h: e.h, text: alt });
      }
    }
    this._currentAltItems = altItems;
    this.textMapAltText?.setItems(altItems);
    // Mirror the video path: cache on the Host so the alt content rides in
    // every new connection's full_state, and broadcast it live to players +
    // projector so their screen-reader region announces this handout too.
    this.host.setLastTextMapAlt(altItems);
    this.host.broadcast({ type: 'textmap_alt', items: altItems });
    // v2.16.100 — cache on the Host so the videos ride in EVERY new
    // connection's full_state (incl. the BroadcastChannel one a same-browser
    // preview / pop-out requests on open), not just this live broadcast.
    this.host.setLastTextMapVideos(this._currentTextMapVideos);
    this.host.broadcast({ type: 'textmap_videos', videos: this._currentTextMapVideos });
    if (this.editTextMapBtn)   this.editTextMapBtn.hidden   = !isTextMap;
    if (this.editCompositeBtn) this.editCompositeBtn.hidden = !isComposite;
    // Show the Start Animation button only when this handout has a
    // reveal animation configured. Hidden in every other case.
    // Reset to 'idle' state (Start Animation label) — every fresh map
    // load starts the lifecycle over.
    if (this.startAnimationBtn) {
      this.startAnimationBtn.hidden = !hasReveal;
      this._setAnimationButtonState('idle');
    }
    if (this.revealProgressEl) this.revealProgressEl.hidden = true;
    // v2.18 — StarMap: a live external view, no image. Its own path (state load,
    // discovery, broadcast, preview) — everything below assumes a texture.
    if (mapAssetForButton?.source === 'starmap' && mapAssetForButton.starMap) {
      await this._loadStarMap(map, mapAssetForButton.starMap);
      return;
    }
    if (this._activeStarMap) this._leaveStarMap(); // an ordinary map ends StarMap mode
    const fileBlob = await this.maps.getBlob(map.id);
    if (!fileBlob) { this.setStatus('Map blob not found', 'error'); return; }

    // v2.12.x animated-map delivery — split-render strategy:
    //   • GM canvas: gets the FULL video. The GM is staring at this
    //     window; it's the one that needs to animate. File is local,
    //     so no transfer overhead.
    //   • Same-browser peers (player popups, same-machine projector):
    //     get only the first-frame snapshot via map_change. Host
    //     suppresses video_bundle over LocalChannel so they don't
    //     fight the GM for Chrome's per-window decoder budget.
    //   • Remote PeerJS peers (phone, separate-device player): get
    //     the snapshot first, then the video_bundle follow-up over
    //     the wire. They have their own browser process and decode
    //     budget — animation works fine.
    let snapshotBlob: ArrayBuffer = fileBlob;       // What we broadcast (always the snapshot for video maps).
    const localBlob:  ArrayBuffer = fileBlob;       // What the GM canvas renders (full video for video maps).
    this._pendingVideoBundle = null;
    if (_sniffIsVideo(fileBlob)) {
      try {
        const isWebm = new Uint8Array(fileBlob.slice(0, 1))[0] === 0x1a;
        const videoMime = isWebm ? 'video/webm' : 'video/mp4';
        const snap = await extractFirstFrameSnapshot(new Blob([fileBlob], { type: videoMime }));
        snapshotBlob = await snap.arrayBuffer();
        // Stash the full video bytes for the follow-up video_bundle
        // broadcast; remote peers swap from snapshot to VideoTexture
        // when this lands. Same-browser peers never see it (Host
        // skips LocalChannel for this message type).
        this._pendingVideoBundle = {
          mapId:    map.id,
          buffer:   fileBlob,
          mimeType: videoMime,
        };
      } catch (err) {
        // Snapshot extraction failed — fall through and let everyone
        // (including the GM's broadcast path) operate on the full
        // file. Worst case is the pre-v2.12 behaviour.
        console.warn('[GMApp] video snapshot failed; falling back to full broadcast', err);
      }
    }

    // For animated handouts the player + projector receive the STARTING
    // frame initially (background + noAnimate elements). They wait at
    // that state until the GM clicks Start Animation, at which point
    // we broadcast a handout_reveal carrying the final frame. The GM's
    // own canvas always loads the FINAL frame — Alex's spec: GM
    // doesn't need to see the transition; a progress bar at trigger
    // time indicates animation is in flight.
    let broadcastBlob: ArrayBuffer = hasReveal
      ? (await this.maps.getStartingFrameBlob(map.id) ?? snapshotBlob)
      : snapshotBlob;
    const blob = localBlob; // for local renderer.loadMap below — GM canvas animates
    this.currentMapBlob = broadcastBlob;

    // v2.14.54 — composite wire format. Instead of broadcasting the
    // GM-rasterised composite PNG (which hit the pixel-budget cap +
    // chewed bandwidth), pack each unique tile's bytes into a single
    // ArrayBuffer + ship composite metadata. Viewers unpack and
    // rasterise locally via rasterizeFromTiles. Same output;
    // bandwidth scales with unique tile bytes rather than the
    // composite PNG; viewers get crisp render at their own scale.
    let compositePayload: import('../types.ts').CompositeWirePayload | undefined;
    if (isComposite && mapAssetForButton) {
      const { packCompositeForBroadcast } = await import('../maps/compositeWireFormat.ts');
      const packed = await packCompositeForBroadcast(mapAssetForButton);
      if (packed) {
        broadcastBlob   = packed.binary;
        compositePayload = packed.wire;
      }
    }

    // Clear old-map fog immediately so it never appears on the new map's
    // texture, even during the async decode window.  The correct fog for the
    // new map is redrawn once the texture decode completes inside renderer.loadMap.
    this.renderer.clearFog();

    // Load state BEFORE starting the texture load so lastFogState is already
    // correct when the texture callback fires and recreates the FogCompositor.
    // Note: _notify(['map','view','filter','fog']) fires here, but onStateChange
    // deliberately skips fog_update broadcasts when 'map' is in changed (above).
    // Pass the BROADCAST blob (start frame for animated handouts; final
    // frame otherwise) so player + projector display the correct
    // initial state. The GM's local renderer.loadMap below uses the
    // FINAL blob so the GM canvas shows the end state directly.
    const hasSavedConfig = await this.state.loadForMap({ id: map.id, name: map.name }, broadcastBlob);

    // Auto-sample the top-left pixel as the bg colour, but ONLY on a
    // map's first ever load (no saved config in IDB). Re-running this
    // on every reload would clobber a user's explicit pick — including
    // an explicit black on a non-transparent map, and red/blue/etc on
    // a transparent textmap (where the sample always reads black
    // because alpha=0 pixels decode as RGB 0,0,0). We also skip the
    // write when the top-left pixel was transparent: the answer would
    // be a meaningless '#000000' and the default already is black.
    if (!hasSavedConfig) {
      const sample = await this.sampleTopLeftPixel(blob);
      if (sample.opaque) {
        const v = this.state.getState().view;
        this.state.setView({ ...v, backgroundColor: sample.hex });
      }
    }

    this.fogEditor.loadState(this.state.getState().fog);
    this.syncView(this.state.getState());
    this.filterSelect.value = this.state.getState().filter.filterId;
    // v2.16.37 — affect-markers toggle moved to the side panel; nothing
    // to sync inline. Side panel rebuilds its body each open from state.
    this._applyMarkerLayerFilter();
    // Transition UI is restored in onStateChange (changed.includes('map')) — synchronous
    // within loadForMap's _notify call, so activeTransitionId is already correct here.

    // Capture fog state after loadForMap so the correct state is used everywhere
    const fog = this.state.getState().fog;

    // Update fog + viewport + marker aspect ratios once the texture dimensions are known
    this.renderer.onMapLoaded = (aspect) => {
      this.mapAspectRatio = aspect;
      this.fogEditor.setMapAspect(aspect);
      this.viewportEditor.setMapAspect(aspect);
      this.projectorEditor.setMapAspect(aspect, true);
      this.markerEditor.update(this.state.getState().markers, aspect);
      this.motionTracker.setMapAspect(aspect);
      this.updateMarkerPanel();
      this._refreshRectOverlays();
      // Push the loaded map's calibration + intrinsic width to the projector
      // editor so it can size its rectangle correctly.
      void this.refreshProjectorMapInfo();
    };

    // v2.14.70 — Reveal-layer backing buffer. Present iff the active
    // composite map has overlapping tiles + the editor computed a
    // "minus topmost tile" rasterise on save. Passed through to the
    // renderer so it can mount a backing plane behind the main map;
    // Reveal Map Layer brushes punch the main map's alpha + the
    // backing shows through. Non-composite maps + composites without
    // overlaps pass undefined and the renderer skips the backing.
    let backingBuffer: ArrayBuffer | undefined;
    if (mapAssetForButton?.revealBackingBlob) {
      backingBuffer = await mapAssetForButton.revealBackingBlob.arrayBuffer();
    }

    // Pass fog explicitly so the texture-load callback always redraws the right
    // fog even if another loadMap call races ahead of this one's decode.
    this.renderer.loadMap(blob, fog, backingBuffer);

    // Clear the status bar on a successful load. The map name was
    // duplicated here while loadMap completed, but the active map
    // name is already shown in the Map Selection dropdown at the top
    // of the sidebar — no need to repeat it at the bottom edge too.
    this.setStatus('', 'ok');

    // Auto-reveal: if this handout has the reveal animation set to
    // autoReveal, fire it once after the map_change message has had a
    // chance to settle on the receivers. 350 ms is enough for the
    // chunked mapBlob to arrive over WebRTC + the receiver's
    // renderer.loadMap to complete. Manual reveal (autoReveal=false)
    // waits for the GM to click Start Animation.
    if (hasReveal && mapAssetForButton?.textMap?.animation?.autoReveal === true) {
      // Reset (manual replay) suppresses auto-fire so the GM gets a
      // chance to click Start themselves instead of getting an
      // immediate replay.
      if (this._suppressAutoReveal) {
        this._suppressAutoReveal = false;
      } else {
        // Wait for the player's map→map entry transition to finish
        // BEFORE firing the reveal — otherwise the reveal animation
        // overlaps the entry transition and looks like a single
        // jumbled effect. 600 ms buffer covers chunked-blob delivery
        // over WebRTC + texture decode + the first paint frame.
        const delayMs = entryTransitionMs + 600;
        setTimeout(() => { void this._triggerHandoutReveal(); }, delayMs);
      }
    }

    // Show / hide the Fix Missing Map button based on whether the asset blob
    // actually came back. The placeholder is rendered at this point if not.
    const missing = await this.maps.isAssetMissing(map.id);
    const fixBtn  = document.querySelector<HTMLButtonElement>('#fix-missing-map-btn');
    if (fixBtn) fixBtn.hidden = !missing;

    // Persist last-opened map so it reopens on next page load
    void loadSession().then((s) => {
      if (s) void saveSession({ ...s, lastMapId: map.id });
    });

    // Reset every marker interaction's per-map state (positional audio engine, etc.)
    this.interactions.reset();
    this.soundboardPanel.stopAll();
    this.soundboardPanel.update(this.state.getState().audio.slots);

    // Broadcast new map to all connected players.
    // fog, filter, view, markers, and audio all travel atomically inside map_change.
    const allMarkers        = this.state.getState().markers;
    const visibleMarkers    = allMarkers.filter((m) => !m.hidden);
    const broadcastMarkers2 = allMarkers.filter((m) =>
      !m.hidden || m.roles.audio === 'source' || m.roles.motion === 'source');
    const markerIconData    = this._collectIconData(visibleMarkers);
    const soundboardActive  = await this.soundboardPanel.getActiveSlots();
    // Pull asset metadata so projector windows can size their crop correctly.
    const asset = await this.maps.getAsset(map.id);
    // Pull the new map's projector viewport so the projector window applies
    // its rotation / mode / grid / filter-toggle atomically with the map
    // swap. Fall back to defaults when this map's config never saved one,
    // so the projector resets to a clean state rather than inheriting the
    // previous map's rotation.
    const nextProjVp = this.state.getState().projectorViewport ?? defaultProjectorViewport();
    this.host.broadcast({
      type: 'map_change',
      payload:    { id: map.id, name: map.name },
      fog,
      filter:     this._effectiveFilter(),
      view:       this.state.getState().view,
      markers:    broadcastMarkers2,
      audio:      this.state.getState().audio,
      ...(markerIconData.length > 0    ? { iconData:         markerIconData    } : {}),
      ...(soundboardActive.length > 0  ? { soundboardActive: soundboardActive } : {}),
      ...(asset?.pixelsPerSquare       ? { mapPixelsPerSquare: asset.pixelsPerSquare } : {}),
      ...(asset?.imageWidth            ? { mapImageWidth:      asset.imageWidth     } : {}),
      ...(asset?.imageHeight           ? { mapImageHeight:     asset.imageHeight    } : {}),
      ...(asset?.gridOffsetX           ? { gridOffsetX:        asset.gridOffsetX    } : {}),
      ...(asset?.gridOffsetY           ? { gridOffsetY:        asset.gridOffsetY    } : {}),
      projectorViewport: nextProjVp,
      // For animated handouts, the broadcast carries the STARTING frame
      // (background + noAnimate elements) so the player + projector
      // display the pre-reveal state. The handout_reveal message
      // delivered separately on Start Animation carries the final
      // frame for the transition. broadcastBlob computed above is
      // either the starting frame (handouts with animation enabled)
      // or the final frame (everything else).
      mapBlob:    broadcastBlob,
      // v2.14.54 — present iff this is a composite map.
      ...(compositePayload ? { composite: compositePayload } : {}),
      transition: this.buildTransitionConfig(),
    });

    // v2.17 Player Voice — refresh the active map's player tokens (maps aren't
    // connected, so each map shows only the tokens placed on it).
    this._liveMarkerPos.clear();
    this._markerMoveOrigin.clear();
    this._refreshPlayerMarkers();
    // v2.16.76 — load this map's annotations (clocks + whiteboard) and
    // broadcast them; annotations are per-map.
    this.annotate?.setMap(this._activeMapId() ?? null);

    // v2.12.x — if this map is a video asset and we have its full
    // bytes queued, send the bundle as a separate follow-up so
    // receivers can swap their static snapshot for the animated
    // VideoTexture once it lands. Pushed to the same broadcast
    // channel so PeerJS / BroadcastChannel deliver it after the
    // map_change has been processed.
    if (this._pendingVideoBundle && this._pendingVideoBundle.mapId === map.id) {
      const pending = this._pendingVideoBundle;
      this._pendingVideoBundle = null;
      this.host.broadcast({
        type:     'video_bundle',
        mapId:    pending.mapId,
        mimeType: pending.mimeType,
        mapBlob:  pending.buffer,
      });
    }

    // Run each interaction's onMapLoaded hook (preload positional audio buffers, etc.)
    void this.interactions.notifyMapLoaded(this._interactionCtx());
  }

  // ─── DOM binding ──────────────────────────────────────────────────────────

  private bindDOMRefs(): void {
    const q = <T extends HTMLElement>(sel: string): T =>
      document.querySelector<T>(sel)!;

    this.mapSelect                  = q<HTMLSelectElement>('#map-select');
    this.mapEditableSelect          = new EditableSelect(this.mapSelect, {
      onRename:     (id, name) => void this._renameMap(id, name),
      // v2.14.50 — the dropdown prepends a type glyph (▣/▶/¶/▦) to
      // every option; strip it when the user starts editing so the
      // icon can't be accidentally backspaced into.
      displayClean: _cleanMapDisplayName,
    });
    this.editTextMapBtn             = q<HTMLButtonElement>('#edit-textmap-btn');
    this.editTextMapBtn.addEventListener('click', () => void this._editCurrentTextMap());
    // v2.14.42 — composite-map editor entry. Same wiring shape as
    // the text-map button; visible only when the active map's asset
    // is a composite (toggled in loadMap).
    const editCompositeEl = document.getElementById('edit-composite-btn') as HTMLButtonElement | null;
    if (editCompositeEl) {
      this.editCompositeBtn = editCompositeEl;
      editCompositeEl.addEventListener('click', () => void this._editCurrentCompositeMap());
    }
    this.startAnimationBtn          = q<HTMLButtonElement>('#start-animation-btn');
    this.startAnimationBtn.addEventListener('click', () => void this._onAnimationButtonClick());
    this.revealProgressEl           = q<HTMLElement>('#reveal-progress');
    this.revealProgressBarEl        = q<HTMLElement>('#reveal-progress-bar');
    this.packNameInput              = q<HTMLInputElement>('#pack-name-input');
    this.packNameDisplay            = document.getElementById('pack-name-display');
    this.transitionSelect           = q<HTMLSelectElement>('#transition-select');
    // v2.16.38 — #transition-params moved into the side panel; nothing
    // to bind here. Side panel rebuilds its body each open from state.
    this.filterSelect               = q<HTMLSelectElement>('#filter-select');
    // v2.16.37 — #filter-params + #filter-affect-markers-toggle moved
    // to the side panel. Fields retained for compile compat below.
    this.viewBgFxBtn           = q<HTMLButtonElement>('#view-bg-fx-btn');
    this.mapFxBtn              = q<HTMLButtonElement>('#mapfx-fx-btn');
    this.roomCodeEl            = q('#room-code');
    const msglogHost = document.querySelector<HTMLElement>('#msglog-host');
    if (msglogHost) this.messageLog = new MessageLog(msglogHost, { title: 'Activity' });
    this.markerSelect          = q<HTMLSelectElement>('#marker-select');
    this.markerEditableSelect  = new EditableSelect(this.markerSelect, {
      onRename: (id, label) => this._renameMarker(id, label),
    });
    this.markerIconBtn         = q<HTMLButtonElement>('#marker-icon-btn');
    this.markerColorInput      = q<HTMLInputElement>('#marker-color');
    this.markerHiddenToggle      = q<HTMLInputElement>('#marker-hidden');
    this.markerShowLabelToggle   = q<HTMLInputElement>('#marker-show-label');
    this.markerShowLabelGmToggle = q<HTMLInputElement>('#marker-show-label-gm');
    this.markerLockedToggle      = q<HTMLInputElement>('#marker-locked');
  }

  private bindRenderer(): void {
    const canvas = document.querySelector<HTMLCanvasElement>('#renderer-canvas')!;
    this.renderer = new Renderer(canvas);
    this.renderer.setFilterEnabled(false); // GM sees raw unfiltered scene
    this.renderer.setShaderPlanesEnabled(false); // GM sees flat fills for MapFX kinds, not the player's fancy shaders
    this.renderer.enableGMOverlay();
    this.renderer.setFogOpacity(0.35);     // GM sees through fog; players get full opacity

    // v2.17 Player Voice — ping pulses persist on the GM with the player's name
    // + a dismiss button, tracking the map through workspace pan/zoom.
    const pingLayerEl = document.getElementById('ping-layer');
    if (pingLayerEl) {
      this.pingLayer = new PingLayer(
        pingLayerEl,
        (x, y) => this.renderer.mapNormToCanvasCss(x, y),
        { showLabel: true, persistent: true, onDismiss: () => { /* GM-local removal only */ } },
      );
    }
    // v2.18 — StarMap GM preview layer (what players see; drive it from the SSE tab).
    const starMapLayerEl = document.getElementById('starmap-layer');
    if (starMapLayerEl) this.starMapLayer = new StarMapLayer(starMapLayerEl, 'gm');
    // v2.16.91 — live text-map video overlay (tracks the map like markers).
    const videoLayerEl = document.getElementById('textmap-video-layer');
    if (videoLayerEl) {
      void import('../rendering/TextMapVideoLayer.ts').then(({ TextMapVideoLayer }) => {
        this.textMapVideoLayer = new TextMapVideoLayer(
          videoLayerEl,
          (x, y) => this.renderer.mapNormToCanvasCss(x, y),
          {
            mode: 'gm',
            // GM owns the controls; relay each play/pause/seek/volume change
            // to viewers so they follow within ~0.5 s.
            onPlayback: (ev) => this.host.broadcast({ type: 'video_playback', ...ev }),
          },
        );
        this.textMapVideoLayer.setVideos(this._currentTextMapVideos);
      });
    }

    // v2.17.26 — text-map accessibility: a visually-hidden screen-reader region
    // listing the handout's text + image alt (baked into the page image, so
    // invisible to AT). No visual presence; sighted users see no change.
    const canvasWrapper = document.getElementById('canvas-wrapper');
    if (canvasWrapper) {
      // project = map-norm → canvas-css, so the focusable a11y boxes sit over
      // their handout elements and track pan/zoom; canvas gets role="img" too.
      this.textMapAltText = new TextMapAltText(
        canvasWrapper,
        (x, y) => this.renderer.mapNormToCanvasCss(x, y),
        canvas,
      );
      this.textMapAltText.setItems(this._currentAltItems);
    }

    // v2.17 Player Voice — player tokens. The GM can drag any token to place it.
    const pmEl = document.getElementById('player-marker-layer');
    if (pmEl) {
      this.playerMarkerLayer = new PlayerMarkerLayer(pmEl, {
        project:   (x, y) => this.renderer.mapNormToCanvasCss(x, y),
        unproject: (cx, cy) => {
          const r = canvas.getBoundingClientRect();
          return this.renderer.canvasCssToMapNorm(cx - r.left, cy - r.top);
        },
        canDrag: () => true,
        onDragEnd: (pid, x, y) => { void this._onGmMarkerDragEnd(pid, x, y); },
        onRotateEnd: (pid, facing) => { void this._onGmMarkerRotateEnd(pid, facing); },
        getPxPerSquare: () => this._tokenPxPerSquare(),
      });
    }
  }

  /** Current screen-pixels-per-map-square on the active map at the active
   *  zoom, or null when the map isn't calibrated. Drives token footprint
   *  sizing on the GM's own PlayerMarkerLayer. */
  private _tokenPxPerSquare(): number | null {
    const meta = this._lastMapAssetMeta;
    if (!meta?.pixelsPerSquare || !meta.imageHeight) return null;
    const scale = this.renderer.worldToScreenScale();
    return (meta.pixelsPerSquare / meta.imageHeight) * scale.pxPerWorldY;
  }

  private bindProjectorEditor(): void {
    const canvas = document.querySelector<HTMLCanvasElement>('#projector-viewport-canvas')!;
    this.projectorEditor = new ProjectorViewportEditor(canvas);
    this.projectorEditor.setRenderer(this.renderer);
    this.projectorEditor.onChange((vp) => {
      this.state.setProjectorViewport(vp);
      this.host.broadcast({ type: 'projector_viewport_update', payload: vp });
      this._refreshRectOverlays();
    });

    // v2.14.31 — Map-panel grid colour swatch + "calibrate first"
    // button binding. Persists the colour on the MapAsset and pushes
    // it to live viewers via map_meta_update so both Player and
    // Scaled View pick it up immediately without a map reload.
    const mapGridColour = document.getElementById('map-grid-colour') as HTMLInputElement | null;
    const mapGridCalibrateBtn = document.getElementById('map-grid-calibrate-btn') as HTMLButtonElement | null;
    // v2.14.31 — 'input' fires on every picker tick → live preview to
    // connected viewers via broadcast. 'change' fires on picker close
    // → one IDB save per picking session (a colour-picker drag can
    // fire 'input' 30+ times; we don't want that many getAsset →
    // saveMapAsset round-trips).
    mapGridColour?.addEventListener('input', () => {
      this._lastMapAssetGridColor = mapGridColour.value;
      this.host.setLastMapGridColor(mapGridColour.value);
      this.host.broadcast({ type: 'map_meta_update', gridColor: mapGridColour.value });
    });
    mapGridColour?.addEventListener('change', () => {
      void this._setActiveMapGridColor(mapGridColour.value);
    });

    // v2.14.77 — GM-only upper-layer opacity slider for layered
    // composites. Drives renderer.setMainMapOpacity directly — no
    // broadcast, no IDB write; this is a transient editing aid only.
    const upperLayerSlider = document.getElementById('map-upper-layer-opacity') as HTMLInputElement | null;
    upperLayerSlider?.addEventListener('input', () => {
      const o = parseInt(upperLayerSlider.value, 10) / 100;
      this.renderer.setMainMapOpacity(isFinite(o) ? o : 1);
    });
    mapGridCalibrateBtn?.addEventListener('click', () => {
      // Re-use the existing recalibrate flow — same UX entry point.
      document.getElementById('projection-recal-map-btn')?.click();
    });

    // v2.14.3 — Move Projection View button + edit-mode flow retired.
    // The projector rect now has its own green move handle on the GM
    // canvas (managed inside ProjectorViewportEditor); drag from there
    // to reposition. The Open Scaled View Monitor button takes the
    // prominent slot in the side panel.

    // Full-Map toggle — switches between scaled and full-map projection.
    // The retired Blackout button's job (hide what's on the projector) is
    // covered by the projection-broadcast switch + faff placeholder now.
    const setMode = (mode: 'scaled' | 'full') => {
      const current = this.state.snapshot().projectorViewport ?? defaultProjectorViewport();
      const next: ProjectorViewport = { ...current, mode };
      this.state.setProjectorViewport(next);
      this.projectorEditor.setViewport(next);
      this.host.broadcast({ type: 'projector_viewport_update', payload: next });
      this.refreshProjectionModeButtons();
    };
    document.getElementById('projection-fullmap-btn')?.addEventListener('click', () => {
      // Locked to 'full' while the active map is uncalibrated — scaled
      // requires pixelsPerSquare to render meaningfully.
      if (!this._isActiveMapCalibrated()) return;
      const cur = this.state.snapshot().projectorViewport?.mode ?? 'scaled';
      setMode(cur === 'full' ? 'scaled' : 'full');
    });

    // Rotation buttons — quick set-and-broadcast.
    document.querySelectorAll<HTMLButtonElement>('#projection-rotation-row [data-rotation]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rotation = Number(btn.dataset['rotation']) as 0 | 90 | 180 | 270;
        const current = this.state.snapshot().projectorViewport ?? defaultProjectorViewport();
        const next: ProjectorViewport = { ...current, rotation };
        this.state.setProjectorViewport(next);
        this.projectorEditor.setViewport(next);
        this.host.broadcast({ type: 'projector_viewport_update', payload: next });
        this.refreshRotationButtons();
      });
    });

    // v2.14.31 — the Show Grid toggle now lives on the rect's chrome
    // icon (set via the GM canvas). The colour swatch moved to the
    // Map panel (under Backdrop), per-map and shared with the Player.
    // Only the filter passthrough toggle stays here.
    const filterToggle = document.getElementById('projection-filter-toggle') as HTMLInputElement | null;
    const broadcastVp = (patch: Partial<Pick<ProjectorViewport, 'gridEnabled' | 'filterEnabled'>>) => {
      const current = this.state.snapshot().projectorViewport ?? defaultProjectorViewport();
      const next: ProjectorViewport = { ...current, ...patch };
      this.state.setProjectorViewport(next);
      // Keep the projectorEditor's local viewport in sync with state — otherwise
      // a later rect-drag would spread its stale copy (missing this patch) and
      // clobber the toggle back off on the projector. Mirrors rotation / mode.
      this.projectorEditor.setViewport(next);
      this.host.broadcast({ type: 'projector_viewport_update', payload: next });
    };
    // "Disable Filters" — checked = filters disabled = filterEnabled false.
    filterToggle?.addEventListener('change', () => broadcastVp({ filterEnabled: !filterToggle.checked }));
    this._refreshProjectionPanelMode();

    // Recalibrate this Map — opens the calibration modal for the active map's asset.
    document.getElementById('projection-recal-map-btn')?.addEventListener('click', async () => {
      const mapState = this.state.snapshot().map;
      if (!mapState) return;
      const asset = await this.maps.getAsset(mapState.id);
      if (!asset) return;

      // v2.14.27 — Alex's diagnostic showed 0 broadcasts dropped
      // during a 5-10s pause with 2 viewers open. So GM isn't sending.
      // What's left: the popup windows kept their own Three.js render
      // loops spinning behind the hold screen, competing with the
      // calibration modal SVG for the GPU at the OS level. The faff
      // overlay now stops the popup's renderer (Viewer.showFaffOverlay
      // calls renderer.stop). Also stop the GM's own renderer during
      // the modal so hiding canvas-wrapper doesn't just paint-skip
      // (the WebGL animation loop ran anyway). Everything restored
      // in the finally block.
      const canvasWrapper = document.getElementById('canvas-wrapper');
      const wasDisplay = canvasWrapper?.style.display ?? '';
      if (canvasWrapper) canvasWrapper.style.display = 'none';
      this.renderer?.stop();
      // v2.14.28 — generic faff message; players don't need to know
      // the GM is mid-calibration (it's GM-internal plumbing). Random
      // one-liner from the shared pool, same as the broadcast-bypass
      // toggle uses.
      const holdMsg = randomFaffMessage();
      this.host.broadcast({ type: 'view_placeholder', target: 'player',    show: true, message: holdMsg });
      this.host.broadcast({ type: 'view_placeholder', target: 'projector', show: true, message: holdMsg });
      this.host.setBroadcastSuspended(true);

      try {
        const cal = new MapCalibrationModal();
        await cal.open(asset);
      } finally {
        // Restore everything regardless of save / cancel / thrown error.
        // Resume broadcasts FIRST so the view_placeholder show=false
        // messages below actually go out.
        this.host.setBroadcastSuspended(false);
        this.host.broadcast({ type: 'view_placeholder', target: 'player',    show: false, message: '' });
        this.host.broadcast({ type: 'view_placeholder', target: 'projector', show: false, message: '' });
        if (canvasWrapper) canvasWrapper.style.display = wasDisplay;
        this.renderer?.start();
      }
      // Push the saved calibration to viewers. No-op for cancel
      // (the asset hasn't changed) — the message still fires but
      // every field matches what they already had.
      await this.refreshProjectorMapInfo();
    });

    // Unified Projector dropdown. Acts as launcher, off-switch, and setup
    // picker rolled into one. Options: "No Projection" / each saved
    // setup / "+ Calibrate New Projector…". GM and projector share
    // localStorage on the same device, so the list is read fresh.
    const projectorSelect = document.getElementById('projection-projector-select') as HTMLSelectElement | null;
    if (projectorSelect) {
      this.projectorEditableSelect = new EditableSelect(projectorSelect, {
        onRename: (id, name) => this._renameProjectorSetup(id, name),
      });
    }
    projectorSelect?.addEventListener('change', () => this._onProjectorSelectChange(projectorSelect));
    this.refreshProjectorSetupSelect();
    // Calibration completes in its own window — pick up the new setup the
    // moment localStorage changes (storage events fire on OTHER tabs/windows
    // for the same origin, which is exactly the calibration popup → GM case).
    window.addEventListener('storage', (e) => {
      if (e.key === 'dmr_projector_setups' || e.key === 'dmr_projector_active') {
        this.refreshProjectorSetupSelect();
      }
    });

    // Open Projector Monitor — visible only after a primary is connected.
    document.getElementById('projection-monitor-btn')?.addEventListener('click', () => {
      const room = this.host.roomCode;
      if (!room) { this.setStatus('Waiting for P2P… try again in a moment.', 'warn'); return; }
      this._ensureCalibratedMapStartsScaled();
      window.open(this._buildProjectorUrl(room), '_blank', 'noopener,popup,width=1280,height=800');
    });
  }

  /** Force the projector viewport into 'scaled' mode if the active map
   *  is calibrated and the current stored mode is 'full'. Called right
   *  before opening any Scaled View window so the new view defaults
   *  to calibrated rather than inheriting a stale 'full' that was set
   *  earlier (e.g. when the user had an uncalibrated map loaded —
   *  setMapAssetCalibration auto-flips to 'full' on uncalibrated, but
   *  never flips back when the GM switches to a calibrated map). */
  private _ensureCalibratedMapStartsScaled(): void {
    if (!this._isActiveMapCalibrated()) return;
    const currentVp = this.state.snapshot().projectorViewport ?? defaultProjectorViewport();
    if (currentVp.mode === 'scaled') return;
    const next: ProjectorViewport = { ...currentVp, mode: 'scaled' };
    this.state.setProjectorViewport(next);
    this.projectorEditor.setViewport(next);
    this.host.broadcast({ type: 'projector_viewport_update', payload: next });
    this.refreshProjectionModeButtons();
    this._refreshRectOverlays();
  }

  /**
   * Handle a change on the unified Projector dropdown:
   *   - 'off'     → close all connected projectors
   *   - SELECT_ADD_SENTINEL → open the calibrate window
   *   - <id>      → set active setup, open primary projector window
   */
  private _onProjectorSelectChange(sel: HTMLSelectElement): void {
    const v = sel.value;
    if (v === 'off') {
      // Tear down every connected projector via shutdown messages.
      for (const conn of this.projectorConnections.values()) {
        this.host.broadcast({ type: 'projector_shutdown', targetId: conn.clientId });
      }
      this.projectorConnections.clear();
      this._projectorPeerByClientId.clear();
      this.projectorEditor?.setConnection(null);
      this.refreshProjectorStatus();
      this._refreshProjectionPanelMode();
      this._updatePlayerCount();
      return;
    }
    if (v === SELECT_ADD_SENTINEL) {
      // Calibration needs to physically run on the projector display — the
      // user drags the window there and full-sizes it before rulering the
      // live grid. Open as its own popup; the storage listener picks up
      // the saved setup and refreshes the dropdown.
      window.open(`/calibrate.html${this._instanceQuery()}`, '_blank', 'noopener,popup,width=1280,height=800');
      sel.value = 'off';
      return;
    }
    // setupId — make active, then open primary.
    const room = this.host.roomCode;
    if (!room) { this.setStatus('Waiting for P2P… try again in a moment.', 'warn'); return; }
    setActiveSetupId(v);
    this._ensureCalibratedMapStartsScaled();
    window.open(this._buildProjectorUrl(room), '_blank', 'noopener,popup,width=1280,height=800');
  }

  /**
   * Populate the unified Projector dropdown from localStorage:
   *     No Projection
   *     <each saved setup>
   *     ──────────
   *     + Calibrate New Projector…
   * Selection reflects the current connection — if a primary is live, its
   * setup is shown selected; otherwise "off". Read fresh so a calibration
   * saved on another tab appears immediately.
   */
  private refreshProjectorSetupSelect(): void {
    const sel = document.getElementById('projection-projector-select') as HTMLSelectElement | null;
    if (!sel) return;
    const setups      = getAllSetups();
    const primary     = this._primaryProjector();
    const liveSetupId = primary
      ? setups.find((s) => s.name === primary.setupName)?.id ?? null
      : null;
    sel.innerHTML = '';

    const off = document.createElement('option');
    off.value = 'off';
    off.textContent = 'No Projection';
    sel.appendChild(off);

    for (const s of setups) {
      const opt = document.createElement('option');
      opt.value = s.id;
      // Display the name only — px/sq calibration density lives in the
      // option tooltip so the EditableSelect's in-place rename can edit
      // the bare name without mangling the density suffix.
      opt.textContent = s.name;
      opt.title       = `${s.pixelsPerSquare.toFixed(1)} px/sq`;
      sel.appendChild(opt);
    }

    // v2.16.34 — sentinel "+ Calibrate New Display" retired in favour of
    // the adjacent "+" button (#add-display-btn). Defensive branch in the
    // change handler stays for safety.

    // Selected option reflects the LIVE state only — when nothing's running,
    // default to "No Projection" so picking the previously-active setup
    // actually fires a change event and re-launches it.
    sel.value = liveSetupId ?? 'off';
    this.projectorEditableSelect?.refresh();
  }

  /**
   * Show the intro paragraph when nothing's connected; show the active-control
   * block when at least one primary projector is live.
   */
  private _refreshProjectionPanelMode(): void {
    const intro  = document.getElementById('projection-intro');
    const active = document.getElementById('projection-active-controls');
    const live = this.projectorConnections.size > 0;
    if (intro)  intro.hidden  =  live;
    if (active) active.hidden = !live;
  }

  private refreshRotationButtons(): void {
    const current = this.state.snapshot().projectorViewport?.rotation ?? 0;
    document.querySelectorAll<HTMLButtonElement>('#projection-rotation-row [data-rotation]').forEach((btn) => {
      btn.classList.toggle('btn--primary', Number(btn.dataset['rotation']) === current);
      btn.classList.toggle('btn--ghost',   Number(btn.dataset['rotation']) !== current);
    });
  }

  private refreshProjectionModeButtons(): void {
    const mode = this.state.snapshot().projectorViewport?.mode ?? 'scaled';
    const fullBtn = document.getElementById('projection-fullmap-btn') as HTMLButtonElement | null;
    if (!fullBtn) return;
    const active   = mode === 'full';
    const locked   = !this._isActiveMapCalibrated();
    fullBtn.classList.toggle('btn--warn', active);
    // When the active map has no calibration, Scaled View is invalid;
    // lock the button in its pressed "Full Map" state so the user can
    // see why nothing reacts to clicks. Calibrating the map (or swapping
    // to a calibrated one) releases the lock. Label spells out the
    // locked state explicitly so disabled-greyed text still reads.
    fullBtn.textContent = locked
      ? 'Scaled View (Unavailable)'
      : (active ? 'Scaled View' : 'Full Map');
    fullBtn.disabled = locked;
    fullBtn.title = locked
      ? 'Map is not calibrated — calibrate to enable Scaled View'
      : '';
  }

  /** Is the active map calibrated? Drives the Full Map button lock and
   *  the auto-flip to 'full' mode on uncalibrated map swaps. */
  private _isActiveMapCalibrated(): boolean {
    return !!this._lastMapAssetMeta?.pixelsPerSquare;
  }

  /** Ghost the "Measure from here" context-menu item when the active map
   *  isn't calibrated (no scale → no meaningful distance). Called whenever
   *  the active map's calibration metadata changes. */
  private _updateMeasureMenuItem(): void {
    const btn = document.querySelector<HTMLButtonElement>('#ctx-measure');
    if (!btn) return;
    const ok = this._isActiveMapCalibrated();
    btn.disabled = !ok;
    btn.title = ok
      ? 'Click a second point to measure the distance.'
      : 'Calibrate this map (give it a grid scale) to enable measuring.';
  }

  private onPeerMessage(_peerId: string, msg: GMMessage): void {
    if (msg.type === 'gm_preview_hello') {
      // v2.16.43 — tag this preview (PiP iframe or pop-out window) so the
      // disconnect handler shows a sane status instead of "Player (peerid…)
      // disconnected".
      // v2.17.16 — previews now arrive over LocalChannel (_peerId === 'local'),
      // which carries no peer id, so key the tracking on the preview's
      // clientId. That lets the matching player_bye (also clientId-tagged)
      // clear it on close — restoring the connect/count/disconnect lifecycle
      // the dropped PeerJS path used to provide.
      const key = msg.clientId ?? _peerId;
      this._gmPreviewPeers.add(key);
      this._updatePlayerCount();
      // v2.17.13 — show the GM that their own Player View is connected
      // (rather than a generic peer hash or a guest joining).
      this.setStatus('Player connected (GM Player View)', 'ok');
      // v2.16.98 — previews identify via gm_preview_hello (NOT
      // player_identify), so they skipped the overlay catch-up bundle that
      // real joiners get: map-anchored state (videos, annotations, tokens)
      // lives in discrete messages, not the full_state cache. Without this,
      // a freshly-opened "Show Player View" / popped-out window showed no
      // video until the next map swap re-broadcast it. Push the same
      // overlay state here.
      this.host.broadcast({ type: 'textmap_videos', videos: this._currentTextMapVideos });
      this.textMapVideoLayer?.reportNow();
      this.annotate?.rebroadcast();
      this._refreshPlayerMarkers();
      return;
    }
    if (msg.type === 'player_identify') {
      // v2.17 Player Voice — a device player introduced themselves. Upsert
      // the persistent record, bind the live connection, refresh + rebroadcast.
      console.info('[gm] player_identify received', { from: _peerId, playerId: msg.playerId, name: msg.characterName || msg.playerName });
      // v2.16.103 — remember the device class for the connections summary.
      this._peerIsMobile.set(_peerId, !!msg.mobile);
      void this.playerRegistry.identify(_peerId, msg).then(() => {
        this._refreshPlayersPanel();
        this._broadcastRoster();
        this._broadcastPlayerFeatures();
        this._refreshPlayerMarkers(); // let the new joiner see existing tokens
        this._broadcastAllPlayerIcons(); // seed their per-player icon cache
        // Initiative tracker — fire current state to the new joiner.
        if (this.initiativeTracker) this.host.broadcast({ type: 'initiative_update', state: stripInitiativeForWire(this.initiativeTracker.getState(), isInitiativeAnonymised()) });
        // v2.16.76 — annotations (clocks) for the new joiner.
        this.annotate?.rebroadcast();
        // v2.16.91 — text-map videos for the new joiner.
        this.host.broadcast({ type: 'textmap_videos', videos: this._currentTextMapVideos });
        // v2.16.97 — catch the new joiner up to the current playback position
        // (captured as pending until their iframe is ready).
        this.textMapVideoLayer?.reportNow();
        const who = msg.playerName || msg.characterName || 'A player';
        this.setStatus(`${who} joined`, 'ok');
      });
      return;
    }
    if (msg.type === 'player_bye') {
      // v2.17.16 — a same-browser GM preview (LocalChannel-only) signs off
      // with player_bye on pagehide. Clear its clientId-keyed tracking +
      // show the matching disconnect status, mirroring the old PeerJS path.
      if (this._gmPreviewPeers.delete(msg.clientId)) {
        this._updatePlayerCount();
        this.setStatus('GM Player View disconnected', 'ok');
        return;
      }
      this.playerRegistry.bye(msg.clientId);
      this._refreshPlayersPanel();
      this._broadcastRoster();
      return;
    }
    if (msg.type === 'player_forget_me') {
      // Wipe the registry entry + their tokens. The player will reload with a
      // fresh playerId so future testing starts from zero. Falls back to the
      // playerId from the message when there's no live binding yet.
      const bound = this.playerRegistry.playerForClient(msg.clientId);
      const id = bound?.id ?? msg.playerId;
      const who = bound?.playerName || bound?.characterName || 'A player';
      void this.playerRegistry.remove(id).then(() => {
        this._liveMarkerPos.delete(id);
        this._markerMoveOrigin.delete(id);
        this.playerRegistry.bye(msg.clientId); // clear any live binding too
        this._refreshPlayersPanel();
        this._broadcastRoster();
        this._refreshPlayerMarkers();
        this.setStatus(`${who} reset their identity`, 'warn');
      });
      return;
    }
    if (msg.type === 'player_icon_request') {
      // A receiver (player or projector) is rendering a token whose hasIcon
      // flag is set but their local icon cache is empty — a chunked-binary
      // delivery must have been dropped or arrived before they mounted.
      // Resend just that icon. Cheap to over-fire; the receivers idempotently
      // re-cache. (We re-broadcast rather than targeting a single conn so
      // other receivers that were also missing the icon can catch up.)
      this._broadcastPlayerIcon(msg.playerId);
      return;
    }
    if (msg.type === 'player_ping') {
      if (!arePingsEnabled()) return; // GM has pings switched off — ignore
      if (this._seenUpstream(msg.pingId)) return;
      const player = this.playerRegistry.playerForClient(msg.clientId);
      const color = player?.color ?? '#3b82f6';
      const name  = player?.playerName || player?.characterName || 'Player';
      // Show on the GM (persists until dismissed) and relay to every player.
      this.pingLayer?.add({ id: msg.pingId, x: msg.x, y: msg.y, color, name });
      this.host.broadcast({ type: 'ping_show', pingId: msg.pingId, x: msg.x, y: msg.y, color, name });
      return;
    }
    if (msg.type === 'player_message') {
      if (!isMessagingEnabled()) return; // GM has messaging switched off
      if (this._seenUpstream(msg.messageId)) return;
      const sender = this.playerRegistry.playerForClient(msg.clientId);
      const fromName  = sender?.playerName || sender?.characterName || 'Player';
      const fromColor = sender?.color ?? '#3b82f6';
      const recipient = msg.toPlayerId ? this.playerRegistry.get(msg.toPlayerId) : undefined;
      // v2.16.7 — pre-fetch reply suggestions the moment a message arrives so
      // they're (usually) ready by the time the GM opens the reply box. Silent
      // — the panel renders them on open if they resolved; the manual button
      // still surfaces explicit errors.
      // v2.16.52 — gate on !msg.toPlayerId. Only to-GM messages get the
      // auto pre-fetch; peer-bound (player→player) traffic skips it so we
      // don't burn LLM tokens on conversations the GM may never reply to.
      // The manual Re-roll/Suggest button stays available on every thread,
      // so the GM can still opt in to a suggestion on peer-bound chatter.
      const client = LLMClient.fromSettings();
      const suggestionsPromise = client && !msg.toPlayerId
        ? client.suggest(msg.text).catch(() => [] as string[])
        : undefined;
      // v2.16.47 — message lands on the per-player thread store. Unread
      // counters bump unless the side panel for this sender is already
      // open. The Players panel re-renders via the store's onChange
      // subscription so the unread badge appears immediately.
      const senderPlayerId = sender?.id ?? msg.fromPlayerId;
      const entry: import('./MessageThreads.ts').ThreadMessage = {
        id: msg.messageId,
        fromKind: 'player',
        fromPlayerId: senderPlayerId,
        fromName, fromColor,
        toPlayerId: msg.toPlayerId ?? null,
        ...(msg.toPlayerId && recipient ? { toName: recipient.characterName || recipient.playerName || 'player', toColor: recipient.color } : {}),
        text: msg.text,
        at: Date.now(),
        origin: msg.toPlayerId ? 'peer-bound' : 'gm-bound',
        ...(suggestionsPromise ? { suggestionsPromise } : {}),
      };
      this._messageThreads.addIncoming(senderPlayerId, entry, this._openThreadPlayerId);
      // v2.16.49 — peer-bound messages also land in the RECIPIENT's
      // thread so the GM can monitor both sides from either badge.
      // Orange unread bumps on the recipient row; the message reads
      // identically in both threads (same id, same content). When the
      // recipient is the player whose thread is currently open, the
      // bump is skipped and the body refresh handles the live update.
      if (msg.toPlayerId) {
        this._messageThreads.addIncoming(msg.toPlayerId, entry, this._openThreadPlayerId);
        // Player→player: relay to the addressed player so their PlayerApp
        // shows the toast.
        this.host.broadcast({
          type: 'message_deliver',
          messageId: msg.messageId,
          fromKind:  'player',
          fromName, fromColor,
          toPlayerId: msg.toPlayerId,
          text: msg.text,
        });
      }
      return;
    }
    if (msg.type === 'initiative_roll') {
      // A player submitted their initiative value — find them and slot a card in.
      const player = this.playerRegistry.playerForClient(msg.clientId);
      if (!player || player.id !== msg.playerId) return;
      const name = player.characterName || player.playerName || 'Player';
      this.initiativeTracker?.ingestRoll(player.id, name, player.color, msg.value, player.iconDataUrl);
      this.setStatus(`${name} rolled ${msg.value}`, 'ok');
      return;
    }
    if (msg.type === 'player_marker_move') {
      if (!arePlayerMarkersMovable()) return; // GM disabled player-movable tokens
      const mapId = this._activeMapId();
      if (!mapId) return;
      const bound = this.playerRegistry.playerForClient(msg.clientId);
      if (!bound || bound.id !== msg.playerId) return;          // only your own token
      if (!this.playerRegistry.isPlacedOn(msg.playerId, mapId)) return;
      // Capture the pre-move state (position + facing) once so the GM can
      // cancel the move and restore both.
      if (!this._markerMoveOrigin.has(msg.playerId)) {
        const cur = this.playerRegistry.placementOn(msg.playerId, mapId);
        if (cur) {
          const origin: { x: number; y: number; facing?: number } = { x: cur.x, y: cur.y };
          if (cur.facing !== undefined) origin.facing = cur.facing;
          this._markerMoveOrigin.set(msg.playerId, origin);
        }
      }
      if (msg.done) {
        void this.playerRegistry.setPlacement(msg.playerId, mapId, msg.x, msg.y, msg.facing).then(() => {
          this._liveMarkerPos.delete(msg.playerId);
          this._liveMarkerFacing.delete(msg.playerId);
          this._refreshPlayerMarkers();
          this._refreshPlayersPanel(); // surfaces the cancel-move button
        });
      } else {
        this._liveMarkerPos.set(msg.playerId, { x: msg.x, y: msg.y });
        if (msg.facing !== undefined) this._liveMarkerFacing.set(msg.playerId, msg.facing);
        this._refreshPlayerMarkers();
      }
      return;
    }
    if (msg.type === 'projector_bye') {
      const wasPrimary = this._primaryProjector()?.clientId === msg.clientId;
      this.projectorConnections.delete(msg.clientId);
      this._projectorPeerByClientId.delete(msg.clientId);
      if (wasPrimary) {
        // Closing the primary window is the canonical "turn off projection"
        // gesture — tear down every monitor too rather than auto-promoting
        // someone else. Send shutdown to each remaining client and forget them.
        for (const conn of this.projectorConnections.values()) {
          this.host.broadcast({ type: 'projector_shutdown', targetId: conn.clientId });
        }
        this.projectorConnections.clear();
        this._projectorPeerByClientId.clear();
      }
      this.projectorEditor?.setConnection(this._primaryProjector() ?? null);
      this.refreshProjectorStatus();
      this._refreshProjectionPanelMode();
      this.refreshProjectorSetupSelect();
      this._updatePlayerCount();
      // Projector gone → green chrome should disappear too.
      this._refreshRectOverlays();
      return;
    }
    if (msg.type === 'projector_hello') {
      const wasNew = !this.projectorConnections.has(msg.clientId);
      this.projectorConnections.set(msg.clientId, {
        clientId:        msg.clientId,
        setupName:       msg.setupName,
        pixelsPerSquare: msg.pixelsPerSquare,
        canvasWidth:     msg.canvasWidth,
        canvasHeight:    msg.canvasHeight,
      });
      // Track the underlying PeerJS peer id for remote projectors so we can
      // (a) exclude them from the player count and (b) clean up if the data
      // channel closes before projector_bye is delivered. 'local' marker for
      // BC-only projectors is harmless — they're not in host.connections.
      if (_peerId && _peerId !== 'local') {
        this._projectorPeerByClientId.set(msg.clientId, _peerId);
      }
      this._updatePlayerCount();

      // The first connection (insertion order) is primary; the GM rectangle
      // tracks the primary's dimensions. Monitors don't influence the GM rect.
      const primary = this._primaryProjector();
      if (primary) this.projectorEditor?.setConnection(primary);
      this.refreshProjectorStatus();
      // A new projector might have just calibrated — re-read the setup list
      // so the picker reflects what's now in localStorage.
      this.refreshProjectorSetupSelect();
      this._refreshProjectionPanelMode();

      // If the active map has no projectorViewport yet, seed a default one.
      if (!this.state.snapshot().projectorViewport) {
        this.state.setProjectorViewport(defaultProjectorViewport());
      }

      // Send role assignment to this projector (and refresh monitors if the
      // primary's view fraction changed because primary itself just resized).
      this._broadcastRoles(wasNew);

      // Re-broadcast the current projector viewport so the projector
      // window can position itself correctly.
      const vp = this.state.snapshot().projectorViewport;
      if (vp) this.host.broadcast({ type: 'projector_viewport_update', payload: vp });

      // A projector just appeared — its green rect now has bounds, so push
      // the overlay handles in.
      this._refreshRectOverlays();

      // v2.17 Player Voice — seed the new projector with current Player Voice
      // state (tokens, icons, initiative rail). Players get this on identify;
      // projectors send projector_hello instead so we mirror the same dispatch
      // here. Broadcasts to all peers but existing receivers idempotently
      // re-apply, so it's cheap.
      this._refreshPlayerMarkers();
      this._broadcastAllPlayerIcons();
      if (this.initiativeTracker) this.host.broadcast({ type: 'initiative_update', state: stripInitiativeForWire(this.initiativeTracker.getState(), isInitiativeAnonymised()) });
      this.annotate?.rebroadcast();
      this.host.broadcast({ type: 'textmap_videos', videos: this._currentTextMapVideos });
      // v2.16.97 — catch the projector up to the current playback position.
      this.textMapVideoLayer?.reportNow();
    }
  }

  /** Returns the primary projector connection (oldest by insertion order), or null. */
  private _primaryProjector(): (ProjectorConnection & { clientId: string }) | null {
    const first = this.projectorConnections.values().next();
    return first.done ? null : first.value;
  }

  /**
   * Compute the primary's view fraction (viewNW × viewNH on the active map)
   * given its calibration + window size + the active map's calibration.
   * Returns null if any input is missing.
   */
  private _primaryViewFraction(): { viewNW: number; viewNH: number } | null {
    const primary = this._primaryProjector();
    if (!primary || primary.pixelsPerSquare <= 0) return null;
    const meta = this._lastMapAssetMeta;
    if (!meta) return null;
    const ratio = meta.pixelsPerSquare / primary.pixelsPerSquare;
    const wMap  = primary.canvasWidth  * ratio;
    const hMap  = primary.canvasHeight * ratio;
    return {
      viewNW: Math.min(1, wMap / meta.imageWidth),
      viewNH: Math.min(1, hMap / meta.imageHeight),
    };
  }

  /**
   * Send role messages to all currently-connected projectors. Cheap to spam;
   * the GM does this on hello, primary swap, primary resize, or map-asset
   * metadata change so monitors stay in sync with the primary's crop.
   */
  private _broadcastRoles(_includesNew: boolean): void {
    const primary = this._primaryProjector();
    if (!primary) return;
    const view = this._primaryViewFraction();
    const primaryAspect = primary.canvasHeight > 0
      ? primary.canvasWidth / primary.canvasHeight
      : undefined;
    let monitorIndex = 0;
    for (const conn of this.projectorConnections.values()) {
      if (conn.clientId === primary.clientId) {
        this.host.broadcast({ type: 'projector_role', targetId: conn.clientId, role: 'primary' });
      } else {
        monitorIndex++;
        this.host.broadcast({
          type: 'projector_role',
          targetId: conn.clientId,
          role: 'monitor',
          monitorIndex,
          ...(view ? { primaryViewNW: view.viewNW, primaryViewNH: view.viewNH } : {}),
          ...(primaryAspect ? { primaryAspect } : {}),
        });
      }
    }
  }

  private refreshProjectorStatus(): void {
    const launchBtn = document.getElementById('projector-launch-btn') as HTMLButtonElement | null;
    const el        = document.getElementById('projector-status');
    const hasPrimary = this.projectorConnections.size > 0;
    if (launchBtn) {
      launchBtn.textContent = hasPrimary ? 'Open Scaled View Monitor…' : 'Open Scaled View…';
      launchBtn.classList.toggle('btn--primary', !hasPrimary);
      launchBtn.classList.toggle('btn--ghost',    hasPrimary);
    }
    if (!el) return;
    if (!hasPrimary) {
      el.textContent = 'No projector connected.';
      return;
    }
    const primary = this._primaryProjector()!;
    const monitorCount = this.projectorConnections.size - 1;
    const monitorSuffix = monitorCount > 0 ? ` · +${monitorCount} monitor${monitorCount === 1 ? '' : 's'}` : '';
    el.textContent = `Connected: ${primary.setupName} · ${primary.canvasWidth}×${primary.canvasHeight} @ ${primary.pixelsPerSquare.toFixed(1)} px/sq${monitorSuffix}`;
  }

  private bindViewportEditor(): void {
    // The marching-ants outline + drag handles live on the GM canvas via
    // ViewportEditor; the editable chrome (move / resize / aspect-lock /
    // maximise) lives on the HTML overlay (A8). The old Player View
    // side panel — and its Edit / OK / Cancel / Reset buttons — was
    // retired in v2.11/A8.5 because every action is now a single click
    // on the rect itself.
    const canvas = document.querySelector<HTMLCanvasElement>('#viewport-canvas')!;
    this.viewportEditor = new ViewportEditor(canvas);
    this.viewportEditor.setRenderer(this.renderer);

    // Live drag → push view to state (and on to players via P2P)
    this.viewportEditor.onChange((view) => {
      this.state.setView(view);
      this._refreshRectOverlays();
    });
  }

  private bindFogEditor(): void {
    const canvas = document.querySelector<HTMLCanvasElement>('#fog-canvas')!;
    this.fogEditor = new FogEditor(canvas, (fog) => this.state.setFog(fog));
    this.fogEditor.setRenderer(this.renderer);
    // Mount the per-selection delete handle in the shared screen-space layer.
    // marker-overlay sits above the fog canvas at the same inset:0 footprint,
    // so a single px coordinate works for both.
    const overlayHost = document.getElementById('marker-overlay');
    if (overlayHost) this.fogEditor.setOverlayHost(overlayHost);

    // Start in select mode so the canvas is interactive immediately
    this.fogEditor.disable();

    // Wire context-sensitive toolbar.
    this.fogEditor.setOnModeChange(({ drawing, hasSelection, selectedId }) => {
      // v2.14.12 — markers stay disabled whenever ANY fog editing tool
      // is armed, not just polygon-mode `drawing`. Pre-fix the callback
      // only checked `drawing` (FogEditor.enabled, which is polygon
      // mode), so a state cascade triggered while brush or fill was
      // armed (e.g. tolerance-slider drag re-firing emitMode via
      // syncPolygons) would silently flip markers pointer-events back
      // to auto. The markers canvas then absorbed the next click,
      // reading as "fill no longer accepting input" even though
      // PAINTING was still lit and `_actionInProgress` was true.
      const fogEditing = drawing || this._actionInProgress;
      this.markerEditor?.setPointerCapture(!fogEditing);
      // Polygon commits go through _commitOverlayPolygon → _endAction so
      // the action buttons reset; nothing to do here besides marker
      // pointer-capture handling above.
      // Auto-open the Fog panel when a polygon is selected or draw mode activates.
      if (drawing || hasSelection) {
        const body  = document.querySelector<HTMLElement>('#fog-panel .panel-body');
        const title = document.querySelector<HTMLElement>('#fog-panel .panel-title');
        if (body?.hidden) {
          body.hidden = false;
          title?.setAttribute('aria-expanded', 'true');
        }
      }
      // When a polygon is selected, preselect its kind in the dropdown so
      // the GM sees the same panel state they'd get by picking that kind
      // manually (shader-params panel, colour swatch enable/disable, etc.).
      // On deselection (selected → none, not mid-draw), revert the panel
      // to fog — the default kind — so the GM isn't stuck on a previous
      // pick after stepping away from the last polygon. Every selection
      // change also rebuilds the shader-params panel so its sliders
      // snap to the picked polygon's stored values (or to the
      // "next new polygon" draft when nothing is selected).
      if (selectedId && selectedId !== this._lastSelectedSyncedId) {
        const poly = this.state.getState().fog.polygons.find((p) => p.id === selectedId);
        if (poly && poly.kind !== this.activeOverlayKind) {
          this._syncPanelToKind(poly.kind);
        } else {
          this._rebuildShaderParamsPanel();
          this._applyKindToColourSwatch();
          this._applyEdgeFadeSlider();
        }
        this._lastSelectedSyncedId = selectedId;
      } else if (!selectedId && this._lastSelectedSyncedId !== null) {
        if (!drawing && this.activeOverlayKind !== 'fog') {
          this._syncPanelToKind('fog');
        } else {
          this._rebuildShaderParamsPanel();
          this._applyKindToColourSwatch();
          this._applyEdgeFadeSlider();
        }
        this._lastSelectedSyncedId = null;
      }
    });

    // ─── v2.12 unified UI — Drawing Mode toggle + Paint/Erase actions ────
    // Drawing Mode (Polygon | Brush) is a sticky preference, persisted in
    // localStorage so it survives reloads but doesn't end up in save files.
    // Paint and Erase are single-shot action buttons — click one and the
    // active Drawing Mode kicks in for one polygon/stroke, then auto-exits.
    const modePolyBtn  = document.querySelector<HTMLButtonElement>('#fog-mode-poly-btn');
    const modeBrushBtn = document.querySelector<HTMLButtonElement>('#fog-mode-brush-btn');
    const modeFillBtn  = document.querySelector<HTMLButtonElement>('#fog-mode-fill-btn');
    const brushControls = document.querySelector<HTMLElement>('.fog-brush-controls');
    const fillControls  = document.querySelector<HTMLElement>('.fog-fill-controls');
    const paintBtn = document.querySelector<HTMLButtonElement>('#fog-paint-btn');
    const eraseBtn = document.querySelector<HTMLButtonElement>('#fog-erase-btn');

    // Restore persisted drawing mode (Polygon by default).
    const savedMode = (localStorage.getItem(DRAWING_MODE_LS_KEY) ?? 'polygon') as 'polygon' | 'brush' | 'fill';
    this.drawingMode = (savedMode === 'brush' || savedMode === 'fill') ? savedMode : 'polygon';

    const applyDrawingMode = () => {
      modePolyBtn?.classList.toggle('is-active',  this.drawingMode === 'polygon');
      modeBrushBtn?.classList.toggle('is-active', this.drawingMode === 'brush');
      modeFillBtn?.classList.toggle('is-active',  this.drawingMode === 'fill');
      if (brushControls) brushControls.hidden = this.drawingMode !== 'brush';
      if (fillControls)  fillControls.hidden  = this.drawingMode !== 'fill';
    };
    applyDrawingMode();

    const setDrawingMode = (mode: 'polygon' | 'brush' | 'fill') => {
      if (this.drawingMode === mode) return;
      // Exit any in-progress action when the mode changes — keeps the user
      // from accidentally committing a half-built polygon under the new tool.
      this._endAction();
      this.drawingMode = mode;
      localStorage.setItem(DRAWING_MODE_LS_KEY, mode);
      applyDrawingMode();
      // v2.12.x — picking a drawing mode is intent to paint. Auto-engage
      // Paint so the tool is live the moment the GM has chosen Polygon /
      // Brush / Fill, instead of forcing them to click Paint as a
      // separate step. Erase still requires an explicit click.
      this._startAction('paint');
    };
    modePolyBtn?.addEventListener('click',  () => setDrawingMode('polygon'));
    modeBrushBtn?.addEventListener('click', () => setDrawingMode('brush'));
    modeFillBtn?.addEventListener('click',  () => setDrawingMode('fill'));

    paintBtn?.addEventListener('click', () => {
      if (paintBtn.classList.contains('is-active')) this._endAction();
      else this._startAction('paint');
    });
    eraseBtn?.addEventListener('click', () => {
      if (eraseBtn.classList.contains('is-active')) this._endAction();
      else this._startAction('erase');
    });

    const brushRadiusInput = document.querySelector<HTMLInputElement>('#fog-brush-radius');
    brushRadiusInput?.addEventListener('input', () => {
      this.fogEditor.setBrushSettings({ radius: parseFloat(brushRadiusInput.value) });
    });
    // Sliders show their value via a hover tooltip (title attribute)
    // rather than a permanent readout — sliders are "feel" controls
    // and a visible number tempts users to think the exact value
    // matters. Hover still surfaces it for screenshotting / sharing.
    const _tip = (id: string, label: string) => {
      const slider = document.getElementById(id) as HTMLInputElement | null;
      if (slider) wireSliderTooltip(slider, label);
    };
    _tip('fog-brush-radius',   'Brush size');
    // Edge Fade slider lives in the MapFX FX popover; tooltip is wired
    // there per-row, not on a fixed inline element.
    _tip('fog-fill-tolerance', 'Tolerance');
    document.querySelector('#fog-brush-clear')?.addEventListener('click', async () => {
      // Clear all polygons of the active kind only. Lets the GM wipe
      // their current fire / fog / smoke layer without nuking the
      // others. Destructive — confirm first, and name the kind +
      // count so the GM knows exactly what they're about to delete.
      const fog = this.state.getState().fog;
      const k = overlayKind(this.activeOverlayKind);
      const targets = fog.polygons.filter((p) => p.kind === this.activeOverlayKind);
      if (targets.length === 0) return;
      const noun = targets.length === 1 ? 'polygon' : 'polygons';
      const ok = await confirmDialog({
        title: `Delete all ${k.label} on this map?`,
        body: `${targets.length} ${noun} will be removed. This can't be undone.`,
        confirmLabel: 'Delete',
        confirmTone: 'danger',
      });
      if (!ok) return;
      const kept = fog.polygons.filter((p) => p.kind !== this.activeOverlayKind);
      this.state.setFog({ polygons: kept });
    });

    // ─── v2.12 unified — overlay kind picker ─────────────────────────────
    // Kind picking moved into the MapFX FX popover (sparkle button next
    // to the colour swatch). The popover hosts the kind dropdown; the
    // panel label shows the currently-active kind at a glance.
    // Initial-state syncs to the active kind so the brush + swatch +
    // fog editor + label all start coherent.
    this._applyActiveKindToBrush();
    this._applyKindToColourSwatch();
    this._updateActiveKindDisplay();
    this.fogEditor.setActiveKind(this.activeOverlayKind);

    document.querySelector('#fog-delete-btn')?.addEventListener('click', () => {
      this.fogEditor.deleteSelected();
    });

    // v2.12 — inline #fog-colour swatch removed. Colour is edited via
    // the popover's Colour row (which writes to fogEditor + state +
    // _pendingPaintInherit identically to the old handler). The brush
    // colour source for new polygons is fogEditor.getColor().

    // v2.12 — Edge Fade slider. Universal per-poly value baked into
    // the alpha mask at rasterise time. Same per-poly + draft +
    // inheritance pattern as colour and shader params:
    //   • Selected polygon: edits write to poly.edgeFade.
    //   • No selection: edits write to the kind's draft so the next
    //     new polygon inherits.
    //   • Mid-paint with inheritance pending: edits also update the
    //     inheritance snapshot.
    // v2.12 — Edge Fade input moved into the MapFX FX popover. The
    // popover's slider row wires its own onChange (see
    // _populateMapFxPopover), so no inline element / handler here.

    // v2.12 unified — brush + polygon commits go through the same paths.
    // Brush stroke end → _commitOverlayBrushStroke. Polygon close →
    // _commitOverlayPolygon. Both interpret the action (paint/erase) and
    // call _endAction so the single-shot Paint/Erase buttons reset.
    this.fogEditor.setBrushHandlers(
      (_settings, _points) => { /* live preview lives in FogEditor */ },
      (settings, points) => this._commitOverlayBrushStroke(settings, points),
    );
    this.fogEditor.setPolygonCompleteHandler((action, vertices) => {
      this._commitOverlayPolygon(action, vertices);
    });
    // v2.12 Magic Wand — single click in Fill mode runs flood-fill at
    // the click point and commits a polygon. Subsequent tolerance
    // slider changes mutate the same polygon until the GM clicks
    // again (new fill) or ends the action.
    this.fogEditor.setFillHandler((action, mapPos) => {
      this._commitOverlayFill(action, mapPos);
    });

    // Tolerance slider — re-runs the flood-fill on the last fill's
    // seed position and replaces that polygon's vertices live.
    //   • 'input' (live drag): fast mode (fixed 80-vert cap) so the
    //     polygon redraws sub-frame as the user scrubs.
    //   • 'change' (release / commit): dynamic mode upgrades the
    //     polygon — picks the honest vertex count for the shape the
    //     GM landed on. Costs 5-15 ms; invisible against a release.
    const tolSlider = document.querySelector<HTMLInputElement>('#fog-fill-tolerance');
    tolSlider?.addEventListener('input', (e) => {
      const tolerance = parseFloat((e.target as HTMLInputElement).value);
      if (!Number.isFinite(tolerance)) return;
      this._reflowLastFill(tolerance, 'fast');
    });
    tolSlider?.addEventListener('change', (e) => {
      const tolerance = parseFloat((e.target as HTMLInputElement).value);
      if (!Number.isFinite(tolerance)) return;
      this._reflowLastFill(tolerance, 'dynamic');
    });
  }

  /** v2.12 — polygon-mode commit. Paint adds a new polygon; erase carves
   *  through every overlapping polygon via polygon-difference (same
   *  pipeline as the brush erase). Both call _endAction afterwards so the
   *  single-shot Paint/Erase buttons return to neutral. */
  private _commitOverlayPolygon(action: 'paint' | 'erase', vertices: import('../types.ts').FogVertex[]): void {
    if (vertices.length < 3) { this._endAction(); return; }
    const fog = this.state.getState().fog;
    if (action === 'erase') {
      const result = subtractFromAll(fog.polygons, vertices);
      this.state.setFog({ polygons: result });
    } else {
      const k = overlayKind(this.activeOverlayKind);
      const inherit = this._pendingPaintInherit;
      const color = inherit
        ? inherit.color
        : (k.allowColor ? this.fogEditor.getColor() : k.defaultColor);
      const draft = fog.shaderParams?.[this.activeOverlayKind] ?? {};
      const params = inherit ? inherit.shaderParams : draft;
      // Edge-fade fall-through: explicit poly value → inheritance →
      // kind draft → per-kind default → DEFAULT_EDGE_FADE. Fog overrides
      // to 0 so the obscured area reads as a hard gameplay boundary.
      // typeof check is critical so an explicit 0 (GM wants hard
      // edge) doesn't get bumped up to the default.
      const kindDefault = k.defaultEdgeFade ?? DEFAULT_EDGE_FADE;
      const draftEdgeFade = typeof draft['edgeFade'] === 'number' ? draft['edgeFade']! : kindDefault;
      const edgeFade = inherit ? inherit.edgeFade : draftEdgeFade;
      const poly: FogPolygon = {
        id:        generateId(),
        kind:      this.activeOverlayKind,
        vertices,
        color,
        ...(Object.keys(params).length > 0 ? { shaderParams: { ...params } } : {}),
        ...(edgeFade > 0 ? { edgeFade } : {}),
        createdAt: Date.now(),
      };
      this.state.setFog({ polygons: [...fog.polygons, poly] });
    }
    this._endActionAndRearm(action);
  }

  /** v2.12 — selection → panel sync. Called when the GM clicks a polygon
   *  to select it: switches the kind dropdown to the polygon's kind and
   *  runs the same cascade the manual dropdown change runs, so the
   *  shader-params panel + colour swatch + brush defaults all match the
   *  picked polygon. */
  private _syncPanelToKind(kind: OverlayKind): void {
    this.activeOverlayKind = kind;
    this._applyActiveKindToBrush();
    this._applyKindToColourSwatch();
    this._updateActiveKindDisplay();
    this.fogEditor.setActiveKind(kind);
    this.fogEditor.setColor(overlayKind(kind).defaultColor);
    // Popover (if open) rebuilds to highlight the new active kind +
    // show its params. Closed popover is a no-op.
    this._mapfxFxPopover?.refresh();
  }

  /** Push the active brush kind's defaults into the FogEditor's brush
   *  settings (colour + radius). Called when the kind dropdown changes. */
  private _applyActiveKindToBrush(): void {
    const k = overlayKind(this.activeOverlayKind);
    this.fogEditor.setBrushSettings({ color: k.defaultColor, radius: k.defaultRadius });
  }

  /** v2.12 — shader-params display moved into the MapFX FX popover
   *  (sparkle button next to the colour swatch). Legacy callers still
   *  fire this method when state changes; we now route to a popover
   *  refresh instead of rebuilding an inline element. No-op when the
   *  popover isn't open OR when the change originated inside the
   *  popover itself (avoids the mid-drag DOM rebuild that kills
   *  pointer capture on sliders). */
  private _rebuildShaderParamsPanel(): void {
    if (this._suppressPopoverRefresh) return;
    this._mapfxFxPopover?.refresh();
  }

  /** Open the MapFX side panel. Content: Edge Fade slider + the active
   *  kind's shader-param rows. Kind itself is picked from the inline
   *  <select> on the FoW row (v2.16.35); this panel is the focused
   *  "tune what's selected" surface. */
  private _openMapFxPopover(): void {
    if (this._mapfxFxPopover) return;
    void import('./SidePanel.ts').then(({ openSidePanel }) => {
      if (this._mapfxFxPopover) return;
      this._mapfxFxPopover = openSidePanel({
        title: `MapFX — ${overlayKind(this.activeOverlayKind).label}`,
        populate: (body) => { this._populateMapFxPopover(body); },
        onClose: () => { this._mapfxFxPopover = null; },
      });
    });
  }

  /** Fill the MapFX popover with kind picker + Edge Fade + the active
   *  kind's shader-param controls. Pulled out so populate() and the
   *  refresh hook both go through one builder. Layout mirrors the
   *  Backdrop FX popover: list-of-kinds at top, params below.
   *
   *  Edit-target resolution (matches the original inline behaviour):
   *    • Editing a polygon of the active kind  → show poly's stored values.
   *    • Mid-paint with inheritance snapshot   → show snapshot values.
   *    • Otherwise                             → show the kind draft. */
  private _populateMapFxPopover(root: HTMLElement): void {
    const k = overlayKind(this.activeOverlayKind);
    const fog = this.state.getState().fog;
    const draft = fog.shaderParams?.[this.activeOverlayKind] ?? {};
    const selectedId = this.fogEditor.getSelectedId();
    const selectedPoly = selectedId ? fog.polygons.find((p) => p.id === selectedId) ?? null : null;
    const editingPoly = selectedPoly && selectedPoly.kind === this.activeOverlayKind ? selectedPoly : null;
    const inherit = !editingPoly ? this._pendingPaintInherit : null;

    // v2.16.35 — kind picker promoted to the inline row's <select>
    // (#mapfx-kind-display, wired in _bindMapFxKindSelect). Side panel
    // body now starts with the contextual header below.

    // Small header so the GM knows what they're editing.
    const hdr = document.createElement('div');
    hdr.className = 'fog-shader-params-header fx-popover-params-header';
    hdr.textContent = editingPoly
      ? `${k.label} — selected polygon`
      : (inherit ? `${k.label} — about to paint (inherited)` : `${k.label} — next new polygon`);
    root.appendChild(hdr);

    // ─── Per-kind colour (when the kind opts in via allowColor) ──────
    // Mirrors the inline #fog-colour swatch behaviour but lives in
    // the popover so the GM can tune all aspects of an effect in one
    // focused place. Kinds with allowColor: false skip this row —
    // their colour is the kind's identity (e.g. aurora's dual-colour
    // params replace a single-swatch).
    if (k.allowColor) {
      const currentColor =
        editingPoly && editingPoly.color ? editingPoly.color :
        inherit                          ? inherit.color :
        (this.fogEditor.getColor() || k.defaultColor);
      const colourDef: import('../mapfx/overlayKindRegistry.ts').ColorParamDef = {
        id: 'color', label: 'Colour', type: 'color', default: k.defaultColor,
      };
      const colourRow = this._buildShaderColorRow(
        colourDef, k.label, currentColor,
        (hex) => {
          // Update the FogEditor's brush colour (source of truth for
          // "next new polygon" tint), recolour the selected polygon
          // if one is active, and keep any pending paint-inherit
          // snapshot in sync so the about-to-be-painted polygon
          // commits with the GM's latest tweak. Suppress popover
          // refresh while dispatching so the live colour input keeps
          // its pointer capture (no mid-drag DOM rebuild).
          this._suppressPopoverRefresh = true;
          try {
            this.fogEditor.setColor(hex);
            this.fogEditor.setBrushSettings({ color: hex });
            if (editingPoly) this.state.setPolygonColor(editingPoly.id, hex);
            if (this._pendingPaintInherit) this._pendingPaintInherit.color = hex;
          } finally {
            this._suppressPopoverRefresh = false;
          }
        },
      );
      root.appendChild(colourRow);
    }

    // ─── Edge Fade (universal, applies to every kind) ────────────────
    const kindDefault = k.defaultEdgeFade ?? DEFAULT_EDGE_FADE;
    let edgeFadeValue: number;
    if (editingPoly) {
      edgeFadeValue = typeof editingPoly.edgeFade === 'number' ? editingPoly.edgeFade : kindDefault;
    } else if (inherit) {
      edgeFadeValue = inherit.edgeFade;
    } else {
      const v = draft['edgeFade'];
      edgeFadeValue = typeof v === 'number' && Number.isFinite(v) ? v : kindDefault;
    }
    const edgeFadeDef: import('../mapfx/overlayKindRegistry.ts').SliderParamDef = {
      id: 'edgeFade', label: 'Edge Fade', min: 0, max: 0.2, step: 0.05, default: kindDefault,
    };
    const edgeFadeRow = this._buildShaderSliderRow(
      edgeFadeDef, k.label, edgeFadeValue,
      (v) => {
        // Suppress popover refresh during the drag so pointer
        // capture survives — same protection as the colour row.
        this._suppressPopoverRefresh = true;
        try {
          if (editingPoly) this.state.setPolygonEdgeFade(editingPoly.id, v);
          this.state.setShaderParams(this.activeOverlayKind, { edgeFade: v });
          if (this._pendingPaintInherit) this._pendingPaintInherit.edgeFade = v;
        } finally {
          this._suppressPopoverRefresh = false;
        }
      },
    );
    root.appendChild(edgeFadeRow);

    // ─── Kind-specific params ────────────────────────────────────────
    const defs = k.shaderParams ?? [];
    if (defs.length === 0) return;

    const polyValues = editingPoly?.shaderParams ?? {};
    const sourceMap: Record<string, number | string> =
      editingPoly ? polyValues :
      inherit     ? inherit.shaderParams :
                    draft;
    for (const p of defs) {
      const stored = sourceMap[p.id];
      const onChange = (v: number | string) => {
        // Suppress popover refresh during the drag so the slider
        // doesn't get rebuilt mid-stroke and lose pointer capture.
        this._suppressPopoverRefresh = true;
        try {
          this.state.setShaderParams(this.activeOverlayKind, { [p.id]: v });
          if (editingPoly) this.state.setPolygonShaderParams(editingPoly.id, { [p.id]: v });
          if (this._pendingPaintInherit) this._pendingPaintInherit.shaderParams[p.id] = v;
        } finally {
          this._suppressPopoverRefresh = false;
        }
      };
      let row: HTMLElement;
      if (p.type === 'color') {
        const hex = typeof stored === 'string' && /^#[0-9a-fA-F]{6}$/.test(stored) ? stored : p.default;
        row = this._buildShaderColorRow(p, k.label, hex, (v) => onChange(v));
      } else if (p.type === 'toggle') {
        const n = typeof stored === 'number' && Number.isFinite(stored) ? stored : p.default;
        row = this._buildShaderToggleRow(p, k.label, n, (v) => onChange(v));
      } else {
        const n = typeof stored === 'number' && Number.isFinite(stored) ? stored : p.default;
        row = this._buildShaderSliderRow(p, k.label, n, (v) => onChange(v));
      }
      root.appendChild(row);
    }
  }

  /** Helper: build one labelled toggle row for a binary shader param.
   *  Matches the FilterPanel's `.toggle-switch` styling. onChange
   *  fires with 1 (on) or 0 (off). */
  /** v2.16.39 — shader param row helpers now delegate to the shared
   *  sideParamRows builders so Backdrop / MapFX / Visual Filter /
   *  Map Transition all render identical markup. The wrappers stay
   *  here so existing call sites (kindLabel suffix, 0/1 ⇄ boolean for
   *  shader toggles) need no churn. */
  private _buildShaderToggleRow(
    p: import('../mapfx/overlayKindRegistry.ts').ToggleParamDef,
    kindLabel: string,
    initial: number,
    onChange: (v: number) => void,
  ): HTMLElement {
    return buildToggleRow(
      { label: p.label, checked: initial > 0.5, title: `${p.label} — ${kindLabel}` },
      (checked) => onChange(checked ? 1 : 0),
    );
  }

  private _buildShaderSliderRow(
    p: import('../mapfx/overlayKindRegistry.ts').SliderParamDef,
    kindLabel: string,
    initial: number,
    onChange: (v: number) => void,
  ): HTMLElement {
    return buildSliderRow(
      { label: p.label, min: p.min, max: p.max, step: p.step, value: initial, title: `${p.label} — ${kindLabel}` },
      onChange,
    );
  }

  private _buildShaderColorRow(
    p: import('../mapfx/overlayKindRegistry.ts').ColorParamDef,
    kindLabel: string,
    initial: string,
    onChange: (v: string) => void,
  ): HTMLElement {
    return buildColorRow(
      { label: p.label, value: initial, title: `${p.label} — ${kindLabel}` },
      onChange,
    );
  }

  /** v2.12 — Edge Fade UI moved into the MapFX FX popover. Legacy
   *  callers still fire this on selection / kind changes; we route
   *  to a popover refresh instead of mutating an inline slider.
   *  No-op when the popover isn't open OR when the change came from
   *  the popover (same drag-capture protection as
   *  _rebuildShaderParamsPanel). */
  private _applyEdgeFadeSlider(): void {
    if (this._suppressPopoverRefresh) return;
    this._mapfxFxPopover?.refresh();
  }

  /** Sync the colour swatch to the current selection + kind.
   *    • A polygon of the active kind selected → swatch shows that
   *      polygon's colour (or kind default if the polygon has none).
   *    • No matching selection → swatch shows the kind default
   *      ("next new polygon" colour, which the input handler also
   *      writes through to the brush for paint-mode).
   *  Greys out for identity-colour kinds (electric is always
   *  electric-blue, etc.). */
  private _applyKindToColourSwatch(): void {
    // Inline #fog-colour swatch was removed in v2.12 — colour is now
    // edited via the popover. This function keeps its name + call
    // sites but only does the FogEditor brush-colour sync now:
    // pulls the selected polygon's colour (if of the active kind)
    // or the kind default into the brush, so a freshly-painted
    // polygon picks up the right tint without the GM touching the
    // popover. No-op when the kind doesn't allow colour.
    const k = overlayKind(this.activeOverlayKind);
    if (!k.allowColor) return;
    const selectedId = this.fogEditor.getSelectedId();
    const selectedPoly = selectedId
      ? this.state.getState().fog.polygons.find((p) => p.id === selectedId) ?? null
      : null;
    const editingPoly = selectedPoly && selectedPoly.kind === this.activeOverlayKind ? selectedPoly : null;
    const value = editingPoly?.color ?? k.defaultColor;
    this.fogEditor.setColor(value);
  }

  /** v2.12 — start a Paint or Erase action under the current Drawing Mode.
   *  Activates the drawing tool (polygon-click flow OR brush-drag flow)
   *  with the given action. Commit handlers call _endAction so single-shot
   *  behaviour returns to neutral after one shape lands.
   *
   *  Paint inheritance: if a polygon of the active kind is selected at
   *  the moment Paint is clicked, snapshot its colour + shaderParams
   *  into `_pendingPaintInherit`. The commit handler reads this so the
   *  new polygon inherits the exemplar's look ("paint another like
   *  this") — lets the GM lay down a row of identical campfires, a
   *  consistent river flow, etc. without re-tuning per shape. */
  private _startAction(action: 'paint' | 'erase'): void {
    this._actionInProgress = true;
    if (action === 'paint') {
      const selectedId = this.fogEditor.getSelectedId();
      const exemplar = selectedId
        ? this.state.getState().fog.polygons.find((p) => p.id === selectedId) ?? null
        : null;
      if (exemplar && exemplar.kind === this.activeOverlayKind) {
        const k = overlayKind(exemplar.kind);
        const color = (k.allowColor && exemplar.color) ? exemplar.color : k.defaultColor;
        const shaderParams = exemplar.shaderParams ? { ...exemplar.shaderParams } : {};
        const edgeFade = typeof exemplar.edgeFade === 'number' ? exemplar.edgeFade : 0;
        this._pendingPaintInherit = { color, shaderParams, edgeFade };
        // Push the inherited colour into the brush + polygon-outline
        // colour so the live draw preview matches the exemplar.
        this.fogEditor.setColor(color);
        this.fogEditor.setBrushSettings({ color });
      } else {
        this._pendingPaintInherit = null;
      }
    } else {
      this._pendingPaintInherit = null;
    }

    const paintBtn = document.querySelector<HTMLButtonElement>('#fog-paint-btn');
    const eraseBtn = document.querySelector<HTMLButtonElement>('#fog-erase-btn');
    paintBtn?.classList.toggle('is-active', action === 'paint');
    eraseBtn?.classList.toggle('is-active', action === 'erase');
    // Push the action mode into the three editor paths so the eventual
    // commit routes correctly.
    this.fogEditor.setPolygonAction(action);
    this.fogEditor.setBrushSettings({ mode: action });
    this.fogEditor.setFillAction(action);
    if (this.drawingMode === 'polygon') {
      this.fogEditor.setBrushActive(false);
      this.fogEditor.setFillActive(false);
      this.fogEditor.enable();
    } else if (this.drawingMode === 'brush') {
      this.fogEditor.disable();
      this.fogEditor.setFillActive(false);
      this.fogEditor.setBrushActive(true);
    } else {
      // Fill mode — Magic Wand. Disable polygon + brush, enable fill.
      this.fogEditor.disable();
      this.fogEditor.setBrushActive(false);
      this.fogEditor.setFillActive(true);
    }
    this.markerEditor?.setPointerCapture(false);

    // fogEditor.enable() may have cleared the selection (polygon mode);
    // the resulting setOnModeChange has already clobbered the swatch
    // back to the kind default. If we have inheritance pending, snap
    // the swatch + slider panel back to the inherited values so the GM
    // visually sees what the new polygon will get.
    if (this._pendingPaintInherit) {
      // Inline swatch removed in v2.12 — the FogEditor's own brush
      // colour gets nudged so a brushed stroke picks up the inherited
      // tint, and the popover refreshes to show the snapshot values.
      this.fogEditor.setColor(this._pendingPaintInherit.color);
      this._applyEdgeFadeSlider();
      this._rebuildShaderParamsPanel();
    }
  }

  /** v2.14.2 — commit-and-rearm. After a polygon / brush stroke /
   *  fill commit, the GM almost always wants to lay another. Pre-2.14
   *  the button stayed sticky but visually went out-of-sync. v2.14
   *  fixed the visual bug by going single-shot (button cleared after
   *  every commit). v2.14.2 restores sticky behaviour the right way:
   *  the action ends cleanly (selection / brush / fill state reset),
   *  then re-arms the same action in the same tick so the button
   *  stays lit and the next pointer-down starts a fresh stroke.
   *  Re-clicking the action button or switching Drawing Mode is the
   *  explicit exit. */
  private _endActionAndRearm(action: 'paint' | 'erase', opts: { preserveFillState?: boolean } = {}): void {
    this._endAction(opts);
    this._startAction(action);
  }

  /** v2.12 — exit the current Paint/Erase action. Called by the action
   *  buttons (re-click to cancel), by the Drawing Mode switch, and
   *  automatically by polygon-complete + brush-commit handlers.
   *  Clears any pending paint-inheritance snapshot so the next Paint
   *  starts fresh.
   *
   *  v2.12.x — the button reset runs both synchronously AND in a
   *  follow-up microtask. Synchronous handles the simple case;
   *  microtask defends against the bug where a commit's downstream
   *  cascade (state.setFog → syncPolygons → emitMode → onModeChange
   *  → various panel rebuilds; plus FogEditor's own follow-up
   *  this.disable() after the commit handler returns) sometimes
   *  reaches DOM after our class removal. Whatever runs in that
   *  window can't out-race the microtask. Cheap, idempotent, and
   *  finally kills the "Paint stays lit after committing a polygon"
   *  report we couldn't reproduce from inspection. */
  private _endAction(opts: { preserveFillState?: boolean } = {}): void {
    this._actionInProgress = false;
    this._pendingPaintInherit = null;
    // Fill paint commits opt-in to preserving _lastFillState so the
    // Tolerance slider can keep refining the just-committed polygon
    // after the Paint button visually clears. Other commits (brush,
    // polygon, fill-erase) wipe it.
    if (!opts.preserveFillState) this._lastFillState = null;
    this._clearPaintEraseActive();
    this.fogEditor.disable();
    this.fogEditor.setBrushActive(false);
    this.fogEditor.setFillActive(false);
    this.markerEditor?.setPointerCapture(true);
    // Run the deactivation once more after the current event loop
    // tick drains — catches anything that re-asserts is-active via
    // any emitMode cascade triggered by setFog / syncPolygons.
    // Skipped when _actionInProgress flipped true between scheduling
    // and firing (e.g. drawing-mode pick → _endAction → immediate
    // _startAction). Otherwise the deferred clears would clobber
    // the legitimate new is-active state.
    queueMicrotask(() => { if (!this._actionInProgress) this._clearPaintEraseActive(); });
    setTimeout(() => { if (!this._actionInProgress) this._clearPaintEraseActive(); }, 0);
  }

  private _clearPaintEraseActive(): void {
    const paintBtn = document.querySelector<HTMLButtonElement>('#fog-paint-btn');
    const eraseBtn = document.querySelector<HTMLButtonElement>('#fog-erase-btn');
    paintBtn?.classList.remove('is-active');
    eraseBtn?.classList.remove('is-active');
  }

  /** Brush stroke commit. Converts the polyline to a polygon (offset at
   *  brush radius, converted from CSS px to map-norm at commit time so the
   *  GM gets fine-detail painting by zooming in), then either pushes it as
   *  a new overlay polygon (paint) or runs polygon-difference against
   *  every existing polygon (erase). Each stroke = one polygon, no
   *  auto-merge with other strokes. */
  private _commitOverlayBrushStroke(settings: import('../mapfx/BrushController.ts').BrushSettings, points: import('../types.ts').FogVertex[]): void {
    if (points.length === 0) return;
    const radMapNorm = this.fogEditor.radiusScreenPxToMapNorm(settings.radius);
    // offsetPolyline returns the flat-ended ribbon + a disc at each endpoint;
    // cleanRibbonToBlobs unions them so end-points round naturally and any
    // self-overlap (loops) absorbs without leaving cap imprints.
    const rings = offsetPolyline(points, radMapNorm);
    if (rings.length === 0) return;
    const blobs = cleanRibbonToBlobs(rings);
    if (blobs.length === 0) return;
    const fog = this.state.getState().fog;
    if (settings.mode === 'erase') {
      let polys = fog.polygons;
      for (const blob of blobs) polys = subtractFromAll(polys, blob.outer);
      this.state.setFog({ polygons: polys });
      // v2.14.2 sticky: re-arm the same action so the GM can drag
      // again without re-clicking Erase. Click Erase or switch
      // Drawing Mode to exit.
      this._endActionAndRearm('erase');
      return;
    }
    // Paint — one new polygon per blob, holes preserved (a donut scribble
    // keeps its hole). Erase carving still preserves target-polygon holes
    // separately via subtractFromAll.
    //
    // Inheritance:
    //   • If Paint was clicked with a polygon selected, every blob in
    //     this stroke inherits that exemplar's colour + shaderParams
    //     (paint-another-like-this).
    //   • Otherwise blobs inherit the kind's current draft (the
    //     last-tweaked-or-painted look).
    const k = overlayKind(this.activeOverlayKind);
    const now = Date.now();
    const inherit = this._pendingPaintInherit;
    const draft = fog.shaderParams?.[this.activeOverlayKind] ?? {};
    const params = inherit ? inherit.shaderParams : draft;
    const inheritedColor = inherit?.color;
    // Same fall-through as the polygon-mode commit: poly value (no
    // selection here) → inheritance → kind draft → per-kind default →
    // DEFAULT_EDGE_FADE.
    const kindDefault = k.defaultEdgeFade ?? DEFAULT_EDGE_FADE;
    const draftEdgeFade = typeof draft['edgeFade'] === 'number' ? draft['edgeFade']! : kindDefault;
    const edgeFade = inherit ? inherit.edgeFade : draftEdgeFade;
    const paramsCopy = Object.keys(params).length > 0 ? { shaderParams: { ...params } } : {};
    const edgeFadeCopy = edgeFade > 0 ? { edgeFade } : {};
    const newPolys: FogPolygon[] = blobs.map((blob) => ({
      id:        generateId(),
      kind:      this.activeOverlayKind,
      vertices:  blob.outer,
      ...(blob.holes.length > 0 ? { holes: blob.holes } : {}),
      ...paramsCopy,
      ...edgeFadeCopy,
      color:     inheritedColor ?? settings.color ?? k.defaultColor,
      createdAt: now,
    }));
    this.state.setFog({ polygons: [...fog.polygons, ...newPolys] });
    // v2.14.2 sticky: re-arm the same action so the GM can drag
    // again without re-clicking Paint. Click Paint or switch
    // Drawing Mode to exit.
    this._endActionAndRearm('paint');
  }

  /** v2.12 Magic Wand commit. Click in Fill mode runs flood-fill at
   *  the click position on the map and creates a polygon. Subsequent
   *  Tolerance slider drags re-run from the same seed via
   *  _reflowLastFill, mutating that polygon's vertices live.
   *  Clicking again starts a fresh fill. */
  private _commitOverlayFill(action: 'paint' | 'erase', mapPos: import('../types.ts').FogVertex): void {
    const tol = this._currentFillTolerance();
    // Initial click commit — afford the 5-15 ms for adaptive
    // simplification so the polygon lands with the honest vertex
    // count for its shape (smooth blobs settle to ~40, jagged
    // silhouettes get up to 500).
    const polyVerts = this._runFloodFill(mapPos, tol, 'dynamic');
    if (!polyVerts) {
      // Bad seed (off-map, tiny region, or no map loaded). Leave the
      // action mode active so the GM can try clicking a different
      // spot or widening the tolerance first.
      return;
    }
    const fog = this.state.getState().fog;
    if (action === 'erase') {
      const result = subtractFromAll(fog.polygons, polyVerts);
      this.state.setFog({ polygons: result });
      // Erase doesn't have a "last fill" to mutate via tolerance —
      // each erase commits. v2.14.10 — back to sticky (was single-shot
      // in 2.14.6). Single-shot lost tolerance-slider fine-tuning
      // after each commit; sticky keeps the slider live until the GM
      // explicitly clicks Paint/Erase to exit. Paint button gains a
      // "PAINTING" / "ERASING" label when active (CSS, see below) so
      // the live state is unmistakable.
      this._lastFillState = null;
      this._endActionAndRearm('erase');
      return;
    }
    // Paint — inheritance + draft + default chain like the other commits.
    const k = overlayKind(this.activeOverlayKind);
    const inherit = this._pendingPaintInherit;
    const color = inherit
      ? inherit.color
      : (k.allowColor ? this.fogEditor.getColor() : k.defaultColor);
    const draft = fog.shaderParams?.[this.activeOverlayKind] ?? {};
    const params = inherit ? inherit.shaderParams : draft;
    const kindDefault = k.defaultEdgeFade ?? DEFAULT_EDGE_FADE;
    const draftEdgeFade = typeof draft['edgeFade'] === 'number' ? draft['edgeFade']! : kindDefault;
    const edgeFade = inherit ? inherit.edgeFade : draftEdgeFade;
    const poly: FogPolygon = {
      id:        generateId(),
      kind:      this.activeOverlayKind,
      vertices:  polyVerts,
      color,
      ...(Object.keys(params).length > 0 ? { shaderParams: { ...params } } : {}),
      ...(edgeFade > 0 ? { edgeFade } : {}),
      createdAt: Date.now(),
    };
    this.state.setFog({ polygons: [...fog.polygons, poly] });
    // Stash the seed so the Tolerance slider can re-flood and
    // replace this polygon's vertices. Survives _endAction below
    // because the Tolerance handler reads _lastFillState directly
    // and doesn't care whether the fill action is "live" — the
    // refinement workflow stays intact after the button clears.
    this._lastFillState = { polyId: poly.id, seedX: mapPos.x, seedY: mapPos.y, action };
    // v2.14.10 — back to sticky. Tolerance slider keeps refining the
    // last fill; further canvas clicks lay another fill. Click Paint
    // again (or switch Drawing Mode) to exit. preserveFillState
    // survives the re-arm so the slider keeps the same target until
    // the next fill click replaces it.
    this._endActionAndRearm('paint', { preserveFillState: true });
  }

  /** v2.12 — re-run the last fill at a new tolerance and replace the
   *  polygon's vertices. No-op if there's no last fill or the seed
   *  no longer flood-fills cleanly at the new tolerance (e.g.
   *  tolerance 0 on a noisy map gives nothing). */
  private _reflowLastFill(tolerance: number, mode: 'fast' | 'dynamic' = 'fast'): void {
    const last = this._lastFillState;
    if (!last) return;
    const polyVerts = this._runFloodFill({ x: last.seedX, y: last.seedY }, tolerance, mode);
    if (!polyVerts) return;
    const fog = this.state.getState().fog;
    const polygons = fog.polygons.map((p) =>
      p.id === last.polyId ? { ...p, vertices: polyVerts } : p
    );
    this.state.setFog({ ...fog, polygons });
  }

  /** Read the Tolerance slider's current value (0..1). Defaults to
   *  0.1 if the slider hasn't been initialised. */
  private _currentFillTolerance(): number {
    const slider = document.getElementById('fog-fill-tolerance') as HTMLInputElement | null;
    const v = slider ? parseFloat(slider.value) : 0.1;
    return Number.isFinite(v) ? v : 0.1;
  }

  /** Run flood-fill at the given map-norm position with the given
   *  tolerance. Returns vertices in map-norm space, or null on
   *  failure (no map loaded, seed off-map, fill too small).
   *
   *  `mode` selects the simplification strategy:
   *    • 'fast' — fixed 80-vertex cap. Used during live slider drag
   *      so feedback is predictable and sub-frame.
   *    • 'dynamic' — adaptive ladder (40 → 80 → 200 → 500), stops at
   *      the smallest cap where bumping higher only changes coverage
   *      by < 1% IoU. Used on initial click commit and slider
   *      release. Adds 5-15 ms; invisible against a click. */
  private _runFloodFill(
    mapPos: import('../types.ts').FogVertex,
    tolerance: number,
    mode: 'fast' | 'dynamic' = 'fast',
  ): import('../types.ts').FogVertex[] | null {
    const imgData = this.renderer.getMapImageData();
    if (!imgData) return null;
    const seedX = Math.round(mapPos.x * (imgData.width - 1));
    const seedY = Math.round(mapPos.y * (imgData.height - 1));
    const opts = mode === 'dynamic'
      ? { tolerance, dynamic: true }
      : { tolerance };
    const result = floodFillToPolygon(imgData, seedX, seedY, opts);
    if (!result || result.pixels.length < 3) return null;
    // Convert image-pixel vertices back to map-normalised coords.
    const verts: import('../types.ts').FogVertex[] = result.pixels.map((p) => ({
      x: p.x / (imgData.width - 1),
      y: p.y / (imgData.height - 1),
    }));
    return verts;
  }

  private bindFilterPanel(): void {
    // v2.16.37 — params + "Tint Player Markers" toggle moved into the
    // side panel (the sliders icon next to the picker opens it). The
    // inline FilterPanel that used to render into #filter-params is
    // gone; a fresh one is constructed inside the side panel each open.
    // Populate the inline dropdown + wire its change handler here.
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
    // Sliders button → open the side panel.
    document.querySelector('#filter-fx-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._filterSidePanel) this._filterSidePanel.close();
      else this._openFilterSidePanel();
    });
  }

  /** v2.16.37 — open the Visual Filter side panel: per-map "Tint Player
   *  Markers" toggle + the active filter's parameter controls. Same
   *  framework as the Backdrop / MapFX panels. */
  private _openFilterSidePanel(): void {
    if (this._filterSidePanel) return;
    void import('./SidePanel.ts').then(({ openSidePanel }) => {
      if (this._filterSidePanel) return;
      const def = filterRegistry.getOrFallback(this.state.getState().filter.filterId);
      this._filterSidePanel = openSidePanel({
        title: `Visual Filter — ${def.name}`,
        populate: (body) => { this._populateFilterSidePanel(body); },
        onClose: () => {
          this._filterSidePanel = null;
          this._filterPanelInstance = null;
        },
      });
    });
  }

  /** Build the side panel body: tint toggle (gated by "any player marker
   *  on the active map") + FilterPanel-rendered controls for the active
   *  filter's params. */
  private _populateFilterSidePanel(body: HTMLElement): void {
    const state = this.state.getState();
    const filter = state.filter;
    const def = filterRegistry.getOrFallback(filter.filterId);

    // Tint Player Markers row — only show when this map has at least
    // one player marker placed (matches the prior inline gate).
    const mapId = this._activeMapId();
    const hasMarkers = mapId
      ? this.playerRegistry.all().some((p) => p.placements?.[mapId])
      : false;
    if (hasMarkers) {
      const row = document.createElement('label');
      row.className = 'filter-affect-markers';
      row.title = 'Tint player tokens on the player + projector views to match this filter\'s palette (colour shift only — not the procedural scanlines / grain / animation)';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!filter.affectPlayerMarkers;
      cb.addEventListener('change', () => {
        this.state.setFilterAffectPlayerMarkers(cb.checked);
      });
      const lbl = document.createElement('span');
      lbl.textContent = 'Tint Player Markers';
      row.appendChild(cb);
      row.appendChild(lbl);
      body.appendChild(row);
    }

    // Params via FilterPanel rendered into a body-local container.
    const paramsWrap = document.createElement('div');
    paramsWrap.className = 'filter-params-container';
    body.appendChild(paramsWrap);
    const fp = new FilterPanel(paramsWrap, (values) => {
      const fid = this.state.getState().filter.filterId;
      this.state.setFilterParams(fid, values);
      this.renderer.updateFilterParams(fid, values);
    });
    fp.render(def, filter.params[filter.filterId] ?? {});
    // Keep a handle so external state changes (filter switched via the
    // inline dropdown while the panel is open) can update values without
    // tearing the whole body down.
    this._filterPanelInstance = fp;
  }

  /** Patch E — apply the CSS approximation of the active filter to the
   *  GM-side player-marker DOM overlay when the "Affect Player Markers"
   *  toggle is on. Mirrors what the player + projector views do, so the
   *  GM previews the same look. Clears the filter when the toggle is off. */
  private _applyMarkerLayerFilter(): void {
    const f = this.state.getState().filter;
    const layer = document.getElementById('player-marker-layer');
    if (!layer) return;
    if (f.affectPlayerMarkers) {
      const css = cssApproxForFilter(f.filterId);
      layer.style.filter = css || '';
    } else {
      layer.style.filter = '';
    }
  }

  private bindTransitionPanel(): void {
    // v2.16.38 — TransitionPanel rebuilds inside the side panel each
    // open. Inline #transition-params is gone. Match the Backdrop /
    // MapFX / Visual Filter shape.
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
      this.state.setTransition(this.buildTransitionConfig());
      // Side panel (if open) reflects the new kind + its params.
      const def = transitionRegistry.getOrFallback(this.activeTransitionId);
      this._transitionSidePanel?.setTitle(`Map Transition — ${def.label}`);
      this._transitionSidePanel?.refresh();
    });

    document.querySelector('#transition-fx-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._transitionSidePanel) this._transitionSidePanel.close();
      else this._openTransitionSidePanel();
    });
  }

  /** v2.16.38 — open the Map Transition side panel: per-kind params via
   *  TransitionPanel rendered into the body. Same framework as
   *  Backdrop / MapFX / Visual Filter. */
  private _openTransitionSidePanel(): void {
    if (this._transitionSidePanel) return;
    void import('./SidePanel.ts').then(({ openSidePanel }) => {
      if (this._transitionSidePanel) return;
      const def = transitionRegistry.getOrFallback(this.activeTransitionId);
      this._transitionSidePanel = openSidePanel({
        title: `Map Transition — ${def.label}`,
        populate: (body) => { this._populateTransitionSidePanel(body); },
        onClose: () => { this._transitionSidePanel = null; },
      });
    });
  }

  /** Build the side panel body: TransitionPanel-rendered params for the
   *  active transition. */
  private _populateTransitionSidePanel(body: HTMLElement): void {
    const def    = transitionRegistry.getOrFallback(this.activeTransitionId);
    const saved  = this.allTransitionParams[this.activeTransitionId] ?? transitionRegistry.defaultParams(this.activeTransitionId);
    const wrap = document.createElement('div');
    wrap.className = 'transition-params-container';
    body.appendChild(wrap);
    const tp = new TransitionPanel(wrap, (params) => {
      this.allTransitionParams[this.activeTransitionId] = params;
      this.state.setTransition(this.buildTransitionConfig());
    });
    tp.render(def, saved);
  }

  /** Returns the current transition config to include in a map_change
   *  broadcast. When the upcoming map_change is a reload of the same
   *  map (re-broadcast after an asset edit, retarget, etc. — same id
   *  before and after), we force transition=none so the player /
   *  projector don't re-run the entry transition. The user only wants
   *  to see the entry transition when actually switching to a different
   *  map, not when the GM has just tweaked the active one. */
  private buildTransitionConfig(): TransitionConfig {
    if (this._suppressNextMapTransition) {
      this._suppressNextMapTransition = false;
      return { transitionId: 'none', params: {} };
    }
    // Bypass switch on the panel header — when off, every transition
    // is reported as 'none' (an instant cut). Selected transition
    // persists in the dropdown for when the GM flips the switch back.
    if (this._transitionBypassed) return { transitionId: 'none', params: {} };
    return {
      transitionId: this.activeTransitionId,
      params: this.allTransitionParams[this.activeTransitionId] ?? transitionRegistry.defaultParams(this.activeTransitionId),
    };
  }

  /** Effective filter for broadcast + renderer — returns 'none' when
   *  the Visual Filter bypass switch is off, otherwise the live
   *  state.filter. Keeps the dropdown selection alive in the UI
   *  while suppressing the actual effect. */
  // ── v2.18 StarMap (docs/starmap-map-kind-design.md 4.3 / 4.4) ─────────────

  /** GM activation of a StarMap map. Loads the map's own saved config (so
   *  audio slots, projector viewport etc. still round-trip), then discovers
   *  the SSE session through the bridge and, once it matches, broadcasts
   *  starmap_show and shows the GM preview. Never broadcasts on a mismatch. */
  private async _loadStarMap(map: StoredMap, cfg: import('../types.ts').StarMapConfig): Promise<void> {
    await this.state.loadForMap({ id: map.id, name: map.name }, null);
    this.fogEditor.loadState(this.state.getState().fog);
    this.syncView(this.state.getState());
    this.filterSelect.value = this.state.getState().filter.filterId;
    this.setStatus('', 'ok');
    void loadSession().then((s) => { if (s) void saveSession({ ...s, lastMapId: map.id }); });
    this.interactions.reset();
    this.soundboardPanel.stopAll();
    this.soundboardPanel.update(this.state.getState().audio.slots);
    // No texture: clear map-bound overlays so nothing stale hangs over the frame.
    this._currentTextMapVideos = [];
    this.textMapVideoLayer?.setVideos([]);
    this.host.setLastTextMapVideos([]);
    this.host.broadcast({ type: 'textmap_videos', videos: [] });
    this._activeStarMap = cfg;
    this._applyStarMapUiGates(true);
    // Discovery. Any later announce (SSE opened / right map loaded) re-runs
    // the check, so the banner resolves itself without the GM re-clicking.
    this._starMapUnsub?.();
    this._starMapUnsub = sse2Bridge.onAnnounce((a, origin) => {
      if (this._activeStarMap !== cfg || origin !== Sse2Bridge.normaliseOrigin(cfg.origin)) return;
      void this._starMapReconcile(map, cfg, a);
    });
    const a = await sse2Bridge.hello(cfg.origin);
    if (this._activeStarMap !== cfg) return; // the GM moved on while we waited
    if (!a) {
      this._showStarMapBanner(
        `Open Star System Explorer to power "${cfg.starmapName} — ${cfg.presetName}". This map shows its live player view.`,
        [{ label: 'Open Star System Explorer', primary: true, onClick: () => sse2Bridge.openSse(cfg.origin) },
         { label: 'Retry', onClick: () => void this._loadStarMap(map, cfg) }],
      );
      return;
    }
    await this._starMapReconcile(map, cfg, a);
  }

  /** Compare what SSE announces with what this map expects; go live only on a match. */
  private async _starMapReconcile(map: StoredMap, cfg: import('../types.ts').StarMapConfig, a: SseAnnounce): Promise<void> {
    if (a.starmapId !== cfg.starmapId) {
      this._showStarMapBanner(
        `This map expects the starmap "${cfg.starmapName}", but Star System Explorer has "${a.starmapName}" loaded. Load "${cfg.starmapName}" there, or re-point this map.`,
        [{ label: 'Re-point to loaded starmap…', onClick: () => void this._editActiveStarMap() }],
      );
      return;
    }
    // Same starmap, different persistent session id (the owner regenerated it):
    // follow it and save, so the pack stays right for next time.
    if (a.sessionId !== cfg.sessionId) {
      cfg = { ...cfg, sessionId: a.sessionId };
      this._activeStarMap = cfg;
      const asset = await this.maps.getAsset(map.id);
      if (asset?.starMap) await MapAssetStore.update(asset.id, { starMap: cfg });
    }
    this._hideStarMapBanner();
    void sse2Bridge.ensureRemote(cfg.origin, cfg.sessionId); // remote players can dial in
    const payload = {
      origin: Sse2Bridge.normaliseOrigin(cfg.origin),
      sessionId: cfg.sessionId,
      presetId: cfg.presetId,
      backgroundColor: this.state.getState().view?.backgroundColor,
    };
    this.host.setLastStarMap(payload);
    this.host.broadcast({ type: 'starmap_show', payload });
    // Filters are forced off for the frame — tell viewers so nothing lingers.
    this.host.broadcast({ type: 'filter_update', payload: this._effectiveFilter() });
    this.starMapLayer?.show({ origin: payload.origin, sessionId: payload.sessionId, presetId: payload.presetId });
    this.renderer.setPaused(true);
  }

  /** Leaving StarMap mode (an ordinary map was activated). The viewer side
   *  ends StarMap mode on the incoming map_change; here we restore GM chrome. */
  private _leaveStarMap(): void {
    this._starMapUnsub?.(); this._starMapUnsub = null;
    this._activeStarMap = null;
    this.host.setLastStarMap(null);
    this._hideStarMapBanner();
    this.starMapLayer?.hide();
    this.renderer.setPaused(false);
    this._applyStarMapUiGates(false);
  }

  /** Disable gates (decision Q4/Q5): filters, viewport editors, fog, markers,
   *  grid and annotate tools have no meaning over a live external view. */
  private _applyStarMapUiGates(on: boolean): void {
    document.body.classList.toggle('starmap-active', on);
    const tip = on ? 'Filters run inside Star System Explorer for StarMap maps' : '';
    this.filterSelect.disabled = on;
    this.filterSelect.title = tip;
    const fx = document.querySelector<HTMLButtonElement>('#filter-fx-btn');
    if (fx) { fx.disabled = on; fx.title = tip; }
  }

  private _showStarMapBanner(text: string, actions: { label: string; primary?: boolean; onClick: () => void }[]): void {
    const el = document.getElementById('starmap-banner');
    if (!el) return;
    el.replaceChildren();
    const span = document.createElement('span');
    span.textContent = text;
    el.append(span);
    for (const a of actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn btn--sm ${a.primary ? 'btn--primary' : 'btn--ghost'}`;
      b.textContent = a.label;
      b.addEventListener('click', a.onClick);
      el.append(b);
    }
    el.hidden = false;
  }
  private _hideStarMapBanner(): void {
    const el = document.getElementById('starmap-banner');
    if (el) { el.hidden = true; el.replaceChildren(); }
  }

  /** Re-point / re-pick the active StarMap's preset via the same dialog. */
  private async _editActiveStarMap(): Promise<void> {
    const cfg = this._activeStarMap;
    const mapId = this.state.getState().map?.id;
    if (!cfg || !mapId) return;
    const asset = await this.maps.getAsset(mapId);
    if (!asset?.starMap) return;
    const result = await new StarMapDialog(asset.starMap).open();
    if (!result || result.presets.length === 0) return;
    const p = result.presets[0]!;
    const next: import('../types.ts').StarMapConfig = {
      origin: result.origin,
      sessionId: result.announce.sessionId,
      starmapId: result.announce.starmapId,
      starmapName: result.announce.starmapName,
      presetId: p.id,
      presetName: p.name,
    };
    await MapAssetStore.update(asset.id, { starMap: next, filename: `${next.starmapName} — ${next.presetName}` });
    const map = (await getAllMaps()).find((m) => m.id === mapId);
    if (map) await this.loadMap(map);
  }

  private _effectiveFilter(): FilterState {
    if (this._filterBypassed) return { filterId: 'none', params: {} };
    // v2.18 — a StarMap's look (CRT, thermal...) is the SSE preset's own GLSL
    // filter; Mappadux must not filter the frame again (no filter-in-filter).
    if (this._activeStarMap) return { filterId: 'none', params: {} };
    return this.state.getState().filter;
  }

  /** Apply current bypass state to the renderer + broadcast a fresh
   *  filter_update so player + projector match. Called whenever the
   *  filter bypass toggle flips. */
  private _reapplyFilterBypass(): void {
    const eff = this._effectiveFilter();
    this.renderer.setFilter(eff);
    this.host.broadcast({ type: 'filter_update', payload: eff });
  }
  /** One-shot flag — set true before a loadMap() that should NOT play
   *  the entry transition (same-map reload after an edit, fix-missing,
   *  re-target). Consumed and cleared by the next buildTransitionConfig
   *  call. */
  private _suppressNextMapTransition = false;
  /** Panel-header bypass switch: when true, every buildTransitionConfig
   *  call returns 'none' regardless of the selected transition. State
   *  is UI-only; the selected transition persists in the dropdown. */
  private _transitionBypassed = false;
  /** Panel-header bypass switch: when true, the broadcast filter
   *  payload + the local renderer's filter are forced to 'none'
   *  regardless of what's selected in the dropdown. */
  private _filterBypassed = false;

  /** Read the duration param of the currently-active map→map entry
   *  transition. Used by the auto-reveal scheduler to wait the right
   *  amount of time for the player's entry transition to finish before
   *  firing the handout reveal. Returns 0 for "no transition" cases
   *  (reload, 'none' picked, no duration param). */
  private _computeEntryTransitionDurationMs(isReload: boolean): number {
    if (isReload) return 0;
    if (this.activeTransitionId === 'none') return 0;
    const saved = this.allTransitionParams[this.activeTransitionId]?.['duration'];
    if (typeof saved === 'number') return saved;
    const def = transitionRegistry.get(this.activeTransitionId);
    const p = def?.params.find((q) => q.id === 'duration');
    if (p && p.type === 'slider') return p.default;
    return 0;
  }
  /** One-shot flag — set true before a loadMap() when we don't want
   *  the handout autoReveal to fire (Reset Animation path: we want the
   *  GM to manually click Start again rather than the reveal replaying
   *  the moment they reset). */
  private _suppressAutoReveal = false;

  private bindUIControls(): void {
    this.mapAssetModal = new MapAssetModal(
      this.maps,
      () => { /* onPick is assigned per-open call below */ },
      // When an asset is edited (currently: text-map handout edits), reload
      // the active map if it points at this asset — without this the GM
      // canvas keeps showing the pre-edit rasterisation until a manual
      // reload. The MapAssetModal already invalidated the rasterisation
      // cache, so loadMap re-fetches from MapAssetStore and the rasteriser
      // produces a fresh PNG with the new config.
      async (assetId: string) => {
        const currentId = this.state.snapshot().map?.id;
        if (!currentId) return;
        const storedMap = await getMap(currentId);
        if (storedMap?.mapAssetId === assetId) {
          await this.loadMap(storedMap);
        }
      },
    );

    // Click the GM brand icon (top-left duck) to copy the mappadux.com URL
    // to the clipboard. Tiny share-friendly shortcut so GMs can paste the
    // link into Discord / a player chat without leaving the GM screen.
    document.getElementById('gm-brand-icon')?.addEventListener('click', () => {
      void this._copyMappaduxUrl();
    });

    // v2.16.34 — "+" button beside the Map picker. Wires to the same
    // openAddMapDialog flow the SELECT_ADD_SENTINEL branch used to call,
    // so existing flows (modal cancel/restore, post-add dropdown refresh)
    // keep working identically.
    document.querySelector('#add-map-btn')?.addEventListener('click', () => {
      this.openAddMapDialog();
    });
    document.querySelector('#add-display-btn')?.addEventListener('click', () => {
      // Mirror the SELECT_ADD_SENTINEL branch in _onProjectorSelectChange:
      // calibration runs in its own popup so the user can drag it to the
      // physical display. Storage event refreshes the dropdown after save.
      window.open(`/calibrate.html${this._instanceQuery()}`, '_blank', 'noopener,popup,width=1280,height=800');
    });

    // Map selection — also handles the "+ Add New Map" sentinel that lives
    // at the bottom of the dropdown.
    this.mapSelect.addEventListener('change', async () => {
      const id = this.mapSelect.value;

      if (id === SELECT_ADD_SENTINEL) {
        // Revert visually before opening the modal so the dropdown doesn't
        // sit on the action item if the user cancels out.
        this.mapSelect.value = this._lastMapSelectValue;
        this.mapEditableSelect.refresh();
        this.openAddMapDialog();
        return;
      }

      if (!id) return;
      const all = await this.maps.getAll();
      const map = all.find((m) => m.id === id);
      if (map) {
        this._lastMapSelectValue = id;
        await this.loadMap(map);
      }
    });

    // Map delete
    document.querySelector('#delete-map-btn')?.addEventListener('click', async () => {
      const id = this.mapSelect.value;
      if (!id) return;
      const name = this.mapSelect.selectedOptions[0]?.text ?? 'this map';
      const ok = confirm(
        `Delete the map "${name}"?\n\n` +
        'This removes the named map and its settings (fog, markers, audio). ' +
        'The underlying map image asset stays in your library and can be reused.\n\n' +
        'This cannot be undone.'
      );
      if (!ok) return;
      try {
        await this.state.flushSave(); // commit any pending saves before wiping
        await this.maps.delete(id);
        await this.populateMapList();
        const remaining = await this.maps.getAll();
        if (remaining.length === 0) {
          this.setStatus('No maps — add one to get started', 'warn');
        }
      } catch (err) {
        this.setStatus(`Delete failed: ${(err as Error).message}`, 'error');
      }
    });

    // Fix Missing Map — open the picker, retarget the current map at the
    // chosen asset, drop the scratch instance the modal created for the pick.
    document.querySelector('#fix-missing-map-btn')?.addEventListener('click', () => {
      const targetId = this.mapSelect.value;
      if (!targetId) return;
      this.mapAssetModal.open(async (scratchMap) => {
        await this.maps.retargetMap(targetId, scratchMap.mapAssetId);
        await this.maps.delete(scratchMap.id);
        const fixed = (await this.maps.getAll()).find((m) => m.id === targetId);
        if (fixed) await this.loadMap(fixed);
      });
    });

    // v2.14.36 — Swap Map Asset (#26). Re-target the active map at
    // a different MapAsset from the library, preserving fog, markers,
    // audio, view state, etc. Re-uses the asset modal's onPick flow
    // (same shape Fix Missing Map uses): the modal creates a scratch
    // StoredMap pointing at the picked asset, we retarget our map to
    // that asset id, then delete the scratch. A confirm dialog up
    // front so swaps aren't accidental.
    document.querySelector('#swap-map-asset-btn')?.addEventListener('click', async () => {
      const targetId = this.mapSelect.value;
      if (!targetId) return;
      const currentMap = (await this.maps.getAll()).find((m) => m.id === targetId);
      if (!currentMap) return;
      const currentAsset = await MapAssetStore.get(currentMap.mapAssetId);
      const currentLabel = currentAsset?.filename ?? 'current asset';
      this.mapAssetModal.open(async (scratchMap) => {
        // Same asset picked → no-op except for scratch cleanup.
        if (scratchMap.mapAssetId === currentMap.mapAssetId) {
          await this.maps.delete(scratchMap.id);
          return;
        }
        const newAsset = await MapAssetStore.get(scratchMap.mapAssetId);
        const newLabel = newAsset?.filename ?? 'selected asset';
        const ok = await confirmDialog({
          title:        'Swap map asset?',
          body:         `Replace "${currentLabel}" with "${newLabel}" on "${currentMap.name}". Fog, markers, audio and view stay attached to the map — only the underlying image changes.`,
          confirmLabel: 'Swap',
        });
        if (!ok) {
          await this.maps.delete(scratchMap.id);
          return;
        }
        await this.maps.retargetMap(targetId, scratchMap.mapAssetId);
        await this.maps.delete(scratchMap.id);
        const swapped = (await this.maps.getAll()).find((m) => m.id === targetId);
        if (swapped) await this.loadMap(swapped);
      });
    });

    // Map clone
    document.querySelector('#clone-map-btn')?.addEventListener('click', async () => {
      const id = this.mapSelect.value;
      if (!id) return;
      try {
        await this.state.flushSave(); // ensure the source map's latest state is on disk
        const newMap = await this.maps.cloneMap(id);
        if (!newMap) return;
        // Cloned map shares its source asset, so the dropdown glyph
        // (image / animated / text) carries over — look it up the
        // same way the Add flow and populateMapList do.
        const asset = await MapAssetStore.get(newMap.mapAssetId);
        const kind = _dropdownKindForAsset(asset);
        this._insertMapOptionSorted(newMap.id, newMap.name, kind);
        this.mapSelect.value = newMap.id;
        this.mapEditableSelect.refresh();
        await this.loadMap(newMap);
      } catch (err) {
        this.setStatus(`Clone failed: ${(err as Error).message}`, 'error');
      }
    });

    // Pack rename — live-edit the workspace pack name. Debounced so we
    // don't hammer IDB on every keystroke; the value is the single source of
    // truth used by Save Map Pack, the splash/About fallback title, etc.
    this.packNameInput.addEventListener('input', () => {
      this._schedulePackNameSave(this.packNameInput.value);
    });
    this.packNameInput.addEventListener('blur', () => {
      this._schedulePackNameSave(this.packNameInput.value, /* immediate */ true);
      this._endPackNameEdit();
    });
    this.packNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.packNameInput.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); this._endPackNameEdit(); }
    });
    // v2.16.88 — pencil in the Map Pack header → inline-edit the name.
    document.getElementById('pack-name-edit-btn')?.addEventListener('click', (e) => {
      e.stopPropagation(); // don't toggle the panel collapse
      this._beginPackNameEdit();
    });

    // Map rename — now driven by the EditableSelect's onRename callback;
    // see _renameMap() below.


    // Bundle import — file picker change handler. Picker is triggered from the
    // hamburger ("Load Mappadux Pack") which calls `.click()` on the input.
    document.querySelector<HTMLInputElement>('#bundle-import')?.addEventListener('change', async (e) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = ''; // reset so the same file can be re-selected
      if (!file) return;
      await this.loadBundleFromFile(file);
    });

    // Background colour: inline #view-bg-colour swatch removed in
    // v2.12. The bg colour is now edited via the Backdrop popover's
    // Background row (see _populateBgFxPopover). Same state path
    // (state.setView({ ..., backgroundColor })), just no inline DOM
    // input to bind to.

    // FX button — opens a small popover of animated-backdrop options. Lives
    // here next to the colour picker because backdrop is the same kind of
    // decision ("what do my dead bars look like?") but for the animated
    // case rather than the solid one.
    // v2.16.35 — sliders button opens the right-edge side panel that
    // holds the active backdrop's params. Kind picker lives inline on
    // the row now (was inside the popover before).
    this.viewBgFxBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._bgFxPopover) this._bgFxPopover.close();
      else this._openBgFxPopover();
    });
    this.mapFxBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._mapfxFxPopover) this._mapfxFxPopover.close();
      else this._openMapFxPopover();
    });
    // Populate the inline kind selects + wire change handlers.
    this._bindBackdropKindSelect();
    this._bindMapFxKindSelect();

    // Open local player window as a real popup. We tag the URL with
    // ?gmPreview=1 so the popup recognises itself as the GM's preview view and
    // (by default) suppresses player-only chrome + interaction. Real player
    // tabs connecting via the QR never carry the flag.
    // v2.16.40 — Open Player Window button retired. The PlayerPip overlay
    // on the canvas (Show Player View / pop-out chrome) is the single
    // affordance now. The handler is removed; the HTML button is gone
    // too. Pop-out from the PiP frame opens a standalone window with
    // the same URL the old button used.

    // v2.16.33 — Copy-player-URL handlers used to live on the QR + a
    // dedicated copy button in the Player Connection panel. Both are
    // gone; players pick up the URL from the hold screen they see when
    // they aren't connected. If we add a top-of-sidebar / menu-level
    // "Copy player URL" entry later, the body of the old handler is
    // straightforward to revive.

    // Collapsible panel sections. Use the parent panel's .panel-body
    // child rather than nextElementSibling so panels with a header
    // bypass toggle (which sits between the title button and the body
    // in DOM order) still expand/collapse correctly.
    document.querySelectorAll<HTMLElement>('.panel-title[aria-expanded]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!expanded));
        const body = btn.closest('.panel')?.querySelector<HTMLElement>('.panel-body') ?? null;
        if (body) body.hidden = expanded;
      });
    });

    // v2.16.103 — Collapsible SUBPANELS (Player Views → Player connections /
    // Scaled view). Same aria-expanded / hidden mechanism, but scoped to the
    // subpanel's OWN body so it doesn't toggle the parent panel-body. Opening
    // the connections subpanel (re)renders the QR + window summary.
    document.querySelectorAll<HTMLElement>('.subpanel-title[aria-expanded]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!expanded));
        const body = btn.parentElement?.querySelector<HTMLElement>('.subpanel-body') ?? null;
        if (body) body.hidden = expanded;
        if (!expanded && btn.parentElement?.id === 'player-connections-sub') {
          this._renderConnectionsQr();
          this._renderConnectionsSummary();
        }
      });
    });

    // Panel-header bypass toggles. Each toggle stops propagation so a
    // click doesn't bubble to anything else; flipping the toggle
    // applies the bypass immediately on the local renderer + broadcasts
    // a fresh state to player + projector.
    const transToggle = document.querySelector<HTMLInputElement>('#transition-bypass-toggle');
    if (transToggle) {
      transToggle.addEventListener('click', (e) => e.stopPropagation());
      transToggle.addEventListener('change', () => {
        this._transitionBypassed = !transToggle.checked;
      });
    }
    const filterToggle = document.querySelector<HTMLInputElement>('#filter-bypass-toggle');
    if (filterToggle) {
      filterToggle.addEventListener('click', (e) => e.stopPropagation());
      filterToggle.addEventListener('change', () => {
        this._filterBypassed = !filterToggle.checked;
        this._reapplyFilterBypass();
      });
    }
    // mute-all-toggle is wired by SoundboardPanel — just stop click
    // propagation here so the panel-title doesn't expand/collapse when
    // the GM clicks the toggle.
    const muteToggle = document.querySelector<HTMLInputElement>('#mute-all-toggle');
    if (muteToggle) muteToggle.addEventListener('click', (e) => e.stopPropagation());
    // Markers-panel master mute: silences every positional-audio source
    // (local engine + broadcasts a hint to players). Mirrors the
    // Soundboard bypass switch but only affects marker audio.
    const markerMuteToggle = document.querySelector<HTMLInputElement>('#marker-mute-all-toggle');
    if (markerMuteToggle) {
      markerMuteToggle.addEventListener('click', (e) => e.stopPropagation());
      markerMuteToggle.addEventListener('change', () => {
        const muted = !markerMuteToggle.checked;
        this.audio.setMuteAll(muted);
        this.trackerAudio.setMuteAll(muted);
        this.host.broadcast({ type: 'positional_mute_all', muted });
        // v2.16.44 — let the audio coordinator know our local audio
        // state changed so other Mappadux windows can mute / claim
        // accordingly. Claim wins; release stops heartbeating.
        if (muted) this._audioCoord?.release();
        else       this._audioCoord?.claim();
      });
    }
    // v2.16.33 — single broadcast-bypass switch lives on the Player Views
    // panel header. Off broadcasts a "GM is faffing" placeholder to BOTH
    // the player views AND the projector / scaled views simultaneously;
    // the underlying map state keeps streaming so flipping back is
    // instant. A fresh faff message is picked on every off-flip.
    // (The old per-audience pair (Player Connection panel + Scaled View
    // panel) collapsed into this one — players + projectors are always
    // both "audience", and the two-toggle UI was prone to leaving one
    // half visible while the other was held.)
    this._wireBroadcastBypass('#projection-broadcast-toggle', ['player', 'projector']);

    // Paint initial "no connection" greying so the toggles are correctly
    // faded before any first connect/disconnect event fires.
    this._updatePlayerCount();

    // Local players ping us via BroadcastChannel every ~4s; their entries
    // expire after 10s of silence. Refresh the displayed count on the
    // same cadence so a closed player tab drops out of the count
    // promptly even without an explicit disconnect event.
    window.setInterval(() => this._updatePlayerCount(), 5000);
  }

  private _wireBroadcastBypass(selector: string, targets: ('player' | 'projector')[]): void {
    const toggle = document.querySelector<HTMLInputElement>(selector);
    if (!toggle) return;
    toggle.addEventListener('click', (e) => e.stopPropagation());
    toggle.addEventListener('change', () => {
      const show = !toggle.checked;
      // Share the same faff message across both target audiences for
      // this flip — feels like one decision, not two.
      const message = show ? randomFaffMessage() : '';
      for (const target of targets) {
        this.host.broadcast({ type: 'view_placeholder', target, show, message });
      }
      // v2.16.108 — remember it so a viewer that connects WHILE faffing gets
      // the hold screen on connect (full_state would otherwise show the map).
      this.host.setFaffState(show, message);
      // v2.14.3 — refresh the rect overlay so the eye icons on both
      // viewport rects mirror the new broadcast state (panel-header
      // toggle ↔ rect eyes stay in sync in both directions).
      this._refreshRectOverlays();
    });
  }

  /** Sample the top-left pixel of a map asset and return a CSS hex colour
   *  plus an `opaque` flag set when alpha > 0. Works for still images
   *  (createImageBitmap path) AND video maps (webm / mp4 — decode the
   *  first frame via a hidden <video>). On decode failure returns
   *  { hex: '#000000', opaque: false } so the caller can leave the
   *  default in place. The opaque flag lets the caller distinguish a
   *  genuinely-black pixel from a transparent one (both decode to
   *  RGB 0,0,0 in the canvas readback). */
  private async sampleTopLeftPixel(blob: ArrayBuffer): Promise<{ hex: string; opaque: boolean }> {
    try {
      if (_sniffIsVideo(blob)) return await this._sampleVideoTopLeft(blob);
      return await this._sampleImageTopLeft(blob);
    } catch {
      return { hex: '#000000', opaque: false };
    }
  }

  private async _sampleImageTopLeft(buffer: ArrayBuffer): Promise<{ hex: string; opaque: boolean }> {
    const bmp = await createImageBitmap(new Blob([buffer]));
    const cv  = document.createElement('canvas');
    cv.width  = 1;
    cv.height = 1;
    cv.getContext('2d')!.drawImage(bmp, 0, 0, 1, 1);
    bmp.close();
    const d = cv.getContext('2d')!.getImageData(0, 0, 1, 1).data;
    const hex = '#' + [d[0]!, d[1]!, d[2]!].map((v) => v.toString(16).padStart(2, '0')).join('');
    return { hex, opaque: (d[3] ?? 0) > 0 };
  }

  private _sampleVideoTopLeft(buffer: ArrayBuffer): Promise<{ hex: string; opaque: boolean }> {
    return new Promise<{ hex: string; opaque: boolean }>((resolve, reject) => {
      // Build a Blob with a video MIME so the element actually decodes
      // it — magic-byte sniff already picked the right path; we just
      // need to give the browser a hint.
      const mime = new Uint8Array(buffer.slice(0, 4))[0] === 0x1a ? 'video/webm' : 'video/mp4';
      const url  = URL.createObjectURL(new Blob([buffer], { type: mime }));
      const v    = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.src = url;
      const teardown = () => {
        URL.revokeObjectURL(url);
        v.removeAttribute('src');
        try { v.load(); } catch { /* benign */ }
      };
      // We need a paintable first frame, not just metadata — wait for
      // canplay (Chrome) / loadeddata (Safari) before drawing.
      const onReady = () => {
        try {
          const cv = document.createElement('canvas');
          cv.width = 1; cv.height = 1;
          cv.getContext('2d')!.drawImage(v, 0, 0, 1, 1);
          const d = cv.getContext('2d')!.getImageData(0, 0, 1, 1).data;
          const hex = '#' + [d[0]!, d[1]!, d[2]!].map((n) => n.toString(16).padStart(2, '0')).join('');
          teardown();
          resolve({ hex, opaque: (d[3] ?? 0) > 0 });
        } catch (err) {
          teardown();
          reject(err as Error);
        }
      };
      v.addEventListener('loadeddata', onReady, { once: true });
      v.addEventListener('error', () => { teardown(); reject(new Error('video decode failed')); }, { once: true });
    });
  }

  /** v2.12 — refresh the FX button's "active" dot so the GM can tell at
   *  a glance whether an animated backdrop is currently in play for
   *  the active map. Called whenever view state changes. */
  private _refreshBgFxButtonState(): void {
    const kind = this.state.getState().view.backdrop?.kind ?? 'none';
    this.viewBgFxBtn.classList.toggle('bg-fx-btn--active', kind !== 'none');
  }

  /** Open the backdrop FX popover anchored under the FX button.
   *
   *  Layout mirrors the MapFX popover for full consistency:
   *    • <select> dropdown for the backdrop kind (compact, scales as
   *      backdrops are added without growing the popover vertically).
   *    • Background Colour row (always present, even when backdrop is
   *      'none' — the bg colour is the pack-level setting that fills
   *      the bars when no backdrop is active).
   *    • Active backdrop's params (slider / toggle / color rows).
   *
   *  Drag-capture protection: the popover's slider / colour / toggle
   *  onChange paths flip _suppressBgPopoverRefresh so the structural
   *  refresh hooks skip the rebuild mid-drag. */
  private _openBgFxPopover(): void {
    void import('../rendering/backdrops/backdropRegistry.ts').then(async ({ BACKDROPS }) => {
      if (this._bgFxPopover) return;
      // v2.16.35 — was an anchored fx-popover; now a right-edge SidePanel.
      const { openSidePanel } = await import('./SidePanel.ts');
      const view  = this.state.getState().view;
      const kind  = view.backdrop?.kind ?? 'none';
      const entry = BACKDROPS.find((b) => b.id === kind);
      this._bgFxPopover = openSidePanel({
        title: `Backdrop — ${entry?.label ?? 'None'}`,
        populate: (body) => { this._populateBgFxPopover(body, BACKDROPS); },
        onClose: () => { this._bgFxPopover = null; },
      });
    });
  }

  /** v2.16.35 — populate the inline Backdrop kind <select> + wire its
   *  change handler. Was a kind picker inside the popover; promoted to
   *  the row so the GM can see + change the active kind at a glance. */
  private _bindBackdropKindSelect(): void {
    const sel = document.getElementById('view-bg-display') as HTMLSelectElement | null;
    if (!sel) return;
    void import('../rendering/backdrops/backdropRegistry.ts').then(({ BACKDROPS }) => {
      sel.innerHTML = '';
      for (const b of BACKDROPS) {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = b.label;
        sel.appendChild(opt);
      }
      this._updateActiveBgDisplay();
    });
    sel.addEventListener('change', () => {
      this._applyBackdrop(sel.value);
      // If the side panel is open, refresh its body so the params
      // section reflects the newly-active kind + sync the header title.
      void import('../rendering/backdrops/backdropRegistry.ts').then(({ BACKDROPS }) => {
        const entry = BACKDROPS.find((b) => b.id === sel.value);
        this._bgFxPopover?.setTitle(`Backdrop — ${entry?.label ?? 'None'}`);
      });
      this._bgFxPopover?.refresh();
    });
  }

  /** v2.16.35 — populate the inline MapFX kind <select> + wire its
   *  change handler. Mirror of _bindBackdropKindSelect — same idea, kind
   *  dropdown promoted from inside the popover to the row. */
  private _bindMapFxKindSelect(): void {
    const sel = document.getElementById('mapfx-kind-display') as HTMLSelectElement | null;
    if (!sel) return;
    sel.innerHTML = '';
    for (const id of OVERLAY_KIND_ORDER) {
      const entry = OVERLAY_KIND_REGISTRY[id];
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = entry.label;
      sel.appendChild(opt);
    }
    sel.value = this.activeOverlayKind;
    // v2.16.45 — Reveal Layer is map-state-dependent; ghost it when
    // the active map isn't multilayered.
    this._refreshMapFxKindOptionState();
    sel.addEventListener('change', () => {
      const newKind = sel.value as OverlayKind;
      if (this.activeOverlayKind === newKind) return;
      this.activeOverlayKind = newKind;
      // Morph any selected polygon to the new kind.
      const selId = this.fogEditor.getSelectedId();
      if (selId) this.state.setPolygonKind(selId, newKind);
      this._applyActiveKindToBrush();
      this._applyKindToColourSwatch();
      this.fogEditor.setActiveKind(newKind);
      this.fogEditor.setColor(overlayKind(newKind).defaultColor);
      // Refresh the side panel's body so the per-kind params reflect
      // the new active kind. setTitle keeps the header in sync.
      this._mapfxFxPopover?.refresh();
      this._mapfxFxPopover?.setTitle(`MapFX — ${overlayKind(newKind).label}`);
    });
  }

  /** Fill the backdrop popover with the kind dropdown + bg colour row
   *  + active backdrop's params. Pulled into its own method so
   *  populate() and refresh() share one builder. */
  private _populateBgFxPopover(
    root: HTMLElement,
    BACKDROPS: import('../rendering/backdrops/backdropRegistry.ts').BackdropEntry[],
  ): void {
    const view = this.state.getState().view;
    const currentKind = view.backdrop?.kind ?? 'none';
    const entry = BACKDROPS.find((b) => b.id === currentKind);

    // v2.16.35 — kind picker promoted to the inline row's <select>
    // (#view-bg-display, wired in _bindBackdropKindSelect). The side
    // panel body starts with the Background Colour row below.

    // ─── Background Colour (always available) ────────────────────────
    // The pack-level bg colour fills the bars when no backdrop is
    // active, and serves as the base over which any backdrop renders
    // its additive / alpha-composited output.
    const bgDef: import('../mapfx/overlayKindRegistry.ts').ColorParamDef = {
      id: 'background', label: 'Background', type: 'color', default: '#000000',
    };
    const bgRow = this._buildShaderColorRow(
      bgDef, 'Backdrop', view.backgroundColor || '#000000',
      (hex) => {
        // setView writes through to onStateChange which applies the
        // colour to the renderer + broadcasts. syncView updates the
        // panel label but doesn't rebuild the popover, so the live
        // drag keeps pointer capture without extra protection.
        this.state.setView({ ...this.state.getState().view, backgroundColor: hex });
      },
    );
    root.appendChild(bgRow);

    // ─── Active backdrop's params (if any) ───────────────────────────
    const params = entry?.params ?? [];
    if (params.length === 0) return;
    const label = entry?.label ?? currentKind;
    const stored = view.backdrop?.params ?? {};
    for (const p of params) {
      const onChange = (v: number | string) => {
        // setView (inside _setBackdropParam) writes through to
        // onStateChange which pushes the param value into the clip-
        // pass uniform; syncView updates the panel label but
        // doesn't rebuild the popover, so the drag survives.
        this._setBackdropParam(p.id, v);
      };
      let row: HTMLElement;
      if (p.type === 'color') {
        const v = stored[p.id];
        const hex = typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : p.default;
        row = this._buildShaderColorRow(p, label, hex, onChange);
      } else if (p.type === 'toggle') {
        const v = stored[p.id];
        const n = typeof v === 'number' && Number.isFinite(v) ? v : p.default;
        row = this._buildShaderToggleRow(p, label, n, onChange);
      } else {
        const v = stored[p.id];
        const n = typeof v === 'number' && Number.isFinite(v) ? v : p.default;
        row = this._buildShaderSliderRow(p, label, n, onChange);
      }
      root.appendChild(row);
    }
  }

  // _closeBgFxPopover removed — callers now use `this._bgFxPopover?.close()`
  // directly via the FxPopoverHandle, or click off / press Escape.

  /** Commit a backdrop choice into the active map's ViewState. The
   *  state change ripples through onStateChange → setBackdrop on the
   *  renderer and a view_update broadcast.
   *
   *  When swapping kinds, restore the kind's stashed draft (if any)
   *  so "I tuned Aurora last time and want it back" works without
   *  re-dialling. The draft is kept in view.backdropDrafts[kind] and
   *  populated on every _setBackdropParam call below. Mirrors the
   *  MapFX side, where fog.shaderParams[kind] serves the same role
   *  for per-poly shader-param drafts. */
  private _applyBackdrop(kind: string): void {
    const v = this.state.getState().view;
    const next = { ...v };
    if (kind === 'none') {
      delete next.backdrop;
    } else {
      const draft = v.backdropDrafts?.[kind];
      next.backdrop = draft && Object.keys(draft).length > 0
        ? { kind, params: { ...draft } }
        : { kind };
    }
    this.state.setView(next);
  }

  /** Patch a single backdrop param's value into the active map's
   *  ViewState. Triggered by the popover slider / colour-picker / toggle
   *  rows. No-op when no backdrop is currently active.
   *
   *  Writes the new value to TWO places:
   *    • backdrop.params — the live active config that drives the
   *      renderer and the player broadcast.
   *    • backdropDrafts[kind] — the per-kind stash that _applyBackdrop
   *      reads when the user switches to this kind again later. */
  private _setBackdropParam(id: string, value: number | string): void {
    const v = this.state.getState().view;
    if (!v.backdrop) return;
    const kind = v.backdrop.kind;
    const next = {
      ...v,
      backdrop: {
        ...v.backdrop,
        params: { ...(v.backdrop.params ?? {}), [id]: value },
      },
      backdropDrafts: {
        ...(v.backdropDrafts ?? {}),
        [kind]: { ...(v.backdropDrafts?.[kind] ?? {}), [id]: value },
      },
    };
    this.state.setView(next);
  }

  private syncView(state: SessionState): void {
    this.viewportEditor.setView(state.view);
    // Inline #view-bg-colour swatch was removed in v2.12; the
    // backdrop popover's Background row picks up the colour when
    // opened. Update the always-visible kind label on the Map panel
    // instead.
    this._updateActiveBgDisplay();
    this._refreshBgFxButtonState();
    if (state.projectorViewport) this.projectorEditor.setViewport(state.projectorViewport);
    this._refreshRectOverlays();
    this.refreshRotationButtons();
    this.refreshProjectionModeButtons();
    const vp = state.projectorViewport ?? defaultProjectorViewport();
    const filterToggle = document.getElementById('projection-filter-toggle') as HTMLInputElement | null;
    // UI toggle is "Disable Filters" — checked when filters are NOT applied.
    if (filterToggle) filterToggle.checked = !vp.filterEnabled;
  }

  /**
   * Push the active map's pixelsPerSquare and intrinsic image width to the
   * projector editor so it can size its viewport rectangle. Called whenever
   * the active map changes (or its calibration is updated).
   */
  private async refreshProjectorMapInfo(): Promise<void> {
    const mapState = this.state.snapshot().map;
    const warnEl = document.getElementById('projection-map-cal-warning');
    if (!mapState) {
      this.projectorEditor.setMapPixelsPerSquare(null);
      this.projectorEditor.setMapImageWidth(0);
      this.host.updateMapAssetInfo(undefined, undefined, undefined);
      this._lastMapAssetMeta = null;
      this._lastMapAssetGridColor = null;
      this._updateMapGridPanel();
      void this._updateUpperLayerPanel();
      if (warnEl) warnEl.hidden = true;
      this._broadcastRoles(false);
      return;
    }
    const asset = await this.maps.getAsset(mapState.id);
    if (!asset) {
      this.projectorEditor.setMapPixelsPerSquare(null);
      this.projectorEditor.setMapImageWidth(0);
      this.host.updateMapAssetInfo(undefined, undefined, undefined);
      this._lastMapAssetMeta = null;
      this._lastMapAssetGridColor = null;
      this._updateMapGridPanel();
      void this._updateUpperLayerPanel();
      if (warnEl) warnEl.hidden = true;
      this._broadcastRoles(false);
      return;
    }
    this.projectorEditor.setMapPixelsPerSquare(asset.pixelsPerSquare ?? null);
    this.projectorEditor.setMapImageWidth(asset.imageWidth ?? 0);
    // v2.14.34 — also cache offset + colour for late-joiner full_state.
    this.host.updateMapAssetInfo(
      asset.pixelsPerSquare, asset.imageWidth, asset.imageHeight,
      asset.gridOffsetX, asset.gridOffsetY, asset.gridColor,
    );
    this._lastMapAssetMeta = (asset.pixelsPerSquare && asset.imageWidth && asset.imageHeight)
      ? { pixelsPerSquare: asset.pixelsPerSquare, imageWidth: asset.imageWidth, imageHeight: asset.imageHeight }
      : null;
    // v2.14.31 — cache + render the map-scoped grid colour swatch.
    this._lastMapAssetGridColor = asset.gridColor ?? null;
    this._updateMapGridPanel();
    // v2.14.77 — also refresh the upper-layer-opacity row visibility.
    void this._updateUpperLayerPanel();
    // v2.16 — Stagecraft. Refresh the panel so its dropdowns reflect
    // the new map's assignments + fire the assigned WLED preset / HA
    // scene for the incoming map. Skipped when the map id matches the
    // last-fired one so a same-map state refresh (e.g. handout edit
    // round-trip) doesn't re-strobe the table lights. Both calls are
    // fire-and-forget; nothing here blocks on a flaky device.
    if (this.stagecraftPanel) void this.stagecraftPanel.refresh();
    if (this._lastStagecraftFiredMapId !== mapState.id) {
      this._lastStagecraftFiredMapId = mapState.id;
      void fireStagecraftForAsset(asset);
    }
    // Active-map calibration warning — visible when the map has no pps.
    if (warnEl) warnEl.hidden = !!asset.pixelsPerSquare;
    // Push fresh map metadata to the live primary projector so it re-crops at
    // the new scale. Monitors get their refreshed view fraction below via
    // projector_role.
    this.host.broadcast({
      type: 'map_meta_update',
      ...(asset.pixelsPerSquare !== undefined ? { mapPixelsPerSquare: asset.pixelsPerSquare } : {}),
      ...(asset.imageWidth      !== undefined ? { mapImageWidth:      asset.imageWidth      } : {}),
      ...(asset.imageHeight     !== undefined ? { mapImageHeight:     asset.imageHeight     } : {}),
      ...(asset.gridOffsetX     !== undefined ? { gridOffsetX:        asset.gridOffsetX     } : {}),
      ...(asset.gridOffsetY     !== undefined ? { gridOffsetY:        asset.gridOffsetY     } : {}),
      ...(asset.gridColor       !== undefined ? { gridColor:          asset.gridColor       } : {}),
    });
    // Monitors care about the primary's resulting view fraction — push it so they re-crop.
    this._broadcastRoles(false);
    // If the new active map is uncalibrated and the projector is currently
    // in 'scaled' mode, flip to 'full' — scaled requires pixelsPerSquare
    // to render meaningfully. The Full Map button lock (in
    // refreshProjectionModeButtons) keeps the user out of 'scaled' until
    // calibration arrives.
    if (!asset.pixelsPerSquare) {
      const currentVp = this.state.snapshot().projectorViewport ?? defaultProjectorViewport();
      if (currentVp.mode === 'scaled') {
        const next: ProjectorViewport = { ...currentVp, mode: 'full' };
        this.state.setProjectorViewport(next);
        this.projectorEditor.setViewport(next);
        this.host.broadcast({ type: 'projector_viewport_update', payload: next });
      }
    }
    this.refreshProjectionModeButtons();
    // The projector rect's bounds depend on mapPixelsPerSquare we only
    // resolved a moment ago (asset metadata is read async from IndexedDB),
    // so getRectBounds() returned null during renderer.onMapLoaded's
    // refresh. Re-push now that the calibration data has landed —
    // otherwise the green chrome stays missing after a map swap.
    this._refreshRectOverlays();
  }

  private setStatus(msg: string, level: 'ok' | 'warn' | 'error'): void {
    // v2.17.20 — feed the quiet activity log instead of the always-on bar, so
    // connection chatter never parks itself over the panels during play.
    this.messageLog?.push(msg, level);
  }

  // ─── Marker editor ────────────────────────────────────────────────────────

  private bindMarkerEditor(): void {
    const canvas    = document.querySelector<HTMLCanvasElement>('#gm-markers-canvas')!;
    const ctxMenuEl = document.querySelector<HTMLElement>('#marker-context-menu')!;

    void this._preloadLibIcons();

    this.markerEditor = new MarkerEditor(
      canvas,
      ctxMenuEl,
      (markers) => this.state.setMarkers(markers),
      (marker) => {
        this.selectedMarkerId = marker?.id ?? null;
        this.updateMarkerPanel();
        if (marker) {
          // Marker selection wins — clear any selected viewport rect so
          // only one item carries the selection chrome at a time.
          if (this._selectedViewport !== null) this._selectViewport(null);
          const body  = document.querySelector<HTMLElement>('#markers-panel .panel-body');
          const title = document.querySelector<HTMLElement>('#markers-panel .panel-title');
          if (body?.hidden) {
            body.hidden = false;
            title?.setAttribute('aria-expanded', 'true');
          }
        }
      },
      () => this.iconCache,
    );

    // HTML overlay layer for marker labels + handles AND viewport rect
    // chrome (player + projector). The overlay class is GM-wide screen-
    // space chrome — see its doc comment for why the name is historical.
    const overlayEl = document.getElementById('marker-overlay');
    if (overlayEl) {
      const overlay = new MarkerOverlay(overlayEl);
      overlay.setHandlers({
        onMoveDrag: (id, clientX, clientY, phase) => {
          if (phase === 'start')      this.markerEditor.beginOverlayDrag(id, clientX, clientY);
          else if (phase === 'move')  this.markerEditor.updateOverlayDrag(clientX, clientY);
          else                        this.markerEditor.endOverlayDrag();
        },
        onBadgeClick: (id, kind) => this.markerEditor.toggleOverlayBadge(id, kind),
        onResizeDrag: (id, clientX, clientY, phase) => {
          if (phase === 'start')     this.markerEditor.beginOverlayResize(id, clientX, clientY);
          else if (phase === 'move') this.markerEditor.updateOverlayResize(clientX, clientY);
          else                       this.markerEditor.endOverlayResize();
        },
        onRotateDrag: (id, clientX, clientY, phase) => {
          if (phase === 'start')     this.markerEditor.beginOverlayRotate(id, clientX, clientY);
          else if (phase === 'move') this.markerEditor.updateOverlayRotate(clientX, clientY);
          else                       this.markerEditor.endOverlayRotate();
        },
        onDeleteClick:    (id) => this._deleteMarker(id),
        onFlipHClick:     (id) => this.markerEditor.toggleFlipH(id),
        onFlipVClick:     (id) => this.markerEditor.toggleFlipV(id),
        onRectMoveDrag:   (kind, clientX, clientY, phase) => this._handleRectMoveDrag(kind, clientX, clientY, phase),
        onRectResizeDrag: (kind, clientX, clientY, phase) => this._handleRectResizeDrag(kind, clientX, clientY, phase),
        onRectAspectLock:    (kind) => this._handleRectAspect(kind),
        onRectMaximise:      (kind) => this._handleRectMaximise(kind),
        onRectRatioLock:     (kind) => this._handleRectRatioLock(kind),
        onRectViewBroadcast: (kind) => this._handleRectViewBroadcast(kind),
        onRectShowGrid:      (kind) => this._handleRectShowGrid(kind),
        // v2.12 unified — selector-icon click selects an overlay polygon
        // (non-fog kinds; fog uses interior click via FogEditor).
        onMapFXSelect:    (id) => this._selectOverlayPolygon(id),
        onMapFXDelete:    (id) => this._deleteOverlayPolygon(id),
      });
      this.markerEditor.layer.setOverlay(overlay);
      this._markerOverlay = overlay;
      // Push the rects in once any state lands; subsequent state changes
      // (viewport edit, projector connection, camera pan/zoom) all funnel
      // back to _refreshRectOverlays().
      this._refreshRectOverlays();
      this._bindRectSelection();
    }

    this.markerEditor.setFogSelectCallback((pos) => this.fogEditor.trySelectAt(pos));

    document.querySelector('#ctx-add-marker')?.addEventListener('click', () => {
      const { x, y } = this.markerEditor.ctxPos;
      this.markerEditor.addMarker(x, y);
      ctxMenuEl.hidden = true;
    });

    // Measure-from-here ruler. The host is #measure-layer (inset over the
    // canvas); projections come from the renderer; distance maths uses the
    // active map's calibration (_lastMapAssetMeta). Ghosted in the menu when
    // the map isn't calibrated (see _updateMeasureMenuItem).
    const measureLayer = document.getElementById('measure-layer');
    if (measureLayer) {
      this.measureTool = new MeasureTool({
        host: measureLayer,
        project: (mx, my) => this.renderer.mapNormToCanvasCss(mx, my),
        unproject: (clientX, clientY) => {
          const wrap = document.getElementById('canvas-wrapper');
          if (!wrap) return null;
          const r = wrap.getBoundingClientRect();
          return this.renderer.canvasCssToMapNorm(clientX - r.left, clientY - r.top);
        },
        squaresBetween: (a, b) => {
          const m = this._lastMapAssetMeta;
          if (!m) return null;
          return squaresBetweenNorm(a, b, m.imageWidth, m.imageHeight, m.pixelsPerSquare);
        },
        unit: () => ({ value: getMeasureUnitValue(), suffix: getMeasureUnitSuffix() }),
      });
    }
    document.querySelector('#ctx-measure')?.addEventListener('click', () => {
      ctxMenuEl.hidden = true;
      if (!this._isActiveMapCalibrated()) return;
      const { x, y } = this.markerEditor.ctxPos;
      this.measureTool?.start({ x, y });
    });
    this._updateMeasureMenuItem();

    document.querySelector('#clone-marker-btn')?.addEventListener('click', () => {
      if (!this.selectedMarkerId) return;
      const src = this.state.getState().markers.find((m) => m.id === this.selectedMarkerId);
      if (!src) return;
      const clone = {
        ...src,
        id:       generateId(),
        label:    src.label.endsWith(' - copy') ? src.label : `${src.label} - copy`,
        position: {
          x: Math.min(1, src.position.x + 0.02),
          y: Math.min(1, src.position.y + 0.02),
        },
      };
      const markers = [...this.state.getState().markers, clone];
      this.selectedMarkerId = clone.id;
      this.markerEditor.selectById(clone.id);
      this.state.setMarkers(markers);
    });

    document.querySelector('#delete-marker-btn')?.addEventListener('click', () => {
      if (!this.selectedMarkerId) return;
      this._deleteMarker(this.selectedMarkerId);
    });

    // v2.16.34 — "+" button beside the Marker picker. Same action the
    // SELECT_ADD_SENTINEL branch fires: create a new marker at map centre,
    // select it, let updateMarkerPanel rebuild the dropdown.
    document.querySelector('#add-marker-btn')?.addEventListener('click', () => {
      this.markerEditor.addMarker(0.5, 0.5);
    });

    this.markerSelect.addEventListener('change', () => {
      const v = this.markerSelect.value;
      if (v === SELECT_ADD_SENTINEL) {
        // Revert visually; updateMarkerPanel rebuilds the dropdown after the
        // new marker lands and selects it, so the sentinel never sticks.
        this.markerSelect.value = this.selectedMarkerId ?? '';
        this.markerEditor.addMarker(0.5, 0.5);
        return;
      }
      const id = v || null;
      this.selectedMarkerId = id;
      this.markerEditor.selectById(id);
      this.updateMarkerPanel();
    });

    // Marker rename — driven by markerEditableSelect.onRename → _renameMarker.

    this.markerIconBtn.addEventListener('click', () => {
      const sel = this.state.getState().markers.find((m) => m.id === this.selectedMarkerId);
      const currentColor = sel?.color ?? '#e03e3e';
      // Reuse the full Small Asset Library modal as the picker — gives the
      // GM the same category sidebar, search, and inline upload as the
      // standalone library tool. Unicode glyphs flow back as the literal
      // character; everything else as 'libAsset:<id>'.
      void new ImageAssetModal().open({
        pickMode: true,
        onPick: async (asset) => {
          if (asset.source === 'unicode' && asset.unicodeChar) {
            this.updateSelectedMarker({ icon: asset.unicodeChar });
            return;
          }
          this._libAssetTintable.set(asset.id, asset.tintable);
          const rendered = await renderLibIconFromAsset(asset, currentColor);
          if (rendered) {
            this.iconCache.set(rendered.key, rendered.bitmap);
            this.iconDataUrls.set(rendered.key, rendered.dataUrl);
          }
          this.updateSelectedMarker({ icon: 'libAsset:' + asset.id });
        },
      });
    });

    this.markerColorInput.addEventListener('input', () => {
      this.updateSelectedMarker({ color: this.markerColorInput.value });
    });

    this.markerHiddenToggle.addEventListener('change', () => {
      this.updateSelectedMarker({ hidden: this.markerHiddenToggle.checked });
    });

    this.markerShowLabelToggle.addEventListener('change', () => {
      this.updateSelectedMarker({ showLabel: this.markerShowLabelToggle.checked });
    });
    this.markerShowLabelGmToggle.addEventListener('change', () => {
      this.updateSelectedMarker({ showLabelOnGM: this.markerShowLabelGmToggle.checked });
    });

    this.markerLockedToggle.addEventListener('change', () => {
      this.updateSelectedMarker({ locked: this.markerLockedToggle.checked });
    });

    // Audio role selector — buttons carry legacy data-role values:
    //   'default' → clear audio role; 'audio_source' → source; 'listener' → listener
    document.querySelectorAll<HTMLElement>('.marker-audio-role-btns .marker-role-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.selectedMarkerId) return;
        const raw = btn.dataset['role'];
        const next: AudioRole | undefined =
          raw === 'audio_source' ? 'source' :
          raw === 'listener'     ? 'listener' :
          undefined;

        this.state.updateMarkers((markers) => markers.map((m) => {
          if (m.id === this.selectedMarkerId) {
            const roles = { ...m.roles };
            if (next) roles.audio = next;
            else delete roles.audio;
            return { ...m, roles };
          }
          // Single-listener constraint: demote any other listener in the same pass
          if (next === 'listener' && m.roles.audio === 'listener') {
            const roles = { ...m.roles };
            delete roles.audio;
            return { ...m, roles };
          }
          return m;
        }));
      });
    });

    // Motion role selector — data-motion-role on each button
    document.querySelectorAll<HTMLElement>('.marker-motion-role-btns .marker-role-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.selectedMarkerId) return;
        const raw = btn.dataset['motionRole'];
        const next: MotionRole | undefined =
          raw === 'source'  ? 'source'  :
          raw === 'tracker' ? 'tracker' :
          undefined;

        this.state.updateMarkers((markers) => markers.map((m) => {
          if (m.id === this.selectedMarkerId) {
            const roles = { ...m.roles };
            if (next) roles.motion = next;
            else delete roles.motion;
            return { ...m, roles };
          }
          // Single-tracker constraint: demote any other tracker in the same pass
          if (next === 'tracker' && m.roles.motion === 'tracker') {
            const roles = { ...m.roles };
            delete roles.motion;
            return { ...m, roles };
          }
          return m;
        }));
      });
    });

    // Motion muted toggle
    document.querySelector<HTMLInputElement>('#marker-motion-muted')?.addEventListener('change', (e) => {
      this.updateSelectedMarker({ motionMuted: (e.target as HTMLInputElement).checked });
    });

    // Tracker config controls — only meaningful when the selected marker is the tracker
    const patchTrackerCfg = (patch: Partial<import('../types.ts').MotionTrackerConfig>) => {
      const cur = this.state.getState().motionTracker;
      this.state.setMotionTracker({ ...cur, ...patch });
    };

    const rangeInput = document.querySelector<HTMLInputElement>('#tracker-range');
    const rangeVal   = document.querySelector<HTMLElement>('#tracker-range-val');
    rangeInput?.addEventListener('input', () => {
      const v = sliderToRange(parseFloat(rangeInput.value));
      if (rangeVal) rangeVal.textContent = v.toFixed(2);
      patchTrackerCfg({ range: v });
    });

    const rateInput = document.querySelector<HTMLInputElement>('#tracker-rate');
    const rateVal   = document.querySelector<HTMLElement>('#tracker-rate-val');
    rateInput?.addEventListener('input', () => {
      const v = parseFloat(rateInput.value);
      if (rateVal) rateVal.textContent = `${v.toFixed(2)}s`;
      patchTrackerCfg({ rate: v });
    });

    const speedInput = document.querySelector<HTMLInputElement>('#tracker-speed');
    const speedVal   = document.querySelector<HTMLElement>('#tracker-speed-val');
    speedInput?.addEventListener('input', () => {
      const v = parseFloat(speedInput.value);
      if (speedVal) speedVal.textContent = `${v.toFixed(1)}s`;
      patchTrackerCfg({ speed: v });
    });

    document.querySelector<HTMLInputElement>('#tracker-colour')?.addEventListener('input', (e) => {
      patchTrackerCfg({ colour: (e.target as HTMLInputElement).value });
    });

    document.querySelector<HTMLInputElement>('#tracker-hide-blobs')?.addEventListener('change', (e) => {
      patchTrackerCfg({ hideBlobs: (e.target as HTMLInputElement).checked });
    });

    // Per-motion-source: blob mode (single / multi-few / multi-many)
    document.querySelector<HTMLSelectElement>('#source-blob-mode')?.addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value;
      const mode =
        v === 'multi-few'  ? 'multi-few'  :
        v === 'multi-many' ? 'multi-many' :
                             'single';
      this.updateSelectedMarker({ motionBlobMode: mode });
    });

    // Tracker outgoing/return ping sound assignment
    document.querySelector('#tracker-outgoing-btn')?.addEventListener('click', () => {
      this.soundboardPanel.audioModal.open((asset) => {
        patchTrackerCfg({ outgoingPingAssetId: asset.id });
      });
    });
    document.querySelector('#tracker-return-btn')?.addEventListener('click', () => {
      this.soundboardPanel.audioModal.open((asset) => {
        patchTrackerCfg({ returnPingAssetId: asset.id });
      });
    });
    document.querySelector<HTMLInputElement>('#tracker-outgoing-vol')?.addEventListener('input', (e) => {
      patchTrackerCfg({ outgoingPingVolume: parseFloat((e.target as HTMLInputElement).value) });
    });
    document.querySelector<HTMLInputElement>('#tracker-return-vol')?.addEventListener('input', (e) => {
      patchTrackerCfg({ returnPingVolume: parseFloat((e.target as HTMLInputElement).value) });
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
    this.state.updateMarker(this.selectedMarkerId, patch);
  }

  private async _assignMarkerAudio(asset: AudioAsset): Promise<void> {
    if (!this.selectedMarkerId) return;
    this.updateSelectedMarker({ audioTrackId: asset.id });
    await this.audio.loadAsset(asset, this._interactionCtx());
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
        // Mute_all is a safety signal — it always propagates even when
        // remote audio is disabled, so any audio still playing on a
        // player (e.g. from before remoteAudio was switched off) gets
        // silenced. Stop messages always propagate for the same reason.
        if (msg.type === 'mute_all') {
          this.host.broadcast({ type: 'soundboard_mute_all', muted: msg.muted });
          return;
        }
        if (msg.type === 'stop') {
          this.host.broadcast({ type: 'soundboard_stop', slotId: msg.slotId });
          return;
        }
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
        } else if (msg.type === 'volume') {
          this.host.broadcast({ type: 'soundboard_volume', slotId: msg.slotId, volume: msg.volume });
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
        const { slots } = this.state.getState().audio;
        if (!this.remoteAudioEnabled) {
          // Stop all currently playing slots on remote players
          for (const slot of slots) {
            if (this.soundboardEngine.isPlaying(slot.id)) {
              this.host.broadcast({ type: 'soundboard_stop', slotId: slot.id });
            }
          }
        } else {
          // Re-enabling — push the GM's currently-playing slots out to
          // players so the audience hears whatever the GM is hearing
          // without the GM needing to retrigger each slot.
          for (const slot of slots) {
            if (!slot.assetId || !this.soundboardEngine.isPlaying(slot.id)) continue;
            const dataUrl = this.soundboardEngine.getDataUrl(slot.assetId);
            if (!dataUrl) continue;
            this.host.broadcast({
              type:    'soundboard_play',
              slotId:  slot.id,
              assetId: slot.assetId,
              loop:    slot.loop,
              volume:  slot.volume,
              dataUrl,
            });
          }
        }
      });
    }
  }

  // ─── Players (v2.17 Player Voice) ───────────────────────────────────────────

  private bindPlayersPanel(): void {
    this.playersPanel = new PlayersPanel({
      onAddManaged: async (name, character, color) => {
        await this.playerRegistry.addManaged(name, character, color);
        this._refreshPlayersPanel();
        this._broadcastRoster();
      },
      onUpdate: async (id, patch) => {
        await this.playerRegistry.update(id, patch);
        this._refreshPlayersPanel();
        this._broadcastRoster();
        // Colour / name changes affect how tokens render on the map — refresh
        // the marker layer + rebroadcast player_markers immediately rather
        // than waiting on the next event (placement change, map switch, etc.).
        this._refreshPlayerMarkers();
      },
      onRemove: async (id) => {
        await this.playerRegistry.remove(id);
        this._liveMarkerPos.delete(id);
        this._markerMoveOrigin.delete(id);
        this._messageThreads.drop(id);
        if (this._openThreadPlayerId === id) this._threadSidePanel?.close();
        this._refreshPlayersPanel();
        this._broadcastRoster();
        this._refreshPlayerMarkers();
      },
      onToggleMarker: (id) => { void this._togglePlayerMarker(id); },
      onCancelMove:   (id) => { void this._cancelPlayerMarkerMove(id); },
      onPickIcon:     (id) => { void this._pickPlayerIcon(id); },
      onClearIcon:    async (id) => {
        await this.playerRegistry.clearIcon(id);
        this._refreshPlayersPanel();
        this._broadcastPlayerIcon(id); // empty dataUrl ⇒ clear the player-side cache
        this._refreshPlayerMarkers();
      },
      onSetTokenSize: async (id, size) => {
        await this.playerRegistry.update(id, { tokenSize: size });
        this._refreshPlayersPanel();
        this._refreshPlayerMarkers();
      },
      // v2.16.47 — click a per-row unread badge → open this player's
      // message thread in a right-edge SidePanel.
      onOpenThread: (id) => this._openMessageThread(id),
      // v2.16.53 — surface Call for Initiative right next to the player
      // roster so the GM doesn't have to dig into the tracker overlay
      // first. Opens the tracker (if hidden) + broadcasts the prompt.
      onCallForInitiative: () => {
        // v2.17.5 — Fixed-initiative mode with a saved order: reopen it
        // instead of wiping + re-prompting (players aren't asked again).
        if (this._hasPreservedInitiativeOrder()) {
          this.initiativeTracker?.open();
          this.setStatus('Initiative order preserved — players not re-prompted', 'ok');
          return;
        }
        // v2.16.63 — Call for Initiative wipes deck + tray + bench
        // (preserving discard) BEFORE seeding + broadcasting. Both the
        // Players-panel orange button and the in-tracker Call route
        // through this path so behaviour is uniform.
        this.initiativeTracker?.resetForNewCombat();
        this.initiativeTracker?.open();
        this.initiativeTracker?.seedUnallocatedFromPlayers();
        this.host.broadcast({ type: 'initiative_call' });
        this.setStatus('Call for Initiative broadcast', 'ok');
      },
    });
    // Load the persisted roster, then render the panel + any placed tokens.
    void this.playerRegistry.load().then(() => {
      this._refreshPlayersPanel();
      this._refreshPlayerMarkers();
    });
  }

  private _refreshPlayersPanel(): void {
    const mapId = this._activeMapId();
    this.playersPanel?.update(
      this.playerRegistry.all(),
      (id) => {
        const unread = this._messageThreads.unreadFor(id);
        return {
          connected:     this.playerRegistry.isConnected(id),
          placed:        !!mapId && this.playerRegistry.isPlacedOn(id, mapId),
          canCancelMove: this._markerMoveOrigin.has(id),
          unreadGm:      unread.gm,
          unreadPeer:    unread.peer,
        };
      },
    );
  }

  private _broadcastRoster(): void {
    this.host.broadcast(this.playerRegistry.rosterMessage());
  }

  /** v2.17.5 — True when fixed-initiative (preserve) mode is on AND a real
   *  order already exists. In that case Call for Initiative reopens the
   *  saved order rather than wiping it and re-prompting players. */
  private _hasPreservedInitiativeOrder(): boolean {
    const st = this.initiativeTracker?.getState();
    return !!st?.preserveOrder && st.activeDeck.some((c) => c.type !== 'round-marker');
  }

  /** Dedupe a non-idempotent upstream event by its client-supplied id.
   *  Returns true if it was already seen (caller should drop it). */
  private _seenUpstream(id: string): boolean {
    if (this._seenUpstreamIds.has(id)) return true;
    this._seenUpstreamIds.add(id);
    if (this._seenUpstreamIds.size > 400) {
      // Trim oldest ~half — insertion order is preserved by Set.
      const keep = [...this._seenUpstreamIds].slice(-200);
      this._seenUpstreamIds = new Set(keep);
    }
    return false;
  }

  /** Tell player views which Player-Voice interactions are currently allowed,
   *  so they can hide disabled affordances. */
  private _broadcastPlayerFeatures(): void {
    this.host.broadcast({
      type: 'player_features',
      pings: arePingsEnabled(),
      messaging: isMessagingEnabled(),
      movableMarkers: arePlayerMarkersMovable(),
      measureUnitValue:  getMeasureUnitValue(),
      measureUnitSuffix: getMeasureUnitSuffix(),
    });
  }

  // ── Player tokens (v2.16.4 player markers) ─────────────────────────────────

  private _activeMapId(): string | undefined {
    return this.state.snapshot().map?.id;
  }

  /** Render the active map's player tokens on the GM AND broadcast them to
   *  players. Merges any in-progress (un-persisted) drag positions / rotations.
   *  Icon data URLs are stripped from the broadcast — they travel separately
   *  via `player_icon_update` (chunked over the wire to avoid DataChannel limits). */
  private _refreshPlayerMarkers(): void {
    const mapId = this._activeMapId();
    const base = mapId ? this.playerRegistry.markersForMap(mapId) : [];
    const merged = base.map((m) => {
      const livePos    = this._liveMarkerPos.get(m.playerId);
      const liveFacing = this._liveMarkerFacing.get(m.playerId);
      return {
        ...m,
        ...(livePos ? { x: livePos.x, y: livePos.y } : {}),
        ...(liveFacing !== undefined ? { facing: liveFacing } : {}),
      };
    });
    this.playerMarkerLayer?.setMarkers(merged);
    // Strip iconDataUrl from the wire payload (rides player_icon_update
    // separately, chunked). KEEP `hasIcon` so receivers can self-heal a
    // missing icon via player_icon_request — covers the case where a
    // chunked-binary delivery was dropped or arrived before the receiver
    // mounted its layer.
    const broadcastMarkers = merged.map(({ iconDataUrl, ...rest }) => { void iconDataUrl; return rest; });
    this.host.broadcast({ type: 'player_markers', markers: broadcastMarkers });
    // v2.16.32 — the "Tint Player Markers" toggle is only meaningful when
    // there ARE markers on this map, so show / hide it alongside the
    // marker list. Cheap; fires on every placement / drag / identify /
    // map switch.
    this._refreshFilterAffectMarkersVisibility(merged.length > 0);
  }

  /** Refresh the Visual Filter side panel (if open) so the Tint Player
   *  Markers row appears / disappears with placement changes. v2.16.37 —
   *  the row used to live inline and just toggled a `hidden` attribute;
   *  now it's a side-panel element and a refresh() rebuilds the body. */
  private _refreshFilterAffectMarkersVisibility(_hasMarkers: boolean): void {
    this._filterSidePanel?.refresh();
  }

  /** Broadcast the current icon (or absence) for a specific player. Players
   *  cache by playerId and re-render any active token for that player. */
  private _broadcastPlayerIcon(playerId: string): void {
    const p = this.playerRegistry.get(playerId);
    this.host.broadcast({
      type: 'player_icon_update',
      playerId,
      ...(p?.iconDataUrl ? { dataUrl: p.iconDataUrl } : {}),
    });
  }

  /** Send every current player icon to fresh peers — called when a new player
   *  identifies so they catch up on the existing roster's tokens. */
  private _broadcastAllPlayerIcons(): void {
    for (const p of this.playerRegistry.all()) {
      if (p.iconDataUrl) this._broadcastPlayerIcon(p.id);
    }
  }

  private async _onGmMarkerDragEnd(playerId: string, x: number, y: number): Promise<void> {
    const mapId = this._activeMapId();
    if (!mapId) return;
    await this.playerRegistry.setPlacement(playerId, mapId, x, y);
    this._liveMarkerPos.delete(playerId);
    this._markerMoveOrigin.delete(playerId); // GM took control — clear pending cancel
    this._refreshPlayerMarkers();
    this._refreshPlayersPanel();
  }

  /** GM rotated a player's token via the facing-pointer handle. Persists the
   *  new facing (position unchanged) and rebroadcasts. */
  private async _onGmMarkerRotateEnd(playerId: string, facing: number): Promise<void> {
    const mapId = this._activeMapId();
    if (!mapId) return;
    const cur = this.playerRegistry.placementOn(playerId, mapId);
    if (!cur) return;
    await this.playerRegistry.setPlacement(playerId, mapId, cur.x, cur.y, facing);
    this._liveMarkerFacing.delete(playerId);
    this._markerMoveOrigin.delete(playerId); // GM took control — clear pending cancel
    this._refreshPlayerMarkers();
    this._refreshPlayersPanel();
  }

  /** v2.16.49 — place a player's token at a specific normalised map
   *  coord. Used by the drag-from-Players-row-icon → drop-on-map flow.
   *  Mirrors _togglePlayerMarker's PLACE branch but lands at the
   *  drop point rather than the map centre. */
  private async _placePlayerAtNorm(playerId: string, x: number, y: number): Promise<void> {
    const mapId = this._activeMapId();
    if (!mapId) { this.setStatus('Load a map before placing player tokens.', 'warn'); return; }
    const clampedX = Math.max(0, Math.min(1, x));
    const clampedY = Math.max(0, Math.min(1, y));
    await this.playerRegistry.setPlacement(playerId, mapId, clampedX, clampedY);
    this._markerMoveOrigin.delete(playerId);
    this._refreshPlayerMarkers();
    this._refreshPlayersPanel();
  }

  /** Players-panel toggle: place this player's token on the active map (centre)
   *  if absent, or remove it if present. */
  private async _togglePlayerMarker(playerId: string): Promise<void> {
    const mapId = this._activeMapId();
    if (!mapId) { this.setStatus('Load a map before placing player tokens.', 'warn'); return; }
    if (this.playerRegistry.isPlacedOn(playerId, mapId)) {
      await this.playerRegistry.removePlacement(playerId, mapId);
    } else {
      await this.playerRegistry.setPlacement(playerId, mapId, 0.5, 0.5);
    }
    this._markerMoveOrigin.delete(playerId);
    this._refreshPlayerMarkers();
    this._refreshPlayersPanel();
  }

  /** Open the image-asset library in pick mode for this player's token icon. */
  private _pickPlayerIcon(playerId: string): void {
    void new ImageAssetModal().open({
      pickMode: true,
      onPick: async (asset) => {
        const form = await assetToPlayerIcon(asset);
        await this.playerRegistry.setIcon(playerId, { assetId: asset.id, ...form });
        this._refreshPlayersPanel();
        this._broadcastPlayerIcon(playerId); // ship the icon image to player views
        this._refreshPlayerMarkers();
      },
    });
  }

  /** GM "cancel move" — send a player-moved/rotated token back to where it was. */
  private async _cancelPlayerMarkerMove(playerId: string): Promise<void> {
    const mapId = this._activeMapId();
    const origin = this._markerMoveOrigin.get(playerId);
    if (!mapId || !origin) return;
    await this.playerRegistry.setPlacement(playerId, mapId, origin.x, origin.y, origin.facing);
    this._liveMarkerPos.delete(playerId);
    this._liveMarkerFacing.delete(playerId);
    this._markerMoveOrigin.delete(playerId);
    this._refreshPlayerMarkers();
    this._refreshPlayersPanel();
  }

  // ── Initiative tracker (v2.16.8 fanned-deck rail) ──────────────────────────

  private bindInitiativeTracker(): void {
    const el = document.getElementById('initiative-tracker');
    if (!el) return;
    const initial = loadInitiativeState();
    this.initiativeTracker = new InitiativeTracker(el, initial, {
      onChange: (state) => {
        // Mirror the state to every player view so they render in lock-step.
        // v2.16.71 — strip per-card markerUrl data URLs so the JSON stays
        // under the DataChannel single-frame limit (see stripInitiativeForWire).
        this.host.broadcast({ type: 'initiative_update', state: stripInitiativeForWire(state, isInitiativeAnonymised()) });
      },
      onCallForInitiative: () => {
        // v2.17.5 — fixed-initiative mode with a saved order: don't wipe
        // or re-prompt (the Reroll button is disabled in this mode, but
        // guard here too for parity with the Players-panel path).
        if (this._hasPreservedInitiativeOrder()) {
          this.setStatus('Initiative order preserved — players not re-prompted', 'ok');
          return;
        }
        // v2.16.63 — reset deck + tray + bench (preserving discard),
        // then seed players and broadcast. The Players-panel orange
        // button routes through the same path via bindPlayersPanel.
        this.initiativeTracker?.resetForNewCombat();
        this.initiativeTracker?.seedUnallocatedFromPlayers();
        this.host.broadcast({ type: 'initiative_call' });
        this.setStatus('Call for Initiative broadcast', 'ok');
      },
      getPlayers: () => this.playerRegistry.all(),
      getMarkers: () => this.state.getState().markers,
      resolveMarkerImage: (m) => {
        // data: icons are self-contained; asset/libAsset resolve from the
        // already-rendered icon cache (compound key for tintable libAssets).
        if (m.icon.startsWith('data:')) return m.icon;
        if (m.icon.startsWith('libAsset:')) {
          return this.iconDataUrls.get(`${m.icon}#${m.color}`) ?? this.iconDataUrls.get(m.icon) ?? null;
        }
        if (m.icon.startsWith('asset:')) return this.iconDataUrls.get(m.icon) ?? null;
        // Font/Unicode glyph (the default presets) — rasterise it like the map.
        return glyphToDataUrl(m.icon, m.color);
      },
    });
    // v2.16.65 — Initiative direction setting (Settings → Player Voice).
    // Apply on startup + whenever the GM changes it in the dialog.
    this.initiativeTracker.setSortDirection(getInitiativeSortDirection());
    window.addEventListener('mappadux:initiative-direction-changed', (e) => {
      const dir = (e as CustomEvent).detail as 'high-to-low' | 'low-to-high';
      this.initiativeTracker?.setSortDirection(dir);
    });
    // v2.17.21 — Initiative anonymisation toggled in Settings → reship the
    // (re-)stripped state so players reveal / re-hide the threat letters live.
    window.addEventListener('mappadux:initiative-anonymise-changed', () => {
      if (this.initiativeTracker) {
        this.host.broadcast({ type: 'initiative_update', state: stripInitiativeForWire(this.initiativeTracker.getState(), isInitiativeAnonymised()) });
      }
    });
    // v2.17.10 — measurement scale changed in Settings → push it to players
    // so remote views measure on the same units.
    window.addEventListener('mappadux:measure-unit-changed', () => {
      this._broadcastPlayerFeatures();
    });
    // Broadcast initial state so any already-connected players sync up.
    this.host.broadcast({ type: 'initiative_update', state: stripInitiativeForWire(this.initiativeTracker.getState(), isInitiativeAnonymised()) });
  }

  /** v2.16.76 — per-map Annotate layer (progress clocks; whiteboard next).
   *  Clocks broadcast to players + projector; the bypass toggle mutes the
   *  whole layer (default muted on a fresh load). */
  private bindAnnotate(): void {
    const clocksEl = document.getElementById('annotate-clocks');
    const timersEl = document.getElementById('annotate-timers');
    const notesEl = document.getElementById('annotate-notes');
    const boardEl = document.getElementById('annotate-whiteboard') as HTMLCanvasElement | null;
    if (!clocksEl || !timersEl || !notesEl || !boardEl) return;
    boardEl.hidden = false; // always present; pointer-events gate draw mode
    this.annotate = new AnnotateController(
      {
        clocksRoot: clocksEl,
        timersRoot: timersEl,
        notesRoot: notesEl,
        whiteboardCanvas: boardEl,
        project:   (x, y) => this.renderer.mapNormToCanvasCss(x, y),
        unproject: (cx, cy) => {
          const wrap = document.getElementById('canvas-wrapper');
          if (!wrap) return null;
          const r = wrap.getBoundingClientRect();
          return this.renderer.canvasCssToMapNorm(cx - r.left, cy - r.top);
        },
        // v2.16.84 — annotations live in SessionState (per-map; saved to IDB
        // + travels in the .mappadux pack).
        loadAnnotate: () => this.state.snapshot().annotate ?? emptyAnnotateState(),
        persist: (st) => this.state.setAnnotate(st),
      },
      {
        broadcastClocks: (clocks) => this.host.broadcast({ type: 'annotate_clocks', clocks }),
        broadcastTimers: (timers) => this.host.broadcast({ type: 'annotate_timers', timers }),
        broadcastNotes:  (notes) => this.host.broadcast({ type: 'annotate_notes', notes }),
        broadcastStroke: (stroke) => this.host.broadcast({ type: 'annotate_stroke', stroke }),
        broadcastClear:  () => this.host.broadcast({ type: 'annotate_clear' }),
      },
    );
    // Bypass toggle (checked = shown). Default muted, so init unchecked.
    const toggle = document.getElementById('annotate-bypass-toggle') as HTMLInputElement | null;
    const muted0 = isAnnotateMuted();
    if (toggle) {
      toggle.checked = !muted0;
      toggle.addEventListener('change', () => {
        setAnnotateMuted(!toggle.checked);
        this.annotate?.setMuted(!toggle.checked);
      });
    }
    this.annotate.setMuted(muted0);
    // Seed with the active map (if one is already loaded).
    this.annotate.setMap(this._activeMapId() ?? null);
  }

  /** v2.16.47 — replaces bindPlayerVoicePanel. The thread store fires
   *  onChange whenever a message lands or unread counts change; we
   *  re-render the Players panel so badges update. The thread side
   *  panel itself is opened by clicking a row's badge (Players panel
   *  onOpenThread callback). */
  private bindMessageThreads(): void {
    this._messageThreads.onChange(() => {
      this._refreshPlayersPanel();
      // If the open side panel's thread changed, refresh its body so the
      // new message shows up immediately.
      this._threadSidePanel?.refresh();
    });
  }

  /** Open / refresh the thread SidePanel for a given player. Clears that
   *  player's unread counters; subsequent incoming messages bump them
   *  only after the panel closes. */
  private _openMessageThread(playerId: string): void {
    const player = this.playerRegistry.get(playerId);
    if (!player) return;
    const displayName = player.characterName || player.playerName || 'player';
    this._openThreadPlayerId = playerId;
    this._messageThreads.markRead(playerId);

    void import('./SidePanel.ts').then(({ openSidePanel }) => {
      // Close any previous thread panel (single-panel-at-a-time).
      this._threadSidePanel?.close();
      this._threadSidePanel = openSidePanel({
        title: `Messages — ${displayName}`,
        populate: (body) => {
          // v2.16.49 — snapshot includes lastSeenAt so newly-arrived
          // messages render BOLD until the panel is closed.
          const { messages, lastSeenAt } = this._messageThreads.snapshotFor(playerId);
          const lastInbound = [...messages].reverse().find((m) => m.fromKind === 'player');
          const prefetched  = lastInbound?.suggestionsPromise;
          buildMessageThreadPanel(body, {
            messages,
            lastSeenAt,
            toName: displayName,
            ...(prefetched ? { prefetchedSuggestions: prefetched } : {}),
            onSend: (text) => this._sendGmMessage(playerId, displayName, text),
            onSuggest: async () => {
              const client = LLMClient.fromSettings();
              if (!client) throw new Error('No LLM configured — enable the reply assistant in Settings → Player Voice.');
              const ref = lastInbound?.text ?? '';
              return client.suggest(ref);
            },
          });
        },
        onClose: () => {
          // Snapshot the "seen up to now" timestamp so the next open
          // only bolds messages that arrive after this close.
          this._messageThreads.markSeen(playerId);
          this._threadSidePanel = null;
          this._openThreadPlayerId = null;
        },
      });
    });
  }

  /** Broadcast a GM reply to a specific player + append it to the local
   *  thread so the GM sees their own message in the running history. */
  private _sendGmMessage(toPlayerId: string, toName: string, text: string): void {
    const messageId = generateId();
    this.host.broadcast({
      type: 'message_deliver',
      messageId,
      fromKind:  'gm',
      fromName:  'GM',
      fromColor: GMApp.GM_MESSAGE_COLOR,
      toPlayerId,
      text,
    });
    this._messageThreads.addOutgoing(toPlayerId, {
      id: messageId,
      fromKind: 'gm',
      fromPlayerId: null,
      fromName: 'GM',
      fromColor: GMApp.GM_MESSAGE_COLOR,
      toPlayerId,
      toName,
      text,
      at: Date.now(),
      origin: 'gm-bound',
    });
  }

  private bindHamburgerMenu(): void {
    const btn  = document.querySelector<HTMLButtonElement>('#gm-menu-btn');
    const menu = document.querySelector<HTMLElement>('#gm-menu');
    if (!btn || !menu) return;

    this.hamburger = new HamburgerMenu(btn, menu);

    // Pack file group — traditional File-menu order: New, Open, Save.
    this.hamburger.addItem({
      label: 'New Map Pack…',
      icon: 'file-plus',
      danger: true,
      onSelect: () => { void this.newMapPack(); },
    });
    this.hamburger.addItem({
      label: 'Load Map Pack',
      icon: 'folder-open',
      onSelect: () => {
        const input = document.querySelector<HTMLInputElement>('#bundle-import');
        input?.click();
      },
    });
    // De-emphasised fallback: reset this browser to the bundled Getting Started
    // pack. Faded so it doesn't read as a usual pick, but handy to recover.
    this.hamburger.addItem({
      label: 'Open Onboarding Map',
      icon: 'map',
      subtle: true,
      onSelect: () => { void this._openOnboardingMap(); },
    });
    this.hamburger.addItem({
      label: 'Save Map Pack…',
      icon: 'save',
      onSelect: () => { void this.saveBundle(); },
    });
    this.hamburger.addItem({
      label: 'Save Encrypted Pack…',
      icon: 'lock',
      onSelect: () => { void this.saveBundleEncrypted(); },
    });

    this.hamburger.addDivider();

    // v2.16.109 — Open New Instance in its OWN section, between the pack-file
    // group and the asset libraries. Spawns a fresh Mappadux instance in a new
    // tab with its own IndexedDB (split the party, keep handouts on one tab +
    // maps on another, or experiment without touching the live pack — no
    // syncing between instances, each is independent).
    this.hamburger.addItem({
      label: 'Open New Instance',
      icon: 'plus-square',
      onSelect: () => {
        const id = generateInstanceId();
        const url = new URL(window.location.href);
        url.search = `?instance=${id}`;
        url.hash = '';
        window.open(url.toString(), '_blank', 'noopener');
      },
    });

    this.hamburger.addDivider();

    // Asset Libraries group.
    // Same modal as the "+ Add New Map" dropdown sentinel — route both
    // through openAddMapDialog so a newly-created handout / uploaded
    // image / picked library entry lands on the map dropdown AND
    // becomes the active map regardless of which entry point opened
    // the library. Earlier this used a no-op onPick ("browse-only"),
    // which meant creating a new handout from here saved the map to
    // IDB but left the dropdown stale and nothing selected.
    this.hamburger.addItem({
      label: 'Map Asset Library…',
      icon: 'map',
      onSelect: () => { this.openAddMapDialog(); },
    });
    this.hamburger.addItem({
      label: 'Audio Asset Library…',
      icon: 'volume',
      onSelect: () => { void this.openSoundLibrary(); },
    });
    this.hamburger.addItem({
      label: 'Small Assets Library…',
      icon: 'image',
      onSelect: () => { void this.openImageLibrary(); },
    });

    this.hamburger.addDivider();

    // Pack settings + app settings.
    this.hamburger.addItem({
      label: 'Customise pack…',
      icon: 'palette',
      onSelect: () => { void this.openAboutDialog({ startInEdit: true }); },
    });
    this.hamburger.addItem({
      label: 'Settings…',
      icon: 'settings',
      onSelect: () => { void this.openSettings(); },
    });
    // v2.16.66 — Initiative Tracker hamburger entry removed. Roll
    // Initiative (orange button in the Players panel) opens the
    // tracker; End Combat closes it. No reason to keep a third path.
    // v2.16.109 — Open New Instance moved up to its own section (above).

    // Footer — About pinned at the very bottom (auto-divider above).
    this.hamburger.addItem({
      label: 'About…',
      icon: 'info',
      footer: true,
      onSelect: () => { void this.openAboutDialog({}); },
    });
  }

  /** Open the Add Map dialog (Library / Web Links / Upload). On a successful
   *  pick the new map is inserted into #map-select at its alphabetical
   *  position — matching the by_name IDB index that drives the dropdown
   *  on reload. Previously the new option went to the bottom and only
   *  resorted into place after a page reload. */
  private openAddMapDialog(): void {
    this.mapAssetModal.open(async (map) => {
      // Look up the asset so the dropdown row gets the right leading
      // glyph (image / animated / text / composite) — same treatment
      // as populateMapList applies on reload.
      const asset = await MapAssetStore.get(map.mapAssetId);
      const kind = _dropdownKindForAsset(asset);
      this._insertMapOptionSorted(map.id, map.name, kind);
      this.mapSelect.value = map.id;
      this.mapEditableSelect.refresh();
      this._lastMapSelectValue = map.id;
      await this.loadMap(map);
      // v2.14.46 — newly-created composite maps jump straight into
      // the editor so the GM can drop more tiles without hunting
      // for the Edit button. Picking the first tile is step 1; the
      // editor is step 2 — flow through automatically.
      if (asset?.source === 'composite-map') {
        await this._editCurrentCompositeMap();
      }
    });
  }

  /** Insert a new map option into the dropdown at its alphabetical
   *  position by name — matches the by_name IDB index that
   *  populateMapList iterates on reload, so adding / cloning a map no
   *  longer shows it at the bottom until the GM refreshes the page.
   *  Skips the disabled separator and the "+ Add New Map" sentinel so
   *  they always anchor at the end. The `kind` arg picks the right
   *  leading glyph: image (▣), animated video (▶), or text handout (▤). */
  private _insertMapOptionSorted(
    id: string,
    name: string,
    kind: MapDropdownKind = 'image',
  ): void {
    const opt = document.createElement('option');
    opt.value = id;
    const cleanName = _cleanMapDisplayName(name);
    const prefix = _prefixForKind(kind);
    opt.textContent = `${prefix}${cleanName}`;
    if (kind === 'missing') {
      opt.dataset['missing'] = 'true';
      opt.title = 'The map image for this entry is missing from your library — it was probably deleted, or this came from a bundle that didn\'t include the asset. Add the original image back to the library (same filename) to restore it.';
    }
    const addSentinel = this.mapSelect.querySelector<HTMLOptionElement>(
      `option[value="${SELECT_ADD_SENTINEL}"]`,
    );
    const separator = addSentinel?.previousElementSibling ?? null;
    let insertBefore: Element | null = separator ?? addSentinel ?? null;
    // localeCompare sees clean names on both sides so the ≡ prefix
    // doesn't cluster handouts at the top of the dropdown — they
    // sort integrated with image maps by their raw name, matching
    // the by_name IDB index that drives populateMapList on reload.
    for (const existing of Array.from(this.mapSelect.options)) {
      if (!existing.value || existing.disabled) continue;
      if (existing.value === SELECT_ADD_SENTINEL) continue;
      const existingClean = _cleanMapDisplayName(existing.textContent ?? '');
      if (existingClean.localeCompare(cleanName, undefined, { sensitivity: 'base' }) > 0) {
        insertBefore = existing;
        break;
      }
    }
    this.mapSelect.insertBefore(opt, insertBefore);
    // v2.14.76 — defensive: ensure the + Add Map sentinel + its
    // separator always end up LAST in the dropdown after any
    // insertion. Earlier clones were reportedly landing below the
    // sentinel; whatever the cause (race / refresh / stale anchor)
    // this guarantees the sentinel is always at the end so the GM
    // never sees a real map below "+ Add New Map…".
    if (addSentinel) {
      if (separator && separator !== this.mapSelect.lastElementChild?.previousElementSibling) {
        this.mapSelect.appendChild(separator);
      }
      if (addSentinel !== this.mapSelect.lastElementChild) {
        this.mapSelect.appendChild(addSentinel);
      }
    }
  }

  /** Persist a rename of the active map, triggered from the EditableSelect.
   *  Writes through to MapManager, then re-inserts the option at its new
   *  alphabetical position so the rename behaves the same as a reload
   *  would (matches the by_name IDB index that populateMapList iterates).
   *  Preserves the " [T]" text-map marker so handouts keep their tag
   *  after rename. */
  /** v2.12.x — guard so _endAction's deferred cleanup passes don't
   *  clobber a _startAction that ran between the sync clear and the
   *  microtask / timeout firing. Set true on _startAction, false on
   *  _endAction. The deferred callbacks check it and bail when true. */
  private _actionInProgress = false;

  private async _renameMap(id: string, name: string): Promise<void> {
    if (!id) return;
    // EditableSelect feeds the option's full textContent back as the
    // new name — which for text-maps includes the leading "≡ "
    // marker we render with. Strip everything decorative (current
    // glyph + legacy " [T]" suffix) so the raw name is what reaches
    // storage; populateMapList / _insertMapOptionSorted re-apply
    // the marker on render.
    const cleanName = _cleanMapDisplayName(name);
    await this.maps.rename(id, cleanName);
    const oldOpt = this.mapSelect.querySelector<HTMLOptionElement>(`option[value="${id}"]`);
    if (!oldOpt) { this.mapEditableSelect.refresh(); return; }
    // Look up the underlying asset so the re-inserted option gets
    // the right leading glyph for its kind.
    const map = await getMap(id);
    let kind: MapDropdownKind = 'image';
    if (map) {
      const asset = await MapAssetStore.get(map.mapAssetId);
      kind = _dropdownKindForAsset(asset);
      // For text-map handouts, the underlying asset's filename IS the
      // displayed name (handouts don't have a separate "source file
      // name" the way image maps do). Keep the asset's filename in
      // sync with the StoredMap rename so the TextMapEditor's Name
      // input pre-populates with the new name on next open instead
      // of showing the pre-rename original. The Editor's own save
      // path already does the reverse propagation (asset → all
      // StoredMaps using it) so the two directions stay in lockstep.
      if (asset?.source === 'text-map' && asset.filename !== cleanName && cleanName) {
        await MapAssetStore.update(asset.id, { filename: cleanName });
      }
    }
    const displayName = cleanName || '(unnamed)';
    oldOpt.remove();
    this._insertMapOptionSorted(id, displayName, kind);
    this.mapSelect.value = id;
    this._lastMapSelectValue = id;
    this.mapEditableSelect.refresh();
  }

  /** Rename the active marker. updateMarkerPanel rebuilds the dropdown
   *  and calls markerEditableSelect.refresh() so the menu picks up the
   *  new label. */
  private _renameMarker(id: string, label: string): void {
    if (!id) return;
    if (this.selectedMarkerId !== id) this.markerEditor.selectById(id);
    this.updateSelectedMarker({ label });
  }

  /** Rename a projector calibration setup. Updates the option text + the
   *  saved setup, then refreshes the EditableSelect so the menu picks
   *  up the new name. Other tabs running the GM pick it up via the
   *  `storage` event already wired in init(). */
  private _renameProjectorSetup(id: string, name: string): void {
    if (!id) return;
    const setups = getAllSetups();
    const setup = setups.find((s) => s.id === id);
    if (!setup) return;
    saveSetup({ ...setup, name });
    this.refreshProjectorSetupSelect();
  }

  /** Persist the pack-name input value to session, debounced. Pass
   *  `immediate=true` to bypass the debounce (e.g. on blur). */
  private _schedulePackNameSave(value: string, immediate = false): void {
    if (this._packNameSaveTimer !== null) {
      clearTimeout(this._packNameSaveTimer);
      this._packNameSaveTimer = null;
    }
    const flush = async () => {
      this._packNameSaveTimer = null;
      const session = await loadSession();
      if (!session) return;
      const trimmed = value.trim();
      if ((session.packName ?? '') === trimmed) return;
      if (trimmed) {
        await saveSession({ ...session, packName: trimmed });
      } else {
        // Empty input → drop the field rather than persist an empty string.
        const { packName: _drop, ...rest } = session;
        void _drop;
        await saveSession(rest);
      }
    };
    if (immediate) void flush();
    else this._packNameSaveTimer = window.setTimeout(() => { void flush(); }, 400);
  }

  /** Read packName from session and reflect into the panel input. Called
   *  whenever an external flow may have changed it (host-ready first-run
   *  seed, save dialog edits, bundle import). */
  private async _refreshPackNameInput(): Promise<void> {
    const session = await loadSession();
    if (!this.packNameInput) return;
    this.packNameInput.value = session?.packName ?? '';
    this._syncPackNameDisplay();
  }

  /** v2.16.88 — reflect the pack name in the header display span. */
  private _syncPackNameDisplay(): void {
    if (this.packNameDisplay) {
      this.packNameDisplay.textContent = this.packNameInput?.value.trim() || 'Untitled pack';
    }
  }

  /** Reveal the inline rename input over the header (pencil clicked). */
  private _beginPackNameEdit(): void {
    if (!this.packNameInput || !this.packNameDisplay) return;
    this.packNameInput.value = this.packNameDisplay.textContent === 'Untitled pack' ? '' : (this.packNameDisplay.textContent ?? '');
    this.packNameInput.hidden = false;
    this.packNameInput.focus();
    this.packNameInput.select();
  }

  /** Hide the rename input + update the header display. */
  private _endPackNameEdit(): void {
    if (!this.packNameInput) return;
    this.packNameInput.hidden = true;
    this._syncPackNameDisplay();
  }

  /**
   * Handle a `?bundle=<URL>` startup load. Returns true iff the URL was
   * processed (either loaded successfully or the user cancelled the
   * destructive prompt). Returns false when there's no `?bundle=` param
   * at all, so the caller can fall through to default seeding.
   *
   * Flow:
   *   • No `?bundle=` → return false.
   *   • IDB empty → fetch + import directly.
   *   • IDB has content → prompt: save first / discard / cancel.
   *   • Strip the param from the URL after handling so a reload behaves
   *     like a normal session start.
   */
  private async _maybeLoadBundleFromUrl(): Promise<boolean> {
    const params    = new URLSearchParams(location.search);
    const bundleUrl = params.get('bundle');
    if (!bundleUrl) return false;

    // Strip the param so reload / share-from-here doesn't keep re-loading.
    params.delete('bundle');
    const newSearch = params.toString();
    const newUrl = location.pathname + (newSearch ? '?' + newSearch : '') + location.hash;
    history.replaceState(null, '', newUrl);

    // If the user already has content, ask before nuking it.
    const existing = await getAllMaps();
    if (existing.length > 0) {
      const choice = await new BundleUrlPromptDialog().open(bundleUrl);
      if (choice === 'cancel') return false; // fall back to normal init
      if (choice === 'save-then-load') {
        // Save current pack first, then proceed with URL load. If the save
        // is cancelled the user is back in the dialog flow conceptually —
        // we still proceed to load (they had their chance to back out).
        await this.saveBundle();
      }
    }

    // Mixed content: an http:// pack can't be fetched from an https:// page —
    // the browser blocks it before the request is even made. Catch it up front
    // so the user gets a real explanation instead of a generic "failed to fetch".
    if (location.protocol === 'https:' && bundleUrl.startsWith('http://')) {
      this.setStatus(
        'Pack URL blocked: it is http:// but this site is https://. Host the pack over https:// and try again.',
        'error',
      );
      return true;
    }

    const filenameGuess = bundleUrl.split(/[\\/?#]/).filter(Boolean).pop() ?? 'bundle.mappadux';
    try {
      this.setStatus('Loading pack from URL…', 'ok');
      const res = await fetch(bundleUrl);
      if (!res.ok) throw new Error(`the server returned HTTP ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], filenameGuess, { type: blob.type });
      // skipConfirm because the URL-load prompt already gathered consent.
      // For a fresh-IDB user no prompt was shown, but they did open a URL
      // with the bundle param themselves, which is itself the consent.
      await this.loadBundleFromFile(file, { skipConfirm: true });
      return true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[bundle-url] load failed:', err);
      // A failed cross-origin fetch surfaces as an opaque TypeError ("Failed to
      // fetch") with no status — almost always CORS (the host didn't allow this
      // origin). A plain DOWNLOAD isn't subject to CORS, so fall back to
      // download-then-import instead of dead-ending.
      if (err instanceof TypeError) {
        this.setStatus('Direct load blocked (CORS) — download the pack, then load it.', 'warn');
        await new BundleUrlFallbackDialog().open(bundleUrl, filenameGuess, () => {
          document.querySelector<HTMLInputElement>('#bundle-import')?.click();
        });
      } else {
        this.setStatus(`Pack URL load failed: ${(err as Error).message || String(err)}.`, 'error');
      }
      return true; // we DID handle the URL — don't fall through to seeding
    }
  }

  /** Reset this browser to a fresh copy of the bundled Getting Started pack —
   *  the de-emphasised "Open Onboarding Map" fallback. Destructive (wipes the
   *  current workspace), so confirm first; reseedWelcomePack clears + re-imports
   *  the bundle, then we reload so the app re-hydrates cleanly. */
  private async _openOnboardingMap(): Promise<void> {
    const ok = await confirmDialog({
      title: 'Open the onboarding map?',
      body: 'This replaces everything in this browser — all maps, sounds, custom icons, and settings — with a fresh copy of the bundled Getting Started pack. Save your current pack first if you want to keep it.',
      confirmLabel: 'Open onboarding map',
      cancelLabel:  'Cancel',
      confirmTone:  'danger',
    });
    if (!ok) return;
    this.setStatus('Loading the onboarding map…', 'ok');
    await reseedWelcomePack();
    location.reload();
  }

  /** Wipe the current workspace and start a fresh, empty pack with the
   *  user-supplied name. Default-bundle re-seed is NOT triggered — pack
   *  starts truly empty. */
  private async newMapPack(): Promise<void> {
    const choice = await new NewPackDialog().open();
    if (!choice) return;
    try {
      this.setStatus('Starting new pack…', 'warn');
      // Tear down any live projector connections so they don't keep
      // referring to maps that are about to vanish.
      for (const conn of this.projectorConnections.values()) {
        this.host.broadcast({ type: 'projector_shutdown', targetId: conn.clientId });
      }
      this.projectorConnections.clear();
      this.projectorEditor?.setConnection(null);

      const existing = await loadSession();
      await this.state.flushSave();
      const allMaps = await getAllMaps();
      for (const m of allMaps) await deleteMap(m.id);
      await clearAssetLibraries();
      // v2.17.12 — preserve the creator's IDENTITY across a new pack: their
      // customised About (splash — text, graphic, and the links at the
      // bottom) and theme carry over, so "New Map Pack" wipes the maps /
      // assets but keeps your branding. An un-customised splash stays
      // undefined → the default "Hi, I'm Alex…" About still shows. Pack
      // content (soundtracks) is NOT preserved — that's per-pack, not identity.
      const peerId    = existing?.peerId ?? '';
      const packName  = choice.packName.trim();
      await saveSession({
        key:       'current',
        peerId,
        lastMapId: null,
        ...(packName ? { packName } : {}),
        ...(existing?.splash ? { splash: existing.splash } : {}),
        ...(existing?.theme  ? { theme:  existing.theme  } : {}),
      });
      await seedAudioAssets(); // re-seed built-in tracker pings (CC0)
      // v2.17.3 — restore the basic default tokens. clearAssetLibraries() wiped
      // imageAssets, which holds the 47 Unicode marker presets + the system
      // image categories; without this a "New Map Pack" left you with NO
      // default tokens at all. Idempotent re-seed brings just those back.
      await seedImageAssetsIfNeeded();
      // v2.17.3 — mark the default seed as done so a reload doesn't drop the
      // Getting Started pack back over the user's freshly-emptied workspace.
      try { localStorage.setItem(DEFAULT_SEED_DONE_KEY, '1'); } catch { /* private mode */ }
      this.state.resetForImport();
      await this._reloadLibIcons();
      await this.populateMapList();
      void this._refreshPackNameInput();
      applyTheme(existing?.theme); // keep the creator's theme (default if none)
      this.setStatus('New pack ready — empty workspace', 'ok');
    } catch (err) {
      this.setStatus(`New pack failed: ${(err as Error).message}`, 'error');
    }
  }

  /** Open the Image Library modal — browse + add icons across categories.
   *  At M3 this is browse-only; marker icon integration follows. */
  private async openImageLibrary(): Promise<void> {
    await new ImageAssetModal().open();
  }

  /** Copy the canonical Mappadux site URL to the clipboard — wired to the
   *  GM brand icon (top-left duck) so creators can share the project link
   *  in a single click. Also called from the About dialog's footer duck. */
  private async _copyMappaduxUrl(): Promise<void> {
    const { copyText } = await import('../utils/copyText.ts');
    const url = 'https://www.mappadux.com/';
    const ok = await copyText(url);
    if (ok) {
      this.setStatus(`Copied ${url} to clipboard — share it!`, 'ok');
    } else {
      this.setStatus('Copy failed — clipboard blocked by browser', 'warn');
    }
  }

  /** Open the audio library (FreesoundModal) in browse-only mode — onAssign
   *  callback is a no-op, so picking a sound from the library doesn't try
   *  to drop it into a soundboard slot. The user can still manage
   *  attribution, store, delete, etc. on each row. */
  private async openSoundLibrary(): Promise<void> {
    const { FreesoundModal } = await import('./FreesoundModal.ts');
    new FreesoundModal(() => { /* browse-only */ }).open();
  }

  /** Open the Settings dialog. Handles the Delete DB / Delete All Data
   *  destructive actions itself (full page reload afterwards). */
  private async openSettings(): Promise<void> {
    await new SettingsDialog().open({
      onDeleteDb: async () => {
        // Wipe IDB but keep API keys + projector calibration. Set a flag
        // so the upcoming reload doesn't re-seed Getting Started over the
        // empty workspace.
        localStorage.setItem(SUPPRESS_DEFAULT_SEED_KEY, '1');
        await clearEverything();
        location.reload();
      },
      onDeleteAllData: async () => {
        // Nuke everything: IDB + ALL local settings (including API keys,
        // projector setups, and the suppress-seed flag). On reload init
        // runs as if fresh-installed, so Getting Started re-seeds.
        await clearEverything();
        clearAllLocalSettings();
        location.reload();
      },
    });
    // v2.16 — Stagecraft connections may have been added or removed
    // in Settings. Refresh the panel so it appears / disappears and
    // re-fetches device state to match. Same for Soundtracks.
    if (this.stagecraftPanel) void this.stagecraftPanel.refresh({ force: true });
    if (this.soundtracksPanel) this.soundtracksPanel.refresh();
    // v2.17 Player Voice — the GM may have toggled pings / messaging; push the
    // current feature flags so player views update their action menus.
    this._broadcastPlayerFeatures();
  }

  /** Open the About / splash dialog. Reads pack name + splash + theme from
   *  session, renders, and on Save persists the edited splash and theme
   *  back. Theme is also live-applied during edit so the user previews. */
  private async openAboutDialog(opts: { startInEdit?: boolean }): Promise<void> {
    this._aboutOpen = true;
    try {
      const session = await loadSession();
      const result = await new AboutDialog().open({
        packName:    session?.packName ?? '',
        splash:      session?.splash,
        theme:       session?.theme,
        ...(opts.startInEdit ? { startInEdit: true } : {}),
      });
      if (!result || !session) return;
      const hasTheme = !!result.theme.mode || !!result.theme.accent;
      const next = { ...session, splash: result.splash };
      if (hasTheme) next.theme = result.theme;
      else delete next.theme;
      await saveSession(next);
      applyTheme(hasTheme ? result.theme : undefined);
    } finally {
      this._aboutOpen = false;
    }
  }

  /** v2.12 — one-off "Message of the Day" popup. Runs once at startup
   *  per the rules in src/motd/motd.ts:
   *
   *    • First install (`_didSeedDefault` true)        → silently mark
   *      the current MOTD version as seen and skip the popup. The
   *      auto-About dialog is the welcome message in that case.
   *    • About dialog currently open                   → defer to the
   *      next session. Don't mark seen.
   *    • CURRENT_MOTD.version === '' (disabled)        → no-op.
   *    • Stored 'seen' version === CURRENT_MOTD.version → already shown,
   *      no-op.
   *    • Otherwise                                     → show the
   *      MOTD modal; on dismiss, record the current version as seen
   *      so it doesn't reappear until the next bump. */
  private async _maybeShowMotd(): Promise<void> {
    const { CURRENT_MOTD, BETA_MOTD } = await import('../motd/motd.ts');
    const settings = await import('../storage/localSettings.ts');

    // v2.14.2 — beta-channel announcement. Shown once per browser on a
    // beta host. Doesn't compete with the per-release MOTD: beta MOTD
    // fires only on beta hosts; the release MOTD fires regardless of
    // host. If both want to show, the beta one wins this session (its
    // job is to set context for everything else the user sees).
    if (settings.isBetaHost() && !settings.isBetaMotdDismissed() && !this._didSeedDefault && !this._aboutOpen) {
      const { showMotdDialog } = await import('./MotdDialog.ts');
      await showMotdDialog(BETA_MOTD, { variant: 'warn' });
      settings.setBetaMotdDismissed();
      return;
    }

    if (!CURRENT_MOTD.version) return;
    const { getLastSeenMotdVersion, setLastSeenMotdVersion } = settings;
    if (this._didSeedDefault) {
      // First-install path — About is about to auto-open (or was just
      // dismissed). Don't bombard with a second popup; mark the MOTD
      // as already seen so the next session lands clean.
      setLastSeenMotdVersion(CURRENT_MOTD.version);
      return;
    }
    if (getLastSeenMotdVersion() === CURRENT_MOTD.version) return;
    if (this._aboutOpen) return; // defer to next session
    const { showMotdDialog } = await import('./MotdDialog.ts');
    await showMotdDialog(CURRENT_MOTD);
    setLastSeenMotdVersion(CURRENT_MOTD.version);
  }

  /** Save the current workspace as a plain (unencrypted) `.mappadux` pack.
   *  Skips any internal dialog and goes straight to the OS save picker —
   *  the user can hand-edit the filename there. The default filename
   *  derives from the current pack name. */
  private async saveBundle(): Promise<void> {
    await this._saveBundleAndPrompt({ encrypt: false });
  }

  /** Save the current workspace as an AES-GCM-encrypted `.mappadux` pack.
   *  Opens a small password dialog first; on confirm, builds the encrypted
   *  bundle and hands off to the OS save picker. */
  private async saveBundleEncrypted(): Promise<void> {
    const choice = await new EncryptSaveDialog().open();
    if (!choice) return;
    await this._saveBundleAndPrompt({ encrypt: true, password: choice.password });
  }

  private async _saveBundleAndPrompt(opts:
    | { encrypt: false }
    | { encrypt: true; password: string },
  ): Promise<void> {
    try {
      this.setStatus(opts.encrypt ? 'Encrypting pack…' : 'Building pack…', 'ok');
      await this.state.flushSave(); // write in-memory state before reading IDB
      const { blob } = await exportBundle(
        opts.encrypt ? { password: opts.password } : undefined,
      );
      const suggestedName = await this._suggestedSaveFilename(opts.encrypt);
      const result = await saveBlob({
        blob,
        suggestedName,
        description: 'Mappadux Map Pack',
        // Custom MIME so Chrome's save picker doesn't expand the filter to
        // generic binary extensions (.exe/.com/.bin) — those leak in when
        // you use application/octet-stream.
        accept: { 'application/x-mappadux-pack': ['.mappadux'] },
      });
      this.setStatus(
        result === 'cancelled' ? 'Save cancelled' : 'Pack saved',
        result === 'cancelled' ? 'warn' : 'ok',
      );
    } catch (err) {
      this.setStatus(`Save failed: ${(err as Error).message}`, 'error');
    }
  }

  /** Build a default save filename from the current pack name + today's
   *  date stamp. Slugs the pack name down to a filesystem-safe segment. */
  private async _suggestedSaveFilename(encrypted: boolean): Promise<string> {
    const datestamp = new Date().toISOString().slice(0, 10);
    const session   = await loadSession();
    const packName  = session?.packName?.trim() ?? '';
    const slug = packName
      .toLowerCase()
      .replace(/['"]+/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    const base = slug.length > 0 ? slug : 'mappadux-pack';
    return encrypted
      ? `${base}-encrypted-${datestamp}.mappadux`
      : `${base}-${datestamp}.mappadux`;
  }

  /** Replace all current maps/sounds/icons with the contents of `file`. If
   *  the file is an encrypted bundle, prompt for a password and decrypt
   *  BEFORE wiping the workspace, so a wrong-password cancel leaves the
   *  current pack intact.
   *
   *  Pass `opts.skipConfirm` when the caller has already gotten user
   *  consent (e.g. the URL-load prompt). */
  private async loadBundleFromFile(file: File, opts?: { skipConfirm?: boolean }): Promise<void> {
    if (!opts?.skipConfirm) {
      const ok = confirm(
        'Load Map Pack\n\nThis will delete ALL current maps, sounds, and custom icons, and replace them with the contents of the selected file.\n\nMake sure you have saved a backup first.\n\nContinue?',
      );
      if (!ok) return;
    }

    // Pre-flight: read the file and (if encrypted) decrypt before any
    // destruction. Handles three formats: gzipped JSON (current plain saves),
    // raw JSON envelope (encrypted), and legacy raw JSON. A bad password /
    // cancel here aborts cleanly without touching the workspace.
    const bytes = new Uint8Array(await file.arrayBuffer());
    let plainJson: string;
    try {
      if (startsWithGzipMagic(bytes)) {
        // Gzipped plain bundle — decompress and we're done.
        plainJson = await gunzipToString(bytes);
      } else {
        const text = new TextDecoder().decode(bytes);
        const parsed: unknown = JSON.parse(text);
        if (isEncryptedBundleEnvelope(parsed)) {
          this.setStatus('Encrypted pack — password required', 'warn');
          const decryptedBytes = await new PasswordPromptDialog().open(parsed);
          if (decryptedBytes === null) {
            this.setStatus('Load cancelled', 'warn');
            return;
          }
          plainJson = parsed.compressed
            ? await gunzipToString(decryptedBytes)
            : new TextDecoder().decode(decryptedBytes);
        } else {
          // Legacy raw-JSON bundle (pre-compression / pre-rebrand).
          plainJson = text;
        }
      }
    } catch {
      this.setStatus('Load failed: not a valid map pack file', 'error');
      return;
    }

    // Decrypted (or plain) JSON in hand — now safe to wipe and import.
    try {
      this.setStatus('Loading pack…', 'ok');
      await this.state.flushSave();
      const existing = await getAllMaps();
      for (const m of existing) await deleteMap(m.id);
      await clearAssetLibraries();
      const { added } = await importBundleText(plainJson);
      await seedAudioAssets();           // re-seed built-in tracker pings (CC0)
      await seedImageAssetsIfNeeded();   // re-pin system image categories + Unicode presets if missing
      this.state.resetForImport();
      await this._reloadLibIcons();
      await this.populateMapList();
      void this._refreshPackNameInput();
      // Re-apply theme so any creator-supplied look from the bundle takes effect.
      const importedSession = await loadSession();
      applyTheme(importedSession?.theme);

      // v2.17.11 — the pack's GM/system preferences (measurement scale,
      // initiative direction, player permissions) were applied to
      // localStorage during import; push the live ones out now. Features
      // broadcast covers measure scale + permissions to connected players;
      // the initiative event re-sorts the tracker to the imported direction.
      this._broadcastPlayerFeatures();
      this.initiativeTracker?.setSortDirection(getInitiativeSortDirection());

      // Retrofit pass — auto-detect grid scale on any map in the loaded pack
      // that doesn't already carry one. Manually-calibrated maps and no-grid
      // opt-outs are skipped. Ambiguous maps stay uncalibrated; the creator
      // can resolve them per-asset later.
      const retro = await retrofitMapScales();
      const retroMsg = retro.applied > 0 || retro.ambiguous > 0
        ? ` · Auto-scaled ${retro.applied}` + (retro.ambiguous > 0 ? `, ${retro.ambiguous} need a look` : '')
        : '';
      this.setStatus(`Loaded — ${added} map${added !== 1 ? 's' : ''} imported${retroMsg}`, 'ok');

      // Auto-open the About dialog so the user immediately sees the splash
      // for the pack they just loaded — whether it's creator-branded or just
      // the default content.
      void this.openAboutDialog({});
    } catch (err) {
      this.setStatus(`Load failed: ${(err as Error).message}`, 'error');
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
    // v2.16.34 — sentinel "+ Add Marker" retired; #add-marker-btn beside
    // the dropdown is the affordance now (bound in bindMarkerEditor /
    // bindUIControls). Defensive branch in the change handler stays.
    if (sel) this.markerSelect.value = sel.id;

    const controlsEl = document.querySelector<HTMLElement>('#marker-controls');
    if (controlsEl) controlsEl.hidden = !sel;

    this.markerEditableSelect?.refresh();

    if (sel) {
      this.markerColorInput.value     = sel.color;
      this.markerHiddenToggle.checked      = sel.hidden;
      this.markerShowLabelToggle.checked   = sel.showLabel ?? false;
      this.markerShowLabelGmToggle.checked = sel.showLabelOnGM ?? true;
      this.markerLockedToggle.checked      = sel.locked ?? false;

      // Update icon button display — rendered at 96×96 px for the
      // new double-height preview button (.marker-icon-btn--lg). The
      // button itself is 64×64 visually; rendering at 1.5× the visual
      // size keeps the icon crisp on high-DPI displays.
      this.markerIconBtn.innerHTML = '';
      const isLib   = sel.icon.startsWith('libAsset:');
      const isAsset = sel.icon.startsWith('asset:') || sel.icon.startsWith('data:') || isLib;
      if (isAsset) {
        // libAsset tintables live under '<icon>#<color>' in iconCache.
        const cacheKey = isLib
          ? (this.iconCache.has(`${sel.icon}#${sel.color}`)
              ? `${sel.icon}#${sel.color}`
              : sel.icon)
          : sel.icon;
        const bmp = this.iconCache.get(cacheKey);
        const img = document.createElement('img');
        if (bmp) {
          const cv = document.createElement('canvas');
          cv.width = 96; cv.height = 96;
          cv.getContext('2d')!.drawImage(bmp, 0, 0, 96, 96);
          img.src = cv.toDataURL();
        }
        this.markerIconBtn.appendChild(img);
      } else {
        this.markerIconBtn.textContent = sel.icon;
      }
      // Tintability gate for the Colour row. Unicode glyphs are always
      // tintable. Legacy 'asset:' and inline 'data:' icons are not.
      // libAsset: reads from the _libAssetTintable cache which is
      // populated at preload + pick time — synchronous so the row's
      // hidden state never flickers mid-render. Mid-render flicker on
      // a `<input type="color">` ancestor closes the native picker
      // dialog in Chrome, which is what we're avoiding here.
      const colorRow = document.getElementById('marker-color-row');
      if (colorRow) {
        let shouldHide: boolean;
        if (isLib) {
          const id = sel.icon.slice('libAsset:'.length);
          const known = this._libAssetTintable.get(id);
          if (known === undefined) {
            // Unknown so far — leave the row as-is and fetch in the
            // background so the next render is correct.
            shouldHide = colorRow.hidden === true;
            void ImageAssetStore.get(id).then((asset) => {
              if (!asset) return;
              this._libAssetTintable.set(id, asset.tintable);
              if (this.selectedMarkerId === sel.id) {
                colorRow.hidden = !asset.tintable;
              }
            });
          } else {
            shouldHide = !known;
          }
        } else {
          shouldHide = isAsset; // tintable iff not a legacy raster asset
        }
        // Only touch the DOM when the value actually changes — keeps the
        // native colour-picker dialog open through stream of 'input'
        // events fired while the user drags the picker around.
        if (colorRow.hidden !== shouldHide) colorRow.hidden = shouldHide;
      }

      // Audio role buttons — translate legacy data-role values to the current audio role
      document.querySelectorAll<HTMLElement>('.marker-audio-role-btns .marker-role-btn').forEach((btn) => {
        const raw = btn.dataset['role'];
        const matches =
          (raw === 'default'      && !sel.roles.audio) ||
          (raw === 'audio_source' && sel.roles.audio === 'source') ||
          (raw === 'listener'     && sel.roles.audio === 'listener');
        btn.classList.toggle('marker-role-btn--active', matches);
      });

      // Motion role buttons
      document.querySelectorAll<HTMLElement>('.marker-motion-role-btns .marker-role-btn').forEach((btn) => {
        const raw = btn.dataset['motionRole'];
        const matches =
          (raw === 'default' && !sel.roles.motion) ||
          (raw === 'source'  && sel.roles.motion === 'source') ||
          (raw === 'tracker' && sel.roles.motion === 'tracker');
        btn.classList.toggle('marker-role-btn--active', matches);
      });

      // Audio controls — visible whenever the marker has an audio role
      const audioControlsEl  = document.querySelector<HTMLElement>('#marker-audio-controls');
      const sourceControlsEl = document.querySelector<HTMLElement>('#marker-source-controls');
      const mutedToggle      = document.querySelector<HTMLInputElement>('#marker-audio-muted');
      if (audioControlsEl)  audioControlsEl.hidden  = !sel.roles.audio;
      if (sourceControlsEl) sourceControlsEl.hidden = sel.roles.audio !== 'source';
      if (mutedToggle)      mutedToggle.checked      = sel.audioMuted;

      // Motion controls — visible whenever the marker has a motion role
      const motionControlsEl   = document.querySelector<HTMLElement>('#marker-motion-controls');
      const motionMutedToggle  = document.querySelector<HTMLInputElement>('#marker-motion-muted');
      if (motionControlsEl)  motionControlsEl.hidden  = !sel.roles.motion;
      if (motionMutedToggle) motionMutedToggle.checked = sel.motionMuted;

      // Tracker-only sliders — only show when this marker holds the tracker role
      const trackerControlsEl = document.querySelector<HTMLElement>('#marker-motion-tracker-controls');
      if (trackerControlsEl) trackerControlsEl.hidden = sel.roles.motion !== 'tracker';
      if (sel.roles.motion === 'tracker') {
        const cfg = this.state.getState().motionTracker;
        const set = <T extends HTMLInputElement>(id: string, v: string | boolean) => {
          const el = document.querySelector<T>(id);
          if (!el) return;
          if (typeof v === 'boolean') el.checked = v; else el.value = v;
        };
        set<HTMLInputElement>('#tracker-range',      String(rangeToSlider(cfg.range)));
        set<HTMLInputElement>('#tracker-rate',       String(cfg.rate));
        set<HTMLInputElement>('#tracker-speed',      String(cfg.speed));
        set<HTMLInputElement>('#tracker-colour',     cfg.colour);
        set<HTMLInputElement>('#tracker-hide-blobs', cfg.hideBlobs);
        const rv = document.querySelector<HTMLElement>('#tracker-range-val'); if (rv) rv.textContent = cfg.range.toFixed(2);
        const ra = document.querySelector<HTMLElement>('#tracker-rate-val');  if (ra) ra.textContent = `${cfg.rate.toFixed(2)}s`;
        const sp = document.querySelector<HTMLElement>('#tracker-speed-val'); if (sp) sp.textContent = `${cfg.speed.toFixed(1)}s`;
        // Outgoing/return ping button labels + volume sliders
        this._refreshTrackerPingButton('#tracker-outgoing-row', '#tracker-outgoing-btn', cfg.outgoingPingAssetId);
        this._refreshTrackerPingButton('#tracker-return-row',   '#tracker-return-btn',   cfg.returnPingAssetId);
        set<HTMLInputElement>('#tracker-outgoing-vol', String(cfg.outgoingPingVolume));
        set<HTMLInputElement>('#tracker-return-vol',   String(cfg.returnPingVolume));
      }

      // Motion source controls — only when this marker is a Motion Source
      const motionSourceControlsEl = document.querySelector<HTMLElement>('#marker-motion-source-controls');
      if (motionSourceControlsEl) motionSourceControlsEl.hidden = sel.roles.motion !== 'source';
      if (sel.roles.motion === 'source') {
        const blobModeSel = document.querySelector<HTMLSelectElement>('#source-blob-mode');
        if (blobModeSel) blobModeSel.value = sel.motionBlobMode;
      }

      if (sel.roles.audio === 'source') {
        const soundRow        = document.querySelector<HTMLElement>('#marker-sound-row');
        const soundBtn        = document.querySelector<HTMLButtonElement>('#marker-sound-btn');
        const soundControls   = document.querySelector<HTMLElement>('#marker-sound-controls');
        const onceBtn         = document.querySelector<HTMLButtonElement>('#marker-once-btn');
        const loopBtn         = document.querySelector<HTMLButtonElement>('#marker-loop-btn');
        const randomBtn       = document.querySelector<HTMLButtonElement>('#marker-random-btn');
        const audioVolInput   = document.querySelector<HTMLInputElement>('#marker-audio-volume');
        const randomRow       = document.querySelector<HTMLElement>('#marker-random-row');
        const randomFreqInput = document.querySelector<HTMLInputElement>('#marker-random-freq');
        const randomFreqVal   = document.querySelector<HTMLElement>('#marker-random-freq-val');
        const maxDistInput    = document.querySelector<HTMLInputElement>('#marker-max-dist');
        const maxDistVal      = document.querySelector<HTMLElement>('#marker-max-dist-val');

        if (sel.audioTrackId) {
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
          if (soundRow)      soundRow.className = 'sb-slot-empty';
          if (soundBtn) {
            soundBtn.className   = 'sb-assign-btn btn btn--ghost btn--sm btn--full';
            soundBtn.textContent = '+ Assign Sound';
          }
          if (soundControls) soundControls.hidden = true;
        }

        if (audioVolInput)    audioVolInput.value      = String(sel.audioVolume ?? 1);
        if (onceBtn)          onceBtn.classList.toggle('sb-mode-btn--active', !sel.audioLoop && !(sel.audioRandom ?? false));
        if (loopBtn)          loopBtn.classList.toggle('sb-mode-btn--active', sel.audioLoop);
        if (randomBtn)        randomBtn.classList.toggle('sb-mode-btn--active', !!(sel.audioRandom));
        if (randomRow)        randomRow.hidden          = !(sel.audioRandom);
        if (randomFreqInput)  randomFreqInput.value     = String(sel.audioRandomFreq ?? 10);
        if (randomFreqVal)    randomFreqVal.textContent = `~${sel.audioRandomFreq ?? 10} / 10 min`;
        if (maxDistInput)     maxDistInput.value        = String(sel.audioMaxDistance);
        if (maxDistVal)       maxDistVal.textContent    = sel.audioMaxDistance.toFixed(2);
      }
    }

    // Refresh the static tracker-range preview ring (no-op if no tracker selected)
    this._pushMotionOverlay();
  }
}
