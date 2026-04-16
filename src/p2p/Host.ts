import Peer, { type DataConnection } from 'peerjs';
import type { GMMessage, SessionState } from '../types.ts';
import { LocalChannel } from './LocalChannel.ts';

const CHUNK_SIZE = 16 * 1024; // 16 KB — safe DataChannel message size

export interface HostEvents {
  onPeerConnected: (peerId: string) => void;
  onPeerDisconnected: (peerId: string) => void;
  onError: (err: Error) => void;
  onReady: (roomCode: string) => void;
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
  private connections = new Map<string, DataConnection>();
  private local: LocalChannel;
  private events: HostEvents;
  private lastState: SessionState | null = null;
  private lastMapBlob: ArrayBuffer | null = null;

  constructor(events: HostEvents) {
    this.events = events;
    this.local = new LocalChannel();
  }

  /** Start the host. Pass a previously persisted peerId to attempt resumption. */
  start(peerId?: string): void {
    const peer = peerId ? new Peer(peerId) : new Peer();
    this.peer = peer;

    peer.on('open', (id) => {
      this.events.onReady(id);
    });

    peer.on('connection', (conn) => {
      this.handleConnection(conn);
    });

    peer.on('error', (err) => {
      this.events.onError(err as Error);
    });
  }

  get roomCode(): string | null {
    return this.peer?.id ?? null;
  }

  get connectedCount(): number {
    return this.connections.size;
  }

  /** Broadcast a message to all network peers AND the local window channel */
  broadcast(msg: GMMessage): void {
    this.local.send(msg);

    // Cache latest state + blob for new joiners
    if (msg.type === 'full_state') {
      this.lastState = msg.payload;
      if (msg.mapBlob) this.lastMapBlob = msg.mapBlob;
    }
    if (msg.type === 'map_change') {
      this.lastMapBlob = msg.mapBlob;
    }

    for (const conn of this.connections.values()) {
      this.sendTo(conn, msg);
    }
  }

  /** Update the cached state (call whenever GM state changes) */
  updateState(state: SessionState, mapBlob?: ArrayBuffer): void {
    this.lastState = state;
    if (mapBlob) this.lastMapBlob = mapBlob;
  }

  destroy(): void {
    this.local.destroy();
    for (const conn of this.connections.values()) conn.close();
    this.peer?.destroy();
    this.peer = null;
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private handleConnection(conn: DataConnection): void {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      this.events.onPeerConnected(conn.peer);

      // Send full state snapshot to new joiner
      if (this.lastState) {
        const msg: GMMessage = this.lastMapBlob
          ? { type: 'full_state', payload: this.lastState, mapBlob: this.lastMapBlob }
          : { type: 'full_state', payload: this.lastState };
        this.sendTo(conn, msg);
      }
    });

    conn.on('close', () => {
      this.connections.delete(conn.peer);
      this.events.onPeerDisconnected(conn.peer);
    });

    conn.on('error', (err) => {
      this.events.onError(err as Error);
      this.connections.delete(conn.peer);
    });
  }

  private sendTo(conn: DataConnection, msg: GMMessage): void {
    // PeerJS handles chunking internally for binary data, but we still
    // serialise as JSON + separate binary to keep the protocol clean.
    const { mapBlob, ...rest } = msg as { mapBlob?: ArrayBuffer } & GMMessage;

    conn.send(JSON.stringify(rest));

    if (mapBlob && mapBlob.byteLength > 0) {
      this.sendBlob(conn, mapBlob);
    }
  }

  private sendBlob(conn: DataConnection, blob: ArrayBuffer): void {
    const total = Math.ceil(blob.byteLength / CHUNK_SIZE);
    conn.send(JSON.stringify({ type: '__blob_start__', total }));

    for (let i = 0; i < total; i++) {
      const chunk = blob.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      conn.send(chunk);
    }
  }
}
