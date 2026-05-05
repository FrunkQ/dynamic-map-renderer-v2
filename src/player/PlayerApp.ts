import { Guest } from '../p2p/Guest.ts';
import { Renderer } from '../rendering/Renderer.ts';
import { filterRegistry } from '../filters/FilterRegistry.ts';
import { TransitionEngine } from '../transitions/TransitionEngine.ts';
import { transitionRegistry } from '../transitions/TransitionRegistry.ts';
import type { GMMessage, TransitionConfig } from '../types.ts';

/**
 * PlayerApp — top-level orchestrator for the player view.
 *
 * Reads the room code from the URL fragment (#roomcode).
 * If the fragment is absent or empty, waits for a room code input.
 * Connects via P2P Guest (BroadcastChannel for local window, PeerJS for network).
 * Applies all incoming state updates to the Renderer.
 */
export class PlayerApp {
  private renderer!: Renderer;
  private transitionEngine!: TransitionEngine;
  private guest!: Guest;
  private statusEl!: HTMLElement;
  private connectPanel!: HTMLElement;
  private roomInput!: HTMLInputElement;
  /** Tracks which map ID the player is currently showing (or loading). */
  private currentMapId: string | null = null;
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
    this.renderer = new Renderer(
      document.querySelector<HTMLCanvasElement>('#renderer-canvas')!,
      { preserveDrawingBuffer: true },
    );
    this.transitionEngine = new TransitionEngine(
      document.querySelector<HTMLCanvasElement>('#transition-canvas')!,
    );
    this.renderer.start();

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
  }

  // ─── P2P ──────────────────────────────────────────────────────────────────

  private connect(roomCode: string): void {
    this.setStatus('Connecting…');

    this.guest = new Guest({
      onConnected:    () => this.setStatus('Connected'),
      onDisconnected: () => this.setStatus('Disconnected — waiting for GM…'),
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
        this.currentMapId = msg.payload.map?.id ?? null;
        if (mapBlob) {
          // loadMap stores fog and redraws after texture decode — no separate updateFog needed.
          this.renderer.loadMap(mapBlob, msg.payload.fog);
        } else {
          // No map blob (e.g. fresh session with no maps loaded yet) — still sync fog state.
          this.renderer.updateFog(msg.payload.fog);
        }
        this.renderer.setFilter(msg.payload.filter);
        this.renderer.setView(msg.payload.view);
        this.setStatus('');
        break;
      }

      case 'map_change': {
        // Update currentMapId immediately so any fog_update arriving before
        // the texture finishes loading is evaluated against the new map.
        this.currentMapId = msg.payload.id;
        if (mapBlob) {
          // fog, filter, and view all travel atomically inside map_change.
          // They are applied inside triggerChange() so the transition snapshot
          // captures the OLD state and only the new state appears at the reveal.
          const fog    = msg.fog    ?? { polygons: [] };
          const filter = msg.filter;
          const view   = msg.view;
          const blob   = mapBlob;
          void this.runTransition(msg.transition, () => {
            this.renderer.loadMap(blob, fog);
            if (filter) this.renderer.setFilter(filter);
            if (view)   this.renderer.setView(view);
          });
        }
        break;
      }

      case 'filter_update': {
        this.renderer.setFilter(msg.payload);
        break;
      }

      case 'fog_update': {
        // Safety net: discard fog updates for a different map.
        // With seq deduplication the BC+PeerJS race is already prevented, but
        // this guard catches any edge case where mapId doesn't match.
        if (msg.mapId && msg.mapId !== this.currentMapId) break;
        this.renderer.updateFog(msg.payload);
        break;
      }

      case 'view_update': {
        this.renderer.setView(msg.payload);
        break;
      }

      // Stubs — logged but not yet acted on
      case 'marker_update':
      case 'audio_update':
        break;
    }
  }

  // ─── Transitions ──────────────────────────────────────────────────────────

  private async runTransition(
    config: TransitionConfig | undefined,
    applyChange: () => void,
  ): Promise<void> {
    const id  = config?.transitionId ?? 'none';
    const def = transitionRegistry.getOrFallback(id);
    const params = config?.params ?? transitionRegistry.defaultParams(id);
    const canvas = document.querySelector<HTMLCanvasElement>('#renderer-canvas')!;
    await this.transitionEngine.run(def, params, canvas, applyChange);
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
