/**
 * DiceLayer (v2.19) — where a roll is SHOWN: player views, and the table screen.
 *
 * Two ways to show one, chosen per recipient by the policy (see
 * src/dice/dicePolicy.ts), never by this class:
 *   full — the dice tumble and land, and STAY. A table screen should behave
 *          like a table: dice sit there until that person rolls again.
 *   line — a small transient line in a corner. Enough to follow someone else's
 *          roll without it taking over your screen.
 *
 * SCREEN SPACE, not map space. PingLayer is map-anchored because a ping means a
 * place; dice mean a person, and belong to the surface. Anchoring them to the
 * map would have them swim when the GM pans, and on a calibrated projector they
 * could land in the letterbox, off the physical table.
 *
 * The faces are NEVER decided here. They arrive already rolled and this only
 * animates its way to them — otherwise the table screen lands on 17 while the
 * GM's feed says 12.
 */

import type { RollOutcome } from '../dice/roll.ts';
import { buildDie, type DieElement } from './dieShapes.ts';

export interface DiceShow {
  rollId: string;
  label: string;
  outcome: RollOutcome;
  /** Who rolled it — one lane per person. */
  rollerKey: string;
  rollerName: string;
  rollerColor: string;
  whisper?: boolean;
}

/** How long a `line` sits before fading. Long enough to read across a table. */
const LINE_MS = 7000;
/** The tumble. Short: this is the fast, simple version, not a physics toy. */
const TUMBLE_MS = 550;
const TUMBLE_STEP_MS = 60;
/** Lanes on screen at once; the oldest is retired when a new roller arrives. */
const MAX_LANES = 4;

export class DiceLayer {
  private lanes = new Map<string, HTMLElement>();
  /** The tumble running in each lane. Rolling again before the last one lands
   *  must STOP it: it holds the old dice, and its finish would mark the new
   *  roll settled early — dice sitting still while their numbers flicker. */
  private tumbles = new Map<string, ReturnType<typeof setInterval>>();
  private lineHost: HTMLElement;
  private laneHost: HTMLElement;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private reduced = false;

  /** `mode` only sizes things: a table screen is read from across a room. */
  constructor(private root: HTMLElement, mode: 'viewer' | 'table') {
    this.root.classList.add('dice-layer', `dice-layer--${mode}`);
    this.laneHost = document.createElement('div');
    this.laneHost.className = 'dice-lanes';
    this.lineHost = document.createElement('div');
    this.lineHost.className = 'dice-lines';
    this.root.append(this.laneHost, this.lineHost);
    try { this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* old browser */ }
  }

  /** The dice, rolling — and then staying put until that roller rolls again. */
  showFull(d: DiceShow): void {
    const lane = this._lane(d);
    lane.replaceChildren();

    const name = document.createElement('div');
    name.className = 'dice-lane-name';
    name.textContent = d.rollerName;
    name.style.color = d.rollerColor;

    const label = document.createElement('div');
    label.className = 'dice-lane-label';
    label.textContent = d.label;

    const faces = document.createElement('div');
    faces.className = 'dice-faces';
    const dieEls: DieElement[] = [];
    for (const die of d.outcome.dice) {
      const built = buildDie(die.sides, faceText(die.sides, die.value), die.dropped === true);
      faces.appendChild(built.el);
      dieEls.push(built);
    }

    const total = document.createElement('div');
    total.className = 'dice-lane-total';
    total.textContent = String(d.outcome.total);

    lane.append(name, label, faces, total);
    if (d.whisper) lane.classList.add('is-whisper');

    if (this.reduced || dieEls.length === 0) {
      lane.classList.add('is-settled');
      return;
    }

    // The tumble: flicker plausible faces, then land on the ones we were given.
    // While `is-settled` is absent the dice wobble and a highlight sweeps across
    // them; both are transforms, and the drop shadow only appears once they
    // land, so nothing filters while anything moves.
    // Timed by the CLOCK, not by counting ticks. A browser throttles timers in
    // a hidden tab to about one a second, and a player who looks away mid-roll
    // must come back to dice that landed — not to a tumble still going nine
    // seconds later.
    const finals = d.outcome.dice.map((die) => faceText(die.sides, die.value));
    const startedAt = now();
    const spin: ReturnType<typeof setInterval> = setInterval(() => {
      const elapsed = now() - startedAt;
      for (let i = 0; i < dieEls.length; i++) {
        const die = d.outcome.dice[i]!;
        dieEls[i]!.setValue(die.sides === 'F'
          ? faceText('F', Math.floor(Math.random() * 3) - 1)
          : String(Math.floor(Math.random() * (die.sides as number)) + 1));
      }
      total.textContent = '…';
      if (elapsed >= TUMBLE_MS) {
        clearInterval(spin);
        this.tumbles.delete(d.rollerKey);
        for (let i = 0; i < dieEls.length; i++) dieEls[i]!.setValue(finals[i]!);
        total.textContent = String(d.outcome.total);
        lane.classList.add('is-settled');
      }
    }, TUMBLE_STEP_MS);
    this.tumbles.set(d.rollerKey, spin);
  }

  /** A line: someone else rolled, here is what it came to. Fades by itself. */
  showLine(d: DiceShow): void {
    const line = document.createElement('div');
    line.className = 'dice-line' + (d.whisper ? ' is-whisper' : '');
    line.style.setProperty('--roller-color', d.rollerColor);

    const who = document.createElement('span');
    who.className = 'dice-line-who';
    who.textContent = d.rollerName;
    who.style.color = d.rollerColor;

    const what = document.createElement('span');
    what.className = 'dice-line-what';
    what.textContent = d.label;

    const faces = document.createElement('span');
    faces.className = 'dice-line-faces';
    faces.textContent = d.outcome.dice
      .map((die) => (die.dropped ? `(${faceText(die.sides, die.value)})` : faceText(die.sides, die.value)))
      .join(' ');

    const total = document.createElement('span');
    total.className = 'dice-line-total';
    total.textContent = String(d.outcome.total);

    line.append(who, what, faces, total);
    this.lineHost.appendChild(line);
    // Newest at the bottom; keep the stack short so it never eats the view.
    while (this.lineHost.childElementCount > 5) this.lineHost.firstElementChild?.remove();

    const t = setTimeout(() => {
      line.classList.add('is-leaving');
      const t2 = setTimeout(() => { line.remove(); this.timers.delete(t2); }, 400);
      this.timers.add(t2);
      this.timers.delete(t);
    }, LINE_MS);
    this.timers.add(t);
  }

  /** Sweep the table — the GM clearing up, or leaving the map. */
  clear(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const t of this.tumbles.values()) clearInterval(t);
    this.tumbles.clear();
    this.lanes.clear();
    this.laneHost.replaceChildren();
    this.lineHost.replaceChildren();
  }

  destroy(): void {
    this.clear();
    this.root.replaceChildren();
  }

  /** One lane per roller, so two people rolling at once do not collide. */
  private _lane(d: DiceShow): HTMLElement {
    const running = this.tumbles.get(d.rollerKey);
    if (running !== undefined) { clearInterval(running); this.tumbles.delete(d.rollerKey); }
    const existing = this.lanes.get(d.rollerKey);
    if (existing) {
      existing.classList.remove('is-settled', 'is-whisper');
      return existing;
    }
    const lane = document.createElement('div');
    lane.className = 'dice-lane';
    lane.style.setProperty('--roller-color', d.rollerColor);
    this.laneHost.appendChild(lane);
    this.lanes.set(d.rollerKey, lane);
    // Retire the oldest lane once the table is crowded.
    while (this.lanes.size > MAX_LANES) {
      const oldestKey = this.lanes.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.lanes.get(oldestKey)?.remove();
      this.lanes.delete(oldestKey);
      const stale = this.tumbles.get(oldestKey);
      if (stale !== undefined) { clearInterval(stale); this.tumbles.delete(oldestKey); }
    }
    return lane;
  }
}

/** Monotonic where available; Date.now() is fine as a fallback here. */
function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Fate dice read as +/-/0; everything else is its number. */
function faceText(sides: number | 'F', value: number): string {
  if (sides !== 'F') return String(value);
  return value > 0 ? '+' : value < 0 ? '−' : '0';
}
