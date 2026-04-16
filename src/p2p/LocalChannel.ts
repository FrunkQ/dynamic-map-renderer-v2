import type { GMMessage } from '../types.ts';

const CHANNEL_NAME = 'dmr-local';

/**
 * LocalChannel — BroadcastChannel wrapper for same-browser communication.
 *
 * The GM writes; player windows opened via window.open() read.
 * Works completely offline — no network required.
 */
export class LocalChannel {
  private channel: BroadcastChannel;
  private listeners: ((msg: GMMessage) => void)[] = [];

  constructor() {
    this.channel = new BroadcastChannel(CHANNEL_NAME);
    this.channel.addEventListener('message', (e: MessageEvent<GMMessage>) => {
      for (const fn of this.listeners) fn(e.data);
    });
  }

  send(msg: GMMessage): void {
    this.channel.postMessage(msg);
  }

  onMessage(fn: (msg: GMMessage) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  destroy(): void {
    this.channel.close();
    this.listeners = [];
  }
}
