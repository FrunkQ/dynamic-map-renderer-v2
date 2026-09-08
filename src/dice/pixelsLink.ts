/**
 * pixelsLink (v2.19.8) — physical Pixels dice, mirrored onto the table.
 *
 * LAZY: this module (and the library it pulls in) is only ever fetched when
 * someone actually asks to connect dice, so nobody who does not own a set pays
 * for it. Import it with `await import('./pixelsLink.ts')`, never statically.
 *
 * Written against Systemic's Pixels Developer's Guide, which is mostly a list
 * of ways wireless goes wrong. The rules it gives that shaped this file:
 *
 *   - CONNECT WITH `repeatConnect`, never `connect`. Windows reports a
 *     peripheral as disconnected about four seconds before the die itself
 *     notices, so a prompt reconnect attempt fails; repeatConnect backs off and
 *     retries. Connecting takes seconds, so the caller is told it is happening.
 *   - NEVER trust `pixel.status` as a pre-flight check — it is the LAST KNOWN
 *     status and the die may drop the instant after. Always try/catch instead.
 *   - LISTEN for `status` and react: a disconnection while listening for rolls
 *     is otherwise completely silent, and the player is left wondering why
 *     their dice stopped working.
 *   - NO POPUPS on failure. The tray says what happened, in place.
 *   - ALWAYS leave a way to roll without the dice. When nothing is connected
 *     the on-screen chips come back by themselves.
 *   - A die talks to ONE device at a time, so while Mappadux holds it the
 *     Pixels app cannot, and vice versa. We let go on page hide.
 *   - Re-rolls are surfaced, not swallowed: a bumped die that changes the
 *     result must say so, or the screen and the table disagree.
 *
 * What this does NOT do, on purpose: it does not ARM anything (throw the dice,
 * the roll appears), and it does not drive the LEDs — a die runs its own on-die
 * profile, configured in the Pixels app.
 *
 * Requirements, failing closed and silently: Web Bluetooth (Chromium only — no
 * iOS, no Firefox) in a SECURE CONTEXT.
 */

import {
  RollCollector, sidesForDieType, isPhysicalDiceSupported, type PhysicalFace,
} from './physicalRoll.ts';
import type { RollOutcome } from './roll.ts';
import { getKnownPixels, rememberPixels } from '../storage/localSettings.ts';

export type DieConnection = 'connecting' | 'ready' | 'lost';

export interface ConnectedDie {
  /** The die's own id — stable, and how a roll is attributed. */
  id: string;
  /** The id the OS gave it, which is what silent reconnection needs. */
  systemId: string;
  name: string;
  /** "d20", "d6" … as the die reports itself. */
  dieType: string;
  sides: number | 'F';
  status: DieConnection;
}

export interface PixelsLinkOptions {
  /** A handful has been thrown and the table has gone quiet. */
  onRoll: (outcome: RollOutcome, dice: ConnectedDie[]) => void;
  /** Dice are landing and we are still waiting for the rest of the handful. */
  onCollecting?: (faces: { count: number; rerolled: string | null }) => void;
  /** Any change to what is connected, including a die dropping out. */
  onDiceChanged?: (dice: ConnectedDie[]) => void;
}

/** Minimal shape we rely on, so the library's types never leak past here. */
interface PixelLike {
  pixelId: number | string;
  systemId: string;
  name: string;
  dieType?: string;
  dieFaceCount?: number;
  disconnect: () => Promise<unknown>;
  addEventListener: (event: string, handler: (value: never) => void) => void;
}

interface Entry { pixel: PixelLike; info: ConnectedDie; releasing: boolean }

export class PixelsLink {
  private dice = new Map<string, Entry>();
  private collector: RollCollector;
  private onPageHide = () => void this.release();

  constructor(private opts: PixelsLinkOptions) {
    this.collector = new RollCollector({
      onComplete: (faces) => this._report(faces),
      onProgress: (faces, event) => opts.onCollecting?.({
        count: faces.length,
        rerolled: event?.rerolled ? this.dice.get(event.dieId)?.info.name ?? 'A die' : null,
      }),
    });
    // A die belongs to one device at a time: let go when the page goes away, so
    // it is available to the Pixels app (or another window) again.
    try { window.addEventListener('pagehide', this.onPageHide); } catch { /* no window */ }
  }

  get connected(): ConnectedDie[] {
    return [...this.dice.values()].map((d) => d.info);
  }

  /** Is anything actually listening right now? The tray shows its chips again
   *  when nothing is, so there is always a way to roll. */
  get hasLiveDie(): boolean {
    return [...this.dice.values()].some((d) => d.info.status === 'ready');
  }

  /** Whether dice authorised in an EARLIER session can be reconnected without
   *  the chooser. Chrome only does that with its new permissions backend. */
  async canReconnectSilently(): Promise<boolean> {
    if (!isPhysicalDiceSupported()) return false;
    try {
      const { getBluetoothCapabilities } = await import('@systemic-games/pixels-web-connect');
      return getBluetoothCapabilities().persistentPermissions === true;
    } catch { return false; }
  }

  /**
   * Ask for one die. The browser's own chooser appears, so this MUST be called
   * from a click. Called once per die: several dice, several taps.
   */
  async addDie(): Promise<ConnectedDie | null> {
    if (!isPhysicalDiceSupported()) return null;
    const { requestPixel } = await import('@systemic-games/pixels-web-connect');
    // requestPixel returns the SAME instance for a die chosen twice, so a
    // double tap cannot produce a duplicate.
    const pixel = (await requestPixel()) as unknown as PixelLike;
    if (!pixel) return null;
    return this._adopt(pixel);
  }

  /**
   * Reconnect dice this browser already knows about, with no chooser and no
   * tap. Silent by design — a die that is off or out of range simply does not
   * come back, and the player still has the chips.
   */
  async reconnectKnown(): Promise<void> {
    if (!isPhysicalDiceSupported()) return;
    const known = getKnownPixels();
    if (known.length === 0) return;
    const { getPixel } = await import('@systemic-games/pixels-web-connect');
    for (const entry of known) {
      if ([...this.dice.values()].some((d) => d.info.systemId === entry.systemId)) continue;
      try {
        const pixel = (await getPixel(entry.systemId)) as unknown as PixelLike | undefined;
        if (pixel) await this._adopt(pixel);
      } catch { /* not authorised any more, or not around */ }
    }
  }

  /** Let a die go, on purpose. It becomes available to the Pixels app again. */
  async removeDie(id: string): Promise<void> {
    const entry = this.dice.get(id);
    if (!entry) return;
    entry.releasing = true;                 // so the status event does not fight us
    this.dice.delete(id);
    this._remember();
    this.opts.onDiceChanged?.(this.connected);
    try { await entry.pixel.disconnect(); } catch { /* already gone */ }
  }

  /** Try a lost die again, on the player's say-so. */
  async retry(id: string): Promise<void> {
    const entry = this.dice.get(id);
    if (entry) await this._connect(entry);
  }

  /** Throw away a half-collected handful — a knock, or a change of mind. */
  cancelPending(): void {
    this.collector.cancel();
    this.opts.onCollecting?.({ count: 0, rerolled: null });
  }

  /** Hand every die back. */
  async release(): Promise<void> {
    this.collector.cancel();
    const all = [...this.dice.values()];
    for (const d of all) d.releasing = true;
    this.dice.clear();
    this.opts.onDiceChanged?.([]);
    for (const d of all) { try { await d.pixel.disconnect(); } catch { /* already gone */ } }
  }

  async destroy(): Promise<void> {
    try { window.removeEventListener('pagehide', this.onPageHide); } catch { /* no window */ }
    await this.release();
  }

  // ─── internals ───────────────────────────────────────────────────────────

  /** Take a Pixel instance, wire it up, and get it connected. */
  private async _adopt(pixel: PixelLike): Promise<ConnectedDie | null> {
    const id = String(pixel.pixelId);
    const existing = this.dice.get(id);
    if (existing) { await this._connect(existing); return existing.info; }

    const entry: Entry = {
      pixel,
      releasing: false,
      info: {
        id,
        systemId: pixel.systemId,
        name: pixel.name || 'die',
        dieType: pixel.dieType ?? '',
        sides: sidesForDieType(pixel.dieType, pixel.dieFaceCount),
        status: 'connecting',
      },
    };
    this.dice.set(id, entry);
    this.opts.onDiceChanged?.(this.connected);

    // "roll" fires when the die has SETTLED on a face; the rolling state is of
    // no interest, since a roll only exists once it has stopped.
    pixel.addEventListener('roll', ((value: number) => {
      this.collector.add({ dieId: id, sides: entry.info.sides, value });
    }) as never);

    // A disconnection is otherwise SILENT: roll events simply stop arriving and
    // the player is left wondering. Say so, and try to get it back.
    pixel.addEventListener('status', ((status: string) => {
      if (status === 'ready') {
        entry.info.status = 'ready';
        entry.info.sides = sidesForDieType(pixel.dieType, pixel.dieFaceCount);
        entry.info.name = pixel.name || entry.info.name;
        this._remember();
        this.opts.onDiceChanged?.(this.connected);
      } else if (status === 'disconnected' || status === 'disconnecting') {
        if (entry.releasing || !this.dice.has(id)) return;   // we asked for this
        entry.info.status = 'lost';
        this.opts.onDiceChanged?.(this.connected);
        void this._connect(entry);                            // unasked-for: get it back
      }
    }) as never);

    await this._connect(entry);
    return entry.info;
  }

  /**
   * `repeatConnect`, never `connect`: it backs off and retries, which is the
   * documented workaround for Windows announcing a disconnection about four
   * seconds before the die acts on it. Failure is reported in the tray, not in
   * a dialog box.
   */
  private async _connect(entry: Entry): Promise<void> {
    entry.info.status = 'connecting';
    this.opts.onDiceChanged?.(this.connected);
    try {
      const { repeatConnect } = await import('@systemic-games/pixels-web-connect');
      await repeatConnect(entry.pixel as never);
      entry.info.status = 'ready';
      this._remember();
    } catch {
      // Out of range, out of battery, or held by another app. The player can
      // ask again, and the on-screen dice are still there in the meantime.
      entry.info.status = 'lost';
    }
    this.opts.onDiceChanged?.(this.connected);
  }

  /** So a returning player does not have to pick their dice again. */
  private _remember(): void {
    rememberPixels(this.connected.map((d) => ({ systemId: d.systemId, name: d.name })));
  }

  private _report(faces: PhysicalFace[]): void {
    this.opts.onCollecting?.({ count: 0, rerolled: null });
    void import('./physicalRoll.ts').then(({ outcomeFor }) => {
      const outcome = outcomeFor(faces);
      if (!outcome) return;
      const used = faces
        .map((f) => this.dice.get(f.dieId)?.info)
        .filter((d): d is ConnectedDie => !!d);
      this.opts.onRoll(outcome, used);
    });
  }
}
