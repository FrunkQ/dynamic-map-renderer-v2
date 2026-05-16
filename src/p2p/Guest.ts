import Peer, { type DataConnection } from 'peerjs';
import type { GMMessage } from '../types.ts';
import { LocalChannel } from './LocalChannel.ts';

export interface GuestEvents {
  onMessage: (msg: GMMessage, mapBlob?: ArrayBuffer) => void;
  onConnected: () => void;
  onDisconnected: () => void;
  /** Fired when a disconnect is detected and a reconnect attempt is scheduled. */
  onReconnecting?: (attempt: number, delayMs: number) => void;
  onError: (err: Error) => void;
}

/**
 * Guest — player-side P2P session participant.
 *
 * Connects to the GM's PeerJS peer ID (room code).
 * Falls back to LocalChannel automatically if the page was opened
 * by window.open() from the GM (same origin, no network needed).
 */
export class Guest {
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

  constructor(events: GuestEvents) {
    this.events = events;
    this.local = new LocalChannel();

    // Listen for state updates pushed by the GM (fog/filter/view changes)
    this.local.onMessage((msg) => {
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
   * Send a message upstream to the GM. Goes through both LocalChannel
   * (instant for same-browser windows) and the PeerJS connection (for
   * remote players). Cheap to double-send: GM dedups by message identity
   * via inbound type discrimination on its own state.
   */
  send(msg: GMMessage): void {
    this.local.sendUpstream(msg);
    if (this.conn?.open) this.conn.send(msg);
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

    const peer = new Peer();
    this.peer = peer;

    peer.on('open', () => {
      if (this._destroyed) return;
      const conn = peer.connect(roomCode, { reliable: true, serialization: 'raw' });
      this.conn = conn;
      this.setupConnection(conn);
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
    if (
      (msg.type === 'full_state'
       || msg.type === 'map_change'
       || msg.type === 'handout_reveal'
       || msg.type === 'video_bundle'
       || msg.type === 'soundboard_play'
       || msg.type === 'soundboard_asset'
       || msg.type === 'positional_play')
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
