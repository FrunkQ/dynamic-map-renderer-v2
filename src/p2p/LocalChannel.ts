import type { GMMessage } from '../types.ts';

// Two channels: one for GM→Player state, one for Player→GM requests.
// Using separate channels avoids a tab receiving its own broadcasts.
const GM_TO_PLAYER  = 'dmr-state';
const PLAYER_TO_GM  = 'dmr-request';

interface LocalRequest {
  type: 'request_state';
}

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

  private msgListeners: ((msg: GMMessage) => void)[]     = [];
  private reqListeners: ((req: LocalRequest) => void)[]  = [];

  constructor() {
    // Listen for incoming player requests (GM side)
    this.inbound.addEventListener('message', (e: MessageEvent<LocalRequest>) => {
      for (const fn of this.reqListeners) fn(e.data);
    });

    // Listen for incoming state messages (Player side)
    this.outbound.addEventListener('message', (e: MessageEvent<GMMessage>) => {
      for (const fn of this.msgListeners) fn(e.data);
    });
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

  // ─── Player side ─────────────────────────────────────────────────────────

  /** Ask the GM for the current full state. Call once on player page load. */
  requestState(): void {
    this.inbound.postMessage({ type: 'request_state' } satisfies LocalRequest);
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
