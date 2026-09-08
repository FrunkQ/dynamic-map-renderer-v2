/**
 * dieColors — a player's dice are their own colour, the GM's are black with
 * gold, and nobody ends up with a die they cannot read.
 */
import { describe, it, expect } from 'vitest';
import { skinFor, gmSkin, isLightColor, parseHex, GM_DIE_BASE, GM_DIE_INK } from '../../src/rendering/dieColors.ts';

describe('die colours', () => {
  it('parses the hex forms a colour input produces, and refuses the rest', () => {
    expect(parseHex('#22d3ee')).toEqual({ r: 34, g: 211, b: 238 });
    expect(parseHex('22d3ee')).toEqual({ r: 34, g: 211, b: 238 });
    expect(parseHex('#abc')).toEqual({ r: 170, g: 187, b: 204 });
    for (const bad of ['', 'red', '#12', 'rgb(1,2,3)', null, undefined]) expect(parseHex(bad)).toBeNull();
  });

  it('builds the die out of the roller colour, lit and shaded from it', () => {
    const skin = skinFor('#3b82f6');
    expect(skin.base).toBe('#3b82f6');
    expect(skin.mid).toBe('#3b82f6');            // the body IS the player's colour
    expect(isLightColor(skin.hi)).toBe(true);    // the facet facing the light
    expect(skin.lo).not.toBe(skin.base);         // and one turning away
    expect(Number.parseInt(skin.lo.slice(1, 3), 16)).toBeLessThan(0x3b);
  });

  it('picks an ink that can actually be read', () => {
    expect(skinFor('#fde047').ink).toBe('#141821');   // pale yellow -> dark numerals
    expect(skinFor('#1e293b').ink).toBe('#f8fafc');   // deep navy  -> light numerals
  });

  it('the GM rolls black and gold, and can change both', () => {
    const gm = gmSkin();
    expect(gm.base).toBe(GM_DIE_BASE);
    expect(gm.ink).toBe(GM_DIE_INK);
    expect(isLightColor(gm.base)).toBe(false);
    const custom = gmSkin('#3f0d0d', '#c0c0c0');
    expect(custom.base).toBe('#3f0d0d');
    expect(custom.ink).toBe('#c0c0c0');
  });

  it('falls back rather than throwing on a colour it cannot read', () => {
    const skin = skinFor('not-a-colour');
    expect(parseHex(skin.base)).not.toBeNull();
    expect(parseHex(skin.ink)).not.toBeNull();
  });
});
