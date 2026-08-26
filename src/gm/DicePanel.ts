/**
 * DicePanel (v2.19) — the GM's side of dice: the SET players tap, and the house
 * rules about who sees a roll.
 *
 * The set is the GM's vocabulary for the game — "Attack", "1d20+5" — because a
 * player at the table should tap one thing, not build a formula. Entries are
 * validated as they are typed, so nothing unrollable ever reaches a tray.
 *
 * Both the set and the policy live in localSettings and travel in the pack.
 * Everything else about dice (who is told, in how much detail) is resolved by
 * src/dice/dicePolicy.ts — this panel only edits the inputs to it.
 */

import type { DiceButton } from '../types.ts';
import { isValidFormula, parseFormula } from '../dice/roll.ts';
import { asDetail, type DiceDetail, type DicePolicy, type RollAudience } from '../dice/dicePolicy.ts';
import { GM_DIE_BASE, GM_DIE_INK } from '../rendering/dieColors.ts';
import {
  getDiceSet, setDiceSet, getDicePolicy, setDicePolicy, areDiceEnabled, setDiceEnabled,
} from '../storage/localSettings.ts';

export interface DicePanelOptions {
  /** The GM rolled one of their own. */
  onRoll: (entry: DiceButton) => void;
  /** The set or the permission changed — viewers need telling. */
  onSetChanged: () => void;
}

/** Ready-made spreads, so no GM starts from an empty list. */
const PRESETS: Record<string, { label: string; formula: string }[]> = {
  d20: [
    { label: 'd20',       formula: '1d20' },
    { label: 'Advantage', formula: '1d20 adv' },
    { label: 'Disadv.',   formula: '1d20 dis' },
    { label: 'd4',        formula: '1d4' },
    { label: 'd6',        formula: '1d6' },
    { label: 'd8',        formula: '1d8' },
    { label: 'd10',       formula: '1d10' },
    { label: 'd12',       formula: '1d12' },
    { label: '2d6',       formula: '2d6' },
  ],
  d6pool: [
    { label: '1d6', formula: '1d6' },
    { label: '2d6', formula: '2d6' },
    { label: '3d6', formula: '3d6' },
    { label: '4d6', formula: '4d6' },
    { label: '5d6', formula: '5d6' },
    { label: '6d6', formula: '6d6' },
  ],
  fate: [
    { label: '4dF', formula: '4dF' },
    { label: '1d6', formula: '1d6' },
    { label: '2d6', formula: '2d6' },
    { label: '3d6', formula: '3d6' },
    { label: '4d6', formula: '4d6' },
  ],
};

export class DicePanel {
  private rows: HTMLElement | null = null;

  constructor(private opts: DicePanelOptions) {}

  /** Bind the markup in index.html. Safe to call once at GM start-up. */
  mount(): void {
    this.rows = document.getElementById('dice-set-rows');

    const enabled = document.getElementById('dice-enabled-toggle') as HTMLInputElement | null;
    if (enabled) {
      enabled.checked = areDiceEnabled();
      enabled.addEventListener('change', () => {
        setDiceEnabled(enabled.checked);
        this.opts.onSetChanged();
      });
    }

    const label = document.getElementById('dice-add-label') as HTMLInputElement | null;
    const formula = document.getElementById('dice-add-formula') as HTMLInputElement | null;
    const addBtn = document.getElementById('dice-add-btn');
    const add = () => {
      if (!label || !formula) return;
      const l = label.value.trim();
      const fm = formula.value.trim();
      if (!l) return this._error('Give the roll a name — that is what players tap.');
      if (!isValidFormula(fm)) return this._error(`"${fm || 'nothing'}" is not a roll. Try 1d20+5, 2d6, or 4dF.`);
      this._error(null);
      const set = getDiceSet();
      set.push({ id: `d${Date.now().toString(36)}${set.length}`, label: l, formula: fm });
      setDiceSet(set);
      label.value = ''; formula.value = '';
      label.focus();
      this._renderRows();
      this.opts.onSetChanged();
    };
    addBtn?.addEventListener('click', add);
    for (const input of [label, formula]) {
      input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    }
    // Live validation: the GM finds out here, not a player at the table.
    formula?.addEventListener('input', () => {
      const v = formula.value.trim();
      formula.classList.toggle('is-invalid', v !== '' && !isValidFormula(v));
    });

    const presetApply = document.getElementById('dice-preset-apply');
    const presetSelect = document.getElementById('dice-preset-select') as HTMLSelectElement | null;
    presetApply?.addEventListener('click', () => {
      const preset = PRESETS[presetSelect?.value ?? ''];
      if (!preset) return;
      const set = getDiceSet();
      // Skip anything already in the set — pressing Add twice must not double it.
      const have = new Set(set.map((d) => d.formula.toLowerCase()));
      let n = 0;
      for (const p of preset) {
        if (have.has(p.formula.toLowerCase())) continue;
        set.push({ id: `d${Date.now().toString(36)}${set.length + n++}`, ...p });
      }
      setDiceSet(set);
      this._renderRows();
      this.opts.onSetChanged();
    });

    this._bindPolicy();
    this._renderRows();
  }

  /** Re-read storage and redraw — after a pack import, for instance. */
  refresh(): void {
    const enabled = document.getElementById('dice-enabled-toggle') as HTMLInputElement | null;
    if (enabled) enabled.checked = areDiceEnabled();
    this._bindPolicy(true);
    this._renderRows();
  }

  private _error(message: string | null): void {
    const el = document.getElementById('dice-add-error');
    if (!el) return;
    el.hidden = message === null;
    el.textContent = message ?? '';
  }

  private _bindPolicy(valuesOnly = false): void {
    const policy = getDicePolicy();
    const bind = <T extends string>(id: string, value: T, apply: (v: T) => void) => {
      const el = document.getElementById(id) as HTMLSelectElement | null;
      if (!el) return;
      el.value = value;
      if (valuesOnly) return;
      el.addEventListener('change', () => { apply(el.value as T); });
    };
    const save = (patch: Partial<DicePolicy>) => setDicePolicy({ ...getDicePolicy(), ...patch });

    bind<RollAudience>('dice-audience', policy.playerRollAudience, (v) => save({ playerRollAudience: v }));
    bind<DiceDetail>('dice-table-detail', policy.tableDetail, (v) => save({ tableDetail: asDetail(v, 'full') }));
    bind<DiceDetail>('dice-others-detail', policy.othersDetail, (v) => save({ othersDetail: asDetail(v, 'line') }));
    bind<string>('dice-roller-detail', policy.rollerDetail, (v) =>
      save({ rollerDetail: v === 'auto' ? 'auto' : asDetail(v, 'full') }));

    // The GM's own dice. Black with gold by default: not one of the players'
    // colours, and it should never read as one.
    const base = document.getElementById('dice-gm-base') as HTMLInputElement | null;
    const ink  = document.getElementById('dice-gm-ink') as HTMLInputElement | null;
    if (base && ink) {
      base.value = policy.gmDieBase ?? GM_DIE_BASE;
      ink.value  = policy.gmDieInk  ?? GM_DIE_INK;
      if (!valuesOnly) {
        base.addEventListener('change', () => save({ gmDieBase: base.value }));
        ink.addEventListener('change', () => save({ gmDieInk: ink.value }));
        document.getElementById('dice-gm-colors-reset')?.addEventListener('click', () => {
          base.value = GM_DIE_BASE; ink.value = GM_DIE_INK;
          save({ gmDieBase: GM_DIE_BASE, gmDieInk: GM_DIE_INK });
        });
      }
    }

    const pub = document.getElementById('dice-gm-public') as HTMLInputElement | null;
    if (pub) {
      pub.checked = policy.gmRollsPublic;
      if (!valuesOnly) pub.addEventListener('change', () => save({ gmRollsPublic: pub.checked }));
    }
  }

  /** One row per entry: roll it, mark it public, throw it away. */
  private _renderRows(): void {
    const host = this.rows;
    if (!host) return;
    host.replaceChildren();
    const set = getDiceSet();
    if (set.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'dice-empty';
      empty.textContent = 'No rolls yet. Add one below, or start from a preset.';
      host.appendChild(empty);
      return;
    }

    for (const entry of set) {
      const row = document.createElement('div');
      row.className = 'dice-row';

      const roll = document.createElement('button');
      roll.type = 'button';
      roll.className = 'dice-row-roll';
      roll.title = `Roll ${entry.formula} yourself`;
      const name = document.createElement('span');
      name.className = 'dice-row-label';
      name.textContent = entry.label;
      const fm = document.createElement('span');
      fm.className = 'dice-row-formula';
      fm.textContent = entry.formula;
      roll.append(name, fm);
      roll.addEventListener('click', () => this.opts.onRoll(entry));

      // A GM entry that reaches the room even while GM rolls are private —
      // the "roll this one out loud" case, per entry rather than per session.
      const loud = document.createElement('button');
      loud.type = 'button';
      loud.className = 'dice-row-public' + (entry.public ? ' is-on' : '');
      loud.textContent = '★';
      loud.title = entry.public
        ? 'Public: the table sees this one even when your rolls are private'
        : 'Private: only you see this one unless your rolls are public';
      loud.setAttribute('aria-pressed', String(!!entry.public));
      loud.addEventListener('click', () => {
        setDiceSet(getDiceSet().map((d) => {
          if (d.id !== entry.id) return d;
          const { public: _wasPublic, ...rest } = d;
          return entry.public ? rest : { ...rest, public: true as const };
        }));
        this._renderRows();
        this.opts.onSetChanged();
      });

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'dice-row-delete';
      del.title = `Remove ${entry.label}`;
      del.setAttribute('aria-label', `Remove ${entry.label}`);
      del.innerHTML =
        '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        + '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/>'
        + '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
      del.addEventListener('click', () => {
        setDiceSet(getDiceSet().filter((d) => d.id !== entry.id));
        this._renderRows();
        this.opts.onSetChanged();
      });

      row.append(roll, loud, del);
      host.appendChild(row);
    }

    // A quiet sanity line: how many dice the biggest entry throws, since that
    // is what a phone has to draw.
    const most = set.reduce((n, d) => Math.max(n, parseFormula(d.formula)?.terms.reduce((s, t) => s + t.count, 0) ?? 0), 0);
    if (most > 12) {
      const note = document.createElement('p');
      note.className = 'dice-empty';
      note.textContent = `Your biggest roll throws ${most} dice — fine as a line, slow to animate on a phone.`;
      host.appendChild(note);
    }
  }
}
