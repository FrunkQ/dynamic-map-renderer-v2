import { describe, it, expect, beforeEach } from 'vitest';
import {
  collectBundledPreferences,
  applyBundledPreferences,
  getMeasureUnitValue,
  getMeasureUnitSuffix,
  getInitiativeSortDirection,
  isInitiativeAnonymised,
  arePingsEnabled,
  isMessagingEnabled,
  arePlayerMarkersMovable,
  areDiceEnabled,
  getDiceSet,
  getDicePolicy,
  setDiceSet,
  getDiceDetailPreference,
  setDiceDetailPreference,
} from '../../src/storage/localSettings.ts';
import { DEFAULT_DICE_POLICY } from '../../src/dice/dicePolicy.ts';

describe('Bundled GM preferences — pack round-trip', () => {
  beforeEach(() => localStorage.clear());

  it('defaults are sensible when nothing is stored', () => {
    const p = collectBundledPreferences();
    expect(p.measureUnitValue).toBe(5);
    expect(p.measureUnitSuffix).toBe("'");
    expect(p.initiativeSortDirection).toBe('high-to-low');
    expect(p.initiativeAnonymise).toBe(true);
    expect(p.playerPingsEnabled).toBe(true);
    expect(p.playerMessagingEnabled).toBe(true);
    expect(p.playerMarkersMovable).toBe(true);
    expect(p.playerDiceEnabled).toBe(true);
    expect(p.diceSet).toEqual([]);
    expect(p.dicePolicy).toEqual(DEFAULT_DICE_POLICY);
  });

  it('apply then collect round-trips every field', () => {
    applyBundledPreferences({
      measureUnitValue: 3,
      measureUnitSuffix: 'm',
      initiativeSortDirection: 'low-to-high',
      initiativeAnonymise: false,
      playerPingsEnabled: false,
      playerMessagingEnabled: false,
      playerMarkersMovable: false,
      playerDiceEnabled: false,
      diceSet: [{ id: 'a', label: 'Attack', formula: '1d20+5' }],
      dicePolicy: { ...DEFAULT_DICE_POLICY, othersDetail: 'full', gmRollsPublic: true },
    });
    expect(getMeasureUnitValue()).toBe(3);
    expect(getMeasureUnitSuffix()).toBe('m');
    expect(getInitiativeSortDirection()).toBe('low-to-high');
    expect(isInitiativeAnonymised()).toBe(false);
    expect(arePingsEnabled()).toBe(false);
    expect(isMessagingEnabled()).toBe(false);
    expect(arePlayerMarkersMovable()).toBe(false);
    expect(areDiceEnabled()).toBe(false);
    expect(getDiceSet()).toEqual([{ id: 'a', label: 'Attack', formula: '1d20+5' }]);
    expect(getDicePolicy().othersDetail).toBe('full');
    expect(collectBundledPreferences()).toEqual({
      measureUnitValue: 3,
      measureUnitSuffix: 'm',
      initiativeSortDirection: 'low-to-high',
      initiativeAnonymise: false,
      playerPingsEnabled: false,
      playerMessagingEnabled: false,
      playerMarkersMovable: false,
      playerDiceEnabled: false,
      diceSet: [{ id: 'a', label: 'Attack', formula: '1d20+5' }],
      dicePolicy: { ...DEFAULT_DICE_POLICY, othersDetail: 'full', gmRollsPublic: true },
    });
  });

  it('a pack with no dice leaves the set the GM already has', () => {
    setDiceSet([{ id: 'mine', label: 'Mine', formula: '2d6' }]);
    applyBundledPreferences({ measureUnitValue: 5 });          // a pack that carries no dice
    expect(getDiceSet()).toEqual([{ id: 'mine', label: 'Mine', formula: '2d6' }]);
  });

  it('drops set entries that will not roll, whatever a pack claims', () => {
    applyBundledPreferences({
      diceSet: [
        { id: 'ok', label: 'Fine', formula: '2d6' },
        { id: 'bad', label: 'Nope', formula: 'twenty' },
        { id: 'huge', label: 'Hang me', formula: '9999d6' },
        { id: 'nameless', label: '   ', formula: '1d6' },
      ],
    });
    expect(getDiceSet().map((d) => d.id)).toEqual(['ok']);
  });

  it('a viewer detail preference is per-device and never travels', () => {
    setDiceDetailPreference('line');
    // Importing a pack must not touch it — a pack cannot force spectacle on a phone.
    applyBundledPreferences({ dicePolicy: { ...DEFAULT_DICE_POLICY, othersDetail: 'full' } });
    expect(getDiceDetailPreference()).toBe('line');
    expect(collectBundledPreferences()).not.toHaveProperty('diceDetail');
  });

  it('absent fields (older bundle) leave current settings untouched', () => {
    applyBundledPreferences({ measureUnitValue: 10 });        // partial
    applyBundledPreferences(undefined);                       // no-op
    expect(getMeasureUnitValue()).toBe(10);
    expect(getMeasureUnitSuffix()).toBe("'");                 // default preserved
    expect(arePingsEnabled()).toBe(true);                     // default preserved
  });
});
