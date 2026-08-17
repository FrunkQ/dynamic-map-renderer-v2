import Peer, { type DataConnection } from 'peerjs';
import type { GMMessage } from '../types.ts';
import { peerConfigFor, type IceServerEntry } from './iceConfig.ts';
import { LocalChannel } from './LocalChannel.ts';

export interface GuestEvents {
  onMessage: (msg: GMMessage, mapBlob?: ArrayBuffer) => void;
  onConnected: () => void;
  onDisconnected: () => void;
  /** Fired when a disconnect is detected and a reconnect attempt is scheduled. */
  onReconnecting?: (attempt: number, delayMs: number) => void;
  onError: (err: Error) => void;
  /** v2.18 — ICE verdict: 'ice-failed' when neither a direct nor a relayed path could be
   *  negotiated (typically UDP blocked with no turns:443 relay); null once a later attempt
   *  connects. Viewers turn it into an honest "blocked" message instead of endless waiting. */
  onIceState?: (state: 'ice-failed' | null) => void;
}

/**
 * Guest — player-side P2P session participant.
 *
 * Connects to the GM's PeerJS peer ID (room code).
 * Falls back to LocalChannel automatically if the page was opened
 * by window.open() from the GM (same origin, no network needed).
 */
export class Guest {
  /** v2.18 — custom ICE servers for this guest (from the join URL). Set before connect(). */
  private iceServers: IceServerEntry[] | null = null;
  setIceServers(servers: IceServerEntry[] | null): void { this.iceServers = servers; }

  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private local: LocalChannel;
  private events: GuestEvents;

  // Blob reassembly state
  private blobChunks: ArrayBuffer[] = [];
  private blobTotal = 0;
  private pendingMsg: GMMessage | null = null;

  // Auto-reconnect state
  private _destroyed = false;
  private _reconnectCode: string | null = null;
  private _reconnectAttempt = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** v2.12.x — set to true the first time a message arrives via
   *  LocalChannel (BroadcastChannel). BroadcastChannel only works
   *  within the same browser, so a single message from the GM via
   *  this path proves the Player is running in the same browser as
   *  the GM — i.e. it's a popup on the GM's own machine. Player
   *  views on separate devices (real player at the table on a phone,
   *  laptop on the LAN, etc.) connect via PeerJS only and never see
   *  this flag flip. */
  private _isSameMachineSession = false;

  isSameMachineSession(): boolean { return this._isSameMachineSession; }

  /** True when the PeerJS DataConnection is currently up. False if it never
   *  opened, was torn down, or hasn't been created yet. Used by PlayerApp's
   *  visibility-resume watchdog to decide whether to force a reconnect. */
  isConnectionOpen(): boolean { return !!this.conn?.open; }

  constructor(events: GuestEvents) {
    this.events = events;
    this.local = new LocalChannel();

    // Listen for state updates pushed by the GM (fog/filter/view changes)
    this.local.onMessage((msg) => {
      this._isSameMachineSession = true;
      // BroadcastChannel uses structured cloning — mapBlob arrives inside the msg object.
      // Extract it so PlayerApp receives it via the standard (msg, mapBlob) signature.
      if (msg.type === 'full_state' || msg.type === 'map_change' || msg.type === 'handout_reveal' || msg.type === 'video_bundle') {
        const blob = (msg as { mapBlob?: ArrayBuffer }).mapBlob;
        const { mapBlob: _stripped, ...cleanMsg } = msg as typeof msg & { mapBlob?: ArrayBuffer };
        void _stripped;
        this.events.onMessage(cleanMsg as GMMessage, blob);
      } else {
        this.events.onMessage(msg);
      }
    });

    // Request the current full state immediately — the GM responds via LocalChannel.
    // This is instant for local windows (no PeerJS broker needed).
    this.local.requestState();
  }

  /** Connect to a GM via their room code (PeerJS peer ID) */
  connect(roomCode: string): void {
    this._reconnectCode    = roomCode;
    this._reconnectAttempt = 0;
    this._doConnect(roomCode);
  }

  /**
   * v2.17.16 — Same-browser-only connect. Skips the PeerJS loopback
   * entirely and rides on LocalChannel (BroadcastChannel) alone.
   *
   * The GM's own Player View (PiP iframe / pop-out, `?gmPreview=1`) is
   * always in the same browser as the GM, so BroadcastChannel already
   * delivers every state update reliably. The redundant loopback WebRTC
   * channel, by contrast, gets suspended by browser background-throttling
   * the moment the GM focuses the main window (Chrome especially), which
   * tore the connection down + reconnected every few seconds — spamming
   * "connection not open" errors on the GM and dropping the odd marker
   * move. Dropping PeerJS for previews removes that whole failure mode.
   *
   * Fires onConnected on a microtask so the caller's identify / hello
   * flow runs exactly as it would on a real PeerJS open.
   */
  connectLocalOnly(): void {
    this._reconnectCode = null;     // no peer to reconnect to
    this._reconnectAttempt = 0;
    this._isSameMachineSession = true;
    this._teardownPeer();           // ensure no stray loopback peer lingers
    this.local.requestState();      // (re)ask in case the GM mounted late
    void Promise.resolve().then(() => {
      if (this._destroyed) return;
      this.events.onConnected();
    });
  }

  /**
   * Send a message upstream to the GM. Goes through both LocalChannel
   * (instant for same-browser windows) and the PeerJS connection (for
   * remote players). Cheap to double-send: GM dedups by message identity
   * via inbound type discrimination on its own state.
   *
   * Important: we JSON.stringify before conn.send. PeerJS is configured with
   * serialization: 'raw' (so it doesn't second-guess our packing of map
   * blobs), which means it passes whatever we give it straight to
   * RTCDataChannel.send — and that only accepts strings / ArrayBuffer.
   * Without stringifying, a plain JS object hits the data channel as an
   * unsupported type and throws silently, so the GM never sees upstream
   * messages from remote (network-only) players. Matches the Host's
   * symmetric sendTo, which stringifies on the way out too.
   */
  send(msg: GMMessage): void {
    this.local.sendUpstream(msg);
    if (this.conn?.open) {
      try { this.conn.send(JSON.stringify(msg)); }
      catch (err) { console.warn('[guest] upstream send failed', err); }
    }
  }

  destroy(): void {
    this._destroyed     = true;
    this._reconnectCode = null;
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this.local.destroy();
    this._teardownPeer();
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private _doConnect(roomCode: string): void {
    this._teardownPeer();
    this._resetBlobState();

    // v2.18 — BYO STUN/TURN (custom prepended to PeerJS defaults) so a locked-down network
    // can still relay over TLS on 443. Read from the URL (?ice=) so it is known BEFORE dialling.
    const cfg = peerConfigFor(this.iceServers);
    const peer = cfg ? new Peer({ config: cfg }) : new Peer();
    this.peer = peer;

    peer.on('open', () => {
      if (this._destroyed) return;
      const conn = peer.connect(roomCode, { reliable: true, serialization: 'raw' });
      this.conn = conn;
      this.setupConnection(conn);
      // ICE failure detection on the underlying RTCPeerConnection.
      const watch = () => {
        const pc: RTCPeerConnection | undefined = (conn as any).peerConnection;
        if (!pc) { if (!this._destroyed) setTimeout(watch, 250); return; }
        pc.addEventListener('connectionstatechange', () => {
          if (pc.connectionState === 'failed') this.events.onIceState?.('ice-failed');
          if (pc.connectionState === 'connected') this.events.onIceState?.(null);
        });
      };
      watch();
    });

    peer.on('error', (err) => {
      if (this._destroyed) return;
      // Ignore broker-level noise when the data link is already healthy.
      if (this.conn?.open) return;
      // In reconnect mode, retry on any peer-level error (peer-unavailable etc.)
      if (this._reconnectCode) {
        this._scheduleReconnect();
      } else {
        this.events.onError(err as Error);
      }
    });
  }

  private _teardownPeer(): void {
    try { this.conn?.close(); }   catch { /* ignore */ }
    try { this.peer?.destroy(); } catch { /* ignore */ }
    this.conn = null;
    this.peer = null;
  }

  private _resetBlobState(): void {
    this.blobChunks = [];
    this.blobTotal  = 0;
    this.pendingMsg = null;
  }

  private _scheduleReconnect(): void {
    if (this._destroyed || !this._reconnectCode) return;
    this._reconnectAttempt++;
    // Exponential backoff: 2 s, 4 s, 8 s, 16 s, capped at 30 s
    const delay = Math.min(2000 * Math.pow(2, this._reconnectAttempt - 1), 30_000);
    this.events.onReconnecting?.(this._reconnectAttempt, delay);
    this._reconnectTimer = setTimeout(() => {
      if (this._destroyed || !this._reconnectCode) return;
      this._doConnect(this._reconnectCode);
    }, delay);
  }

  private setupConnection(conn: DataConnection): void {
    conn.on('open', () => {
      if (this._destroyed) return;
      this._reconnectAttempt = 0; // reset backoff on successful connect
      if (this._reconnectTimer !== null) {
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
      }
      this.events.onConnected();
    });

    conn.on('data', (data: unknown) => {
      this.handleData(data);
    });

    conn.on('close', () => {
      if (this._destroyed) return;
      if (this._reconnectCode) {
        this._scheduleReconnect();
      } else {
        this.events.onDisconnected();
      }
    });

    conn.on('error', (err) => {
      if (this._destroyed) return;
      if (this._reconnectCode) {
        this._scheduleReconnect();
      } else {
        this.events.onError(err as Error);
      }
    });
  }

  private handleData(data: unknown): void {
    // Binary chunk — part of an ongoing blob transfer
    if (data instanceof ArrayBuffer) {
      this.blobChunks.push(data);

      if (this.blobChunks.length === this.blobTotal) {
        const assembled = this.assembleBlob();
        const msg = this.pendingMsg;
        this.blobChunks = [];
        this.blobTotal = 0;
        this.pendingMsg = null;
        // Same pattern as full_state / map_change / soundboard_*: hand the
        // assembled bytes to PlayerApp via the blob arg, which then wraps
        // it (URL.createObjectURL etc.) in whatever form fits the consumer.
        // Re-encoding to a base64 data URL here would mirror the GM's input
        // but is needlessly slow on phone CPUs.
        if (msg) this.events.onMessage(msg, assembled);
      }
      return;
    }

    // JSON message
    if (typeof data !== 'string') return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }

    if (parsed['type'] === '__blob_start__') {
      this.blobTotal = parsed['total'] as number;
      this.blobChunks = [];
      return;
    }

    const msg = parsed as unknown as GMMessage;

    // If a blob follows, hold until assembled.
    // map blobs: full_state / map_change / handout_reveal / video_bundle
    // audio blobs: soundboard_play / soundboard_asset / positional_play
    // icon blobs: player_icon_update (PNG bytes for the player's token image)
    if (
      (msg.type === 'full_state'
       || msg.type === 'map_change'
       || msg.type === 'handout_reveal'
       || msg.type === 'video_bundle'
       || msg.type === 'soundboard_play'
       || msg.type === 'soundboard_asset'
       || msg.type === 'positional_play'
       || msg.type === 'player_icon_update')
      && this.blobTotal > 0
    ) {
      this.pendingMsg = msg;
      return;
    }

    this.events.onMessage(msg);
  }

  private assembleBlob(): ArrayBuffer {
    const total = this.blobChunks.reduce((sum, c) => sum + c.byteLength, 0);
    const buffer = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.blobChunks) {
      buffer.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }
    return buffer.buffer;
  }
}

