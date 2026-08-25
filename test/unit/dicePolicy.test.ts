import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DICE_POLICY, detailFor, audienceFor, reduceDetail, normalisePolicy,
  type DicePolicy, type RollContext,
} from '../../src/dice/dicePolicy.ts';

const ctx = (over: Partial<RollContext> = {}, policy: Partial<DicePolicy> = {}): RollContext => ({
  policy: { ...DEFAULT_DICE_POLICY, ...policy },
  fromGm: false,
  whisper: false,
  ...over,
});

describe('dice visibility', () => {
  it('defaults: the table sees it, other players get a line, the GM gets chat', () => {
    const c = ctx();
    expect(detailFor('table', c)).toBe('full');
    expect(detailFor('other', c)).toBe('line');
    expect(detailFor('gm', c)).toBe('line');
    // 'auto': the table screen is already showing it, so the roller looks up
    expect(detailFor('roller', c)).toBe('line');
  });

  it('the roller keeps the animation when the table is not staging it', () => {
    expect(detailFor('roller', ctx({}, { tableDetail: 'none' }))).toBe('full');
    expect(detailFor('roller', ctx({}, { rollerDetail: 'full' }))).toBe('full');
  });

  it('the GM never gets an animation, only a feed line', () => {
    for (const c of [ctx(), ctx({ fromGm: true }), ctx({ whisper: true }), ctx({}, { othersDetail: 'full' })]) {
      expect(detailFor('gm', c)).toBe('line');
    }
  });

  it('a whisper reaches the GM and nobody else, and the roller keeps the show', () => {
    const c = ctx({ whisper: true });
    expect(audienceFor(c)).toBe('gm');
    expect(detailFor('table', c)).toBe('none');
    expect(detailFor('other', c)).toBe('none');
    expect(detailFor('gm', c)).toBe('line');
    expect(detailFor('roller', c)).toBe('full');
  });

  it('a whisper beats a policy that would otherwise put it on the table', () => {
    const c = ctx({ whisper: true }, { playerRollAudience: 'table', tableDetail: 'full', othersDetail: 'full' });
    expect(detailFor('table', c)).toBe('none');
    expect(detailFor('other', c)).toBe('none');
  });

  it('GM rolls are private by default, public by policy or per-chip', () => {
    expect(audienceFor(ctx({ fromGm: true }))).toBe('gm');
    expect(detailFor('table', ctx({ fromGm: true }))).toBe('none');
    expect(audienceFor(ctx({ fromGm: true }, { gmRollsPublic: true }))).toBe('table');
    expect(detailFor('table', ctx({ fromGm: true }, { gmRollsPublic: true }))).toBe('full');
    expect(audienceFor(ctx({ fromGm: true, forcePublic: true }))).toBe('table');
  });

  it('a roller-only roll is private even from the GM', () => {
    const c = ctx({}, { playerRollAudience: 'roller' });
    expect(detailFor('gm', c)).toBe('none');
    expect(detailFor('table', c)).toBe('none');
    expect(detailFor('roller', c)).toBe('full');
  });

  it('a gm-audience policy tells the GM but not the room', () => {
    const c = ctx({}, { playerRollAudience: 'gm' });
    expect(detailFor('gm', c)).toBe('line');
    expect(detailFor('other', c)).toBe('none');
    expect(detailFor('table', c)).toBe('none');
    expect(detailFor('roller', c)).toBe('full');
  });

  it('precedence takes the LEAST — a pack cannot force spectacle on a phone', () => {
    expect(reduceDetail('full', 'line')).toBe('line');
    expect(reduceDetail('line', 'none')).toBe('none');
    expect(reduceDetail('full', 'full')).toBe('full');
    // pack says full, the player chose lines, so lines it is
    expect(reduceDetail(detailFor('other', ctx({}, { othersDetail: 'full' })), 'line')).toBe('line');
  });

  it('normalises a policy from a pack written by another build', () => {
    expect(normalisePolicy(undefined)).toEqual(DEFAULT_DICE_POLICY);
    expect(normalisePolicy({ othersDetail: 'sideways' as never })).toEqual(DEFAULT_DICE_POLICY);
    expect(normalisePolicy({ playerRollAudience: 'gm', tableDetail: 'none' })).toEqual({
      ...DEFAULT_DICE_POLICY, playerRollAudience: 'gm', tableDetail: 'none',
    });
  });
});
