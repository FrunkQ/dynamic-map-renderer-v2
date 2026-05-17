import Peer, { type DataConnection } from 'peerjs';
import type { GMMessage, SessionState, MarkerIconData, SoundboardAudioData } from '../types.ts';
import { LocalChannel } from './LocalChannel.ts';
import { generateRoomCode } from './roomCode.ts';

const CHUNK_SIZE = 16 * 1024; // 16 KB — safe DataChannel message size

export interface HostEvents {
  onPeerConnected: (peerId: string) => void;
  onPeerDisconnected: (peerId: string) => void;
  onError: (err: Error) => void;
  onReady: (roomCode: string) => void;
  /** Inbound message from a peer (e.g. projector_hello). Optional — only
   *  bidirectional callers need to wire this. */
  onPeerMessage?: (peerId: string, msg: GMMessage) => void;
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
  /** Cached map-asset metadata so full_state messages can size projector views. */
  private lastMapPps:           number | undefined = undefined;
  private lastMapImgW:          number | undefined = undefined;
  private lastMapImgH:          number | undefined = undefined;
  private lastIconData:         MarkerIconData[] = [];
  private lastSoundboardActive: SoundboardAudioData[] = [];
  private lastSoundboardAssets: { assetId: string; dataUrl: string }[] = [];
  /** markerId → active positional play — delivered to new joiners (mirrors lastSoundboardActive) */
  private lastPositionalActive = new Map<string, { markerId: string; assetId: string; loop: boolean; volume: number; dataUrl: string }>();
  /** Monotonically-increasing sequence number stamped on every broadcast.
   *  Players use this to deduplicate the same message arriving via both
   *  BroadcastChannel and PeerJS (local windows receive both). */
  private broadcastSeq = 0;

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
    const peer = peerId ? new Peer(peerId) : new Peer();
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
          ...(this.lastMapPps  !== undefined           ? { mapPixelsPerSquare: this.lastMapPps          } : {}),
          ...(this.lastMapImgW !== undefined           ? { mapImageWidth:      this.lastMapImgW         } : {}),
          ...(this.lastMapImgH !== undefined           ? { mapImageHeight:     this.lastMapImgH         } : {}),
        };
        this.local.send(msg);
        // Deliver active positional plays inline (BroadcastChannel supports large payloads)
        for (const p of this.lastPositionalActive.values()) {
          this.local.send({ type: 'positional_play', markerId: p.markerId, assetId: p.assetId, loop: p.loop, volume: p.volume, dataUrl: p.dataUrl });
        }
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
    // Stamp with seq before sending so both channels carry the same number.
    const seq = ++this.broadcastSeq;
    const tagged = { ...msg, _seq: seq } as unknown as GMMessage;

    // v2.12.x — animated-map video_bundle messages are deliberately
    // suppressed from the LocalChannel path. Same-browser windows
    // (player popups, same-machine projector) compete with the GM
    // for Chrome's per-window decoder budget; sending them the full
    // video bytes just makes both windows worse. They stay on the
    // first-frame snapshot from the preceding map_change instead.
    // Remote peers (PeerJS) still get the bundle and animate normally.
    if (msg.type !== 'video_bundle') {
      this.local.send(tagged);
    }

    // Keep cached state current for new joiners.
    if (msg.type === 'full_state') {
      this.lastState = msg.payload;
      if (msg.mapBlob) this.lastMapBlob = msg.mapBlob;
    }
    if (msg.type === 'map_change') {
      this.lastMapBlob = msg.mapBlob;
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
  updateMapAssetInfo(pps: number | undefined, imgW: number | undefined, imgH: number | undefined): void {
    this.lastMapPps  = pps;
    this.lastMapImgW = imgW;
    this.lastMapImgH = imgH;
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
          ...(this.lastMapPps  !== undefined           ? { mapPixelsPerSquare: this.lastMapPps          } : {}),
          ...(this.lastMapImgW !== undefined           ? { mapImageWidth:      this.lastMapImgW         } : {}),
          ...(this.lastMapImgH !== undefined           ? { mapImageHeight:     this.lastMapImgH         } : {}),
        };
        this.sendTo(conn, msg);
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
      // Inbound peer message (e.g. projector_hello). Ignore if no listener.
      const data = raw as { type?: string };
      if (typeof data !== 'object' || !data || typeof data.type !== 'string') return;
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
