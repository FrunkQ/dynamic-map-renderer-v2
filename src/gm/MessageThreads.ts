/**
 * MessageThreads — GM-side store for per-player message history + unread
 * counts. Replaces the v2.16.x PlayerVoicePanel store; the panel itself
 * is now a SidePanel opened by clicking a per-player badge on the
 * Players row.
 *
 * Two channels per thread (foreshadowing the v2.16.48 player↔player
 * patch — for now only the GM-bound stream is populated):
 *   - gmBound: messages addressed to the GM. Drive the RED unread badge.
 *   - peerBound: messages between this player and another player; the
 *     GM watches them ambiently. Drive the ORANGE unread badge.
 *
 * Each thread is per-playerId. The store fires `onChange` after any
 * mutation so subscribers (PlayersPanel re-render, open SidePanel
 * refresh) can update without each call site sequencing the call.
 */

export type MessageOrigin = 'gm-bound' | 'peer-bound';

export interface ThreadMessage {
  id:        string;
  fromKind:  'gm' | 'player';
  /** PlayerId of the sender, or null when fromKind === 'gm'. */
  fromPlayerId: string | null;
  fromName:  string;
  fromColor: string;
  /** Recipient PlayerId. For GM-bound: the GM (represented by null on the
   *  receiver-recipient axis but the thread is keyed by fromPlayerId).
   *  For peer-bound: the other player's id. */
  toPlayerId: string | null;
  toName?:   string;
  /** v2.16.51 — peer-bound messages carry the recipient's identity
   *  colour so the thread renders "→ <Other Player Name>" with the
   *  arrow in white and the name bold in their colour. Lets the GM
   *  spot at-a-glance that a message was sent to a different player. */
  toColor?:  string;
  text:      string;
  at:        number;
  /** v2.19 — a dice roll rather than a sentence. Rolls render as a chip, are
   *  filterable in the All Players panel, and never bump the red unread badge:
   *  a GM watching a busy table would otherwise have it lit all evening. The
   *  `text` field still carries a readable fallback. */
  kind?:     'roll';
  roll?:     {
    label: string;
    outcome: import('../dice/roll.ts').RollOutcome;
    whisper: boolean;
    /** Thrown on real dice rather than tapped — worth saying in the feed. */
    physical?: boolean;
  };
  /** Pre-fetched LLM reply suggestions for GM-bound messages, if the
   *  assistant was configured at arrival time. */
  suggestionsPromise?: Promise<string[]>;
  /** Which channel the message belongs to, for badge accounting. */
  origin:    MessageOrigin;
}

interface Thread {
  messages: ThreadMessage[];
  unreadGm:   number;
  unreadPeer: number;
  /** v2.19 — rolls counted quietly, away from the badge that means "someone
   *  is talking to you". */
  unreadRolls: number;
  /** Timestamp when the GM last CLOSED the thread side panel for this
   *  player. Messages with at > lastSeenAt render BOLD ("new since you
   *  last looked"). 0 = never opened. v2.16.49. */
  lastSeenAt: number;
}

export class MessageThreads {
  private byPlayer = new Map<string, Thread>();
  private listeners: Array<() => void> = [];

  /** Subscribe to any-mutation notifications. Returns an unsubscribe fn. */
  onChange(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** Append an inbound message from a player. Increments the matching
   *  unread counter unless the consumer claims the thread is already
   *  visible (`alreadyOpenPlayerId`). */
  addIncoming(playerId: string, msg: ThreadMessage, alreadyOpenPlayerId: string | null): void {
    const t = this._ensure(playerId);
    t.messages.push(msg);
    // '*' — the All Players panel is open, so everything is already on screen.
    const visible = alreadyOpenPlayerId === '*' || alreadyOpenPlayerId === playerId;
    if (!visible) {
      if (msg.kind === 'roll')              t.unreadRolls += 1;
      else if (msg.origin === 'gm-bound')   t.unreadGm    += 1;
      else if (msg.origin === 'peer-bound') t.unreadPeer  += 1;
    }
    this._fire();
  }

  /** Append an outgoing message FROM the GM TO this player. No unread
   *  bump (the GM authored it). */
  addOutgoing(playerId: string, msg: ThreadMessage): void {
    const t = this._ensure(playerId);
    t.messages.push(msg);
    this._fire();
  }

  /** Clear unread counters for a thread — typically when the GM opens
   *  the side panel for that player. */
  markRead(playerId: string): void {
    const t = this.byPlayer.get(playerId);
    if (!t) return;
    if (t.unreadGm === 0 && t.unreadPeer === 0 && t.unreadRolls === 0) return;
    t.unreadGm    = 0;
    t.unreadPeer  = 0;
    t.unreadRolls = 0;
    this._fire();
  }

  /** Clear every thread's counters — the All Players panel shows the lot. */
  markAllRead(): void {
    let changed = false;
    for (const t of this.byPlayer.values()) {
      if (t.unreadGm || t.unreadPeer || t.unreadRolls) changed = true;
      t.unreadGm = 0; t.unreadPeer = 0; t.unreadRolls = 0;
    }
    if (changed) this._fire();
  }

  /** v2.19 — every thread merged chronologically for the All Players panel.
   *  Each row keeps its player id so the panel can label it and offer a reply
   *  that opens that player's own thread. */
  snapshotAll(): { playerId: string; lastSeenAt: number; message: ThreadMessage }[] {
    const rows: { playerId: string; lastSeenAt: number; message: ThreadMessage }[] = [];
    for (const [playerId, t] of this.byPlayer) {
      for (const message of t.messages) rows.push({ playerId, lastSeenAt: t.lastSeenAt, message });
    }
    return rows.sort((a, b) => a.message.at - b.message.at);
  }

  /** Mark every thread seen — the All Players panel closing. */
  markAllSeen(): void {
    const now = Date.now();
    for (const t of this.byPlayer.values()) t.lastSeenAt = now;
  }

  /** Read accessor — returns the thread's messages (copy) or [] if none. */
  messagesFor(playerId: string): ThreadMessage[] {
    return [...(this.byPlayer.get(playerId)?.messages ?? [])];
  }

  /** Snapshot of the thread for rendering — messages + the lastSeenAt
   *  timestamp so the consumer can mark fresh-since-last-open messages
   *  visually (bold). v2.16.49. */
  snapshotFor(playerId: string): { messages: ThreadMessage[]; lastSeenAt: number } {
    const t = this.byPlayer.get(playerId);
    return {
      messages: [...(t?.messages ?? [])],
      lastSeenAt: t?.lastSeenAt ?? 0,
    };
  }

  /** Mark the thread as "seen up to NOW" — call when the GM closes the
   *  side panel. Subsequent messages with at > now will render as new
   *  on the next open. Independent of `markRead` (which only clears
   *  unread counters; the visual freshness state is separate). */
  markSeen(playerId: string): void {
    const t = this.byPlayer.get(playerId);
    if (!t) return;
    t.lastSeenAt = Date.now();
    // No _fire — closing the panel doesn't need anyone re-rendered.
  }

  /** Unread counts — red (gm-bound) and orange (peer-bound). */
  unreadFor(playerId: string): { gm: number; peer: number; rolls: number } {
    const t = this.byPlayer.get(playerId);
    return { gm: t?.unreadGm ?? 0, peer: t?.unreadPeer ?? 0, rolls: t?.unreadRolls ?? 0 };
  }

  /** Totals across every thread, for the All Players button's badge. */
  unreadTotals(): { gm: number; peer: number; rolls: number } {
    let gm = 0, peer = 0, rolls = 0;
    for (const t of this.byPlayer.values()) { gm += t.unreadGm; peer += t.unreadPeer; rolls += t.unreadRolls; }
    return { gm, peer, rolls };
  }

  /** Forget a thread entirely — e.g. when the GM removes a player. */
  drop(playerId: string): void {
    if (this.byPlayer.delete(playerId)) this._fire();
  }

  private _ensure(playerId: string): Thread {
    let t = this.byPlayer.get(playerId);
    if (!t) {
      t = { messages: [], unreadGm: 0, unreadPeer: 0, unreadRolls: 0, lastSeenAt: 0 };
      this.byPlayer.set(playerId, t);
    }
    return t;
  }

  private _fire(): void {
    for (const fn of this.listeners) {
      try { fn(); } catch { /* listener bugs shouldn't kill the rest */ }
    }
  }
}
