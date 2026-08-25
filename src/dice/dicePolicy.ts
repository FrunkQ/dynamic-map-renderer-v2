/**
 * Dice visibility (v2.19) — who is told about a roll, and in how much detail.
 *
 * PURE, and separate from the engine on purpose: this is the part a table
 * argues about, so it is one small resolvable function rather than conditionals
 * spread across three surfaces.
 *
 * Two axes, resolved independently:
 *   AUDIENCE  who hears about the roll at all
 *   DETAIL    what each recipient gets: an animation, a line in a feed, nothing
 *
 * And three layers of precedence, effective = the LEAST of:
 *   1. the pack's policy (the ceiling — travels in the .mappadux bundle)
 *   2. the viewer's own choice (a player may always turn spectacle DOWN)
 *   3. what their device can do
 * A pack can never force an animation onto someone's phone.
 *
 * Two rules are fixed, not configurable:
 *   - The GM always gets a LINE, never an animation. Rolls land in the chat
 *     feed; the GM asked not to have every roll thrown at their screen.
 *   - A WHISPER never reaches the table screen or another player, whatever the
 *     policy says — and the roller sees it in full on their own device, since
 *     the table cannot show it for them.
 */

export type DiceDetail = 'full' | 'line' | 'none';
/** Who is told about a roll. 'roller' is private even from the GM. */
export type RollAudience = 'table' | 'gm' | 'roller';
export type DiceRecipient = 'roller' | 'other' | 'table' | 'gm';

export interface DicePolicy {
  /** Who hears about a PLAYER's roll. */
  playerRollAudience: RollAudience;
  /** GM rolls are private unless this is on (a set entry may force it per-chip). */
  gmRollsPublic: boolean;
  /** How players who did NOT roll see it. */
  othersDetail: DiceDetail;
  /** How the table screen (projector / scaled view) shows it. */
  tableDetail: DiceDetail;
  /** How the ROLLER sees their own roll. 'auto' = a line when the table screen
   *  is already showing it in full, because everyone is looking up at it. */
  rollerDetail: DiceDetail | 'auto';
}

export const DEFAULT_DICE_POLICY: DicePolicy = {
  playerRollAudience: 'table',
  gmRollsPublic:      false,
  othersDetail:       'line',
  tableDetail:        'full',
  rollerDetail:       'auto',
};

export interface RollContext {
  policy:  DicePolicy;
  /** The GM rolled it. */
  fromGm:  boolean;
  /** Whispered: GM + roller only. */
  whisper: boolean;
  /** Per-chip override: this GM entry is public even when GM rolls are not. */
  forcePublic?: boolean;
  /** Is a table screen actually connected? `rollerDetail: 'auto'` hands the
   *  show to the table and drops the roller to a line — but only if there IS
   *  a table. With none connected, "everyone is looking up at it" is false and
   *  the roller would be left with a line and nothing to look at. Undefined
   *  counts as connected, so a caller that does not know keeps the old rule. */
  tableConnected?: boolean;
}

const RANK: Record<DiceDetail, number> = { none: 0, line: 1, full: 2 };

/** The lesser of two details — how the precedence layers combine. */
export function reduceDetail(a: DiceDetail, b: DiceDetail): DiceDetail {
  return RANK[a] <= RANK[b] ? a : b;
}

/** Is this roll told to anyone beyond the roller and the GM? */
export function audienceFor(ctx: RollContext): RollAudience {
  if (ctx.whisper) return 'gm';
  if (ctx.fromGm) return ctx.policy.gmRollsPublic || ctx.forcePublic ? 'table' : 'gm';
  return ctx.policy.playerRollAudience;
}

/**
 * What a given recipient gets, by pack policy alone. Callers then reduce this
 * against the viewer's own preference and their device.
 */
export function detailFor(recipient: DiceRecipient, ctx: RollContext): DiceDetail {
  const audience = audienceFor(ctx);
  const { policy } = ctx;

  if (recipient === 'gm') {
    // Fixed: a line in the feed, unless the roll is private even from the GM.
    return audience === 'roller' ? 'none' : 'line';
  }

  if (recipient === 'roller') {
    // A whisper cannot be staged on the table, so the roller keeps the show.
    if (ctx.whisper) return 'full';
    if (policy.rollerDetail !== 'auto') return policy.rollerDetail;
    const tableShowsIt = audience === 'table'
      && policy.tableDetail === 'full'
      && ctx.tableConnected !== false;
    return tableShowsIt ? 'line' : 'full';
  }

  if (audience !== 'table') return 'none';
  return recipient === 'table' ? policy.tableDetail : policy.othersDetail;
}

/** Coerce anything (a bundle field, a stale localStorage value) to a detail. */
export function asDetail(v: unknown, fallback: DiceDetail): DiceDetail {
  return v === 'full' || v === 'line' || v === 'none' ? v : fallback;
}

/** Normalise a policy object read from a bundle — every field independently,
 *  so a pack written by an older or newer build still loads. */
export function normalisePolicy(raw: Partial<DicePolicy> | undefined | null): DicePolicy {
  const p = raw ?? {};
  const audience: RollAudience =
    p.playerRollAudience === 'gm' || p.playerRollAudience === 'roller' ? p.playerRollAudience : 'table';
  const roller = p.rollerDetail === 'auto' ? 'auto' : asDetail(p.rollerDetail, DEFAULT_DICE_POLICY.rollerDetail as DiceDetail);
  return {
    playerRollAudience: audience,
    gmRollsPublic:      typeof p.gmRollsPublic === 'boolean' ? p.gmRollsPublic : false,
    othersDetail:       asDetail(p.othersDetail, DEFAULT_DICE_POLICY.othersDetail),
    tableDetail:        asDetail(p.tableDetail, DEFAULT_DICE_POLICY.tableDetail),
    rollerDetail:       roller,
  };
}
