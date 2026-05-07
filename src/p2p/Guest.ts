import Peer, { type DataConnection } from 'peerjs';
import type { GMMessage } from '../types.ts';
import { LocalChannel } from './LocalChannel.ts';

export interface GuestEvents {
  onMessage: (msg: GMMessage, mapBlob?: ArrayBuffer) => void;
  onConnected: () => void;
  onDisconnected: () => void;
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

  constructor(events: GuestEvents) {
    this.events = events;
    this.local = new LocalChannel();

    // Listen for state updates pushed by the GM (fog/filter/view changes)
    this.local.onMessage((msg) => {
      // BroadcastChannel uses structured cloning — mapBlob arrives inside the msg object.
      // Extract it so PlayerApp receives it via the standard (msg, mapBlob) signature.
      if (msg.type === 'full_state' || msg.type === 'map_change') {
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
    const peer = new Peer();
    this.peer = peer;

    peer.on('open', () => {
      const conn = peer.connect(roomCode, { reliable: true, serialization: 'raw' });
      this.conn = conn;
      this.setupConnection(conn);
    });

    peer.on('error', (err) => {
      // Ignore background peer-level errors (broker reconnects, ICE noise, etc.)
      // if a DataConnection is already open and working — the data link is fine.
      if (this.conn?.open) return;
      this.events.onError(err as Error);
    });
  }

  destroy(): void {
    this.local.destroy();
    this.conn?.close();
    this.peer?.destroy();
    this.peer = null;
    this.conn = null;
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private setupConnection(conn: DataConnection): void {
    conn.on('open', () => {
      this.events.onConnected();
    });

    conn.on('data', (data: unknown) => {
      this.handleData(data);
    });

    conn.on('close', () => {
      this.events.onDisconnected();
    });

    conn.on('error', (err) => {
      this.events.onError(err as Error);
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
    // map blobs: full_state / map_change  |  audio blobs: soundboard_play / soundboard_asset / positional_play
    if ((msg.type === 'full_state' || msg.type === 'map_change' || msg.type === 'soundboard_play' || msg.type === 'soundboard_asset' || msg.type === 'positional_play') && this.blobTotal > 0) {
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
