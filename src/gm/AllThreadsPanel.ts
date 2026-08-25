/**
 * AllThreadsPanel (v2.19) — every player's thread merged into one feed.
 *
 * The per-player panel answers "what did Sam say?"; this one answers "what is
 * happening at my table?", which is the question a GM has while dice are being
 * rolled. It is meant to be left open: rolls arrive here as chips rather than
 * as toasts over the map, and while it is open nothing bumps an unread badge.
 *
 * No composer. Replying means choosing someone, so each row carries a Reply
 * that opens that player's own thread (the SidePanel framework allows one panel
 * at a time, so this one closes as that one opens — deliberate).
 */

import type { ThreadMessage } from './MessageThreads.ts';
import { buildThreadRow } from './MessageThreadPanel.ts';

export type AllThreadsFilter = 'all' | 'rolls' | 'chat';

export interface AllThreadsPanelOptions {
  /** Every thread's messages, already merged and sorted oldest-first. */
  rows: { playerId: string; lastSeenAt: number; message: ThreadMessage }[];
  filter: AllThreadsFilter;
  onFilter: (f: AllThreadsFilter) => void;
  /** Open one player's own thread — the reply route. */
  onOpenThread: (playerId: string) => void;
}

const FILTERS: { id: AllThreadsFilter; label: string; title: string }[] = [
  { id: 'all',   label: 'All',   title: 'Everything, oldest first' },
  { id: 'rolls', label: 'Rolls', title: 'Dice only' },
  { id: 'chat',  label: 'Chat',  title: 'Messages only' },
];

export function buildAllThreadsPanel(body: HTMLElement, opts: AllThreadsPanelOptions): void {
  body.classList.add('mt-panel', 'mt-panel--all');

  const bar = document.createElement('div');
  bar.className = 'mt-filterbar';
  for (const f of FILTERS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'mt-filter' + (f.id === opts.filter ? ' is-active' : '');
    chip.textContent = f.label;
    chip.title = f.title;
    chip.setAttribute('aria-pressed', String(f.id === opts.filter));
    chip.addEventListener('click', () => opts.onFilter(f.id));
    bar.appendChild(chip);
  }
  body.appendChild(bar);

  const thread = document.createElement('div');
  thread.className = 'mt-thread';

  const visible = opts.rows.filter(({ message }) =>
    opts.filter === 'all' ? true
    : opts.filter === 'rolls' ? message.kind === 'roll'
    : message.kind !== 'roll');

  if (visible.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'mt-empty';
    empty.textContent = opts.filter === 'rolls'
      ? 'No dice rolled yet. Rolls land here as players make them.'
      : opts.filter === 'chat'
        ? 'No messages yet.'
        : 'Nothing yet. Messages and dice rolls from every player arrive here.';
    thread.appendChild(empty);
  } else {
    for (const { playerId, lastSeenAt, message } of visible) {
      const isNew = message.at > lastSeenAt;
      const reply = message.fromKind === 'player' ? () => opts.onOpenThread(playerId) : undefined;
      thread.appendChild(buildThreadRow(message, isNew, reply));
    }
  }
  body.appendChild(thread);

  // Newest at the bottom, like every other feed here.
  requestAnimationFrame(() => { thread.scrollTop = thread.scrollHeight; });
}
