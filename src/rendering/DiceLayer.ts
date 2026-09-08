/**
 * DiceLayer (v2.19) — where a roll is SHOWN: player views, the GM's own canvas,
 * and the table screen.
 *
 * Two ways to show one, chosen per recipient by the policy (see
 * src/dice/dicePolicy.ts), never by this class:
 *   full — the dice are THROWN across the surface, bounce off the edges a
 *          couple of times, and come to rest where they fall, with the total
 *          caught up under them. They sit for a few seconds and fade.
 *   line — a small transient line in a corner. Enough to follow someone else's
 *          roll without it taking over your screen.
 *
 * SCREEN SPACE, not map space. PingLayer is map-anchored because a ping means a
 * place; dice mean a person, and belong to the surface. Anchoring them to the
 * map would have them swim when the GM pans, and on a calibrated projector they
 * could land in the letterbox, off the physical table.
 *
 * The faces are NEVER decided here, and neither is the throw: the result was
 * settled before anything moved, and the path is generated from a seed
 * (dicePath.ts). All the animation has to do is look like a roll.
 */

import { critOf, type CelebrateDirection, type RollOutcome } from '../dice/roll.ts';
import { buildDie, type DieElement } from './dieShapes.ts';
import { skinFor } from './dieColors.ts';
import { bouncePath, captionSpot, type Point } from './dicePath.ts';
import { resolveDiceRender } from '../storage/localSettings.ts';

export interface DiceShow {
  rollId: string;
  label: string;
  outcome: RollOutcome;
  /** Who rolled it — one throw per person on screen at a time. */
  rollerKey: string;
  rollerName: string;
  rollerColor: string;
  whisper?: boolean;
  /** What the dice are MADE of. Defaults to the roller's own colour — at a real
   *  table you know whose dice those are before you read them. The GM's arrive
   *  with their own (black and gold, unless the pack says otherwise). */
  skin?: { base: string; ink?: string };
  /** Which way is up for this game: a roll-under system celebrates a 1. */
  celebrate?: CelebrateDirection;
}

/** How long a `line` sits before fading. Long enough to read across a table. */
const LINE_MS = 7000;
/** The throw: long enough to watch, short enough not to hold up the table. */
const THROW_MS = 900;
const TUMBLE_STEP_MS = 60;
/**
 * How long LANDED dice sit before they fade away. They are a moment, not a
 * record: the evidence lives in the GM's feed as a sentence
 * ("1+2+2=5 (on 3d6 [3-18])"), which is where anyone looks afterwards.
 * The table screen holds them longer — it is the shared surface, and people
 * look up at it a beat after the roll rather than during it.
 */
const LINGER_MS = 7000;
const LINGER_TABLE_MS = 12000;
/** The fade itself; mirrored by the CSS transition on .is-leaving. */
const FADE_MS = 600;
/** Throws on screen at once; the oldest is retired when a new roller arrives. */
const MAX_LANES = 4;
/** Nominal surface, for a layer not laid out yet (hidden, or a test). */
const FALLBACK_SURFACE = { width: 640, height: 420 };

export class DiceLayer {
  private lanes = new Map<string, HTMLElement>();
  /** The tumble running in each throw. Rolling again before the last one lands
   *  must STOP it: it holds the old dice, and its finish would mark the new
   *  roll settled early — dice sitting still while their numbers flicker. */
  private tumbles = new Map<string, ReturnType<typeof setInterval>>();
  /** The fade waiting on each throw. Rolling again must CANCEL it outright — a
   *  fade that fires afterwards would sweep away the throw that replaced it. */
  private fades = new Map<string, ReturnType<typeof setTimeout>[]>();
  private lineHost: HTMLElement;
  private laneHost: HTMLElement;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private reduced = false;
  private readonly lingerMs: number;
  private readonly mode: 'viewer' | 'table';
  private seq = 0;

  /** `mode` sizes things — a table screen is read from across a room — and sets
   *  how long dice sit there before fading. */
  constructor(private root: HTMLElement, mode: 'viewer' | 'table') {
    this.mode = mode;
    this.lingerMs = mode === 'table' ? LINGER_TABLE_MS : LINGER_MS;
    this.root.classList.add('dice-layer', `dice-layer--${mode}`);
    this.laneHost = document.createElement('div');
    this.laneHost.className = 'dice-lanes';
    this.lineHost = document.createElement('div');
    this.lineHost.className = 'dice-lines';
    this.root.append(this.laneHost, this.lineHost);
    try { this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* old browser */ }
  }

  /** The dice, thrown across the surface — and then staying where they land. */
  showFull(d: DiceShow): void {
    const lane = this._lane(d);
    lane.replaceChildren();

    const style = resolveDiceRender();
    lane.classList.toggle('is-plain', style === 'plain');

    // One skin for the hand: facet tones and ink, derived once.
    const skin = skinFor(d.skin?.base ?? d.rollerColor, d.skin?.ink);
    lane.style.setProperty('--die-base', skin.base);
    lane.style.setProperty('--die-hi', skin.hi);
    lane.style.setProperty('--die-mid', skin.mid);
    lane.style.setProperty('--die-lo', skin.lo);
    lane.style.setProperty('--die-ink', skin.ink);
    lane.style.setProperty('--roller-color', d.rollerColor);

    const faces = document.createElement('div');
    faces.className = 'dice-faces';
    lane.append(faces);

    const surface = this._surface();
    const dieSize = this.mode === 'table' ? 54 : 30;
    const inset = this.mode === 'table'
      ? { top: 16, right: 16, bottom: 48, left: 16 }
      // Clear of the dice tray along the bottom, and of the chrome up top.
      : { top: 44, right: 16, bottom: 84, left: 16 };

    const throwSeed = ++this.seq * 977;
    const dieEls: DieElement[] = [];
    const paths: Point[][] = [];
    for (let i = 0; i < d.outcome.dice.length; i++) {
      const die = d.outcome.dice[i]!;
      const built = buildDie(die.sides, faceText(die.sides, die.value), die.dropped === true, style, throwSeed + i);
      // A burst die reads past its own maximum, which would otherwise look like
      // a mistake; the dashed rim says it went off.
      if ((die.burst ?? 0) > 0) built.el.classList.add('die--burst');
      built.el.style.width = `${dieSize}px`;
      built.el.style.height = `${dieSize}px`;
      const path = bouncePath({ ...surface, dieSize, seed: throwSeed + i * 31, inset });
      built.el.style.transform = _at(path.at(-1)!);
      faces.append(built.el);
      dieEls.push(built);
      paths.push(path);
    }

    const caption = this._caption(d);
    lane.append(caption);
    const rests = paths.map((p) => p.at(-1)!);
    const spot = captionSpot(rests, {
      ...surface, dieSize, captionWidth: 150, bottomInset: inset.bottom,
    });
    caption.style.transform = `translate(${Math.round(spot.x)}px, ${Math.round(spot.y)}px) translateX(-50%)`;

    if (d.whisper) lane.classList.add('is-whisper');

    if (this.reduced || dieEls.length === 0) {
      this._land(lane, dieEls, d);
      return;
    }

    // The throw itself. Web Animations rather than CSS keyframes, because the
    // waypoints are generated per die: the browser composites it, and there is
    // no stylesheet to inject. Where it is unavailable the dice are simply
    // already where they landed.
    for (let i = 0; i < dieEls.length; i++) {
      const el = dieEls[i]!.el;
      const path = paths[i]!;
      if (typeof el.animate !== 'function') continue;
      el.animate(
        path.map((p) => ({ transform: _at(p) })),
        { duration: THROW_MS, easing: 'cubic-bezier(.16,.85,.3,1)', fill: 'none' },
      );
    }

    // Faces flicker while the dice are in the air, then land on the ones we
    // were given. Timed by the CLOCK, not by counting ticks: a browser
    // throttles timers in a hidden tab to about one a second, and a player who
    // looks away mid-roll must come back to dice that landed.
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
      if (elapsed >= THROW_MS) {
        clearInterval(spin);
        this.tumbles.delete(d.rollerKey);
        for (let i = 0; i < dieEls.length; i++) dieEls[i]!.setValue(finals[i]!);
        this._land(lane, dieEls, d);
      }
    }, TUMBLE_STEP_MS);
    this.tumbles.set(d.rollerKey, spin);
  }

  /**
   * The dice have landed. Mark the best and worst faces — only NOW, because a
   * flare during the throw would fire on every face flickering past — show the
   * total, and start the clock on the fade.
   */
  private _land(lane: HTMLElement, dieEls: DieElement[], d: DiceShow): void {
    lane.classList.add('is-settled');
    const totalEl = lane.querySelector<HTMLElement>('.dice-lane-total');
    if (totalEl) totalEl.textContent = _totalText(d.outcome);

    const counted = d.outcome.dice.filter((die) => !die.dropped);
    const direction: CelebrateDirection = d.celebrate ?? 'high';
    let good = 0, bad = 0;
    for (let i = 0; i < dieEls.length; i++) {
      const crit = critOf(d.outcome.dice[i]!, direction);
      dieEls[i]!.setCrit(crit);
      if (crit === 'good') good++;
      if (crit === 'bad') bad++;
    }
    // Every die at its best (or worst) is a different event from one of them
    // being lucky, and the throw says so rather than the dice repeating it.
    if (counted.length > 0 && good === counted.length) lane.classList.add('is-allgood');
    if (counted.length > 0 && bad === counted.length) lane.classList.add('is-allbad');
    // A pool that came up mostly ones is its own kind of bad news.
    if (d.outcome.pool?.glitch && direction !== 'off') lane.classList.add('is-glitch');
    this._fadeAfter(lane, d.rollerKey);
  }

  /** Dice are a moment; the feed keeps the record. */
  private _fadeAfter(lane: HTMLElement, rollerKey: string): void {
    const pending: ReturnType<typeof setTimeout>[] = [];
    const go = setTimeout(() => {
      lane.classList.add('is-leaving');
      const gone = setTimeout(() => {
        lane.remove();
        this.lanes.delete(rollerKey);
        this.fades.delete(rollerKey);
      }, FADE_MS);
      pending.push(gone);
    }, this.lingerMs);
    pending.push(go);
    this.fades.set(rollerKey, pending);
  }

  /** Stop a throw fading — it has just been rolled into again. */
  private _cancelFade(rollerKey: string): void {
    const pending = this.fades.get(rollerKey);
    if (!pending) return;
    for (const t of pending) clearTimeout(t);
    this.fades.delete(rollerKey);
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
    total.textContent = _totalText(d.outcome);

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
    for (const pending of this.fades.values()) for (const t of pending) clearTimeout(t);
    this.fades.clear();
    this.lanes.clear();
    this.laneHost.replaceChildren();
    this.lineHost.replaceChildren();
  }

  destroy(): void {
    this.clear();
    this.root.replaceChildren();
  }

  /** The surface a throw crosses. Zero while the layer is hidden or unlaid — a
   *  nominal box then, so the maths still produces sane places. */
  private _surface(): { width: number; height: number } {
    const rect = this.root.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0
      ? { width: rect.width, height: rect.height }
      : FALLBACK_SURFACE;
  }

  /** Name, what they called it, and the total — parked under the dice. */
  private _caption(d: DiceShow): HTMLElement {
    const caption = document.createElement('div');
    caption.className = 'dice-caption';

    const name = document.createElement('span');
    name.className = 'dice-lane-name';
    name.textContent = d.rollerName;
    name.style.color = d.rollerColor;

    const label = document.createElement('span');
    label.className = 'dice-lane-label';
    label.textContent = d.label;

    const total = document.createElement('span');
    total.className = 'dice-lane-total';
    total.textContent = '…';

    caption.append(name, label, total);
    return caption;
  }

  /** One throw per roller, so two people rolling at once do not collide. */
  private _lane(d: DiceShow): HTMLElement {
    const running = this.tumbles.get(d.rollerKey);
    if (running !== undefined) { clearInterval(running); this.tumbles.delete(d.rollerKey); }
    this._cancelFade(d.rollerKey);
    const existing = this.lanes.get(d.rollerKey);
    if (existing) {
      // Rolling again catches a fading throw and brings it back.
      existing.classList.remove(
        'is-settled', 'is-whisper', 'is-leaving', 'is-allgood', 'is-allbad', 'is-glitch');
      return existing;
    }
    const lane = document.createElement('div');
    lane.className = 'dice-lane';
    lane.style.setProperty('--roller-color', d.rollerColor);
    this.laneHost.appendChild(lane);
    this.lanes.set(d.rollerKey, lane);
    // Retire the oldest throw once the table is crowded.
    while (this.lanes.size > MAX_LANES) {
      const oldestKey = this.lanes.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.lanes.get(oldestKey)?.remove();
      this.lanes.delete(oldestKey);
      const stale = this.tumbles.get(oldestKey);
      if (stale !== undefined) { clearInterval(stale); this.tumbles.delete(oldestKey); }
      this._cancelFade(oldestKey);
    }
    return lane;
  }
}

/** A sum, or a count of hits when the roll was a pool. */
function _totalText(outcome: RollOutcome): string {
  if (!outcome.pool) return String(outcome.total);
  return `${outcome.total} ${outcome.total === 1 ? 'hit' : 'hits'}`;
}

/** Where a die sits, as a transform. */
function _at(p: Point): string {
  return `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) rotate(${Math.round(p.rot)}deg)`;
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
