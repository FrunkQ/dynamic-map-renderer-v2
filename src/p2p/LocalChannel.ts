import type { GMMessage } from '../types.ts';

// Two channels: one for GM→Player state, one for Player→GM requests.
// Using separate channels avoids a tab receiving its own broadcasts.
const GM_TO_PLAYER  = 'dmr-state';
const PLAYER_TO_GM  = 'dmr-request';

interface LocalRequest {
  type: 'request_state';
}

/** Anything sent on the Player-to-GM channel: either a request_state ping or
 *  a full GMMessage from a peer (e.g. projector_hello). */
type PeerToGm = LocalRequest | GMMessage;

/**
 * LocalChannel — BroadcastChannel wrapper for same-browser communication.
 *
 * GM side:
 *   - call send() to push state updates to any open player windows
 *   - call onRequest() to be notified when a player window opens and needs state
 *
 * Player side:
 *   - call onMessage() to receive state updates from GM
 *   - call requestState() immediately on open — GM responds with full_state
 *
 * Works completely offline. Zero latency. Used in parallel with PeerJS so
 * local windows get updates instantly without broker round-trip.
 */
export class LocalChannel {
  private outbound  = new BroadcastChannel(GM_TO_PLAYER);
  private inbound   = new BroadcastChannel(PLAYER_TO_GM);

  private msgListeners:      ((msg: GMMessage) => void)[]     = [];
  private reqListeners:      ((req: LocalRequest) => void)[]  = [];
  private peerMsgListeners:  ((msg: GMMessage) => void)[]     = [];

  /**
   * clientId → last-seen timestamp (performance.now() ms). Players sending
   * player_heartbeat messages over BroadcastChannel land here. The GM
   * counts entries newer than HEARTBEAT_STALE_MS as live local players.
   * BC has no inherent presence mechanism, so this is how we know
   * same-machine player windows are still around.
   */
  private heartbeats = new Map<string, number>();
  private static readonly HEARTBEAT_STALE_MS = 10_000;

  constructor() {
    // Listen for incoming peer-to-GM messages (GM side). Splits into
    // request_state pings, player heartbeats, and full GMMessages from
    // connected peers.
    this.inbound.addEventListener('message', (e: MessageEvent<PeerToGm>) => {
      const data = e.data;
      const kind = (data as { type?: string }).type;
      if (kind === 'player_heartbeat') {
        const id = (data as { clientId?: string }).clientId;
        if (id) this.heartbeats.set(id, performance.now());
        return;
      }
      if (kind === 'request_state') {
        for (const fn of this.reqListeners) fn(data as LocalRequest);
      } else {
        for (const fn of this.peerMsgListeners) fn(data as GMMessage);
      }
    });

    // Listen for incoming state messages (Player side)
    this.outbound.addEventListener('message', (e: MessageEvent<GMMessage>) => {
      for (const fn of this.msgListeners) fn(e.data);
    });
  }

  /**
   * Number of distinct same-machine players whose heartbeat arrived
   * within the last HEARTBEAT_STALE_MS. Reading this also prunes stale
   * entries so the map stays bounded.
   */
  get localPlayerCount(): number {
    const cutoff = performance.now() - LocalChannel.HEARTBEAT_STALE_MS;
    let count = 0;
    for (const [id, t] of this.heartbeats) {
      if (t < cutoff) this.heartbeats.delete(id);
      else count++;
    }
    return count;
  }

  // ─── GM side ─────────────────────────────────────────────────────────────

  /** Broadcast a state update to all open player windows */
  send(msg: GMMessage): void {
    this.outbound.postMessage(msg);
  }

  /** Register a callback for when a player window requests the current state */
  onRequest(fn: (req: LocalRequest) => void): () => void {
    this.reqListeners.push(fn);
    return () => { this.reqListeners = this.reqListeners.filter((l) => l !== fn); };
  }

  /** Register a callback for incoming peer GMMessages (e.g. projector_hello). */
  onPeerMessage(fn: (msg: GMMessage) => void): () => void {
    this.peerMsgListeners.push(fn);
    return () => { this.peerMsgListeners = this.peerMsgListeners.filter((l) => l !== fn); };
  }

  // ─── Player side ─────────────────────────────────────────────────────────

  /** Ask the GM for the current full state. Call once on player page load. */
  requestState(): void {
    this.inbound.postMessage({ type: 'request_state' } satisfies LocalRequest);
  }

  /** Send an upstream GMMessage to the GM (e.g. projector_hello). */
  sendUpstream(msg: GMMessage): void {
    this.inbound.postMessage(msg);
  }

  /** Register a callback for incoming state messages from GM */
  onMessage(fn: (msg: GMMessage) => void): () => void {
    this.msgListeners.push(fn);
    return () => { this.msgListeners = this.msgListeners.filter((l) => l !== fn); };
  }

  destroy(): void {
    this.outbound.close();
    this.inbound.close();
    this.msgListeners = [];
    this.reqListeners = [];
  }
}
