/**
 * pixelsLink (v2.19.5) — physical Pixels dice, mirrored onto the table.
 *
 * LAZY: this module (and the library it pulls in) is only ever fetched when
 * someone actually asks to connect dice, so nobody who does not own a set pays
 * for it. Import it with `await import('./pixelsLink.ts')`, never statically.
 *
 * What this does NOT do, on purpose:
 *   - It does not ARM anything. A die is thrown, and the roll appears. There is
 *     no chip to press first: the dice replace the tray for whoever owns them.
 *   - It does not drive the LEDs. A Pixels die runs its own on-die profile when
 *     it lands (`profileHash` is a property OF THE DIE), so its light show is
 *     configured in the Pixels app and is none of our business.
 *
 * Everything downstream is untouched: a physical roll becomes the same
 * `dice_roll` a tapped chip sends, and gets the same lanes, colours, whisper
 * rules and feed sentence.
 *
 * Requirements, all of which fail closed and silently: Web Bluetooth (Chromium
 * only — no iOS, no Firefox) in a SECURE CONTEXT. Players who join over the
 * https site are fine; a LAN address (http://192.168.x.x) is not a secure
 * context and pairing is never offered there.
 */

import {
  RollCollector, sidesForDieType, isPhysicalDiceSupported, type PhysicalFace,
} from './physicalRoll.ts';
import type { RollOutcome } from './roll.ts';

export interface ConnectedDie {
  id: string;
  name: string;
  /** "d20", "d6" … as the die reports itself. */
  dieType: string;
  sides: number | 'F';
}

export interface PixelsLinkOptions {
  /** A handful has been thrown and the table has gone quiet. */
  onRoll: (outcome: RollOutcome, dice: ConnectedDie[]) => void;
  /** Dice landed and we are still waiting for the rest. */
  onCollecting?: (count: number) => void;
  /** The set of connected dice changed. */
  onDiceChanged?: (dice: ConnectedDie[]) => void;
}

/** Minimal shape we rely on, so the library's types never leak past here. */
interface PixelLike {
  pixelId: number | string;
  name: string;
  dieType?: string;
  dieFaceCount?: number;
  connect: () => Promise<unknown>;
  disconnect: () => Promise<unknown>;
  addEventListener: (event: string, handler: (value: never) => void) => void;
}

export class PixelsLink {
  private dice = new Map<string, { pixel: PixelLike; info: ConnectedDie }>();
  private collector: RollCollector;

  constructor(private opts: PixelsLinkOptions) {
    this.collector = new RollCollector({
      onComplete: (faces) => this._report(faces),
      ...(opts.onCollecting ? { onProgress: (faces) => opts.onCollecting!(faces.length) } : {}),
    });
  }

  get connected(): ConnectedDie[] {
    return [...this.dice.values()].map((d) => d.info);
  }

  /**
   * Ask for one die. The browser's own chooser appears, so this MUST be called
   * from a click — a player picks their die from the list and it stays paired
   * for this origin. Called once per die: several dice, several taps.
   */
  async addDie(): Promise<ConnectedDie | null> {
    if (!isPhysicalDiceSupported()) return null;
    const { requestPixel } = await import('@systemic-games/pixels-web-connect');
    const pixel = (await requestPixel()) as unknown as PixelLike;
    if (!pixel) return null;
    await pixel.connect();

    const id = String(pixel.pixelId);
    const info: ConnectedDie = {
      id,
      name: pixel.name || 'die',
      dieType: pixel.dieType ?? '',
      sides: sidesForDieType(pixel.dieType, pixel.dieFaceCount),
    };

    // "roll" fires when the die has SETTLED on a face — the rolling state is of
    // no interest here, since the roll only exists once it has stopped.
    pixel.addEventListener('roll', ((value: number) => {
      this.collector.add({ dieId: id, sides: info.sides, value });
    }) as never);

    this.dice.set(id, { pixel, info });
    this.opts.onDiceChanged?.(this.connected);
    return info;
  }

  /** Let a die go — it returns to the Pixels app, or to sleep. */
  async removeDie(id: string): Promise<void> {
    const entry = this.dice.get(id);
    if (!entry) return;
    this.dice.delete(id);
    this.opts.onDiceChanged?.(this.connected);
    try { await entry.pixel.disconnect(); } catch { /* already gone */ }
  }

  /** Throw away a half-collected handful — a knock, or a change of mind. */
  cancelPending(): void {
    this.collector.cancel();
    this.opts.onCollecting?.(0);
  }

  async destroy(): Promise<void> {
    this.collector.cancel();
    const all = [...this.dice.values()];
    this.dice.clear();
    for (const d of all) { try { await d.pixel.disconnect(); } catch { /* already gone */ } }
  }

  private _report(faces: PhysicalFace[]): void {
    this.opts.onCollecting?.(0);
    // Built here rather than imported at the top so the pure module stays the
    // only place that knows how a handful becomes a roll.
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
