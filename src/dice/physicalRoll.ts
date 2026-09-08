/**
 * physicalRoll (v2.19.5) — turning real dice landing on a real table into the
 * same roll everything else in Mappadux already understands.
 *
 * PURE: no Bluetooth in here (that is pixelsLink.ts), so the part with the
 * rules in it can be tested without hardware.
 *
 * The model is a MIRROR, not a controller. Nothing is armed, nothing is asked
 * for: dice get thrown, and a moment later the roll appears on screen exactly
 * as a tapped one would — same lanes, same colours, same whisper rules, same
 * sentence in the GM's feed. A physical die also runs its own light show off
 * its on-die profile, which is none of our business.
 *
 * The only real problem is that a thrown SET arrives as separate events, one
 * die at a time. So the first die to land opens a window, each further die
 * extends it, and when the table goes quiet the whole handful is reported as
 * one roll.
 */

import type { DieResult, RollOutcome } from './roll.ts';

/**
 * Can physical dice work here at all? Web Bluetooth is Chromium-only (no iOS,
 * no Firefox) and needs a SECURE CONTEXT — a player who joined over a LAN
 * address rather than the https site is not in one. Asked before anything is
 * offered, so nobody is shown a button that could only disappoint them.
 */
export function isPhysicalDiceSupported(): boolean {
  try {
    return typeof navigator !== 'undefined'
      && 'bluetooth' in navigator
      && typeof window !== 'undefined'
      && window.isSecureContext === true;
  } catch { return false; }
}

/** One physical die, as reported when it settles. */
export interface PhysicalFace {
  /** Stable per die, so a die nudged twice in one window counts once. */
  dieId: string;
  sides: number | 'F';
  value: number;
}

/** How long the table has to stay quiet before a handful counts as thrown. */
export const QUIET_MS = 1800;
/** However long the fidgeting goes on, a roll is reported by now. */
export const MAX_MS = 6000;

/**
 * "1d20+2d6" — what the handful amounts to, biggest dice first, so the roll
 * reads the way a person would say it. Fate dice group as dF.
 */
export function formulaFor(faces: PhysicalFace[]): string {
  const counts = new Map<string, number>();
  for (const f of faces) {
    const key = f.sides === 'F' ? 'F' : String(f.sides);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => (b[0] === 'F' ? -1 : a[0] === 'F' ? 1 : Number(b[0]) - Number(a[0])))
    .map(([sides, n]) => `${n}d${sides}`)
    .join('+');
}

/** The handful as a roll: same shape a tapped chip produces. */
export function outcomeFor(faces: PhysicalFace[]): RollOutcome | null {
  if (faces.length === 0) return null;
  const dice: DieResult[] = faces.map((f) => ({ sides: f.sides, value: f.value }));
  return {
    formula: formulaFor(faces),
    dice,
    modifier: 0,
    total: dice.reduce((sum, d) => sum + d.value, 0),
  };
}

export interface RollCollectorOptions {
  /** The handful is complete. */
  onComplete: (faces: PhysicalFace[]) => void;
  /**
   * A die landed and the window is open — for the "collecting…" state.
   * `rerolled` means this die had already landed and has been thrown again:
   * the guide is firm that a bumped die must be SEEN to change the result,
   * or the screen and the table disagree and the player trusts neither.
   */
  onProgress?: (faces: PhysicalFace[], event?: { dieId: string; rerolled: boolean }) => void;
  quietMs?: number;
  maxMs?: number;
}

/**
 * Gathers dice as they settle. A die reported twice in one window keeps its
 * LAST face: picking one up and dropping it again should correct the roll, not
 * add to it.
 */
export class RollCollector {
  private faces = new Map<string, PhysicalFace>();
  private quietTimer: ReturnType<typeof setTimeout> | null = null;
  private capTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly quietMs: number;
  private readonly maxMs: number;

  constructor(private opts: RollCollectorOptions) {
    this.quietMs = opts.quietMs ?? QUIET_MS;
    this.maxMs = opts.maxMs ?? MAX_MS;
  }

  get pending(): PhysicalFace[] { return [...this.faces.values()]; }
  get isCollecting(): boolean { return this.faces.size > 0; }

  add(face: PhysicalFace): void {
    const first = this.faces.size === 0;
    const rerolled = this.faces.has(face.dieId);
    this.faces.set(face.dieId, face);
    this.opts.onProgress?.(this.pending, { dieId: face.dieId, rerolled });

    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = setTimeout(() => this._complete(), this.quietMs);
    // The cap is set once, by the FIRST die: a table that never quite settles
    // still reports its roll rather than collecting forever.
    if (first) this.capTimer = setTimeout(() => this._complete(), this.maxMs);
  }

  /** Drop what has been collected — a knock, or the player changing their mind. */
  cancel(): void {
    this._stopTimers();
    this.faces.clear();
  }

  private _complete(): void {
    const faces = this.pending;
    this._stopTimers();
    this.faces.clear();
    if (faces.length > 0) this.opts.onComplete(faces);
  }

  private _stopTimers(): void {
    if (this.quietTimer) { clearTimeout(this.quietTimer); this.quietTimer = null; }
    if (this.capTimer) { clearTimeout(this.capTimer); this.capTimer = null; }
  }
}

/**
 * A Pixels die type as this app sees it. `d00` is the percentile tens die: its
 * faces read 00..90 and it is meant to be added to a d10, which the plain sum
 * already does correctly.
 */
export function sidesForDieType(dieType: string | undefined, faceCount: number | undefined): number | 'F' {
  const t = (dieType ?? '').toLowerCase();
  if (t.includes('fudge') || t.includes('fate')) return 'F';
  if (t === 'd00') return 100;
  if (typeof faceCount === 'number' && faceCount >= 2) return faceCount;
  const m = t.match(/^d(\d+)$/);
  return m ? Number(m[1]) : 6;
}
