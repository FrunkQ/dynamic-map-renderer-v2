import { StateManager } from './StateManager.ts';
import { MapManager } from './MapManager.ts';
import { FogEditor } from './FogEditor.ts';
import { OVERLAY_KIND_REGISTRY, OVERLAY_KIND_ORDER, overlayKind, DEFAULT_EDGE_FADE } from '../mapfx/overlayKindRegistry.ts';
import { confirmDialog } from './confirmDialog.ts';
import type { OverlayKind, FogPolygon } from '../types.ts';
import { offsetPolyline } from '../mapfx/polylineOffset.ts';
import { subtractFromAll, cleanRibbonToBlobs } from '../mapfx/polygonOps.ts';
import { floodFillToPolygon } from '../mapfx/floodFill.ts';
import { wireSliderTooltip } from '../utils/sliderReadout.ts';
import { ViewportEditor } from './ViewportEditor.ts';
import { MarkerEditor } from './MarkerEditor.ts';
import { MapAssetModal } from './MapAssetModal.ts';
import { MapAssetStore } from '../maps/MapAssetStore.ts';
import { extractFirstFrameSnapshot } from '../maps/videoSnapshot.ts';
import { TextMapEditor } from './TextMapEditor.ts';
import { MapCalibrationModal } from './MapCalibrationModal.ts';
import { ProjectorViewportEditor } from './ProjectorViewportEditor.ts';
import { HamburgerMenu } from './HamburgerMenu.ts';
import { SELECT_ADD_SENTINEL, appendAddOption } from './selectAdd.ts';
import { EditableSelect } from './EditableSelect.ts';
import { getAllSetups, setActiveSetupId, saveSetup } from '../projector/calibrationStorage.ts';
import { SoundboardPanel, type SoundboardBroadcast } from './SoundboardPanel.ts';
import { SoundboardEngine } from '../audio/SoundboardEngine.ts';
import { Renderer } from '../rendering/Renderer.ts';
import { FilterPanel } from '../filters/FilterPanel.ts';
import { filterRegistry } from '../filters/FilterRegistry.ts';
import { TransitionPanel } from '../transitions/TransitionPanel.ts';
import { transitionRegistry } from '../transitions/TransitionRegistry.ts';
import { Host } from '../p2p/Host.ts';
import { generateRoomCode } from '../p2p/roomCode.ts';
import { saveSession, loadSession, getAllMaps, getMap, saveMap, deleteMap, clearAssetLibraries, clearEverything } from '../storage/db.ts';
import { clearAllLocalSettings, SUPPRESS_DEFAULT_SEED_KEY } from '../storage/localSettings.ts';
import { seedDefaultMaps } from '../storage/seedMaps.ts';
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
import { BundleUrlPromptDialog } from './BundleUrlPromptDialog.ts';
import { saveBlob } from '../utils/saveBlob.ts';
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
import QRCode from 'qrcode';

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
const IMAGE_MAP_PREFIX    = '▣ ';
const ANIMATED_MAP_PREFIX = '▶ ';
const TEXT_MAP_PREFIX     = '▤ ';

/** Strip every decoration that has ever been put on a map's display
 *  name — current "▣ " / "▶ " / "▤ " prefixes, the brief "≡ " trial
 *  run, and the legacy " [T]" suffix — so localeCompare,
 *  EditableSelect, and storage all see the raw name. */
function _cleanMapDisplayName(name: string): string {
  return name
    .replace(/^[▣▶▤≡]\s+/, '')
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
function _dropdownKindForAsset(asset: import('../types.ts').MapAsset | undefined): 'image' | 'animated' | 'text' {
  if (!asset) return 'image';
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

/** Map ASCII letters to their Mathematical Sans-Serif Bold Unicode
 *  equivalents. Used for the dropdown's "Fog of War" entry so it
 *  visually stands out from the MapFX kinds without needing CSS
 *  styling on <option> (which browsers largely ignore). */
function _toUnicodeBold(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x41 && c <= 0x5A)       out += String.fromCodePoint(0x1D5D4 + (c - 0x41)); // A-Z
    else if (c >= 0x61 && c <= 0x7A)  out += String.fromCodePoint(0x1D5EE + (c - 0x61)); // a-z
    else if (c >= 0x30 && c <= 0x39)  out += String.fromCodePoint(0x1D7EC + (c - 0x30)); // 0-9
    else                              out += s[i];
  }
  return out;
}

export class GMApp {
  private state   = new StateManager();
  private maps    = new MapManager();
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
  private filterPanel!:     FilterPanel;
  private transitionPanel!: TransitionPanel;

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
  /** Debounce timer for the in-panel pack-name input. */
  private _packNameSaveTimer: number | null = null;
  private transitionSelect!:        HTMLSelectElement;
  private transitionParamsContainer!: HTMLElement;
  private filterSelect!:            HTMLSelectElement;
  private filterParamsContainer!:   HTMLElement;
  // viewBgColour swatch removed in v2.12 — bg colour lives in the
  // backdrop popover's Background row now.
  private viewBgFxBtn!:            HTMLButtonElement;
  /** Sparkle button on the FoW panel (right of #fog-colour). Opens
   *  the same FxPopover style as the Backdrop FX button, populated
   *  with Edge Fade + the active kind's shader params. */
  private mapFxBtn!:               HTMLButtonElement;
  /** Live popover handle (open state) — null when nothing is shown.
   *  See src/gm/FxPopover.ts for the shared component shape. */
  private _bgFxPopover:    import('./FxPopover.ts').FxPopoverHandle | null = null;
  /** MapFX sparkle popover handle — opened from the FoW panel's
   *  sparkle button. Shares the same FxPopover plumbing. */
  private _mapfxFxPopover: import('./FxPopover.ts').FxPopoverHandle | null = null;
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
  private qrContainer!:            HTMLElement;
  private playerCountEl!:          HTMLElement;
  private statusEl!:               HTMLElement;
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

      const step = 0.1 / this.gmTransform.scale;
      let handled = true;
      switch (e.key) {
        case 'ArrowLeft':  this.gmTransform.panByWorld(-step, 0);  break;
        case 'ArrowRight': this.gmTransform.panByWorld( step, 0);  break;
        case 'ArrowUp':    this.gmTransform.panByWorld(0,  step);  break;
        case 'ArrowDown':  this.gmTransform.panByWorld(0, -step);  break;
        case 'r': case 'R': this.gmTransform.reset(); break;
        default: handled = false;
      }
      if (handled) {
        e.preventDefault();
        this._applyWorkspaceTransform();
      }
    });
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
      btn.title = 'Reset workspace view (centred, 100%)';
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<polyline points="1 4 1 10 7 10"/>' +
          '<path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>' +
        '</svg>' +
        '<span class="reset-view-btn__label">Reset view</span>';
      btn.addEventListener('click', () => {
        this.gmTransform.reset();
        this._applyWorkspaceTransform();
      });
      btn.hidden = true;
      wrapper.appendChild(btn);
      this._resetViewBtn = btn;
    }
    this._resetViewBtn.hidden = this.gmTransform.isIdentity;
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
    const playerBroadcastEl = document.querySelector<HTMLInputElement>('#player-broadcast-toggle');
    const playerBroadcast: 'on' | 'off' = playerBroadcastEl?.checked === false ? 'off' : 'on';
    this._markerOverlay.updateRect('player', playerBounds
      ? {
          ...playerBounds,
          color:      '#ff8c00',
          selected:   playerSelected,
          showResize: playerSelected,
          // v2.14.3 — eye icon shows regardless of selection; the
          // broadcast state matters at a glance.
          viewBroadcast: playerBroadcast,
          ...(playerSelected ? {
            aspectLock:      this._playerAspectUndo ? 'undo' : 'apply',
            maximise:        this._playerMaxRestore ? 'maximised' : 'normal',
            // v2.14.3 — continuous aspect-ratio lock toggle.
            aspectRatioLock: (this.state.snapshot().view?.aspectLocked) ? 'locked' : 'unlocked',
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
    const projBroadcastEl = document.querySelector<HTMLInputElement>('#projection-broadcast-toggle');
    const projBroadcast: 'on' | 'off' = projBroadcastEl?.checked === false ? 'off' : 'on';
    this._markerOverlay.updateRect('projector', projBounds
      ? {
          ...projBounds,
          color:    '#22c55e',
          selected: projSelected,
          // v2.14.3 — eye icon also on the projector / Scaled View rect.
          viewBroadcast: projBroadcast,
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
    const el = document.getElementById('mapfx-kind-display');
    if (!el) return;
    el.textContent = overlayKind(this.activeOverlayKind).label;
  }

  /** v2.12 — sibling to _updateActiveKindDisplay for the Backdrop
   *  side. Shows the active backdrop's label on the Map panel so the
   *  GM can see at a glance whether anything is filling the bars
   *  without opening the popover. */
  private _updateActiveBgDisplay(): void {
    const el = document.getElementById('view-bg-display');
    if (!el) return;
    const kind = this.state.getState().view.backdrop?.kind ?? 'none';
    if (kind === 'none') {
      el.textContent = 'None';
      return;
    }
    // Lazy-resolve label from the backdrop registry (already loaded
    // if a backdrop has ever been picked; the import is cached).
    void import('../rendering/backdrops/backdropRegistry.ts').then(({ BACKDROPS }) => {
      const entry = BACKDROPS.find((b) => b.id === kind);
      el.textContent = entry?.label ?? kind;
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
   * v2.14.3 — eye icon click on a viewport rect. Toggles the same
   * broadcast bypass that the panel-header switch controls; firing
   * the checkbox's 'change' event keeps the existing wiring (faff
   * placeholder broadcast) intact and ensures the panel UI updates
   * to match.
   */
  private _handleRectViewBroadcast(kind: 'player' | 'projector'): void {
    const id = kind === 'player' ? '#player-broadcast-toggle' : '#projection-broadcast-toggle';
    const cb = document.querySelector<HTMLInputElement>(id);
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
      // Pop shortcut (player only): if the rect currently fills the
      // whole map there's nothing to "move", so a grab of the move
      // handle instead snaps it down to a 50% map-dimension rect
      // centred on the map. The user then has a sensibly-sized rect
      // they can drag / resize on their next gesture. We abort the
      // drag init for this gesture so the cursor doesn't drag a rect
      // whose move handle just teleported elsewhere on screen.
      if (kind === 'player') {
        const v = this.viewportEditor.getView();
        if (v.viewNW >= 0.99 && v.viewNH >= 0.99) {
          const popped: ViewState = { ...v, centerX: 0.5, centerY: 0.5, viewNW: 0.5, viewNH: 0.5 };
          this.viewportEditor.setView(popped);
          this.state.setView(popped);
          // Clear any pending snap-undo state — the pop is a deliberate
          // non-undo action and the prior baselines are stale.
          this._clearSnapUndo('player');
          this._refreshRectOverlays();
          return;
        }
      }
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

  private _setBrokerErrorVisible(visible: boolean): void {
    const errBox = document.getElementById('broker-error');
    const qr     = document.getElementById('qr-container');
    if (errBox) errBox.hidden = !visible;
    if (qr)     qr.hidden     =  visible;
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
    this.bindHamburgerMenu();
    this._bindWorkspacePanZoom();

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
    try {
      const lifecycle = new BroadcastChannel('mappadux:lifecycle');
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

  private async onHostReady(roomCode: string): Promise<void> {
    // Broker just confirmed our peer id — any prior broker-down notice
    // is stale, restore the QR.
    this._setBrokerErrorVisible(false);
    this.roomCodeEl.textContent = roomCode;

    // On localhost, replace with the real LAN IP so QR/URL works for other devices.
    // __DEV_LAN_IP__ is injected at build time by vite.config.ts (null in prod).
    if ((location.hostname === 'localhost' || location.hostname === '127.0.0.1')
        && __DEV_LAN_IP__) {
      this.playerOrigin = `${location.protocol}//${__DEV_LAN_IP__}:${location.port}`;
    }

    const playerUrl = `${this.playerOrigin}/player#${roomCode}`;
    this.qrContainer.title = `Click to copy player URL — Room code: ${roomCode}`;
    try {
      await QRCode.toCanvas(
        this.qrContainer.querySelector('canvas') as HTMLCanvasElement,
        playerUrl,
        { width: 120, color: { dark: '#c8d8e8', light: '#0a0e1a' } }
      );
    } catch { /* QR non-critical */ }

    const existing = await loadSession();
    // Pack name precedence: existing session > bundle-seeded default > none.
    const packName = existing?.packName ?? this._seededPackName ?? '';
    this._seededPackName = null; // consume
    await saveSession({
      key:       'current',
      peerId:    roomCode,
      lastMapId: existing?.lastMapId ?? null,
      ...(packName ? { packName } : {}),
    });
    void this._refreshPackNameInput();

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
    // first-installers as caught up.
    void this._maybeShowMotd().finally(() => { this._didSeedDefault = false; });
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
    this.projectorEditor?.setConnection(this._primaryProjector() ?? null);
    this.refreshProjectorStatus();
    this._refreshProjectionPanelMode();
    this._updatePlayerCount();
    this.setStatus(`Player disconnected (${id.slice(0, 8)}…)`, 'warn');
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

    this.playerCountEl.textContent = String(remotePlayers);
    const plural = document.querySelector('#player-count-plural');
    if (plural) plural.textContent = remotePlayers === 1 ? '' : 's';

    // "(N)" — full audience including same-machine players. Shown only when
    // there's at least one local player so the line stays clean for the
    // common pure-remote case.
    const totalSuffix = document.querySelector<HTMLElement>('#player-total-suffix');
    if (totalSuffix) {
      totalSuffix.textContent = localPlayers > 0 ? ` (${totalPlayers})` : '';
    }

    // Projector segment: "+ Projector" once any projector connects, with a
    // bracketed count of ADDITIONAL monitors (projector #1 is always
    // primary; closing the primary auto-closes all monitors).
    const projTotal = this.projectorConnections.size;
    const monitors  = Math.max(0, projTotal - 1);
    const projSuffix = document.querySelector<HTMLElement>('#projector-count-suffix');
    if (projSuffix) {
      if (projTotal === 0)      projSuffix.textContent = '';
      else if (monitors === 0)  projSuffix.textContent = ' + Projector';
      else                      projSuffix.textContent = ` + Projector (${monitors})`;
    }

    // Grey out the broadcast toggles on the side-panel headers when nothing
    // of that type is currently receiving. CSS handles the visual fade; the
    // toggle stays clickable so the GM can pre-set state before joining
    // players / projectors arrive. Player toggle (now in the Session
    // header) uses TOTAL players (a single local player is enough to
    // undgrey it).
    document.querySelector('#session-panel .panel-header')
      ?.classList.toggle('panel-header--no-connection', totalPlayers === 0);
    document.querySelector('#projection-panel .panel-header')
      ?.classList.toggle('panel-header--no-connection', projTotal === 0);

    // Hover tooltip on the session-meta line listing what we know about each
    // connected peer. Players are anonymous PeerJS peers today (real names
    // arrive in v2.13 with User ID); projectors carry their setup name from
    // projector_hello, which is more identifiable.
    const meta = document.querySelector<HTMLElement>('.session-meta');
    if (meta) {
      const playerLines: string[] = [];
      for (const peerId of this.host.connectedPeerIds) {
        if (projectorPeerIds.has(peerId)) continue;
        playerLines.push(`• Player ${peerId.slice(0, 8)}…`);
      }
      const projLines: string[] = [];
      for (const conn of this.projectorConnections.values()) {
        projLines.push(`• ${conn.setupName || '(uncalibrated projector)'}`);
      }
      const sections: string[] = [];
      if (playerLines.length > 0) sections.push('Players:\n' + playerLines.join('\n'));
      if (projLines.length > 0)   sections.push('Projectors:\n' + projLines.join('\n'));
      meta.title = sections.length > 0 ? sections.join('\n\n') : 'No peers connected';
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
        this.host.broadcast({ type: 'filter_update', payload: this._effectiveFilter() });
      }
    }

    if (changed.includes('view')) {
      this.renderer.setBackgroundColour(state.view.backgroundColor);
      this.renderer.setBackdrop(state.view.backdrop ?? null);
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
      this.transitionPanel.render(
        transitionRegistry.getOrFallback(newId),
        this.allTransitionParams[newId] ?? transitionRegistry.defaultParams(newId),
      );

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
    }

    if (changed.includes('markers')) {
      this.markerEditor.update(state.markers, this.mapAspectRatio);
      this.updateMarkerPanel();
      this.interactions.notifyMarkersChanged(this._interactionCtx());
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
    type DropdownKind = 'text' | 'animated' | 'image';
    const kindByAssetId = new Map<string, DropdownKind>();
    for (const a of mapAssets) {
      const isAnimated = (a.blob?.type ?? '').startsWith('video/');
      const kind: DropdownKind = a.source === 'text-map' ? 'text' : isAnimated ? 'animated' : 'image';
      kindByAssetId.set(a.id, kind);
    }
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
      const kind = kindByAssetId.get(m.mapAssetId) ?? 'image';
      const cleanName = _cleanMapDisplayName(m.name);
      const prefix =
        kind === 'text'     ? TEXT_MAP_PREFIX     :
        kind === 'animated' ? ANIMATED_MAP_PREFIX :
                              IMAGE_MAP_PREFIX;
      opt.textContent = `${prefix}${cleanName}`;
      this.mapSelect.appendChild(opt);
    }

    // Trailing "+ Add New Map" sentinel — picking it opens the add-map modal
    // (handled in the change listener).
    appendAddOption(this.mapSelect, '+ Add New Map…');

    if (maps.length > 0) {
      const last = session?.lastMapId ? (maps.find((m) => m.id === session.lastMapId) ?? maps[0]!) : maps[0]!;
      this.mapSelect.value = last.id;
      this._lastMapSelectValue = last.id;
      this.mapEditableSelect?.refresh();
      await this.loadMap(last);
    } else {
      this._lastMapSelectValue = '';
      this.mapEditableSelect?.refresh();
    }
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
    // Detect "same map reload" — e.g. after editing a handout, applying
    // a Fix Missing Map, or re-loading after a retarget. The broadcast
    // map_change shouldn't replay the entry transition in that case.
    const previousMapId = this.state.snapshot().map?.id;
    const isReload = previousMapId === map.id;
    if (isReload) this._suppressNextMapTransition = true;
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
    const hasReveal = isTextMap && mapAssetForButton?.textMap?.animation?.enabled === true;
    if (this.editTextMapBtn) this.editTextMapBtn.hidden = !isTextMap;
    // Show the Start Animation button only when this handout has a
    // reveal animation configured. Hidden in every other case.
    // Reset to 'idle' state (Start Animation label) — every fresh map
    // load starts the lifecycle over.
    if (this.startAnimationBtn) {
      this.startAnimationBtn.hidden = !hasReveal;
      this._setAnimationButtonState('idle');
    }
    if (this.revealProgressEl) this.revealProgressEl.hidden = true;
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
    const broadcastBlob: ArrayBuffer = hasReveal
      ? (await this.maps.getStartingFrameBlob(map.id) ?? snapshotBlob)
      : snapshotBlob;
    const blob = localBlob; // for local renderer.loadMap below — GM canvas animates
    this.currentMapBlob = broadcastBlob;

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

    // Pass fog explicitly so the texture-load callback always redraws the right
    // fog even if another loadMap call races ahead of this one's decode.
    this.renderer.loadMap(blob, fog);

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
      projectorViewport: nextProjVp,
      // For animated handouts, the broadcast carries the STARTING frame
      // (background + noAnimate elements) so the player + projector
      // display the pre-reveal state. The handout_reveal message
      // delivered separately on Start Animation carries the final
      // frame for the transition. broadcastBlob computed above is
      // either the starting frame (handouts with animation enabled)
      // or the final frame (everything else).
      mapBlob:    broadcastBlob,
      transition: this.buildTransitionConfig(),
    });

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
      onRename: (id, name) => void this._renameMap(id, name),
    });
    this.editTextMapBtn             = q<HTMLButtonElement>('#edit-textmap-btn');
    this.editTextMapBtn.addEventListener('click', () => void this._editCurrentTextMap());
    this.startAnimationBtn          = q<HTMLButtonElement>('#start-animation-btn');
    this.startAnimationBtn.addEventListener('click', () => void this._onAnimationButtonClick());
    this.revealProgressEl           = q<HTMLElement>('#reveal-progress');
    this.revealProgressBarEl        = q<HTMLElement>('#reveal-progress-bar');
    this.packNameInput              = q<HTMLInputElement>('#pack-name-input');
    this.transitionSelect           = q<HTMLSelectElement>('#transition-select');
    this.transitionParamsContainer  = q('#transition-params');
    this.filterSelect               = q<HTMLSelectElement>('#filter-select');
    this.filterParamsContainer = q('#filter-params');
    this.viewBgFxBtn           = q<HTMLButtonElement>('#view-bg-fx-btn');
    this.mapFxBtn              = q<HTMLButtonElement>('#mapfx-fx-btn');
    this.roomCodeEl            = q('#room-code');
    this.qrContainer           = q('#qr-container');
    this.playerCountEl         = q('#player-count');
    this.statusEl              = q('#status');
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

    // Projector view sub-toggles (grid overlay, filter passthrough). All travel
    // inside the same projector_viewport_update message that already syncs.
    const gridToggle   = document.getElementById('projection-grid-toggle')   as HTMLInputElement | null;
    const gridColour   = document.getElementById('projection-grid-colour')   as HTMLInputElement | null;
    const filterToggle = document.getElementById('projection-filter-toggle') as HTMLInputElement | null;
    const broadcastVp = (patch: Partial<Pick<ProjectorViewport, 'gridEnabled' | 'gridColor' | 'filterEnabled'>>) => {
      const current = this.state.snapshot().projectorViewport ?? defaultProjectorViewport();
      const next: ProjectorViewport = { ...current, ...patch };
      this.state.setProjectorViewport(next);
      // Keep the projectorEditor's local viewport in sync with state — otherwise
      // a later rect-drag would spread its stale copy (missing this patch) and
      // clobber the toggle back off on the projector. Mirrors rotation / mode.
      this.projectorEditor.setViewport(next);
      this.host.broadcast({ type: 'projector_viewport_update', payload: next });
    };
    gridToggle?.addEventListener  ('change', () => broadcastVp({ gridEnabled:   gridToggle.checked   }));
    gridColour?.addEventListener  ('input',  () => broadcastVp({ gridColor:     gridColour.value     }));
    // "Disable Filters" — checked = filters disabled = filterEnabled false.
    filterToggle?.addEventListener('change', () => broadcastVp({ filterEnabled: !filterToggle.checked }));
    this._refreshProjectionPanelMode();

    // Recalibrate this Map — opens the calibration modal for the active map's asset.
    document.getElementById('projection-recal-map-btn')?.addEventListener('click', async () => {
      const mapState = this.state.snapshot().map;
      if (!mapState) return;
      const asset = await this.maps.getAsset(mapState.id);
      if (!asset) return;
      const cal = new MapCalibrationModal();
      await cal.open(asset);
      // Pick up the new value into the projector editor.
      void this.refreshProjectorMapInfo();
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
      window.open(`/projector.html#${room}`, '_blank', 'noopener,popup,width=1280,height=800');
    });
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
      window.open('/calibrate.html', '_blank', 'noopener,popup,width=1280,height=800');
      sel.value = 'off';
      return;
    }
    // setupId — make active, then open primary.
    const room = this.host.roomCode;
    if (!room) { this.setStatus('Waiting for P2P… try again in a moment.', 'warn'); return; }
    setActiveSetupId(v);
    window.open(`/projector.html#${room}`, '_blank', 'noopener,popup,width=1280,height=800');
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

    appendAddOption(sel, '+ Calibrate New Projector…');

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

  private onPeerMessage(_peerId: string, msg: GMMessage): void {
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
      launchBtn.textContent = hasPrimary ? 'Open Projector Monitor…' : 'Open Projector Screen…';
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
      // Restore marker interaction whenever draw mode ends.
      this.markerEditor?.setPointerCapture(!drawing);
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

  /** Open the MapFX sparkle popover. Content: Edge Fade slider at the
   *  top + the active kind's shader-param rows below. The kind itself
   *  is still picked from the inline dropdown in the panel; this
   *  popover is the focused "tune what's selected" surface. */
  private _openMapFxPopover(): void {
    if (this._mapfxFxPopover) return;
    void import('./FxPopover.ts').then(({ openFxPopover }) => {
      if (this._mapfxFxPopover) return;
      this._mapfxFxPopover = openFxPopover({
        anchor: this.mapFxBtn,
        populate: (root) => { this._populateMapFxPopover(root); },
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

    // ─── Kind picker (compact <select>) ──────────────────────────────
    // 13 kinds is a lot vertically; a single dropdown reads much
    // smaller in the popover. Same green '●' prefix for in-use kinds
    // + bold Unicode for Fog of War (works in <option> text content
    // even though CSS doesn't reliably style options).
    const kindSelect = document.createElement('select');
    kindSelect.className = 'fx-popover-kind-select';
    const inUse = new Set<string>();
    for (const p of fog.polygons) inUse.add(p.kind);
    for (const id of OVERLAY_KIND_ORDER) {
      const entry = OVERLAY_KIND_REGISTRY[id];
      const opt = document.createElement('option');
      opt.value = id;
      let rendered = id === 'fog' ? _toUnicodeBold(entry.label) : entry.label;
      if (inUse.has(id)) {
        rendered = `● ${rendered}`;
        opt.style.color = '#4ade80';
      }
      opt.textContent = rendered;
      if (id === this.activeOverlayKind) opt.selected = true;
      kindSelect.appendChild(opt);
    }
    kindSelect.addEventListener('change', () => {
      const newKind = kindSelect.value as OverlayKind;
      if (this.activeOverlayKind === newKind) return;
      this.activeOverlayKind = newKind;
      // Morph any selected polygon to the new kind.
      const selId = this.fogEditor.getSelectedId();
      if (selId) this.state.setPolygonKind(selId, newKind);
      this._applyActiveKindToBrush();
      this._applyKindToColourSwatch();
      this._updateActiveKindDisplay();
      this.fogEditor.setActiveKind(newKind);
      this.fogEditor.setColor(overlayKind(newKind).defaultColor);
      // Rebuild the popover so the param section reflects the new kind.
      this._mapfxFxPopover?.refresh();
    });
    root.appendChild(kindSelect);

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
  private _buildShaderToggleRow(
    p: import('../mapfx/overlayKindRegistry.ts').ToggleParamDef,
    kindLabel: string,
    initial: number,
    onChange: (v: number) => void,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'fog-brush-row fog-brush-row--toggle';
    const labelEl = document.createElement('span');
    labelEl.textContent = p.label;
    const switchLabel = document.createElement('label');
    switchLabel.className = 'toggle-switch';
    switchLabel.title = `${p.label} — ${kindLabel}`;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = initial > 0.5;
    const knob = document.createElement('span');
    knob.className = 'toggle-slider';
    switchLabel.appendChild(input);
    switchLabel.appendChild(knob);
    input.addEventListener('change', () => {
      onChange(input.checked ? 1 : 0);
    });
    row.appendChild(labelEl);
    row.appendChild(switchLabel);
    return row;
  }

  /** Helper: build one labelled slider row for a shader param. The
   *  onChange handler is fired on every input event with the parsed
   *  numeric value. */
  private _buildShaderSliderRow(
    p: import('../mapfx/overlayKindRegistry.ts').SliderParamDef,
    kindLabel: string,
    initial: number,
    onChange: (v: number) => void,
  ): HTMLElement {
    const row = document.createElement('label');
    row.className = 'fog-brush-row';
    const labelEl = document.createElement('span');
    labelEl.textContent = p.label;
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(p.min);
    slider.max = String(p.max);
    slider.step = String(p.step);
    slider.value = String(initial);
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      if (!Number.isFinite(v)) return;
      onChange(v);
    });
    // Live tooltip (title) so the current value is hover-revealable
    // for shareable setups; no permanent UI footprint for it.
    wireSliderTooltip(slider, `${p.label} — ${kindLabel}`);
    row.appendChild(labelEl);
    row.appendChild(slider);
    return row;
  }

  /** Helper: build one labelled colour-swatch row for a shader param of
   *  `type: 'color'`. Native `<input type="color">` so the OS picker
   *  handles the colour wheel; we just relay the hex string upward. */
  private _buildShaderColorRow(
    p: import('../mapfx/overlayKindRegistry.ts').ColorParamDef,
    kindLabel: string,
    initial: string,
    onChange: (v: string) => void,
  ): HTMLElement {
    const row = document.createElement('label');
    row.className = 'fog-brush-row fog-brush-row--color';
    const labelEl = document.createElement('span');
    labelEl.textContent = p.label;
    const input = document.createElement('input');
    input.type = 'color';
    input.value = initial;
    input.title = `${p.label} — ${kindLabel}`;
    input.addEventListener('input', () => onChange(input.value));
    row.appendChild(labelEl);
    row.appendChild(input);
    return row;
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
      // each erase commits. v2.14.2 sticky: re-arm so the GM can
      // click again without re-clicking Erase.
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
    // v2.14.2 sticky: re-arm the same action so the GM can click
    // again to fill another region. preserveFillState keeps
    // _lastFillState alive across the re-arm so the Tolerance
    // slider can still refine the just-placed polygon until the
    // next fill click replaces it.
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
        this.state.setTransition(this.buildTransitionConfig());
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
      this.state.setTransition(this.buildTransitionConfig());
    });

    // Render initial panel (none — no params)
    this.transitionPanel.render(
      transitionRegistry.getOrFallback('none'),
      this.allTransitionParams['none'] ?? {},
    );
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
  private _effectiveFilter(): FilterState {
    if (this._filterBypassed) return { filterId: 'none', params: {} };
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
    this.viewBgFxBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._bgFxPopover) this._bgFxPopover.close();
      else this._openBgFxPopover();
    });

    // MapFX FX button — opens the same sparkle popover style, but for
    // the active overlay kind's Edge Fade + shader params. The kind
    // dropdown itself stays inline so the GM can switch what's being
    // tuned without diving through a menu.
    this.mapFxBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._mapfxFxPopover) this._mapfxFxPopover.close();
      else this._openMapFxPopover();
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

    // Copy player URL — both the icon button (top-left of QR) and clicking
    // the QR itself trigger the copy.
    const copyPlayerUrl = () => {
      const code = this.roomCodeEl.textContent?.trim() ?? '';
      if (!code) return;
      void navigator.clipboard.writeText(`${this.playerOrigin}/player#${code}`);
      this.setStatus('Player URL copied!', 'ok');
    };
    document.querySelector('#copy-url-btn')?.addEventListener('click', (e) => {
      e.stopPropagation(); // prevent the QR container click from also firing
      copyPlayerUrl();
    });
    this.qrContainer.addEventListener('click', copyPlayerUrl);
    this.qrContainer.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        copyPlayerUrl();
      }
    });

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
      });
    }
    // Player View + Projection View bypass switches. Off broadcasts a
    // full-screen "GM is faffing" placeholder to the downstream view;
    // the underlying map state keeps streaming so flipping back is
    // instant. A fresh funny message is picked on every off-flip.
    this._wireBroadcastBypass('#player-broadcast-toggle', 'player');
    this._wireBroadcastBypass('#projection-broadcast-toggle', 'projector');

    // Paint initial "no connection" greying so the toggles are correctly
    // faded before any first connect/disconnect event fires.
    this._updatePlayerCount();

    // Local players ping us via BroadcastChannel every ~4s; their entries
    // expire after 10s of silence. Refresh the displayed count on the
    // same cadence so a closed player tab drops out of the count
    // promptly even without an explicit disconnect event.
    window.setInterval(() => this._updatePlayerCount(), 5000);
  }

  private _wireBroadcastBypass(selector: string, target: 'player' | 'projector'): void {
    const toggle = document.querySelector<HTMLInputElement>(selector);
    if (!toggle) return;
    toggle.addEventListener('click', (e) => e.stopPropagation());
    toggle.addEventListener('change', () => {
      const show = !toggle.checked;
      const message = show ? randomFaffMessage() : '';
      this.host.broadcast({ type: 'view_placeholder', target, show, message });
      // v2.14.3 — refresh the rect overlay so the eye icon mirrors
      // the new broadcast state (panel-header toggle ↔ rect eye stay
      // in sync in both directions).
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
      const { openFxPopover } = await import('./FxPopover.ts');
      this._bgFxPopover = openFxPopover({
        anchor: this.viewBgFxBtn,
        populate: (root) => { this._populateBgFxPopover(root, BACKDROPS); },
        onClose: () => { this._bgFxPopover = null; },
      });
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

    // ─── Kind dropdown ───────────────────────────────────────────────
    const kindSelect = document.createElement('select');
    kindSelect.className = 'fx-popover-kind-select';
    for (const b of BACKDROPS) {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = b.label;
      if (b.id === currentKind) opt.selected = true;
      kindSelect.appendChild(opt);
    }
    kindSelect.addEventListener('change', () => {
      this._applyBackdrop(kindSelect.value);
      this._bgFxPopover?.refresh();
    });
    root.appendChild(kindSelect);

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
    const gridToggle   = document.getElementById('projection-grid-toggle')   as HTMLInputElement | null;
    const gridColour   = document.getElementById('projection-grid-colour')   as HTMLInputElement | null;
    const filterToggle = document.getElementById('projection-filter-toggle') as HTMLInputElement | null;
    if (gridToggle)   gridToggle.checked   = vp.gridEnabled;
    if (gridColour)   gridColour.value     = vp.gridColor;
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
      if (warnEl) warnEl.hidden = true;
      this._broadcastRoles(false);
      return;
    }
    this.projectorEditor.setMapPixelsPerSquare(asset.pixelsPerSquare ?? null);
    this.projectorEditor.setMapImageWidth(asset.imageWidth ?? 0);
    this.host.updateMapAssetInfo(asset.pixelsPerSquare, asset.imageWidth, asset.imageHeight);
    this._lastMapAssetMeta = (asset.pixelsPerSquare && asset.imageWidth && asset.imageHeight)
      ? { pixelsPerSquare: asset.pixelsPerSquare, imageWidth: asset.imageWidth, imageHeight: asset.imageHeight }
      : null;
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
    this.statusEl.textContent = msg;
    this.statusEl.dataset['level'] = level;
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
        onRectMoveDrag:   (kind, clientX, clientY, phase) => this._handleRectMoveDrag(kind, clientX, clientY, phase),
        onRectResizeDrag: (kind, clientX, clientY, phase) => this._handleRectResizeDrag(kind, clientX, clientY, phase),
        onRectAspectLock:    (kind) => this._handleRectAspect(kind),
        onRectMaximise:      (kind) => this._handleRectMaximise(kind),
        onRectRatioLock:     (kind) => this._handleRectRatioLock(kind),
        onRectViewBroadcast: (kind) => this._handleRectViewBroadcast(kind),
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
      // glyph (image / animated / text) — same treatment as
      // populateMapList applies on reload.
      const asset = await MapAssetStore.get(map.mapAssetId);
      const kind = _dropdownKindForAsset(asset);
      this._insertMapOptionSorted(map.id, map.name, kind);
      this.mapSelect.value = map.id;
      this.mapEditableSelect.refresh();
      this._lastMapSelectValue = map.id;
      void this.loadMap(map);
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
    kind: 'image' | 'animated' | 'text' = 'image',
  ): void {
    const opt = document.createElement('option');
    opt.value = id;
    const cleanName = _cleanMapDisplayName(name);
    const prefix =
      kind === 'text'     ? TEXT_MAP_PREFIX     :
      kind === 'animated' ? ANIMATED_MAP_PREFIX :
                            IMAGE_MAP_PREFIX;
    opt.textContent = `${prefix}${cleanName}`;
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
    let kind: 'image' | 'animated' | 'text' = 'image';
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

    try {
      this.setStatus('Loading pack from URL…', 'ok');
      const res = await fetch(bundleUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching pack`);
      const blob = await res.blob();
      const filenameGuess = bundleUrl.split(/[\\/?#]/).filter(Boolean).pop() ?? 'bundle.mappadux';
      const file = new File([blob], filenameGuess, { type: blob.type });
      // skipConfirm because the URL-load prompt already gathered consent.
      // For a fresh-IDB user no prompt was shown, but they did open a URL
      // with the bundle param themselves, which is itself the consent.
      await this.loadBundleFromFile(file, { skipConfirm: true });
      return true;
    } catch (err) {
      this.setStatus(`URL load failed: ${(err as Error).message}`, 'error');
      return true; // we DID handle the URL — don't fall through to seeding
    }
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
      // Preserve peerId (and lastMapId=null) but drop packName/splash/theme
      // unless the user typed a new pack name.
      const peerId    = existing?.peerId ?? '';
      const packName  = choice.packName.trim();
      await saveSession({
        key:       'current',
        peerId,
        lastMapId: null,
        ...(packName ? { packName } : {}),
      });
      await seedAudioAssets(); // re-seed built-in tracker pings (CC0)
      this.state.resetForImport();
      await this._reloadLibIcons();
      await this.populateMapList();
      void this._refreshPackNameInput();
      applyTheme(undefined); // back to default theme
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
    appendAddOption(this.markerSelect, '+ Add Marker');
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
