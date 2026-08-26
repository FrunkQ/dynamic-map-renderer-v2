/**
 * PlayerDiceTray (v2.19) — the player's dice, as a rail of chips.
 *
 * One tap is one roll. No dialog, no modifier picker, no dropdown: the GM
 * authored the vocabulary, so advantage and damage are their own chips rather
 * than options hidden inside one. That is the whole interaction, and it is the
 * point — a player at a table should not be operating software.
 *
 * WHISPER is a mode, not a per-chip flag: arm it, and whatever you roll next
 * goes to the GM and nobody else. It resets itself after ten minutes so nobody
 * spends an evening whispering by accident, and it says so when it does — a
 * mode that changes silently would be found out by a secret roll appearing on
 * the table screen.
 */

import type { DiceButton } from '../types.ts';

/** Whisper disarms itself this long after it was last used. */
export const WHISPER_TIMEOUT_MS = 10 * 60 * 1000;

export interface PlayerDiceTrayOptions {
  /** The player tapped a chip. `whisper` is the tray's current mode. */
  onRoll: (entry: DiceButton, whisper: boolean) => void;
  /** Whisper armed / disarmed — the caller says so on screen when it lapses. */
  onWhisperChange?: (armed: boolean, reason: 'user' | 'timeout') => void;
  /** v2.19.5 — the player asked to pair a physical die. Only offered where Web
   *  Bluetooth can actually work. */
  onConnectDice?: () => void;
}

export class PlayerDiceTray {
  private set: DiceButton[] = [];
  private enabled = false;
  /** v2.19.5 — real dice REPLACE the chips for whoever owns them: there is
   *  nothing to tap when the dice are on the table. Every rule stays — whisper
   *  still applies to what you throw next, which is why the toggle stays too. */
  private physicalDice: { id: string; name: string; status?: 'connecting' | 'ready' | 'lost' }[] = [];
  private collecting = 0;
  private rerolled: string | null = null;
  private canPair = false;
  private whisper = false;
  private whisperTimer: ReturnType<typeof setTimeout> | null = null;
  private rail: HTMLElement;

  constructor(private root: HTMLElement, private opts: PlayerDiceTrayOptions) {
    this.root.classList.add('dice-tray');
    this.rail = document.createElement('div');
    this.rail.className = 'dice-tray-rail';
    this.root.appendChild(this.rail);
    this.root.hidden = true;
  }

  /** The GM's set and permission, as they arrive on player_features. */
  update(set: DiceButton[] | undefined, enabled: boolean): void {
    if (set) this.set = set;
    this.enabled = enabled;
    // Losing permission mid-session must also disarm whisper: coming back to a
    // tray that is still secretly armed is exactly the surprise this avoids.
    if (!enabled && this.whisper) this._setWhisper(false, 'timeout');
    this._render();
  }

  get isWhispering(): boolean { return this.whisper; }

  /** Offer pairing at all? False where Web Bluetooth cannot work, and then the
   *  player is never shown a button that would only disappoint them. */
  setPairingAvailable(available: boolean): void {
    this.canPair = available;
    this._render();
  }

  /** The dice this player has on the table now, and how each is doing. */
  setPhysicalDice(dice: { id: string; name: string; status?: 'connecting' | 'ready' | 'lost' }[]): void {
    this.physicalDice = dice;
    this._render();
  }

  /** How many have landed while we wait for the rest of the handful. */
  setCollecting(count: number, rerolled: string | null = null): void {
    if (this.collecting === count && this.rerolled === rerolled) return;
    this.collecting = count;
    this.rerolled = rerolled;
    const status = this.root.querySelector('.dice-physical-status');
    if (status) status.textContent = this._statusText();
    this.root.classList.toggle('is-collecting', count > 0);
  }

  /** Any die actually listening? When none is, the chips come back: there is
   *  always a way to roll, which is what the Pixels guide asks for. */
  private get _hasLiveDie(): boolean {
    return this.physicalDice.some((d) => (d.status ?? 'ready') === 'ready');
  }

  /** Hide the tray without forgetting the set (a StarMap, a hold screen). */
  setVisible(visible: boolean): void {
    if (!visible) { this.root.hidden = true; return; }
    this._render();   // one place decides whether there is anything to show
  }

  destroy(): void {
    if (this.whisperTimer) clearTimeout(this.whisperTimer);
    this.whisperTimer = null;
    this.root.replaceChildren();
  }

  private _render(): void {
    this.rail.replaceChildren();
    // With real dice paired there is nothing to tap, but the tray still has a
    // job: it says the dice are live, and it holds the whisper toggle.
    this.root.hidden = !this.enabled || (this.set.length === 0 && this.physicalDice.length === 0 && !this.canPair);
    this.root.classList.toggle('is-whisper', this.whisper);
    if (this.root.hidden) return;

    // Real dice on the table: the chips go, the status and the rules stay.
    if (this.physicalDice.length > 0 || this.collecting > 0) {
      const status = document.createElement('span');
      status.className = 'dice-physical-status';
      status.textContent = this._statusText();
      this.rail.appendChild(status);
    }

    // Dice that are connecting or lost do not replace the chips: a player must
    // never be left with nothing to roll because their die wandered off.
    for (const entry of this._hasLiveDie ? [] : this.set) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'dice-chip';
      chip.title = `Roll ${entry.formula}`;
      const label = document.createElement('span');
      label.className = 'dice-chip-label';
      label.textContent = entry.label;
      const formula = document.createElement('span');
      formula.className = 'dice-chip-formula';
      formula.textContent = entry.formula;
      chip.append(label, formula);
      chip.addEventListener('click', () => this._roll(entry));
      this.rail.appendChild(chip);
    }

    // The mode toggle sits at the end of the rail and says WHISPER in words:
    // the glow alone would fail anyone colour-blind, or a washed-out screen.
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'dice-whisper-toggle' + (this.whisper ? ' is-on' : '');
    toggle.setAttribute('aria-pressed', String(this.whisper));
    toggle.title = this.whisper
      ? 'Whisper is ON — your next rolls go to the GM only. Tap to stop.'
      : 'Whisper: your rolls go to the GM only, nobody else. Turns itself off after ten minutes.';
    toggle.innerHTML =
      '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<path d="M12 3a4 4 0 0 1 4 4v4a4 4 0 0 1-8 0V7a4 4 0 0 1 4-4z"/><path d="M5 11a7 7 0 0 0 14 0"/><line x1="12" y1="18" x2="12" y2="21"/>'
      + '</svg><span>Whisper</span>';
    toggle.addEventListener('click', () => this._setWhisper(!this.whisper, 'user'));
    this.rail.appendChild(toggle);

    // Pairing lives at the end of the rail, and only where it can work.
    if (this.canPair && this.opts.onConnectDice) {
      const pair = document.createElement('button');
      pair.type = 'button';
      pair.className = 'dice-pair-btn';
      pair.title = this.physicalDice.length > 0
        ? 'Add another of your own dice'
        : 'Use your own Pixels dice instead of these buttons';
      pair.textContent = this.physicalDice.length > 0 ? '+ die' : 'My dice';
      pair.addEventListener('click', () => this.opts.onConnectDice?.());
      this.rail.appendChild(pair);
    }
  }

  private _statusText(): string {
    // A bumped die changing the result has to be seen to do it.
    if (this.rerolled) return `${this.rerolled} rolled again — counting the new one`;
    if (this.collecting > 0) {
      return this.collecting === 1 ? 'A die has landed…' : `${this.collecting} dice landed…`;
    }
    const lost = this.physicalDice.filter((d) => d.status === 'lost');
    const connecting = this.physicalDice.filter((d) => d.status === 'connecting');
    if (connecting.length > 0) return `Connecting to ${connecting[0]!.name}…`;
    // Said in place, never in a dialog — and the chips are back underneath it.
    if (lost.length > 0 && !this._hasLiveDie) return `Lost ${lost[0]!.name} — tap to try again`;
    if (lost.length > 0) return `${lost[0]!.name} dropped out`;
    const live = this.physicalDice.filter((d) => (d.status ?? 'ready') === 'ready').length;
    if (live === 0) return 'No dice connected';
    return live === 1 ? 'Your die is connected — just roll it' : `${live} dice connected — just roll them`;
  }

  private _roll(entry: DiceButton): void {
    this.opts.onRoll(entry, this.whisper);
    // Using it restarts the clock: a run of secret rolls should not lapse
    // halfway through.
    if (this.whisper) this._armWhisperTimer();
  }

  private _setWhisper(on: boolean, reason: 'user' | 'timeout'): void {
    if (this.whisper === on) return;
    this.whisper = on;
    if (on) this._armWhisperTimer();
    else if (this.whisperTimer) { clearTimeout(this.whisperTimer); this.whisperTimer = null; }
    this._render();
    this.opts.onWhisperChange?.(on, reason);
  }

  private _armWhisperTimer(): void {
    if (this.whisperTimer) clearTimeout(this.whisperTimer);
    this.whisperTimer = setTimeout(() => {
      this.whisperTimer = null;
      this._setWhisper(false, 'timeout');
    }, WHISPER_TIMEOUT_MS);
  }
}
