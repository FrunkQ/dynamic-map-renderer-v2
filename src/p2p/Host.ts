import Peer, { type DataConnection } from 'peerjs';
import type { GMMessage, SessionState, MarkerIconData, SoundboardAudioData, TextMapVideoElement, TextMapAltItem, MsgStarMapShow, MsgFullState } from '../types.ts';
import { LocalChannel } from './LocalChannel.ts';
import { peerConfigFor, loadStoredIce } from './iceConfig.ts';
import { generateRoomCode } from './roomCode.ts';
import { isLocalPlayerStaticOnly } from '../storage/localSettings.ts';

const CHUNK_SIZE = 16 * 1024; // 16 KB — safe DataChannel message size

export interface HostEvents {
  onPeerConnected: (peerId: string) => void;
  onPeerDisconnected: (peerId: string) => void;
  onError: (err: Error) => void;
  onReady: (roomCode: string) => void;
  /** Inbound message from a peer (e.g. projector_hello). Optional — only
   *  bidirectional callers need to wire this. */
  onPeerMessage?: (peerId: string, msg: GMMessage) => void;
  /** Fired when a new same-browser subscriber asks for state via BroadcastChannel
   *  (typically a freshly-opened player / preview / projector window in the same
   *  browser). Host already responds with full_state; callers can use this hook
   *  to seed additional Player Voice state (player_markers, per-player icons,
   *  initiative) the subscriber wouldn't otherwise get if it never identifies. */
  onLocalRequestState?: () => void;
}

/**
 * Host — GM-side P2P session manager.
 *
 * - Registers a PeerJS peer (using a persisted ID when available)
 * - Accepts incoming player connections
 * - Broadcasts state updates to all connected peers AND the local BroadcastChannel
 * - Handles chunked binary transfer for map blobs
 */
export class Host {
  private peer: Peer | null = null;
  /** The peer ID we asked PeerJS to register. Set synchronously in start();
   *  used as the roomCode fallback before peer.on('open') has fired so the
   *  projector window can launch (over BroadcastChannel) without waiting on
   *  the broker handshake — which on production HTTPS is a noticeable delay. */
  private requestedRoomCode: string | null = null;
  private connections = new Map<string, DataConnection>();
  private local: LocalChannel;
  private events: HostEvents;
  private lastState:            SessionState | null = null;
  private lastMapBlob:          ArrayBuffer | null = null;
  /** v2.12.x — cached video-bundle for the currently active map, so a
   *  player or projector that connects AFTER the GM broadcast can
   *  still receive the full video bytes (lastMapBlob stays the
   *  lightweight snapshot for instant first-paint). Cleared on the
   *  next map_change since each map's bundle is independent. */
  private lastVideoBundle: { mapId: string; mimeType: string; buffer: ArrayBuffer } | null = null;
  /** v2.14.54 — cached composite payload for the currently active
   *  map. Present iff the active map is a composite. New joiners
   *  receive it in their full_state alongside lastMapBlob (which in
   *  that case is the packed tile bundle, not a PNG). */
  private lastComposite: import('../types.ts').CompositeWirePayload | null = null;
  /** Cached map-asset metadata so full_state messages can size projector views. */
  private lastMapPps:           number | undefined = undefined;
  private lastMapImgW:          number | undefined = undefined;
  private lastMapImgH:          number | undefined = undefined;
  /** v2.14.34 — also cache the calibration nudge offset + per-map
   *  grid colour so a late-joining viewer's first full_state carries
   *  them. Without this the new viewer drew at gridOffset=0 with a
   *  default-white grid until the GM happened to broadcast a fresh
   *  map_meta_update (e.g. nudged a value). */
  private lastMapGridOffsetX:   number | undefined = undefined;
  private lastMapGridOffsetY:   number | undefined = undefined;
  private lastMapGridColor:     string | undefined = undefined;
  /** v2.16.100 — live text-map videos for the active map, so every
   *  full_state (including the BroadcastChannel one a same-browser
   *  preview / pop-out requests on open) carries them. */
  private lastTextMapVideos:    TextMapVideoElement[] = [];
  /** v2.18 — StarMap: the ACTIVE map is a StarMap (viewers show the SSE view
   *  instead of a texture) and/or the pack contains one (viewers pre-warm).
   *  Both ride every full_state so a late joiner is correct on connect. */
  private lastStarMap:          MsgStarMapShow['payload'] | null = null;
  private lastStarMapPrewarm:   { origin: string; sessionId: string } | null = null;
  /** v2.17.27 — accessibility content (text + image alt) for the active
   *  text-map, cached so every full_state carries it like the videos do. */
  private lastTextMapAlt:       TextMapAltItem[] = [];
  /** v2.16.108 — current "GM is faffing" hold-screen state (the Player
   *  Views broadcast toggle, off = hold screen). Cached so a viewer
   *  joining WHILE it's off gets the hold screen on connect instead of
   *  the live map (the placeholder was a one-time broadcast otherwise). */
  private _faffActive  = false;
  private _faffMessage = '';
  private lastIconData:         MarkerIconData[] = [];
  private lastSoundboardActive: SoundboardAudioData[] = [];
  private lastSoundboardAssets: { assetId: string; dataUrl: string }[] = [];
  /** markerId → active positional play — delivered to new joiners (mirrors lastSoundboardActive) */
  private lastPositionalActive = new Map<string, { markerId: string; assetId: string; loop: boolean; volume: number; dataUrl: string }>();
  /** Monotonically-increasing sequence number stamped on every broadcast.
   *  Players use this to deduplicate the same message arriving via both
   *  BroadcastChannel and PeerJS (local windows receive both). */
  private broadcastSeq = 0;
  /** v2.14.26 — when true, broadcast() is a no-op. Used to silence
   *  all outbound P2P traffic during the calibration modal session
   *  (the active map's calibration changes shouldn't propagate to
   *  viewers until the GM commits with Save). Viewers see a hold
   *  screen for the whole modal session, so dropping broadcasts is
   *  safe — anything important re-syncs via refreshProjectorMapInfo
   *  the moment the modal closes. */
  private _broadcastSuspended = false;
  /** Counter for diagnostic logging — how many broadcasts were dropped
   *  while suspended. Reset on each setBroadcastSuspended(true). */
  private _suspendedDropCount = 0;
  private _suspendedDropTypes = new Map<string, number>();

  /**
   * Pending broker-reconnect timer. Set when a broker-level PeerJS error
   * (socket/network/server) fires; cleared on a successful peer.on('open')
   * or on destroy(). PeerJS itself doesn't auto-retry the broker WebSocket,
   * so we destroy the dead Peer and recreate it after a fixed delay.
   */
  private _brokerRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly BROKER_RETRY_MS = 60_000;

  constructor(events: HostEvents) {
    this.events = events;
    this.local = new LocalChannel();
  }

  /** Start the host. Pass a previously persisted peerId to attempt resumption. */
  start(peerId?: string): void {
    this.requestedRoomCode = peerId ?? null;
    // v2.18 — BYO STUN/TURN from Settings (prepended to PeerJS defaults) so remote players
    // behind UDP-blocking networks can relay over TLS 443. Same list rides ?ice= on join URLs.
    const cfg = peerConfigFor(loadStoredIce());
    const peer = peerId
      ? (cfg ? new Peer(peerId, { config: cfg }) : new Peer(peerId))
      : (cfg ? new Peer({ config: cfg }) : new Peer());
    this.peer = peer;

    peer.on('open', (id) => {
      // Broker just confirmed us — any pending auto-retry from a prior
      // broker outage is now redundant.
      this._clearBrokerRetry();
      this.events.onReady(id);
    });

    peer.on('connection', (conn) => {
      this.handleConnection(conn);
    });

    peer.on('error', (err) => {
      const type = (err as unknown as { type?: string }).type;
      // If the requested ID is already taken on the PeerJS server, silently
      // regenerate a new word code and retry — collisions are rare but possible.
      if (type === 'unavailable-id') {
        peer.destroy();
        this.start(generateRoomCode());
        return;
      }
      // Broker-level failures (the WebSocket to 0.peerjs.com itself):
      // schedule a one-minute auto-retry. PeerJS doesn't recover the
      // signalling socket on its own — we destroy the dead Peer and
      // recreate it so the broker can hand us the same peer id again
      // once it's back. Same-machine BroadcastChannel players are
      // unaffected throughout.
      const isBrokerLevel =
        type === 'socket-error' || type === 'socket-closed' ||
        type === 'server-error' || type === 'network'       ||
        type === 'disconnected' || type === 'ssl-unavailable';
      if (isBrokerLevel) this._scheduleBrokerRetry();
      this.events.onError(err as Error);
    });

    // Same-browser projector / player windows can also send GMMessages
    // upstream (e.g. projector_hello). Forward to the same callback the
    // network connection uses so GMApp doesn't care which transport.
    this.local.onPeerMessage((msg) => {
      if (this.events.onPeerMessage) {
        try { this.events.onPeerMessage('local', msg); }
        catch (err) { this.events.onError(err as Error); }
      }
    });

    // When a local player window opens it immediately requests state via
    // BroadcastChannel. Respond with full_state so it doesn't wait for PeerJS.
    this.local.onRequest(() => {
      if (this.lastState) {
        const msg: GMMessage = {
          type: 'full_state',
          payload: this.lastState,
          ...(this.lastMapBlob                         ? { mapBlob:          this.lastMapBlob          } : {}),
          ...(this.lastIconData.length > 0             ? { iconData:         this.lastIconData          } : {}),
          ...(this.lastSoundboardActive.length > 0     ? { soundboardActive: this.lastSoundboardActive } : {}),
          ...(this.lastSoundboardAssets.length > 0     ? { soundboardAssets: this.lastSoundboardAssets } : {}),
          ...(this.lastMapPps        !== undefined ? { mapPixelsPerSquare: this.lastMapPps        } : {}),
          ...(this.lastMapImgW       !== undefined ? { mapImageWidth:      this.lastMapImgW       } : {}),
          ...(this.lastMapImgH       !== undefined ? { mapImageHeight:     this.lastMapImgH       } : {}),
          ...(this.lastMapGridOffsetX !== undefined ? { gridOffsetX:       this.lastMapGridOffsetX } : {}),
          ...(this.lastMapGridOffsetY !== undefined ? { gridOffsetY:       this.lastMapGridOffsetY } : {}),
          ...(this.lastMapGridColor   !== undefined ? { gridColor:         this.lastMapGridColor   } : {}),
          ...(this.lastComposite                    ? { composite:         this.lastComposite      } : {}),
          ...(this.lastTextMapVideos.length > 0      ? { textMapVideos:     this.lastTextMapVideos  } : {}),
          ...(this.lastTextMapAlt.length > 0         ? { textMapAlt:        this.lastTextMapAlt     } : {}),
          ...this._starMapFullStateFields(),
        };
        this.local.send(msg);
        // v2.16.108 — if the GM is faffing (broadcast toggle off), the new
        // local window must see the hold screen, not the live map.
        if (this._faffActive) {
          this.local.send({ type: 'view_placeholder', target: 'player',    show: true, message: this._faffMessage });
          this.local.send({ type: 'view_placeholder', target: 'projector', show: true, message: this._faffMessage });
        }
        // Deliver active positional plays inline (BroadcastChannel supports large payloads)
        for (const p of this.lastPositionalActive.values()) {
          this.local.send({ type: 'positional_play', markerId: p.markerId, assetId: p.assetId, loop: p.loop, volume: p.volume, dataUrl: p.dataUrl });
        }
      }
      // v2.17 — let GMApp seed Player Voice state (player_markers,
      // per-player icons, initiative). lastState doesn't carry these, so
      // without this hook a freshly-opened local preview / projector
      // would render initial-letter tokens until the next live update.
      if (this.events.onLocalRequestState) {
        try { this.events.onLocalRequestState(); }
        catch (err) { this.events.onError(err as Error); }
      }
    });
  }

  get roomCode(): string | null {
    // Prefer the PeerJS-confirmed id, but fall back to the requested code so
    // the GM-side projector / player launchers don't have to wait on the
    // broker handshake (which is noticeably slower on production HTTPS than
    // localhost dev). Same-browser BC connections work immediately either way.
    return this.peer?.id || this.requestedRoomCode;
  }

  /** v2.14.26 — suspend / resume outbound broadcasts. Used by GMApp
   *  to silence viewers while the calibration modal is open. The
   *  view_placeholder hold screen broadcasts still go through; every
   *  other type is dropped. On resume, logs the diagnostic counts so
   *  we can SEE which message types were piling up during the modal. */
  setBroadcastSuspended(suspended: boolean): void {
    if (this._broadcastSuspended === suspended) return;
    if (suspended) {
      this._suspendedDropCount = 0;
      this._suspendedDropTypes.clear();
      this._broadcastSuspended = true;
      console.log('[host] broadcasts SUSPENDED');
    } else {
      this._broadcastSuspended = false;
      const breakdown = [...this._suspendedDropTypes.entries()]
        .map(([t, n]) => `${t}=${n}`).join(' ');
      console.log(`[host] broadcasts RESUMED — dropped ${this._suspendedDropCount} during suspension${breakdown ? ' (' + breakdown + ')' : ''}`);
    }
  }

  get connectedCount(): number {
    return this.connections.size;
  }

  /**
   * Same-machine player windows currently alive (BroadcastChannel-only,
   * tracked via player_heartbeat liveness pings). Disjoint from
   * connectedCount, which only covers PeerJS peers.
   */
  get localPlayerCount(): number {
    return this.local.localPlayerCount;
  }

  /** All peer ids currently connected via PeerJS — includes both players and
   *  remote projectors. Callers that want just players should filter out the
   *  ones they've identified as projectors. */
  get connectedPeerIds(): string[] {
    return [...this.connections.keys()];
  }

  /** Broadcast a message to all network peers AND the local window channel.
   *  Every broadcast is stamped with a monotonically-increasing _seq so that
   *  players receiving the same message via BOTH BroadcastChannel and PeerJS
   *  can detect and drop the duplicate. */
  broadcast(msg: GMMessage): void {
    // v2.14.26 — gate. While suspended, drop EVERY outbound message
    // except view_placeholder (we need that to deliver the calibrating
    // hold screen + clear it). Log what gets dropped so we can confirm
    // which message types were causing the calibration-modal stalls.
    if (this._broadcastSuspended && msg.type !== 'view_placeholder') {
      this._suspendedDropCount++;
      this._suspendedDropTypes.set(msg.type, (this._suspendedDropTypes.get(msg.type) ?? 0) + 1);
      return;
    }
    // Stamp with seq before sending so both channels carry the same number.
    const seq = ++this.broadcastSeq;
    const tagged = { ...msg, _seq: seq } as unknown as GMMessage;

    // v2.12.20 — same-machine animated-map suppression is now opt-in.
    // When the user enables "Send only the first frame to local
    // player windows" in Settings → Performance, the GM holds the
    // video_bundle back from the LocalChannel path so same-browser
    // peers (player popups, same-machine projector) stay on the
    // first-frame snapshot from the preceding map_change. They
    // never spin up a video decoder, never fight the GM for Chrome's
    // per-window decode budget. Default off — full animation reaches
    // every connected view unless the GM opts into the bypass.
    // Remote PeerJS peers always receive the bundle regardless.
    if (msg.type === 'video_bundle' && isLocalPlayerStaticOnly()) {
      // skip LocalChannel for this message; PeerJS sendTo below
      // still delivers to remote peers.
    } else {
      this.local.send(tagged);
    }

    // Keep cached state current for new joiners.
    if (msg.type === 'full_state') {
      this.lastState = msg.payload;
      if (msg.mapBlob) this.lastMapBlob = msg.mapBlob;
    }
    if (msg.type === 'map_change') {
      this.lastMapBlob = msg.mapBlob;
      // v2.14.54 — cache composite payload alongside lastMapBlob so
      // late joiners get the same packed-bundle treatment as live
      // peers. Cleared on every map_change so a switch to a non-
      // composite drops the stale payload.
      this.lastComposite = msg.composite ?? null;
      // Each map starts with no video bundle yet — the GM may or may
      // not follow up with one for animated maps.
      this.lastVideoBundle = null;
      this.lastSoundboardActive = [];
      this.lastPositionalActive.clear();
    }
    if (msg.type === 'video_bundle') {
      // Cache so new joiners after this point also get the animation,
      // not just the static snapshot. We DON'T overwrite lastMapBlob
      // here — keeping it as the snapshot means full_state delivers
      // a lightweight blob and the video follows separately, same
      // two-phase rhythm a live connection sees.
      this.lastVideoBundle = { mapId: msg.mapId, mimeType: msg.mimeType, buffer: msg.mapBlob };
    }
    if (msg.type === 'handout_reveal') {
      // Update the cached blob to the FINAL frame so a late-joining
      // player sees the revealed state (rather than the starting
      // frame that was cached at map_change time). They miss the
      // transition itself, but that's natural for late joiners — same
      // as they'd miss any in-flight effect.
      this.lastMapBlob = msg.mapBlob;
    }
    if (msg.type === 'positional_play' && msg.dataUrl) {
      this.lastPositionalActive.set(msg.markerId, {
        markerId: msg.markerId, assetId: msg.assetId, loop: msg.loop, volume: msg.volume, dataUrl: msg.dataUrl,
      });
    }
    if (msg.type === 'positional_volume') {
      const p = this.lastPositionalActive.get(msg.markerId);
      if (p) p.volume = msg.volume;
    }
    if (msg.type === 'positional_stop') {
      this.lastPositionalActive.delete(msg.markerId);
    }
    // Track individual play/stop so late-joining players hear active sounds.
    if (msg.type === 'soundboard_play' && msg.dataUrl) {
      this.lastSoundboardActive = [
        ...this.lastSoundboardActive.filter((s) => s.slotId !== msg.slotId),
        { slotId: msg.slotId, assetId: msg.assetId, loop: msg.loop, volume: msg.volume, dataUrl: msg.dataUrl },
      ];
    }
    if (msg.type === 'soundboard_stop') {
      this.lastSoundboardActive = this.lastSoundboardActive.filter((s) => s.slotId !== msg.slotId);
    }

    for (const conn of this.connections.values()) {
      this.sendTo(conn, tagged);
    }
  }

  /** Update the cached state (call whenever GM state changes) */
  updateState(
    state: SessionState,
    mapBlob?: ArrayBuffer,
    iconData?: MarkerIconData[],
    soundboardActive?: SoundboardAudioData[],
  ): void {
    this.lastState = state;
    if (mapBlob !== undefined)          this.lastMapBlob          = mapBlob;
    if (iconData !== undefined)         this.lastIconData          = iconData;
    if (soundboardActive !== undefined) this.lastSoundboardActive  = soundboardActive;
  }

  /** Update the cached map-asset metadata used by full_state for projector views. */
  updateMapAssetInfo(
    pps: number | undefined,
    imgW: number | undefined,
    imgH: number | undefined,
    gridOffsetX?: number,
    gridOffsetY?: number,
    gridColor?:   string,
  ): void {
    this.lastMapPps  = pps;
    this.lastMapImgW = imgW;
    this.lastMapImgH = imgH;
    this.lastMapGridOffsetX = gridOffsetX;
    this.lastMapGridOffsetY = gridOffsetY;
    this.lastMapGridColor   = gridColor;
  }

  /** v2.14.34 — focused setter for the cached grid colour. Used by
   *  the GM map panel's swatch handler so colour-only updates don't
   *  have to round-trip the other map-meta fields. */
  /** v2.16.100 — keep the cached text-map videos current so a viewer
   *  joining AFTER a map load sees them in its initial full_state. */
  setLastTextMapVideos(videos: TextMapVideoElement[]): void {
    this.lastTextMapVideos = videos;
  }

  /** v2.18 — StarMap: what the active map is (null = an ordinary map) and
   *  whether the pack has any StarMap at all (pre-warm hint). */
  setLastStarMap(active: MsgStarMapShow['payload'] | null): void {
    this.lastStarMap = active;
    // When a StarMap is active it is also the pack's warm target: keep the
    // pre-warm hint pointing at the same session so viewers reuse the frame.
    if (active) this.lastStarMapPrewarm = { origin: active.origin, sessionId: active.sessionId };
  }
  setLastStarMapPrewarm(hint: { origin: string; sessionId: string } | null): void {
    this.lastStarMapPrewarm = hint;
  }
  private _starMapFullStateFields(): Pick<MsgFullState, 'starMap' | 'starMapPrewarm'> {
    return {
      ...(this.lastStarMap        ? { starMap:        this.lastStarMap        } : {}),
      ...(this.lastStarMapPrewarm ? { starMapPrewarm: this.lastStarMapPrewarm } : {}),
    };
  }

  /** v2.17.27 — keep cached alt content current so a viewer joining after a
   *  map load gets the handout's screen-reader text in its initial full_state. */
  setLastTextMapAlt(items: TextMapAltItem[]): void {
    this.lastTextMapAlt = items;
  }

  /** v2.16.108 — remember whether the broadcast toggle is showing the hold
   *  screen, so a late joiner gets it on connect. message is the shared faff
   *  line currently displayed to existing viewers. */
  setFaffState(active: boolean, message: string): void {
    this._faffActive  = active;
    this._faffMessage = message;
  }

  setLastMapGridColor(color: string | undefined): void {
    this.lastMapGridColor = color;
  }

  /** Update the preload asset cache — called whenever blobs finish loading in SoundboardPanel */
  updateSoundboardAssets(assets: { assetId: string; dataUrl: string }[]): void {
    this.lastSoundboardAssets = assets;
  }

  destroy(): void {
    this._clearBrokerRetry();
    this.local.destroy();
    for (const conn of this.connections.values()) conn.close();
    this.peer?.destroy();
    this.peer = null;
  }

  private _scheduleBrokerRetry(): void {
    // Coalesce — a single failure can fire multiple error events.
    if (this._brokerRetryTimer !== null) return;
    this._brokerRetryTimer = setTimeout(() => {
      this._brokerRetryTimer = null;
      const code = this.requestedRoomCode;
      try { this.peer?.destroy(); } catch { /* ignore */ }
      this.peer = null;
      // Reuse the same room code so the QR / saved session stay valid
      // once the broker comes back. start() also re-binds the same
      // event handlers including this retry path, so a continuing
      // outage just keeps the cycle going every BROKER_RETRY_MS.
      if (code) this.start(code);
    }, Host.BROKER_RETRY_MS);
  }

  private _clearBrokerRetry(): void {
    if (this._brokerRetryTimer !== null) {
      clearTimeout(this._brokerRetryTimer);
      this._brokerRetryTimer = null;
    }
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private handleConnection(conn: DataConnection): void {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      this.events.onPeerConnected(conn.peer);

      // Send full state snapshot to new joiner
      if (this.lastState) {
        const msg: GMMessage = {
          type: 'full_state',
          payload: this.lastState,
          ...(this.lastMapBlob                         ? { mapBlob:          this.lastMapBlob          } : {}),
          ...(this.lastIconData.length > 0             ? { iconData:         this.lastIconData          } : {}),
          ...(this.lastSoundboardActive.length > 0     ? { soundboardActive: this.lastSoundboardActive } : {}),
          ...(this.lastSoundboardAssets.length > 0     ? { soundboardAssets: this.lastSoundboardAssets } : {}),
          ...(this.lastMapPps        !== undefined ? { mapPixelsPerSquare: this.lastMapPps        } : {}),
          ...(this.lastMapImgW       !== undefined ? { mapImageWidth:      this.lastMapImgW       } : {}),
          ...(this.lastMapImgH       !== undefined ? { mapImageHeight:     this.lastMapImgH       } : {}),
          ...(this.lastMapGridOffsetX !== undefined ? { gridOffsetX:       this.lastMapGridOffsetX } : {}),
          ...(this.lastMapGridOffsetY !== undefined ? { gridOffsetY:       this.lastMapGridOffsetY } : {}),
          ...(this.lastMapGridColor   !== undefined ? { gridColor:         this.lastMapGridColor   } : {}),
          ...(this.lastComposite                    ? { composite:         this.lastComposite      } : {}),
          ...(this.lastTextMapVideos.length > 0      ? { textMapVideos:     this.lastTextMapVideos  } : {}),
          ...(this.lastTextMapAlt.length > 0         ? { textMapAlt:        this.lastTextMapAlt     } : {}),
          ...this._starMapFullStateFields(),
        };
        this.sendTo(conn, msg);
        // v2.16.108 — if the GM is faffing (broadcast toggle off), the new
        // peer must see the hold screen, not the live map it just received.
        if (this._faffActive) {
          this.sendTo(conn, { type: 'view_placeholder', target: 'player',    show: true, message: this._faffMessage });
          this.sendTo(conn, { type: 'view_placeholder', target: 'projector', show: true, message: this._faffMessage });
        }
        // Late-joiner video catchup — if the active map is animated,
        // deliver the cached full video bytes so the new peer can
        // swap from snapshot to VideoTexture, same as live peers did
        // when the bundle was first broadcast.
        if (this.lastVideoBundle) {
          this.sendTo(conn, {
            type:     'video_bundle',
            mapId:    this.lastVideoBundle.mapId,
            mimeType: this.lastVideoBundle.mimeType,
            mapBlob:  this.lastVideoBundle.buffer,
          });
        }
        // Deliver active positional plays as chunked binary messages
        for (const p of this.lastPositionalActive.values()) {
          this.sendTo(conn, { type: 'positional_play', markerId: p.markerId, assetId: p.assetId, loop: p.loop, volume: p.volume, dataUrl: p.dataUrl });
        }
      }
    });

    conn.on('data', (raw) => {
      // Inbound peer message (e.g. projector_hello, player_identify).
      // Guests now JSON-stringify on send (PeerJS 'raw' serialization can't
      // pack plain objects into RTCDataChannel), so we parse strings here.
      // Plain objects still accepted for back-compat with anything older.
      let data: { type?: string };
      if (typeof raw === 'string') {
        try { data = JSON.parse(raw) as { type?: string }; }
        catch { return; }
      } else if (typeof raw === 'object' && raw !== null) {
        data = raw as { type?: string };
      } else {
        return;
      }
      if (typeof data.type !== 'string') return;
      // PeerJS players send heartbeats too (Guest.send fans out to both
      // transports). They don't change the count — PeerJS lifecycle
      // already tracks these peers — so swallow them here rather than
      // bubbling up as an unknown message type to GMApp.
      if (data.type === 'player_heartbeat') return;
      if (!this.events.onPeerMessage) return;
      try { this.events.onPeerMessage(conn.peer, data as GMMessage); }
      catch (err) { this.events.onError(err as Error); }
    });

    conn.on('close', () => {
      this.removeConnection(conn.peer);
    });

    conn.on('error', (err) => {
      this.events.onError(err as Error);
      // Some browsers fire 'error' but not 'close' when the player tab is
      // closed mid-session — treat this as a disconnect so the count drops.
      this.removeConnection(conn.peer);
    });
  }

  /** Idempotent connection teardown: drop from the map and notify exactly once
   *  even if both 'close' and 'error' fire for the same DataConnection. */
  private removeConnection(peerId: string): void {
    if (!this.connections.has(peerId)) return;
    this.connections.delete(peerId);
    this.events.onPeerDisconnected(peerId);
  }

  private sendTo(conn: DataConnection, msg: GMMessage): void {
    // v2.17.16 — Never send on a connection whose data channel isn't open.
    // PeerJS's send() emits a "Connection is not open" error on a closed /
    // half-torn-down channel, which bubbled to the GM as a scary P2P error
    // toast and tripped removeConnection mid-broadcast. A closed conn is
    // already being cleaned up by its own close/error handler, so skipping
    // it here is safe — the peer catches up on its next full_state.
    if (!conn.open) return;
    const { mapBlob, ...rest } = msg as { mapBlob?: ArrayBuffer } & GMMessage;

    // Audio data URLs are too large for a single data-channel JSON frame (> 16 KB).
    // Strip them out and deliver as binary chunks, same pattern as map blobs.

    // For soundboard_play / marker_audio_asset: strip dataUrl, send binary after the JSON.
    let audioBuffer: ArrayBuffer | undefined;
    let jsonMsg: Record<string, unknown> = rest as Record<string, unknown>;
    if (
      (rest.type === 'soundboard_play' || rest.type === 'positional_play') &&
      rest.dataUrl
    ) {
      audioBuffer = this._dataUrlToBuffer(rest.dataUrl);
      const { dataUrl: _d, ...noUrl } = rest;
      void _d;
      jsonMsg = noUrl as Record<string, unknown>;
    }
    // v2.17 — player_icon_update routes through the chunked-blob path
    // for multi-KB bitmap icons that would blow past the DataChannel
    // message limit. v2.16.31: small icons (SVG-rendered lucide-style,
    // typically < 10 KB base64) are sent INLINE in the JSON instead.
    // The chunked path uses several frames per delivery (header + JSON +
    // chunks) and back-to-back icon broadcasts during a multi-player
    // identify / hello cycle were intermittently racing — inline keeps
    // each small icon atomic and avoids the race window. The receiver
    // already handles both inline `msg.dataUrl` and chunked `blob` paths
    // (see ProjectorApp + PlayerApp player_icon_update handlers).
    if (rest.type === 'player_icon_update' && rest.dataUrl) {
      const INLINE_ICON_MAX = 10 * 1024;
      if (rest.dataUrl.length <= INLINE_ICON_MAX) {
        jsonMsg = rest as Record<string, unknown>;
      } else {
        audioBuffer = this._dataUrlToBuffer(rest.dataUrl);
        const { dataUrl: _d, ...noUrl } = rest;
        void _d;
        jsonMsg = noUrl as Record<string, unknown>;
      }
    }

    // For full_state / map_change: strip dataUrls from soundboardActive and soundboardAssets;
    // deliver them as binary chunks after the main JSON message.
    let activeSounds:  Array<{ meta: Record<string, unknown>; buf: ArrayBuffer }> = [];
    let assetMessages: Array<{ assetId: string; buf: ArrayBuffer }> = [];
    if ((rest.type === 'full_state' || rest.type === 'map_change') && rest.soundboardActive?.length) {
      activeSounds = rest.soundboardActive
        .filter((item) => !!item.dataUrl)
        .map((item) => ({
          meta: { type: 'soundboard_play', slotId: item.slotId, assetId: item.assetId, loop: item.loop, volume: item.volume },
          buf:  this._dataUrlToBuffer(item.dataUrl),
        }));
      jsonMsg = {
        ...jsonMsg,
        soundboardActive: rest.soundboardActive.map(({ dataUrl: _d, ...item }) => { void _d; return item; }),
      };
    }
    if ((rest.type === 'full_state' || rest.type === 'map_change') && rest.soundboardAssets?.length) {
      // Skip assets already being sent as soundboard_play (active sounds).
      const activeIds = new Set(activeSounds.map((s) => (s.meta as Record<string, unknown>)['assetId'] as string));
      assetMessages = rest.soundboardAssets
        .filter((a) => !!a.dataUrl && !activeIds.has(a.assetId))
        .map((a) => ({ assetId: a.assetId, buf: this._dataUrlToBuffer(a.dataUrl!) }));
      // Strip dataUrls — data travels as binary.
      jsonMsg = {
        ...jsonMsg,
        soundboardAssets: rest.soundboardAssets.map(({ dataUrl: _d, ...a }) => { void _d; return a; }),
      };
    }

    // Send map blob header BEFORE JSON so the player sets blobTotal first.
    if (mapBlob && mapBlob.byteLength > 0) {
      conn.send(JSON.stringify({ type: '__blob_start__', total: Math.ceil(mapBlob.byteLength / CHUNK_SIZE) }));
    } else if (audioBuffer && audioBuffer.byteLength > 0) {
      conn.send(JSON.stringify({ type: '__blob_start__', total: Math.ceil(audioBuffer.byteLength / CHUNK_SIZE) }));
    }

    conn.send(JSON.stringify(jsonMsg));

    if (mapBlob && mapBlob.byteLength > 0) {
      this._sendChunks(conn, mapBlob);
    } else if (audioBuffer && audioBuffer.byteLength > 0) {
      this._sendChunks(conn, audioBuffer);
    }

    // Send active sounds as separate chunked soundboard_play messages.
    for (const { meta, buf } of activeSounds) {
      conn.send(JSON.stringify({ type: '__blob_start__', total: Math.ceil(buf.byteLength / CHUNK_SIZE) }));
      conn.send(JSON.stringify(meta));
      this._sendChunks(conn, buf);
    }

    // Send non-playing assets as soundboard_asset messages for preloading.
    for (const { assetId, buf } of assetMessages) {
      conn.send(JSON.stringify({ type: '__blob_start__', total: Math.ceil(buf.byteLength / CHUNK_SIZE) }));
      conn.send(JSON.stringify({ type: 'soundboard_asset', assetId }));
      this._sendChunks(conn, buf);
    }
  }

  private _sendChunks(conn: DataConnection, buf: ArrayBuffer): void {
    const total = Math.ceil(buf.byteLength / CHUNK_SIZE);
    for (let i = 0; i < total; i++) {
      conn.send(buf.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
    }
  }

  private _dataUrlToBuffer(dataUrl: string): ArrayBuffer {
    const base64 = dataUrl.split(',')[1] ?? '';
    const binary = atob(base64);
    const buf = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
    return buf.buffer;
  }
}
