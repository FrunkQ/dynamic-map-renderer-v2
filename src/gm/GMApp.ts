import { StateManager } from './StateManager.ts';
import { MapManager } from './MapManager.ts';
import { FogEditor } from './FogEditor.ts';
import { ViewportEditor } from './ViewportEditor.ts';
import { MarkerEditor } from './MarkerEditor.ts';
import { IconPicker } from './IconPicker.ts';
import { MapAssetModal } from './MapAssetModal.ts';
import { MapAssetStore } from '../maps/MapAssetStore.ts';
import { TextMapEditor } from './TextMapEditor.ts';
import { MapCalibrationModal } from './MapCalibrationModal.ts';
import { ProjectorViewportEditor } from './ProjectorViewportEditor.ts';
import { HamburgerMenu } from './HamburgerMenu.ts';
import { SELECT_ADD_SENTINEL, appendAddOption } from './selectAdd.ts';
import { getAllSetups, setActiveSetupId } from '../projector/calibrationStorage.ts';
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
import { blobToDataUrl } from '../utils/blob.ts';
import type { MotionOverlay } from '../rendering/MarkerLayer.ts';
import type { SessionState, StoredMap, TransitionConfig, FilterState, Marker, MarkerIconData, AudioAsset, AudioRole, MotionRole, ProjectorConnection, ProjectorViewport, GMMessage } from '../types.ts';
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
export class GMApp {
  private state   = new StateManager();
  private maps    = new MapManager();
  private host:   Host;
  private renderer!:       Renderer;
  private fogEditor!:      FogEditor;
  private viewportEditor!: ViewportEditor;
  private projectorEditor!: ProjectorViewportEditor;
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

  private iconPicker!:       IconPicker;
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
  private mapNameInput!:            HTMLInputElement;
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
  private markerLockedToggle!:     HTMLInputElement;
  private currentMapBlob:          ArrayBuffer | null = null;
  private fogDrawing            = false;
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

  constructor() {
    this.host = new Host({
      onReady: (code) => this.onHostReady(code),
      onPeerConnected:    (id) => this.onPeerConnected(id),
      onPeerDisconnected: (id) => this.onPeerDisconnected(id),
      onError: (err) => this.setStatus(`P2P error: ${err.message}`, 'error'),
      onPeerMessage: (peerId, msg) => this.onPeerMessage(peerId, msg),
    });
  }

  async init(): Promise<void> {
    this.bindDOMRefs();
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

    await seedAudioAssets();
    await migrateLegacyMaps();
    await seedImageAssetsIfNeeded();
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
    // dialog so a new user sees what they've landed on.
    if (this._didSeedDefault) {
      this._didSeedDefault = false;
      void this.openAboutDialog({});
    }
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
    // Total raw PeerJS connections includes both players and remote projectors.
    // Subtract the projector subset so the count reflects actual players.
    const total            = this.host.connectedCount;
    const projectorPeerIds = new Set(this._projectorPeerByClientId.values());
    const players          = Math.max(0, total - projectorPeerIds.size);
    this.playerCountEl.textContent = String(players);
    const plural = document.querySelector('#player-count-plural');
    if (plural) plural.textContent = players === 1 ? '' : 's';

    // "(+ N projector)" suffix accounts for ALL projector windows, both
    // local-BroadcastChannel (which never appears in host.connectedCount) and
    // remote-PeerJS. Hidden when zero so the line reads cleanly.
    const projCount = this.projectorConnections.size;
    const suffix = document.querySelector<HTMLElement>('#projector-count-suffix');
    if (suffix) {
      suffix.textContent = projCount > 0
        ? ` (+${projCount} projector${projCount !== 1 ? 's' : ''})`
        : '';
    }

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
      if (m.icon.startsWith('asset:') && !seen.has(m.icon)) {
        const dataUrl = this.iconPicker.iconDataUrls.get(m.icon);
        if (dataUrl) result.push({ key: m.icon, dataUrl });
        seen.add(m.icon);
      }
    }
    return result;
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
    // Build assetId → source lookup so we can flag text-map entries in
    // the dropdown. Cheap (small N) and saves a round-trip per option.
    const sourceByAssetId = new Map<string, string>();
    for (const a of mapAssets) sourceByAssetId.set(a.id, a.source);
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
      // Tag text-map (handout) entries with a trailing [T] so they
      // stand out from regular image maps in the dropdown — matches
      // the My Library row's marker. Trailing (not leading) so an
      // alphabetical sort by name still works the way the GM expects;
      // a leading "[T]" would cluster every handout under '['.
      const isTextMap = sourceByAssetId.get(m.mapAssetId) === 'text-map';
      opt.textContent = isTextMap ? `${m.name} [T]` : m.name;
      this.mapSelect.appendChild(opt);
    }

    // Trailing "+ Add New Map" sentinel — picking it opens the add-map modal
    // (handled in the change listener).
    appendAddOption(this.mapSelect, '+ Add New Map…');

    if (maps.length > 0) {
      const last = session?.lastMapId ? (maps.find((m) => m.id === session.lastMapId) ?? maps[0]!) : maps[0]!;
      this.mapSelect.value = last.id;
      this._lastMapSelectValue = last.id;
      await this.loadMap(last);
    } else {
      this._lastMapSelectValue = '';
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
    this.mapNameInput.value = map.name;
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
    const finalBlob = await this.maps.getBlob(map.id);
    if (!finalBlob) { this.setStatus('Map blob not found', 'error'); return; }
    // For animated handouts the player + projector receive the STARTING
    // frame initially (background + noAnimate elements). They wait at
    // that state until the GM clicks Start Animation, at which point
    // we broadcast a handout_reveal carrying the final frame. The GM's
    // own canvas always loads the FINAL frame — Alex's spec: GM
    // doesn't need to see the transition; a progress bar at trigger
    // time indicates animation is in flight.
    const broadcastBlob: ArrayBuffer = hasReveal
      ? (await this.maps.getStartingFrameBlob(map.id) ?? finalBlob)
      : finalBlob;
    const blob = finalBlob; // for local renderer.loadMap below
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
    await this.state.loadForMap({ id: map.id, name: map.name }, broadcastBlob);

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
      // Push the loaded map's calibration + intrinsic width to the projector
      // editor so it can size its rectangle correctly.
      void this.refreshProjectorMapInfo();
    };

    // Pass fog explicitly so the texture-load callback always redraws the right
    // fog even if another loadMap call races ahead of this one's decode.
    this.renderer.loadMap(blob, fog);

    this.setStatus(map.name, 'ok');

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

    // Run each interaction's onMapLoaded hook (preload positional audio buffers, etc.)
    void this.interactions.notifyMapLoaded(this._interactionCtx());
  }

  // ─── DOM binding ──────────────────────────────────────────────────────────

  private bindDOMRefs(): void {
    const q = <T extends HTMLElement>(sel: string): T =>
      document.querySelector<T>(sel)!;

    this.mapSelect                  = q<HTMLSelectElement>('#map-select');
    this.mapNameInput               = q<HTMLInputElement>('#map-name-input');
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
    this.markerLockedToggle    = q<HTMLInputElement>('#marker-locked');
  }

  private bindRenderer(): void {
    const canvas = document.querySelector<HTMLCanvasElement>('#renderer-canvas')!;
    this.renderer = new Renderer(canvas);
    this.renderer.setFilterEnabled(false); // GM sees raw unfiltered scene
    this.renderer.enableGMOverlay();
    this.renderer.setFogOpacity(0.35);     // GM sees through fog; players get full opacity
  }

  private bindProjectorEditor(): void {
    const canvas = document.querySelector<HTMLCanvasElement>('#projector-viewport-canvas')!;
    this.projectorEditor = new ProjectorViewportEditor(canvas);
    this.projectorEditor.onChange((vp) => {
      this.state.setProjectorViewport(vp);
      this.host.broadcast({ type: 'projector_viewport_update', payload: vp });
    });

    // Edit Projection View toggle (mirrors the player viewport edit-mode flow).
    const defaultActions = document.getElementById('projection-default-actions')!;
    const editActions    = document.getElementById('edit-projection-actions')!;
    let preEditViewport: ProjectorViewport | null = null;

    // Click outside the edit canvas / OK-Cancel buttons implicitly commits —
    // matches the user's mental model that touching any other control means
    // "I'm done with the move". Attached on enter, detached on exit.
    const autoCommit = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('#projector-viewport-canvas')) return; // dragging the rect
      if (t.closest('#edit-projection-actions'))   return; // OK / Cancel
      exitEdit(true);
    };

    const enterEdit = () => {
      preEditViewport = this.state.snapshot().projectorViewport ?? null;
      defaultActions.hidden = true;
      editActions.hidden    = false;
      this.projectorEditor.setEditMode(true);
      // Defer one tick so the click that triggered enterEdit doesn't itself
      // bubble up and immediately satisfy the auto-commit predicate.
      setTimeout(() => document.addEventListener('click', autoCommit, true), 0);
    };
    const exitEdit = (commit: boolean) => {
      document.removeEventListener('click', autoCommit, true);
      if (!commit && preEditViewport) {
        this.state.setProjectorViewport(preEditViewport);
        this.projectorEditor.setViewport(preEditViewport);
        this.host.broadcast({ type: 'projector_viewport_update', payload: preEditViewport });
      }
      preEditViewport = null;
      defaultActions.hidden = false;
      editActions.hidden    = true;
      this.projectorEditor.setEditMode(false);
    };
    document.getElementById('edit-projection-btn')?.addEventListener('click',   enterEdit);
    document.getElementById('projection-ok-btn')?.addEventListener('click',     () => exitEdit(true));
    document.getElementById('projection-cancel-btn')?.addEventListener('click', () => exitEdit(false));

    // Mode toggles — Reset to Full Map and Black Out are mutually exclusive
    // states relative to 'scaled' (the default). Clicking an active button
    // returns the projector to scaled; clicking the inactive other button
    // switches to that mode.
    const setMode = (mode: 'scaled' | 'full' | 'black') => {
      const current = this.state.snapshot().projectorViewport ?? defaultProjectorViewport();
      const next: ProjectorViewport = { ...current, mode };
      this.state.setProjectorViewport(next);
      this.projectorEditor.setViewport(next);
      this.host.broadcast({ type: 'projector_viewport_update', payload: next });
      this.refreshProjectionModeButtons();
    };
    document.getElementById('projection-fullmap-btn')?.addEventListener('click', () => {
      const cur = this.state.snapshot().projectorViewport?.mode ?? 'scaled';
      setMode(cur === 'full' ? 'scaled' : 'full');
    });
    document.getElementById('projection-blackout-btn')?.addEventListener('click', () => {
      const cur = this.state.snapshot().projectorViewport?.mode ?? 'scaled';
      setMode(cur === 'black' ? 'scaled' : 'black');
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
      opt.textContent = `${s.name} · ${s.pixelsPerSquare.toFixed(1)} px/sq`;
      sel.appendChild(opt);
    }

    appendAddOption(sel, '+ Calibrate New Projector…');

    // Selected option reflects the LIVE state only — when nothing's running,
    // default to "No Projection" so picking the previously-active setup
    // actually fires a change event and re-launches it.
    sel.value = liveSetupId ?? 'off';
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
    const fullBtn  = document.getElementById('projection-fullmap-btn');
    const blackBtn = document.getElementById('projection-blackout-btn');
    if (fullBtn) {
      const active = mode === 'full';
      fullBtn.classList.toggle('btn--warn', active);
      fullBtn.textContent = active ? 'Scaled View' : 'Full Map';
    }
    if (blackBtn) {
      const active = mode === 'black';
      blackBtn.classList.toggle('btn--danger', active);
      blackBtn.textContent = active ? 'Restore' : 'Black Out';
    }
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
    const canvas = document.querySelector<HTMLCanvasElement>('#viewport-canvas')!;
    this.viewportEditor = new ViewportEditor(canvas);

    // Live drag → push view to state (and on to players via P2P)
    this.viewportEditor.onChange((view) => {
      this.state.setView(view);
    });

    // Click outside the viewport canvas / OK-Cancel buttons implicitly
    // commits the player viewport edit — same UX as the projection editor.
    const autoCommitView = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('#viewport-canvas'))       return; // dragging the rect
      if (t.closest('#edit-viewport-actions')) return; // OK / Cancel
      this.viewportEditor.commitEdit();
    };

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
      // Wire / unwire the auto-commit listener as edit-mode flips. Defer
      // attaching by a tick so the click that started the edit doesn't
      // itself trigger an immediate commit.
      if (editing) {
        setTimeout(() => document.addEventListener('click', autoCommitView, true), 0);
      } else {
        document.removeEventListener('click', autoCommitView, true);
      }
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
        const opt = document.createElement('option');
        opt.value = newMap.id;
        opt.textContent = newMap.name;
        this.mapSelect.appendChild(opt);
        this.mapSelect.value = newMap.id;
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

    // Map rename — live-edit the active map's display name
    this.mapNameInput.addEventListener('input', async () => {
      const id = this.mapSelect.value;
      if (!id) return;
      const name = this.mapNameInput.value;
      await this.maps.rename(id, name);
      // Update the dropdown option in place so the user sees the new label immediately
      const opt = this.mapSelect.querySelector<HTMLOptionElement>(`option[value="${id}"]`);
      if (opt) opt.textContent = name || '(unnamed)';
    });


    // Bundle import — file picker change handler. Picker is triggered from the
    // hamburger ("Load Mappadux Pack") which calls `.click()` on the input.
    document.querySelector<HTMLInputElement>('#bundle-import')?.addEventListener('change', async (e) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = ''; // reset so the same file can be re-selected
      if (!file) return;
      await this.loadBundleFromFile(file);
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
    if (state.projectorViewport) this.projectorEditor.setViewport(state.projectorViewport);
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
      const markers = this.state.getState().markers.filter((m) => m.id !== this.selectedMarkerId);
      this.selectedMarkerId = null;
      this.markerEditor.selectById(null);
      this.state.setMarkers(markers);
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
    this.hamburger.addItem({
      label: 'Map Asset Library…',
      icon: 'map',
      onSelect: () => { this.mapAssetModal.open(() => { /* browse-only */ }); },
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
   *  pick the new map is inserted into #map-select before the trailing
   *  separator / "+ Add New Map" so the action stays at the bottom. */
  private openAddMapDialog(): void {
    this.mapAssetModal.open((map) => {
      const opt = document.createElement('option');
      opt.value = map.id;
      opt.textContent = map.name;
      const addSentinel = this.mapSelect.querySelector<HTMLOptionElement>(
        `option[value="${SELECT_ADD_SENTINEL}"]`,
      );
      // The disabled separator sits immediately before the add sentinel — anchor
      // the insert against the separator so the new option lands above both.
      const insertBefore = addSentinel?.previousElementSibling ?? addSentinel ?? null;
      this.mapSelect.insertBefore(opt, insertBefore);
      this.mapSelect.value = map.id;
      this._lastMapSelectValue = map.id;
      void this.loadMap(map);
    });
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
      await this.iconPicker.reload();
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
      await this.iconPicker.reload();
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

    if (sel) {
      this.markerLabelInput.value     = sel.label;
      this.markerColorInput.value     = sel.color;
      this.markerSizeInput.value      = String(sel.size);
      this.markerSizeVal.textContent  = `${sel.size.toFixed(1)}×`;
      this.markerHiddenToggle.checked    = sel.hidden;
      this.markerShowLabelToggle.checked = sel.showLabel ?? false;
      this.markerLockedToggle.checked    = sel.locked ?? false;

      // Update icon button display — rendered at 96×96 px for the
      // new double-height preview button (.marker-icon-btn--lg). The
      // button itself is 64×64 visually; rendering at 1.5× the visual
      // size keeps the icon crisp on high-DPI displays.
      this.markerIconBtn.innerHTML = '';
      const isAsset = sel.icon.startsWith('asset:') || sel.icon.startsWith('data:');
      if (isAsset) {
        const bmp = this.iconPicker.iconCache.get(sel.icon);
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
      // Tintability: unicode glyphs respect marker.color (rendered as
      // tinted text); raster assets from the legacy 'icon' store render
      // verbatim — colour has no visible effect. Hide the Colour row
      // for those so the GM isn't presented with a swatch that does
      // nothing.
      const tintable = !isAsset;
      const colorRow = document.getElementById('marker-color-row');
      if (colorRow) colorRow.hidden = !tintable;

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
