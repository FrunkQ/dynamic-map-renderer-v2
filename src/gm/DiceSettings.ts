/**
 * DiceSettings (v2.19.7) — everything about dice EXCEPT rolling them.
 *
 * This lived in the sidebar until v2.19.7, which was the wrong home: it is
 * setup. Once a game is running a GM needs the dice themselves, not the rules
 * about them, and the dice are an overlay on the canvas now. So the sets, the
 * systems, the visibility policy and the colours all moved in here, and the
 * sidebar got its space back.
 *
 * Builds its own markup rather than binding to static HTML, because a settings
 * section is created when the dialog opens and thrown away when it closes.
 */

import type { DiceButton } from '../types.ts';
import { isValidFormula, rangeOf, type CelebrateDirection } from '../dice/roll.ts';
import { asDetail, type DiceDetail, type DicePolicy, type RollAudience } from '../dice/dicePolicy.ts';
import { GM_DIE_BASE, GM_DIE_INK } from '../rendering/dieColors.ts';
import {
  getDiceSet, setDiceSet, getDicePolicy, setDicePolicy, areDiceEnabled, setDiceEnabled,
  isGmDiceTrayShown, setGmDiceTrayShown,
} from '../storage/localSettings.ts';

export interface DiceSettingsOptions {
  /** The set, the permission or the policy changed — viewers need telling. */
  onChanged: () => void;
  /** v2.19.8 — physical dice, if this browser can have them. Setup belongs
   *  here; the live state belongs on the tray, where it is being used. */
  pixels?: {
    supported: boolean;
    /** Why not, when not — so nobody is left guessing. */
    reason?: string;
    list: () => { id: string; name: string; status: 'connecting' | 'ready' | 'lost' }[];
    pair: () => Promise<unknown>;
    forget: (id: string) => Promise<unknown>;
  };
}

interface Preset {
  label: string;
  entries: { label: string; formula: string }[];
  /** Some systems come with their own idea of which way is up. */
  policy?: Partial<DicePolicy>;
  note?: string;
}

/**
 * Ready-made sets, so nobody starts from an empty list — and so the mechanics
 * have worked examples a GM can copy for their own.
 */
const PRESETS: Record<string, Preset> = {
  d20: {
    label: 'd20 — D&D, Pathfinder',
    entries: [
      { label: 'd20',        formula: '1d20' },
      { label: 'Advantage',  formula: '1d20 adv' },
      { label: 'Disadv.',    formula: '1d20 dis' },
      { label: 'd4',         formula: '1d4' },
      { label: 'd6',         formula: '1d6' },
      { label: 'd8',         formula: '1d8' },
      { label: 'd10',        formula: '1d10' },
      { label: 'd12',        formula: '1d12' },
      { label: '2d6',        formula: '2d6' },
      { label: 'Stat',       formula: '4d6 keep 3' },
    ],
  },
  d6pool: {
    label: 'd6 pool',
    entries: [1, 2, 3, 4, 5, 6].map((n) => ({ label: `${n}d6`, formula: `${n}d6` })),
  },
  fate: {
    label: 'Fate / Blades',
    entries: [
      { label: '4dF', formula: '4dF' },
      { label: '1d6', formula: '1d6' },
      { label: '2d6', formula: '2d6' },
      { label: '3d6', formula: '3d6' },
      { label: '4d6', formula: '4d6' },
    ],
  },
  shadowrun: {
    label: 'Shadowrun — hits on 5+',
    entries: [
      { label: 'Pool 6',  formula: '6d6 target 5' },
      { label: 'Pool 8',  formula: '8d6 target 5' },
      { label: 'Pool 10', formula: '10d6 target 5' },
      { label: 'Pool 12', formula: '12d6 target 5' },
      { label: 'Edge 8',  formula: '8d6 burst target 5' },
    ],
    note: 'Counts hits, and calls a glitch when more than half the pool comes up 1.',
  },
  l5r: {
    label: 'Legend of the Five Rings — roll & keep',
    entries: [
      { label: '4k2', formula: '4d10 burst keep 2' },
      { label: '5k3', formula: '5d10 burst keep 3' },
      { label: '6k3', formula: '6d10 burst keep 3' },
      { label: '7k3', formula: '7d10 burst keep 3' },
    ],
  },
  wod: {
    label: 'World of Darkness — successes on 8+',
    entries: [
      { label: 'Pool 5',   formula: '5d10 target 8' },
      { label: 'Pool 8',   formula: '8d10 target 8' },
      { label: '10s again', formula: '8d10 burst target 8' },
    ],
  },
  savage: {
    label: 'Savage Worlds — exploding traits',
    entries: [
      { label: 'd4',   formula: '1d4 burst' },
      { label: 'd6',   formula: '1d6 burst' },
      { label: 'd8',   formula: '1d8 burst' },
      { label: 'd10',  formula: '1d10 burst' },
      { label: 'd12',  formula: '1d12 burst' },
      { label: 'Wild', formula: '1d6 burst' },
    ],
  },
  rollunder: {
    label: 'Roll under — Call of Cthulhu, BRP',
    entries: [
      { label: 'd100', formula: '1d100' },
      { label: 'd10',  formula: '1d10' },
      { label: 'd6',   formula: '1d6' },
    ],
    // The whole point of the system: low is what you want.
    policy: { celebrate: 'low' },
    note: 'Sets celebration to “low is best”, so a 1 is the triumph.',
  },
};

/** The words a formula may use, shown where someone is writing one. */
const VOCABULARY = 'adv · dis · burst · keep 3 · keep low 3 · target 5';

/** What each word does, with something to copy. A GM writing a set should not
 *  have to find documentation to learn their own tool. */
const MECHANICS: { word: string; means: string; example: string }[] = [
  { word: 'adv',        means: 'Roll it twice and keep the higher. The one it beat is shown struck through.', example: '1d20+5 adv' },
  { word: 'dis',        means: 'Roll it twice and keep the lower.', example: '1d20 dis' },
  { word: 'burst',      means: 'A die at its maximum rolls again and ADDS, and keeps going — exploding dice.', example: '1d6 burst' },
  { word: 'keep N',     means: 'Keep the best N dice. The rest stay on screen, struck through.', example: '4d6 keep 3' },
  { word: 'keep low N', means: 'Keep the WORST N instead.', example: '4d6 keep low 1' },
  { word: 'target N',   means: 'A success pool: the result is how many dice reached N, not their sum. Says "glitch" when more than half come up 1.', example: '12d6 target 5' },
];

export function buildDiceSettings(host: HTMLElement, opts: DiceSettingsOptions): void {
  const changed = () => opts.onChanged();
  host.append(
    _permissionRow(changed),
    _gmTrayRow(changed),
    _setEditor(changed),
    _presetRow(changed),
    _mechanicsHelp(),
    _pixelsBlock(host, opts),
    _policyBlock(changed),
  );
}

// ─── Permission ─────────────────────────────────────────────────────────────

function _permissionRow(changed: () => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'settings-danger-row';
  const label = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = 'Let players roll';
  const help = document.createElement('span');
  help.className = 'settings-stat-sub';
  help.textContent =
    'Players get a tray of these rolls on their own screen — one tap is one roll. '
    + 'Off hides it everywhere; your own dice keep working.';
  label.append(title, document.createElement('br'), help);

  const wrap = document.createElement('label');
  wrap.className = 'toggle-switch';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = areDiceEnabled();
  input.addEventListener('change', () => { setDiceEnabled(input.checked); changed(); });
  const slider = document.createElement('span');
  slider.className = 'toggle-slider';
  wrap.append(input, slider);

  row.append(label, wrap);
  return row;
}

/** The GM's own rail, on their own canvas. */
function _gmTrayRow(changed: () => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'settings-danger-row';
  const label = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = 'Show my dice on the map';
  const help = document.createElement('span');
  help.className = 'settings-stat-sub';
  help.textContent =
    'Your own rail along the bottom of the canvas, the same one players get — '
    + 'and where your own Pixels dice pair. Your rolls land there; everyone '
    + 'else\u2019s stay in the feed.';
  label.append(title, document.createElement('br'), help);

  const wrap = document.createElement('label');
  wrap.className = 'toggle-switch';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = isGmDiceTrayShown();
  input.addEventListener('change', () => { setGmDiceTrayShown(input.checked); changed(); });
  const slider = document.createElement('span');
  slider.className = 'toggle-slider';
  wrap.append(input, slider);

  row.append(label, wrap);
  return row;
}

// ─── The set ────────────────────────────────────────────────────────────────

function _setEditor(changed: () => void): HTMLElement {
  const block = document.createElement('div');
  block.className = 'dice-settings-block';

  const intro = document.createElement('p');
  intro.className = 'settings-section-intro';
  intro.textContent =
    'Name the rolls your game asks for. Players tap them; one tap is one roll. '
    + 'The set travels with the pack.';

  const rows = document.createElement('div');
  rows.className = 'dice-rows';

  const addRow = document.createElement('div');
  addRow.className = 'picker-row dice-add-row';
  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.className = 'select-full';
  labelInput.placeholder = 'Attack';
  labelInput.maxLength = 24;
  labelInput.setAttribute('aria-label', 'Roll name');
  const formulaInput = document.createElement('input');
  formulaInput.type = 'text';
  formulaInput.className = 'select-full dice-formula-input';
  formulaInput.placeholder = '1d20+5';
  formulaInput.maxLength = 40;
  formulaInput.setAttribute('aria-label', 'Formula');
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn btn--sm';
  addBtn.textContent = '+';
  addBtn.title = 'Add this roll to the set';
  addRow.append(labelInput, formulaInput, addBtn);

  const vocab = document.createElement('p');
  vocab.className = 'dice-vocab';
  vocab.textContent = `Mechanics: ${VOCABULARY}`;
  vocab.title = 'burst: a die at its maximum rolls again and adds. keep N: keep the best N. '
    + 'target N: count how many dice reached N instead of adding them up.';

  const error = document.createElement('p');
  error.className = 'dice-error';
  error.hidden = true;

  const showError = (message: string | null) => {
    error.hidden = message === null;
    error.textContent = message ?? '';
  };

  const render = () => {
    rows.replaceChildren();
    const set = getDiceSet();
    if (set.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'dice-empty';
      empty.textContent = 'No rolls yet. Add one below, or start from a system.';
      rows.appendChild(empty);
      return;
    }
    for (const entry of set) rows.appendChild(_setRow(entry, () => { render(); changed(); }));
  };

  const add = () => {
    const name = labelInput.value.trim();
    const formula = formulaInput.value.trim();
    if (!name) return showError('Give the roll a name — that is what players tap.');
    if (!isValidFormula(formula)) {
      return showError(`"${formula || 'nothing'}" is not a roll. Try 1d20+5, 4d6 keep 3, or 12d6 target 5.`);
    }
    showError(null);
    setDiceSet([...getDiceSet(), { id: `d${Date.now().toString(36)}${getDiceSet().length}`, label: name, formula }]);
    labelInput.value = ''; formulaInput.value = '';
    labelInput.focus();
    render();
    changed();
  };
  addBtn.addEventListener('click', add);
  for (const input of [labelInput, formulaInput]) {
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  }
  // Say what it will do while it is being typed, not after it is saved.
  formulaInput.addEventListener('input', () => {
    const v = formulaInput.value.trim();
    const ok = v === '' || isValidFormula(v);
    formulaInput.classList.toggle('is-invalid', !ok);
    const range = ok && v ? rangeOf(v) : null;
    vocab.textContent = range
      ? `${v} rolls ${range.min} to ${range.max}${range.open ? '+' : ''}`
      : `Mechanics: ${VOCABULARY}`;
  });

  render();
  block.append(intro, rows, addRow, vocab, error);
  return block;
}

function _setRow(entry: DiceButton, refresh: () => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'dice-row';

  const shown = document.createElement('div');
  shown.className = 'dice-row-roll dice-row-roll--static';
  const name = document.createElement('span');
  name.className = 'dice-row-label';
  name.textContent = entry.label;
  const formula = document.createElement('span');
  formula.className = 'dice-row-formula';
  formula.textContent = entry.formula;
  shown.append(name, formula);

  // A GM entry that reaches the room even while GM rolls are private.
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
    refresh();
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
    refresh();
  });

  row.append(shown, loud, del);
  return row;
}

/** The reference, folded away until someone wants it. */
function _mechanicsHelp(): HTMLElement {
  const details = document.createElement('details');
  details.className = 'dice-policy dice-help';
  const summary = document.createElement('summary');
  summary.textContent = 'How to write a roll';
  details.append(summary);

  const intro = document.createElement('p');
  intro.className = 'settings-section-intro';
  intro.textContent =
    'A roll is dice and a modifier — 2d6, 1d20+5, 1d8+1d6-2, 4dF — followed by '
    + 'any of these words, in any order. They combine: "5d10 burst keep 3" is '
    + 'Legend of the Five Rings, "8d10 burst target 8" is World of Darkness.';
  details.append(intro);

  const list = document.createElement('dl');
  list.className = 'dice-help-list';
  for (const m of MECHANICS) {
    const term = document.createElement('dt');
    term.textContent = m.word;
    const meaning = document.createElement('dd');
    meaning.textContent = m.means;
    const example = document.createElement('code');
    example.className = 'dice-help-example';
    example.textContent = m.example;
    example.title = 'Click to copy into the formula box';
    example.addEventListener('click', () => {
      const input = document.querySelector<HTMLInputElement>('.dice-formula-input');
      if (!input) return;
      input.value = m.example;
      input.dispatchEvent(new Event('input'));
      input.focus();
    });
    meaning.append(document.createElement('br'), example);
    list.append(term, meaning);
  }
  details.append(list);
  return details;
}

/**
 * Physical dice. The PAIRING lives here because it is setup — the question
 * "where do I pair these?" should be answerable from the same place as the rest
 * of the dice settings, not only from a button on the canvas.
 */
function _pixelsBlock(host: HTMLElement, opts: DiceSettingsOptions): HTMLElement {
  const details = document.createElement('details');
  details.className = 'dice-policy dice-pixels';
  const summary = document.createElement('summary');
  summary.textContent = 'Your own dice (Pixels)';
  details.append(summary);

  const intro = document.createElement('p');
  intro.className = 'settings-section-intro';
  intro.innerHTML =
    'Pair a set of <a href="https://gamewithpixels.com/" target="_blank" rel="noopener noreferrer">Pixels</a> '
    + 'electronic dice and throwing them on the actual table puts the roll on screen — the buttons step aside '
    + 'while they are connected. Each player pairs their own, on their own device, from the <strong>My dice</strong> '
    + 'button on their dice tray. A die talks to one device at a time, so while it is paired here the Pixels app '
    + 'cannot have it.';
  details.append(intro);

  const pixels = opts.pixels;
  if (!pixels?.supported) {
    const why = document.createElement('p');
    why.className = 'dice-empty';
    why.textContent = pixels?.reason
      ?? 'Not available on this screen: it needs Chrome, Edge or Android, over the https site '
       + '(a local network address will not do — the browser only allows Bluetooth on a secure connection).';
    details.append(why);
    return details;
  }

  const list = document.createElement('div');
  list.className = 'dice-rows';
  const render = () => {
    list.replaceChildren();
    const dice = pixels.list();
    if (dice.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'dice-empty';
      empty.textContent = 'No dice paired yet.';
      list.append(empty);
      return;
    }
    for (const die of dice) {
      const row = document.createElement('div');
      row.className = 'dice-row';
      const shown = document.createElement('div');
      shown.className = 'dice-row-roll dice-row-roll--static';
      const name = document.createElement('span');
      name.className = 'dice-row-label';
      name.textContent = die.name;
      const status = document.createElement('span');
      status.className = 'dice-row-formula';
      status.textContent = die.status === 'ready' ? 'connected'
        : die.status === 'connecting' ? 'connecting…' : 'not connected';
      shown.append(name, status);

      const forget = document.createElement('button');
      forget.type = 'button';
      forget.className = 'dice-row-delete';
      forget.title = `Disconnect ${die.name}`;
      forget.setAttribute('aria-label', `Disconnect ${die.name}`);
      forget.textContent = '×';
      forget.addEventListener('click', () => { void pixels.forget(die.id).then(render); });

      row.append(shown, forget);
      list.append(row);
    }
  };
  render();
  details.append(list);

  const pair = document.createElement('button');
  pair.type = 'button';
  pair.className = 'btn btn--sm';
  pair.textContent = 'Pair a die…';
  pair.title = 'Your browser will ask which die to connect to';
  pair.addEventListener('click', () => {
    pair.disabled = true;
    pair.textContent = 'Connecting…';
    void pixels.pair().finally(() => {
      pair.disabled = false;
      pair.textContent = 'Pair a die…';
      render();
    });
  });
  details.append(pair);

  const note = document.createElement('p');
  note.className = 'dice-empty';
  note.textContent =
    'Connecting takes a few seconds and can fail if a die is asleep — give it a shake first. '
    + 'Whether a die is connected right now is shown on the tray, where you are using it.';
  details.append(note);

  void host; // the block re-renders itself; the host is only its home
  return details;
}

// ─── Systems ────────────────────────────────────────────────────────────────

function _presetRow(changed: () => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'param-row';
  const label = document.createElement('label');
  label.textContent = 'Start from a system';

  const picker = document.createElement('div');
  picker.className = 'picker-row';
  const select = document.createElement('select');
  select.className = 'select-full picker-row__select';
  const blank = document.createElement('option');
  blank.value = ''; blank.textContent = 'Choose a system…';
  select.append(blank);
  for (const [id, preset] of Object.entries(PRESETS)) {
    const option = document.createElement('option');
    option.value = id; option.textContent = preset.label;
    select.append(option);
  }
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'btn btn--sm btn--ghost';
  apply.textContent = 'Add';
  apply.title = "Add that system's rolls to your set";

  const note = document.createElement('p');
  note.className = 'dice-empty';

  select.addEventListener('change', () => {
    const preset = PRESETS[select.value];
    note.textContent = preset?.note ?? '';
  });

  apply.addEventListener('click', () => {
    const preset = PRESETS[select.value];
    if (!preset) return;
    const set = getDiceSet();
    // Pressing Add twice must not double the set.
    const have = new Set(set.map((d) => d.formula.toLowerCase()));
    let n = 0;
    for (const entry of preset.entries) {
      if (have.has(entry.formula.toLowerCase())) continue;
      set.push({ id: `d${Date.now().toString(36)}${set.length + n++}`, ...entry });
    }
    setDiceSet(set);
    if (preset.policy) setDicePolicy({ ...getDicePolicy(), ...preset.policy });
    changed();
    // The whole section is rebuilt so the new rows and any policy the system
    // brought with it are both on screen.
    const host = row.parentElement;
    if (host) { host.replaceChildren(); buildDiceSettings(host, { onChanged: changed }); }
  });

  picker.append(select, apply);
  row.append(label, picker, note);
  return row;
}

// ─── Who sees what, and which way is up ─────────────────────────────────────

function _policyBlock(changed: () => void): HTMLElement {
  const details = document.createElement('details');
  details.className = 'dice-policy';
  const summary = document.createElement('summary');
  summary.textContent = 'Who sees what';
  details.append(summary);

  const save = (patch: Partial<DicePolicy>) => { setDicePolicy({ ...getDicePolicy(), ...patch }); changed(); };
  const policy = getDicePolicy();

  const select = <T extends string>(
    labelText: string, value: T, options: [T, string][], apply: (v: T) => void,
  ): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'param-row';
    const label = document.createElement('label');
    label.textContent = labelText;
    const el = document.createElement('select');
    el.className = 'select-full';
    for (const [v, text] of options) {
      const option = document.createElement('option');
      option.value = v; option.textContent = text;
      el.append(option);
    }
    el.value = value;
    el.addEventListener('change', () => apply(el.value as T));
    row.append(label, el);
    return row;
  };

  const detailOptions: [DiceDetail, string][] = [
    ['full', 'The dice, rolling'], ['line', 'A line of text'], ['none', 'Nothing'],
  ];

  details.append(
    select<RollAudience>('Player rolls go to', policy.playerRollAudience, [
      ['table', 'The whole table'], ['gm', 'Only me'], ['roller', 'Only the roller'],
    ], (v) => save({ playerRollAudience: v })),
    select<DiceDetail>('Table screen shows', policy.tableDetail, detailOptions,
      (v) => save({ tableDetail: asDetail(v, 'full') })),
    select<DiceDetail>('Other players see', policy.othersDetail, detailOptions,
      (v) => save({ othersDetail: asDetail(v, 'line') })),
    select<string>('The roller sees', policy.rollerDetail, [
      ['auto', 'A line if the table screen has it'], ...detailOptions,
    ], (v) => save({ rollerDetail: v === 'auto' ? 'auto' : asDetail(v, 'full') })),
    select<CelebrateDirection>('Celebrate', policy.celebrate, [
      ['high', 'High rolls are best'], ['low', 'Low rolls are best'], ['off', 'Off'],
    ], (v) => save({ celebrate: v })),
  );

  // The GM's own dice.
  const colours = document.createElement('div');
  colours.className = 'param-row';
  const coloursLabel = document.createElement('label');
  coloursLabel.textContent = 'My dice';
  const pair = document.createElement('div');
  pair.className = 'dice-color-pair';
  const base = document.createElement('input');
  base.type = 'color'; base.className = 'dice-color';
  base.title = 'The body of your dice';
  base.value = policy.gmDieBase ?? GM_DIE_BASE;
  const ink = document.createElement('input');
  ink.type = 'color'; ink.className = 'dice-color';
  ink.title = 'Your numerals';
  ink.value = policy.gmDieInk ?? GM_DIE_INK;
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'btn btn--ghost btn--xs';
  reset.textContent = 'Reset';
  reset.title = 'Back to black and gold';
  base.addEventListener('change', () => save({ gmDieBase: base.value }));
  ink.addEventListener('change', () => save({ gmDieInk: ink.value }));
  reset.addEventListener('click', () => {
    base.value = GM_DIE_BASE; ink.value = GM_DIE_INK;
    save({ gmDieBase: GM_DIE_BASE, gmDieInk: GM_DIE_INK });
  });
  pair.append(base, ink, reset);
  colours.append(coloursLabel, pair);

  const gmPublic = document.createElement('div');
  gmPublic.className = 'param-row param-row--toggle';
  const gmPublicLabel = document.createElement('label');
  gmPublicLabel.textContent = 'My rolls are public';
  const gmPublicWrap = document.createElement('label');
  gmPublicWrap.className = 'toggle-switch';
  const gmPublicInput = document.createElement('input');
  gmPublicInput.type = 'checkbox';
  gmPublicInput.checked = policy.gmRollsPublic;
  gmPublicInput.addEventListener('change', () => save({ gmRollsPublic: gmPublicInput.checked }));
  const gmPublicSlider = document.createElement('span');
  gmPublicSlider.className = 'toggle-slider';
  gmPublicWrap.append(gmPublicInput, gmPublicSlider);
  gmPublic.append(gmPublicLabel, gmPublicWrap);

  const footnote = document.createElement('p');
  footnote.className = 'settings-section-intro';
  footnote.innerHTML =
    'A player’s dice are their own colour, so the table knows whose they are before reading them. '
    + 'Every player can turn their own dice down to lines, or off, on their own device — and whether '
    + 'dice are drawn shaped or as plain numbers is per screen, under Performance.';

  details.append(colours, gmPublic, footnote);
  return details;
}
