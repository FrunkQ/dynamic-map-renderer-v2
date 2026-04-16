import { Guest } from '../p2p/Guest.ts';
import { Renderer } from '../rendering/Renderer.ts';
import { filterRegistry } from '../filters/FilterRegistry.ts';
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
  private guest!: Guest;
  private statusEl!: HTMLElement;
  private connectPanel!: HTMLElement;
  private roomInput!: HTMLInputElement;

  async init(): Promise<void> {
    this.renderer = new Renderer(
      document.querySelector<HTMLCanvasElement>('#renderer-canvas')!
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
    switch (msg.type) {
      case 'full_state': {
        if (mapBlob) this.renderer.loadMap(mapBlob);
        this.renderer.setFilter(msg.payload.filter);
        this.renderer.updateFog(msg.payload.fog);
        this.renderer.setView(msg.payload.view);
        this.setStatus('');
        break;
      }

      case 'map_change': {
        if (mapBlob) {
          this.applyTransition(msg.transition, () => {
            this.renderer.loadMap(mapBlob);
          });
        }
        break;
      }

      case 'filter_update': {
        this.applyTransition(msg.transition, () => {
          this.renderer.setFilter(msg.payload);
        });
        break;
      }

      case 'fog_update': {
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

  private applyTransition(
    transition: TransitionConfig | undefined,
    applyChange: () => void
  ): void {
    if (!transition || transition.type === 'none' || transition.duration === 0) {
      applyChange();
      return;
    }

    const canvas = document.querySelector<HTMLCanvasElement>('#renderer-canvas')!;
    const overlay = document.querySelector<HTMLElement>('#transition-overlay')!;

    overlay.style.transition = `opacity ${transition.duration / 2}ms ease-in`;
    overlay.style.opacity = '1';

    setTimeout(() => {
      applyChange();
      overlay.style.transition = `opacity ${transition.duration / 2}ms ease-out`;
      overlay.style.opacity = '0';
    }, transition.duration / 2);

    void canvas; // suppress unused warning
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
