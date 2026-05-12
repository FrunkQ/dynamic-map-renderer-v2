import { Guest } from '../p2p/Guest.ts';
import { bindFullscreenButton } from '../utils/fullscreen.ts';
import { Renderer } from '../rendering/Renderer.ts';
import { MarkerTexture } from '../rendering/MarkerTexture.ts';
import { filterRegistry } from '../filters/FilterRegistry.ts';
import { TransitionEngine } from '../transitions/TransitionEngine.ts';
import { transitionRegistry } from '../transitions/TransitionRegistry.ts';
import type { GMMessage, TransitionConfig, Marker, MarkerIconData, SoundboardAudioData, SoundboardSlot, FogState, FilterState, ViewState } from '../types.ts';
import type { MotionOverlay, MotionOverlayScan, MotionOverlayBlob } from '../rendering/MarkerLayer.ts';

/**
 * PlayerApp — top-level orchestrator for the player view.
 *
 * Reads the room code from the URL fragment (#roomcode).
 * If the fragment is absent or empty, waits for a room code input.
 * Connects via P2P Guest (BroadcastChannel for local window, PeerJS for network).
 * Applies all incoming state updates to the Renderer.
 *
 * Markers are rendered as a CanvasTexture inside the Three.js scene (Plane 2)
 * so they pass through the active GLSL filter pipeline.
 */
export class PlayerApp {
  private renderer!: Renderer;
  private markerTexture!: MarkerTexture;
  private transitionEngine!: TransitionEngine;
  private guest!: Guest;
  private statusEl!: HTMLElement;
  private connectPanel!: HTMLElement;
  private roomInput!: HTMLInputElement;
  /** Tracks which map ID the player is currently showing (or loading). */
  private currentMapId: string | null = null;
  private currentMarkers: Marker[]    = [];
  private playerIconCache = new Map<string, ImageBitmap>();
  /** slotId → <audio> element for active soundboard slots */
  private sbAudioEls  = new Map<string, HTMLAudioElement>();
  /** assetId → data URL so re-plays don't need the URL resent */
  private sbAssetUrls = new Map<string, string>();
  /** Current slot configurations (for restoring on reconnect) */
  private sbSlots: SoundboardSlot[] = [];
  /** Master mute flag — starts true so first click both satisfies autoplay policy and unmutes */
  private sbMuted = true;
  /** slotIds paused by a mute transition — used to resume them on unmute. */
  private _sbPausedByMute = new Set<string>();
  /** markerIds paused by a positional mute-all — resumed on unmute. */
  private _posPausedByMute = new Set<string>();
  /** Live state of the Markers-panel master mute (broadcast by the GM).
   *  Silences both positional sources and the tracker ping. */
  private _posMutedAll = false;
  private _audioResumeScheduled = false;
  /** markerId → <audio> element for active positional sources */
  private _posAudioEls  = new Map<string, HTMLAudioElement>();
  /** assetId → URL so re-plays (late join / random fires) don't need the data resent */
  private _posAssetUrls = new Map<string, string>();
  private _muteIndicatorEl: HTMLElement | null = null;
  // ── Motion-tracker overlay (rings + return blobs broadcast by the GM) ──────
  private _trackerScans: MotionOverlayScan[] = [];
  private _trackerBlobs: MotionOverlayBlob[] = [];
  private _trackerRafId: number | null       = null;
  /** Cached tracker ping audio data URLs, keyed by assetId. Populated by the
   *  first tracker_scan/tracker_blob carrying that asset's dataUrl. */
  private _trackerAudioUrls = new Map<string, string>();
  // ── WebGL context-loss recovery ──────────────────────────────────────────
  /** Room code retained so we can reconnect if cached state is unavailable. */
  private roomCode = '';
  /** Cached renderer inputs — replayed on WebGL context restore. */
  private lastMapBlob:  ArrayBuffer | null = null;
  private lastFog:      FogState           = { polygons: [] };
  private lastFilter:   FilterState | null = null;
  private lastView:     ViewState  | null  = null;
  private _contextLost = false;
  /**
   * Sequence numbers of messages already processed.
   * Local player windows receive every broadcast TWICE — once via BroadcastChannel
   * (fast, sub-ms) and once via PeerJS (slower, ~50-200ms).  Without dedup, the
   * second delivery re-runs loadMap with a new loadGen, which then discards the
   * first (BC) texture decode and waits for a second, slower decode.  More
   * critically, re-processing map_change resets currentMapId mid-flight, which
   * can make valid fog_update messages appear to belong to a different map and
   * get discarded.  Tracking seqs lets us drop the PeerJS duplicate entirely.
   */
  private seenSeqs = new Set<number>();

  async init(): Promise<void> {
    const fsBtn = document.getElementById('player-fullscreen-btn');
    if (fsBtn) bindFullscreenButton(fsBtn);

    this.renderer = new Renderer(
      document.querySelector<HTMLCanvasElement>('#renderer-canvas')!,
      { preserveDrawingBuffer: true },
    );
    this.markerTexture = new MarkerTexture();
    this.renderer.setMarkerCanvas(this.markerTexture.canvas);

    this.transitionEngine = new TransitionEngine(
      document.querySelector<HTMLCanvasElement>('#transition-canvas')!,
    );
    this.renderer.onMapLoaded = (aspect) => {
      this.markerTexture.setAspectRatio(aspect);
      this.markerTexture.render(this.currentMarkers, this.playerIconCache);
      this.renderer.markMarkersDirty();
    };
    this.renderer.start();

    this.renderer.onContextLost = () => {
      this._contextLost = true;
      this.setStatus('Renderer lost — recovering…');
    };
    this.renderer.onContextRestored = () => {
      this._contextLost = false;
      this._recoverRenderer();
    };

    // visibilitychange fires when the user returns to the tab/app on mobile.
    // If the context was lost while the page was hidden and the browser didn't
    // fire webglcontextrestored yet, this is a fallback trigger.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this._contextLost) {
        this._recoverRenderer();
      }
    });

    this.statusEl     = document.querySelector('#status')!;
    this.connectPanel = document.querySelector('#connect-panel')!;
    this.roomInput    = document.querySelector<HTMLInputElement>('#room-input')!;

    const roomCode = location.hash.slice(1).trim();

    if (roomCode) {
      this.connect(roomCode);
    } else {
      this.showConnectPanel();
    }

    document.querySelector('#connect-btn')?.addEventListener('click', () => {
      const code = this.roomInput.value.trim();
      if (code) {
        this.connectPanel.hidden = true;
        this.connect(code);
      }
    });

    // Left-click toggles mute (first click also satisfies browser autoplay policy).
    // Guard: don't toggle while the connect panel is visible.
    document.addEventListener('click', () => {
      if (!this.connectPanel.hidden) return;
      this._toggleMute();
    });

    // Prevent the browser context menu on right-click (keep canvas clean)
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    // Show "Muted" indicator immediately — player starts muted
    this._showMuteIndicator();
  }

  private _recoverRenderer(): void {
    if (this.lastMapBlob) {
      // Re-feed the cached state — recreates all GPU resources from scratch.
      void this.renderer.loadMap(this.lastMapBlob, this.lastFog).then(() => {
        if (this.lastFilter) this.renderer.setFilter(this.lastFilter);
        if (this.lastView) {
          this.renderer.setView(this.lastView);
          this.markerTexture.setViewHeight(this.lastView.viewNH);
        }
        this.markerTexture.render(this.currentMarkers, this.playerIconCache);
        this.renderer.markMarkersDirty();
        this.setStatus('');
      });
    } else if (this.roomCode) {
      // No cached blob yet (first load) — reconnect to get a fresh full_state.
      this.connect(this.roomCode);
    }
  }

  // ─── P2P ──────────────────────────────────────────────────────────────────

  private connect(roomCode: string): void {
    this.roomCode = roomCode;
    this.setStatus('Connecting…');

    // Destroy any existing guest (e.g. WebGL context-recovery reconnect) before
    // creating a new one, so there are never two active P2P connections at once.
    this.guest?.destroy();

    this.guest = new Guest({
      onConnected:    () => this.setStatus(''),
      onDisconnected: () => this.setStatus('Disconnected — waiting for GM…'),
      onReconnecting: (attempt, delayMs) => {
        const secs = Math.round(delayMs / 1000);
        this.setStatus(`Reconnecting… (${secs}s, attempt ${attempt})`);
      },
      onError: (err)  => this.setStatus(`Error: ${err.message}`),
      onMessage: (msg, blob) => this.handleMessage(msg, blob),
    });

    this.guest.connect(roomCode);
  }

  // ─── Message handling ─────────────────────────────────────────────────────

  private handleMessage(msg: GMMessage, mapBlob?: ArrayBuffer): void {
    // ── Sequence-number deduplication ────────────────────────────────────────
    // Local player windows receive every broadcast twice: once via the fast
    // BroadcastChannel (sub-ms) and once via PeerJS (~50-200ms later).
    // The first delivery (BC) is canonical.  When the PeerJS copy arrives we
    // recognise the seq and drop it before any state is touched.
    const seq = (msg as unknown as Record<string, unknown>)['_seq'];
    if (typeof seq === 'number') {
      if (this.seenSeqs.has(seq)) return; // duplicate — already handled via BC
      this.seenSeqs.add(seq);
      // Trim the set so it doesn't grow without bound over a long session.
      if (this.seenSeqs.size > 200) {
        const sorted = [...this.seenSeqs].sort((a, b) => a - b);
        this.seenSeqs = new Set(sorted.slice(-100));
      }
    }

    switch (msg.type) {
      case 'full_state': {
        this.currentMapId   = msg.payload.map?.id ?? null;
        this.currentMarkers = msg.payload.markers ?? [];
        this.sbSlots        = msg.payload.audio?.slots ?? [];
        if (mapBlob) {
          this.lastMapBlob = mapBlob;
          this.lastFog     = msg.payload.fog ?? { polygons: [] };
          this.renderer.loadMap(mapBlob, msg.payload.fog);
        } else {
          this.renderer.updateFog(msg.payload.fog);
          this.lastFog = msg.payload.fog ?? { polygons: [] };
        }
        if (msg.payload.filter) this.lastFilter = msg.payload.filter;
        if (msg.payload.view)   this.lastView   = msg.payload.view;
        this.renderer.setFilter(msg.payload.filter);
        this.renderer.setView(msg.payload.view);
        this.markerTexture.setViewHeight(msg.payload.view.viewNH);
        void (async () => {
          if (msg.iconData?.length)         await this._decodeIconData(msg.iconData);
          if (msg.soundboardAssets?.length) this._cacheSoundboardAssets(msg.soundboardAssets);
          if (msg.soundboardActive?.length) this._applySoundboardActive(msg.soundboardActive);
          this.markerTexture.render(this.currentMarkers, this.playerIconCache);
          this.renderer.markMarkersDirty();
        })();
        this.setStatus('');
        break;
      }

      case 'map_change': {
        this.currentMapId = msg.payload.id;
        if (msg.markers !== undefined) this.currentMarkers = msg.markers;
        if (msg.audio?.slots)          this.sbSlots = msg.audio.slots;
        // Stop any playing audio from the previous map
        this._stopAllSoundboard();
        this._stopAllPositional();
        // Drop any in-flight tracker visuals from the previous map
        this._trackerScans = [];
        this._trackerBlobs = [];
        if (mapBlob) {
          const fog    = msg.fog    ?? { polygons: [] };
          const filter = msg.filter;
          const view   = msg.view;
          const blob   = mapBlob;
          this.lastMapBlob = blob;
          this.lastFog     = fog;
          if (filter) this.lastFilter = filter;
          if (view)   this.lastView   = view;
          void (async () => {
            if (msg.iconData?.length)       await this._decodeIconData(msg.iconData);
            if (msg.soundboardActive?.length) this._applySoundboardActive(msg.soundboardActive);
            await this.runTransition(msg.transition, async () => {
              await this.renderer.loadMap(blob, fog);
              if (filter) this.renderer.setFilter(filter);
              if (view) {
                this.renderer.setView(view);
                this.markerTexture.setViewHeight(view.viewNH);
              }
            });
          })();
        }
        break;
      }

      case 'handout_reveal': {
        // Reveal animation for a handout. Routes through the
        // renderer's IN-SCENE reveal overlay so the EffectComposer
        // post-effect filter runs over BOTH halves of the reveal
        // (snapshot of unsullied starting frame + underlying final
        // frame). Map→map transitions stay on the existing DOM-overlay
        // path — different filter semantics by design.
        if (!mapBlob) break;
        if (msg.mapId !== this.currentMapId) break; // stale message
        const finalBlob = mapBlob;
        const startBlob = this.lastMapBlob; // cached starting frame
        const fog    = this.lastFog;
        const filter = this.lastFilter;
        const view   = this.lastView;
        this.lastMapBlob = finalBlob;
        void (async () => {
          let preSnap: ImageBitmap | undefined;
          if (startBlob) {
            try {
              preSnap = await createImageBitmap(new Blob([startBlob], { type: 'image/png' }));
            } catch { preSnap = undefined; }
          }
          // Open an in-scene reveal overlay sized to the WebGL
          // canvas's CSS pixels. The TransitionEngine paints onto
          // this offscreen canvas; the renderer pulls those pixels
          // into a CanvasTexture on a plane inside the EffectComposer
          // pipeline. Filter applies. The overlay is torn down when
          // the transition finishes.
          const rendererCanvas = document.querySelector<HTMLCanvasElement>('#renderer-canvas')!;
          const revealCanvas = this.renderer.beginRevealOverlay(
            rendererCanvas.clientWidth  || window.innerWidth,
            rendererCanvas.clientHeight || window.innerHeight,
          );
          try {
            await this.runTransition(msg.transition, async () => {
              await this.renderer.loadMap(finalBlob, fog);
              if (filter) this.renderer.setFilter(filter);
              if (view) {
                this.renderer.setView(view);
                this.markerTexture.setViewHeight(view.viewNH);
              }
            }, preSnap, revealCanvas);
          } finally {
            this.renderer.endRevealOverlay();
          }
        })();
        break;
      }

      case 'filter_update': {
        this.lastFilter = msg.payload;
        this.renderer.setFilter(msg.payload);
        break;
      }

      case 'fog_update': {
        // Safety net: discard fog updates for a different map.
        // With seq deduplication the BC+PeerJS race is already prevented, but
        // this guard catches any edge case where mapId doesn't match.
        if (msg.mapId && msg.mapId !== this.currentMapId) break;
        this.lastFog = msg.payload;
        this.renderer.updateFog(msg.payload);
        break;
      }

      case 'view_update': {
        this.lastView = msg.payload;
        this.renderer.setView(msg.payload);
        this.markerTexture.setViewHeight(msg.payload.viewNH);
        // Re-render markers so the new size kicks in immediately even if the
        // marker list itself hasn't changed.
        this.markerTexture.render(this.currentMarkers, this.playerIconCache);
        this.renderer.markMarkersDirty();
        break;
      }

      case 'marker_update': {
        this.currentMarkers = msg.payload;
        void (async () => {
          if (msg.iconData?.length) await this._decodeIconData(msg.iconData);
          this.markerTexture.render(this.currentMarkers, this.playerIconCache);
          this.renderer.markMarkersDirty();
        })();
        break;
      }

      case 'positional_play': {
        // Reuse the same binary-or-dataUrl pattern as soundboard_play
        if (mapBlob) {
          const url = URL.createObjectURL(new Blob([mapBlob], { type: 'audio/mpeg' }));
          this._posAssetUrls.set(msg.assetId, url);
          this._posPlay(msg.markerId, url, msg.loop, msg.volume);
        } else {
          if (msg.dataUrl) this._posAssetUrls.set(msg.assetId, msg.dataUrl);
          const url = this._posAssetUrls.get(msg.assetId);
          if (url) this._posPlay(msg.markerId, url, msg.loop, msg.volume);
        }
        break;
      }

      case 'positional_volume': {
        const el = this._posAudioEls.get(msg.markerId);
        if (el) el.volume = Math.max(0, Math.min(1, msg.volume));
        break;
      }

      case 'positional_stop': {
        const el = this._posAudioEls.get(msg.markerId);
        if (el) { el.pause(); el.currentTime = 0; }
        this._posAudioEls.delete(msg.markerId);
        break;
      }

      case 'positional_mute_all': {
        // Pause / resume every positional source so loops survive the
        // round-trip cleanly. Soundboard slots are unaffected — they
        // ride the separate soundboard_mute_all channel. The flag also
        // gates the tracker ping so an active scan keeps animating
        // silently when marker audio is muted.
        this._posMutedAll = msg.muted;
        if (msg.muted) {
          this._posPausedByMute.clear();
          for (const [id, el] of this._posAudioEls.entries()) {
            if (!el.paused) {
              this._posPausedByMute.add(id);
              el.pause();
            }
          }
        } else {
          for (const id of this._posPausedByMute) {
            const el = this._posAudioEls.get(id);
            if (el) void el.play().catch(() => { /* autoplay blocked */ });
          }
          this._posPausedByMute.clear();
        }
        break;
      }

      case 'audio_update': {
        // Slot configuration updated (assign/unassign, loop, volume)
        this.sbSlots = msg.payload.slots ?? [];
        // Stop any slots that are no longer assigned
        for (const [slotId, el] of this.sbAudioEls.entries()) {
          const slot = this.sbSlots.find((s) => s.id === slotId);
          if (!slot?.assetId) { el.pause(); this.sbAudioEls.delete(slotId); }
        }
        break;
      }

      case 'soundboard_play': {
        if (mapBlob) {
          // Audio delivered as binary chunks — create an object URL for it.
          const objUrl = URL.createObjectURL(new Blob([mapBlob], { type: 'audio/mpeg' }));
          this.sbAssetUrls.set(msg.assetId, objUrl);
          this._sbPlay(msg.slotId, objUrl, msg.loop, msg.volume);
        } else {
          // Inline dataUrl (local BroadcastChannel) or cached replay.
          if (msg.dataUrl) this.sbAssetUrls.set(msg.assetId, msg.dataUrl);
          const url = this.sbAssetUrls.get(msg.assetId);
          if (url) this._sbPlay(msg.slotId, url, msg.loop, msg.volume);
        }
        break;
      }

      case 'soundboard_stop': {
        const el = this.sbAudioEls.get(msg.slotId);
        if (el) { el.pause(); el.currentTime = 0; }
        break;
      }

      case 'soundboard_asset': {
        if (mapBlob) {
          const objUrl = URL.createObjectURL(new Blob([mapBlob], { type: 'audio/mpeg' }));
          this.sbAssetUrls.set(msg.assetId, objUrl);
        } else if (msg.dataUrl) {
          this.sbAssetUrls.set(msg.assetId, msg.dataUrl);
        }
        break;
      }

      case 'soundboard_volume': {
        const el = this.sbAudioEls.get(msg.slotId);
        if (el) el.volume = Math.max(0, Math.min(1, msg.volume));
        break;
      }

      case 'soundboard_mute_all': {
        this._applyMute(msg.muted);
        break;
      }

      case 'tracker_scan': {
        this._trackerScans.push({
          startTime: performance.now(),
          centre:    msg.centre,
          range:     msg.range,
          speedSecs: msg.speedSecs,
          colour:    msg.colour,
        });
        this._playTrackerPing(msg.audioAssetId, msg.audioDataUrl, msg.audioVolume);
        this._kickTrackerRaf();
        break;
      }

      case 'tracker_blob': {
        // fadeMs=0 is the GM's "audio-only return" sentinel — skip the visual blob.
        if (msg.fadeMs > 0) {
          this._trackerBlobs.push({
            startTime: performance.now(),
            sourceId:  msg.sourceId,
            position:  msg.position,
            fadeMs:    msg.fadeMs,
            mode:      msg.mode,
            colour:    msg.colour,
          });
          this._kickTrackerRaf();
        }
        this._playTrackerPing(msg.audioAssetId, msg.audioDataUrl, msg.audioVolume);
        break;
      }
    }
  }

  /** Cache the tracker ping audio if a fresh dataUrl arrived, and fire a one-shot. */
  private _playTrackerPing(assetId: string | undefined, dataUrl: string | undefined, volume: number | undefined): void {
    if (!assetId) return;
    if (dataUrl) this._trackerAudioUrls.set(assetId, dataUrl);
    const url = this._trackerAudioUrls.get(assetId);
    if (!url) return;
    if (this.sbMuted || this._posMutedAll) return; // respect player mute + GM marker-mute
    const a = new Audio(url);
    a.volume = Math.max(0, Math.min(1, volume ?? 0.8));
    void a.play().catch(() => { /* autoplay-policy ignore */ });
  }

  // ─── Motion-tracker overlay ───────────────────────────────────────────────

  /** Drive the tracker overlay redraw loop. Idempotent; self-terminates when
   *  there are no rings expanding and no blobs still fading. */
  private _kickTrackerRaf(): void {
    if (this._trackerRafId !== null) return;
    const tick = (now: number) => {
      // Prune expired
      this._trackerScans = this._trackerScans.filter((s) => now - s.startTime < s.speedSecs * 1000);
      this._trackerBlobs = this._trackerBlobs.filter((b) => now - b.startTime < b.fadeMs);

      const overlay: MotionOverlay = {
        now,
        scans: this._trackerScans,
        blobs: this._trackerBlobs,
      };
      this.markerTexture.render(this.currentMarkers, this.playerIconCache, overlay);
      this.renderer.markMarkersDirty();

      if (this._trackerScans.length > 0 || this._trackerBlobs.length > 0) {
        this._trackerRafId = requestAnimationFrame(tick);
      } else {
        this._trackerRafId = null;
        // Final draw with no overlay so the texture is clean
        this.markerTexture.render(this.currentMarkers, this.playerIconCache);
        this.renderer.markMarkersDirty();
      }
    };
    this._trackerRafId = requestAnimationFrame(tick);
  }

  // ─── Soundboard ───────────────────────────────────────────────────────────

  private _sbPlay(slotId: string, dataUrl: string, loop: boolean, volume: number): void {
    let el = this.sbAudioEls.get(slotId);
    if (!el) {
      el = new Audio();
      this.sbAudioEls.set(slotId, el);
    }
    if (el.src !== dataUrl) {
      el.pause();
      el.src = dataUrl;
    }
    el.currentTime = 0;
    el.loop   = loop;
    el.volume = Math.max(0, Math.min(1, volume));
    el.muted  = this.sbMuted;
    void el.play().catch(() => {
      this._scheduleAudioResume();
    });
  }

  private _stopAllSoundboard(): void {
    for (const el of this.sbAudioEls.values()) { el.pause(); el.currentTime = 0; }
  }

  private _cacheSoundboardAssets(assets: { assetId: string; dataUrl?: string }[]): void {
    for (const { assetId, dataUrl } of assets) {
      if (dataUrl && !this.sbAssetUrls.has(assetId)) {
        this.sbAssetUrls.set(assetId, dataUrl);
      }
      // Assets without a dataUrl here arrive via binary soundboard_asset messages below.
    }
  }

  private _applySoundboardActive(active: SoundboardAudioData[]): void {
    for (const item of active) {
      // dataUrl may be absent (stripped for chunked binary delivery).
      // Play from cache if available; individual soundboard_play messages follow.
      if (item.dataUrl) this.sbAssetUrls.set(item.assetId, item.dataUrl);
      const url = this.sbAssetUrls.get(item.assetId);
      if (url) this._sbPlay(item.slotId, url, item.loop, item.volume);
    }
  }

  private _scheduleAudioResume(): void {
    if (this._audioResumeScheduled) return;
    this._audioResumeScheduled = true;
    const resume = () => {
      this._audioResumeScheduled = false;
      for (const el of this.sbAudioEls.values()) {
        if (el.paused && el.src) void el.play().catch(() => {});
      }
      for (const el of this._posAudioEls.values()) {
        if (el.paused && el.src) void el.play().catch(() => {});
      }
    };
    document.addEventListener('click',   resume, { once: true });
    document.addEventListener('keydown', resume, { once: true });
  }

  private _toggleMute(): void {
    this._applyMute(!this.sbMuted);
    this._showMuteIndicator();
  }

  /**
   * Apply a mute/unmute transition by pausing/resuming the currently
   * playing audio elements rather than just setting `el.muted`. Looping
   * background tracks survive mute → unmute cycles because pause
   * preserves the playback position; setting `el.muted = false` after
   * the element has been silent is unreliable in some browsers, so we
   * pause on mute and explicitly resume on unmute.
   */
  private _applyMute(muted: boolean): void {
    const wasMuted = this.sbMuted;
    this.sbMuted = muted;
    if (muted && !wasMuted) {
      this._sbPausedByMute.clear();
      for (const [slotId, el] of this.sbAudioEls.entries()) {
        if (!el.paused) {
          this._sbPausedByMute.add(slotId);
          el.pause();
        }
      }
      for (const el of this._posAudioEls.values()) el.muted = true;
    } else if (!muted && wasMuted) {
      for (const el of this.sbAudioEls.values())   el.muted = false;
      for (const el of this._posAudioEls.values()) el.muted = false;
      for (const slotId of this._sbPausedByMute) {
        const el = this.sbAudioEls.get(slotId);
        if (el) void el.play().catch(() => { /* autoplay blocked */ });
      }
      this._sbPausedByMute.clear();
    }
  }

  private _showMuteIndicator(): void {
    if (!this._muteIndicatorEl) {
      const el = document.createElement('div');
      el.className = 'mute-indicator';
      document.body.appendChild(el);
      this._muteIndicatorEl = el;
    }
    const el = this._muteIndicatorEl;
    el.textContent = this.sbMuted ? '🔇 Muted' : '🔊 Audio on';
    el.classList.remove('mute-indicator--hiding');
    if (!this.sbMuted) {
      setTimeout(() => { this._muteIndicatorEl?.classList.add('mute-indicator--hiding'); }, 1500);
    }
  }

  // ─── Positional audio ─────────────────────────────────────────────────────

  private _posPlay(markerId: string, url: string, loop: boolean, volume: number): void {
    let el = this._posAudioEls.get(markerId);
    if (!el) {
      el = new Audio();
      this._posAudioEls.set(markerId, el);
    }
    if (el.src !== url) { el.pause(); el.src = url; }
    el.currentTime = 0;
    el.loop   = loop;
    el.volume = Math.max(0, Math.min(1, volume));
    el.muted  = this.sbMuted;
    el.play().then(
      () => { /* ok */ },
      () => { this._scheduleAudioResume(); },
    );
  }

  private _stopAllPositional(): void {
    for (const el of this._posAudioEls.values()) { el.pause(); el.currentTime = 0; }
    this._posAudioEls.clear();
    this._posAssetUrls.clear();
  }

  // ─── Icon cache ───────────────────────────────────────────────────────────

  private async _decodeIconData(iconData: MarkerIconData[]): Promise<void> {
    await Promise.all(
      iconData
        .filter(({ key }) => !this.playerIconCache.has(key))
        .map(async ({ key, dataUrl }) => {
          const res  = await fetch(dataUrl);
          const blob = await res.blob();
          const bmp  = await createImageBitmap(blob);
          this.playerIconCache.set(key, bmp);
        }),
    );
  }

  // ─── Transitions ──────────────────────────────────────────────────────────

  private async runTransition(
    config: TransitionConfig | undefined,
    applyChange: () => Promise<void>,
    /** Optional pre-decoded snapshot for the transition's "before"
     *  state. Handout reveal pathway passes in the raw starting-frame
     *  bitmap so the filter doesn't get baked into the snapshot at
     *  capture time. Map→map transitions leave this undefined and the
     *  engine snapshots the live canvas. */
    preSnapshot?: ImageBitmap,
    /** Optional offscreen canvas the transition should paint onto
     *  instead of the DOM overlay. Handout reveal pathway supplies
     *  the renderer's in-scene reveal-overlay canvas so the filter
     *  applies to BOTH halves of the reveal. Map→map transitions
     *  leave this undefined and paint to the DOM overlay above the
     *  WebGL canvas — outside the filter pipeline. */
    overlayOverride?: HTMLCanvasElement,
  ): Promise<void> {
    const id  = config?.transitionId ?? 'none';
    const def = transitionRegistry.getOrFallback(id);
    const params = config?.params ?? transitionRegistry.defaultParams(id);
    const canvas = document.querySelector<HTMLCanvasElement>('#renderer-canvas')!;
    await this.transitionEngine.run(def, params, canvas, applyChange, preSnapshot, overlayOverride);
  }

  // ─── UI ───────────────────────────────────────────────────────────────────

  private showConnectPanel(): void {
    this.connectPanel.hidden = false;
    this.setStatus('Enter room code to connect');
  }

  private setStatus(msg: string): void {
    this.statusEl.textContent = msg;
    this.statusEl.hidden = !msg;
  }
}

// Pre-warm filter registry so shaders are compiled on load
filterRegistry.getAll();
