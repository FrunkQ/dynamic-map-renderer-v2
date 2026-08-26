/**
 * MessageThreadPanel — body builder for the per-player message thread
 * side panel. Renders the thread chronologically + a reply composer at
 * the bottom. Lives in the right-edge SidePanel framework (v2.16.35).
 *
 * v2.16.47 first cut: GM ↔ player only. Player ↔ player ambient stream
 * + LLM reply assistant come in patch 2.
 */

import type { ThreadMessage } from './MessageThreads.ts';
import { rangeOf, describeRollSentence } from '../dice/roll.ts';

export interface MessageThreadPanelOptions {
  /** Messages to render (chronological — caller passes them already
   *  ordered from oldest to newest). */
  messages: ThreadMessage[];
  /** Timestamp the GM last marked the thread as "seen" (panel close).
   *  Messages with `at > lastSeenAt` render BOLD to mark them as new
   *  since the GM last looked. 0 = never opened. v2.16.49. */
  lastSeenAt: number;
  /** The player this thread belongs to — used in the empty-state hint
   *  and the composer placeholder. */
  toName: string;
  /** Send a GM reply text. The caller wires this to a broadcast. */
  onSend: (text: string) => void;
  /** Optional LLM reply-suggestions helper. When provided, the panel
   *  surfaces a small button above the composer. Labels as "Re-roll"
   *  when chips are already (or about to be) on display from the
   *  auto pre-fetch; "Suggest replies" when the thread didn't get an
   *  auto pre-fetch (peer-bound traffic) and the GM is opting in. */
  onSuggest?: () => Promise<string[]>;
  /** Pre-fetched suggestions for the most recent inbound message, if
   *  the assistant was configured at message-arrival time. Resolved
   *  before the panel opens, so chips appear instantly. */
  prefetchedSuggestions?: Promise<string[]>;
}

/** Populate a SidePanel body element with the thread view. */
export function buildMessageThreadPanel(body: HTMLElement, opts: MessageThreadPanelOptions): void {
  body.classList.add('mt-panel');

  // ─── Thread (chronological) ──────────────────────────────────────────────
  const thread = document.createElement('div');
  thread.className = 'mt-thread';
  if (opts.messages.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'mt-empty';
    empty.textContent = 'No messages yet. Type below to start.';
    thread.appendChild(empty);
  } else {
    for (const m of opts.messages) thread.appendChild(buildThreadRow(m, m.at > opts.lastSeenAt));
  }
  body.appendChild(thread);

  // ─── Composer ────────────────────────────────────────────────────────────
  const composer = document.createElement('div');
  composer.className = 'mt-composer';

  // Suggestion chips slot (filled either from prefetched, or by the
  // Suggest button below).
  const chips = document.createElement('div');
  chips.className = 'mt-chips';
  composer.appendChild(chips);

  const input = document.createElement('textarea');
  input.className = 'mt-input';
  input.rows = 2;
  input.placeholder = `Reply to ${opts.toName}…`;
  composer.appendChild(input);

  const actions = document.createElement('div');
  actions.className = 'mt-actions';

  // v2.16.52 — auto pre-fetch covers the common to-GM case, so the
  // button's primary job is now "re-roll" (refresh the chips) rather
  // than "ask in the first place". Label switches based on whether the
  // panel was handed a pre-fetched promise: present → "Re-roll", absent
  // → "Suggest replies" (peer-bound thread; GM is opting in).
  const idleLabel = opts.prefetchedSuggestions ? '↻ Re-roll' : 'Suggest replies';
  if (opts.onSuggest) {
    const suggestBtn = document.createElement('button');
    suggestBtn.type = 'button';
    suggestBtn.className = 'btn btn--ghost btn--xs';
    suggestBtn.title = opts.prefetchedSuggestions
      ? 'Re-roll the suggestion options'
      : 'Ask the assistant for reply suggestions';
    suggestBtn.textContent = idleLabel;
    suggestBtn.addEventListener('click', async () => {
      suggestBtn.disabled = true;
      suggestBtn.textContent = 'Thinking…';
      try {
        const opts2 = (await opts.onSuggest?.()) ?? [];
        _renderChips(chips, opts2, input);
      } catch (err) {
        chips.textContent = `Suggestions unavailable: ${(err as Error).message}`;
      } finally {
        suggestBtn.disabled = false;
        // After the first manual ask, subsequent clicks are also re-rolls.
        suggestBtn.textContent = '↻ Re-roll';
        suggestBtn.title = 'Re-roll the suggestion options';
      }
    });
    actions.appendChild(suggestBtn);
  }

  const sendBtn = document.createElement('button');
  sendBtn.type = 'button';
  sendBtn.className = 'btn btn--primary btn--xs';
  sendBtn.textContent = 'Send';
  const doSend = () => {
    const text = input.value.trim();
    if (!text) return;
    opts.onSend(text);
    input.value = '';
    chips.replaceChildren();
  };
  sendBtn.addEventListener('click', doSend);
  // Enter to send; Shift+Enter for newline.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  });
  actions.appendChild(sendBtn);

  composer.appendChild(actions);
  body.appendChild(composer);

  // Resolve pre-fetched suggestions. v2.16.49 — show an animated "…"
  // placeholder while the LLM is still thinking so the GM knows
  // chips are on the way. Replaced by real chips when the promise
  // resolves; cleared if the request errors / returns nothing.
  if (opts.prefetchedSuggestions) {
    const waiting = document.createElement('span');
    waiting.className = 'mt-chips-waiting';
    waiting.title = 'LLM is thinking…';
    waiting.textContent = '…';
    chips.appendChild(waiting);
    void opts.prefetchedSuggestions.then((arr) => {
      if (arr.length > 0) _renderChips(chips, arr, input);
      else chips.replaceChildren();
    }).catch(() => chips.replaceChildren());
  }

  // Autoscroll thread to bottom on render.
  requestAnimationFrame(() => { thread.scrollTop = thread.scrollHeight; });
  // Focus composer so a returning GM can just start typing.
  requestAnimationFrame(() => input.focus());
}

/**
 * One row of a thread — a message bubble, or (v2.19) a dice roll chip. Exported
 * because the All Players panel renders exactly the same rows; `onReply` adds
 * the affordance that panel needs, since it has no composer of its own.
 */
export function buildThreadRow(m: ThreadMessage, isNew: boolean, onReply?: () => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'mt-msg '
    + (m.fromKind === 'gm' ? 'mt-msg--gm' : 'mt-msg--player')
    + (m.kind === 'roll' ? ' mt-msg--roll' : '')
    + (m.roll?.whisper ? ' mt-msg--whisper' : '')
    + (isNew ? ' mt-msg--new' : '');

  const head = document.createElement('div');
  head.className = 'mt-msg-head';
  const from = document.createElement('span');
  from.className = 'mt-msg-from';
  from.style.color = m.fromColor;
  from.textContent = m.fromName;
  head.appendChild(from);
  if (m.toName && m.fromKind === 'player' && m.origin === 'peer-bound') {
    // v2.16.51 — arrow stays white + bright so the "→" reads as a clear
    // direction marker even at a glance; the recipient name renders bold
    // in their own identity colour so the GM spots "this wasn't for me"
    // immediately.
    const arrow = document.createElement('span');
    arrow.className = 'mt-msg-arrow';
    arrow.textContent = '→';
    head.appendChild(arrow);
    const to = document.createElement('span');
    to.className = 'mt-msg-to';
    if (m.toColor) to.style.color = m.toColor;
    to.textContent = m.toName;
    head.appendChild(to);
  }
  if (m.roll?.whisper) {
    // The GM sees the roll BECAUSE it was whispered — say so, or they will read
    // it as something the table also saw.
    const w = document.createElement('span');
    w.className = 'mt-msg-whisper-tag';
    w.textContent = 'whisper';
    w.title = 'Only you and the roller saw this';
    head.appendChild(w);
  }
  const time = document.createElement('span');
  time.className = 'mt-msg-time';
  time.textContent = new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  head.appendChild(time);
  if (onReply) {
    const reply = document.createElement('button');
    reply.type = 'button';
    reply.className = 'mt-msg-reply';
    reply.title = `Open the thread with ${m.fromName}`;
    reply.textContent = 'Reply';
    reply.addEventListener('click', onReply);
    head.appendChild(reply);
  }
  row.appendChild(head);

  row.appendChild(m.kind === 'roll' && m.roll ? _buildRollBody(m.roll) : _buildTextBody(m.text));
  return row;
}

function _buildTextBody(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'mt-msg-text';
  el.textContent = text;
  return el;
}

/** A roll reads as: what they called it, what it was, what it came to. */
function _buildRollBody(roll: NonNullable<ThreadMessage['roll']>): HTMLElement {
  const el = document.createElement('div');
  el.className = 'mt-roll';

  const label = document.createElement('span');
  label.className = 'mt-roll-label';
  label.textContent = roll.label;

  const formula = document.createElement('span');
  formula.className = 'mt-roll-formula';
  const range = rangeOf(roll.outcome.formula);
  // What it COULD have come to: a 5 means nothing until you know it was 3d6.
  formula.textContent = roll.outcome.formula + (range ? ` [${range.min}-${range.max}]` : '');

  const breakdown = document.createElement('span');
  breakdown.className = 'mt-roll-breakdown';
  // The same sum the feed sentence uses, minus the tail it repeats.
  breakdown.textContent = describeRollSentence(roll.outcome).replace(/=.*$/, '').trim();

  const total = document.createElement('span');
  total.className = 'mt-roll-total';
  total.textContent = String(roll.outcome.total);

  el.append(label, formula, breakdown, total);
  return el;
}

function _renderChips(host: HTMLElement, options: string[], input: HTMLTextAreaElement): void {
  host.replaceChildren();
  for (const opt of options) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'mt-chip';
    chip.textContent = opt;
    chip.title = 'Click to use; edit before sending';
    chip.addEventListener('click', () => { input.value = opt; input.focus(); });
    host.appendChild(chip);
  }
}
