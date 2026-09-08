/**
 * PlayerDiceTray — the player's whole dice interaction, and the mode that can
 * leak a secret if it misbehaves. The ten-minute reset is the part nobody can
 * check by hand, so it is checked here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PlayerDiceTray, WHISPER_TIMEOUT_MS } from '../../src/player/PlayerDiceTray.ts';
import type { DiceButton } from '../../src/types.ts';

const SET: DiceButton[] = [
  { id: 'a', label: 'Attack', formula: '1d20+5' },
  { id: 'b', label: '2d6',    formula: '2d6' },
];

describe('PlayerDiceTray', () => {
  let root: HTMLElement;
  let rolls: { label: string; whisper: boolean }[];
  let whisperEvents: { armed: boolean; reason: string }[];
  let tray: PlayerDiceTray;

  const chip = (label: string) =>
    [...root.querySelectorAll<HTMLElement>('.dice-chip')]
      .find((c) => c.querySelector('.dice-chip-label')?.textContent === label);
  const toggle = () => root.querySelector<HTMLElement>('.dice-whisper-toggle');

  beforeEach(() => {
    vi.useFakeTimers();
    root = document.createElement('div');
    rolls = [];
    whisperEvents = [];
    tray = new PlayerDiceTray(root, {
      onRoll: (entry, whisper) => rolls.push({ label: entry.label, whisper }),
      onWhisperChange: (armed, reason) => whisperEvents.push({ armed, reason }),
    });
  });
  afterEach(() => { tray.destroy(); vi.useRealTimers(); });

  it('stays out of the way until the GM sends a set', () => {
    expect(root.hidden).toBe(true);
    tray.update([], true);
    expect(root.hidden).toBe(true);           // permission but no rolls: nothing to show
    tray.update(SET, false);
    expect(root.hidden).toBe(true);           // rolls but no permission
    tray.update(SET, true);
    expect(root.hidden).toBe(false);
    expect(root.querySelectorAll('.dice-chip')).toHaveLength(2);
  });

  it('one tap is one roll', () => {
    tray.update(SET, true);
    chip('Attack')!.click();
    expect(rolls).toEqual([{ label: 'Attack', whisper: false }]);
  });

  it('whisper applies to what is rolled next, and marks the whole tray', () => {
    tray.update(SET, true);
    toggle()!.click();
    expect(tray.isWhispering).toBe(true);
    expect(root.classList.contains('is-whisper')).toBe(true);
    expect(toggle()!.getAttribute('aria-pressed')).toBe('true');
    // ...and says the word, not just the glow
    expect(toggle()!.textContent).toContain('Whisper');
    chip('2d6')!.click();
    expect(rolls).toEqual([{ label: '2d6', whisper: true }]);
  });

  it('disarms itself after ten minutes, and says so', () => {
    tray.update(SET, true);
    toggle()!.click();
    vi.advanceTimersByTime(WHISPER_TIMEOUT_MS - 1000);
    expect(tray.isWhispering).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(tray.isWhispering).toBe(false);
    expect(root.classList.contains('is-whisper')).toBe(false);
    // The caller is told, so it can put it on screen: a mode that changes
    // silently is found out by a secret roll appearing on the table screen.
    expect(whisperEvents.at(-1)).toEqual({ armed: false, reason: 'timeout' });
  });

  it('restarts the clock on each whispered roll, so a run does not lapse midway', () => {
    tray.update(SET, true);
    toggle()!.click();
    vi.advanceTimersByTime(WHISPER_TIMEOUT_MS - 1000);
    chip('Attack')!.click();                       // used it with a second to spare
    vi.advanceTimersByTime(WHISPER_TIMEOUT_MS - 1000);
    expect(tray.isWhispering).toBe(true);          // still armed: the clock restarted
    vi.advanceTimersByTime(2000);
    expect(tray.isWhispering).toBe(false);
  });

  it('losing permission mid-session disarms whisper too', () => {
    tray.update(SET, true);
    toggle()!.click();
    expect(tray.isWhispering).toBe(true);
    tray.update(SET, false);
    // Coming back to a tray that is still secretly armed is the surprise this
    // whole mechanism exists to avoid.
    expect(tray.isWhispering).toBe(false);
    expect(root.hidden).toBe(true);
  });

  it('real dice replace the chips, but never the rules', () => {
    tray.update(SET, true);
    expect(root.querySelectorAll('.dice-chip')).toHaveLength(2);

    tray.setPhysicalDice([
      { id: 'd1', name: 'Sparkle', status: 'ready' }, { id: 'd2', name: 'Doom', status: 'ready' }]);
    // Nothing left to tap: the dice are on the table.
    expect(root.querySelectorAll('.dice-chip')).toHaveLength(0);
    expect(root.querySelector('.dice-physical-status')?.textContent).toContain('2 dice connected');
    // ...but whisper still governs what you throw next, so it stays.
    expect(toggle()).not.toBeNull();
    toggle()!.click();
    expect(tray.isWhispering).toBe(true);

    // Unpair and the chips come back.
    tray.setPhysicalDice([]);
    expect(root.querySelectorAll('.dice-chip')).toHaveLength(2);
  });

  it('gives the chips back when no die is actually listening', () => {
    tray.update(SET, true);
    tray.setPhysicalDice([{ id: 'd1', name: 'Sparkle', status: 'ready' }]);
    expect(root.querySelectorAll('.dice-chip')).toHaveLength(0);

    // The die wanders off. There must always be a way to roll.
    tray.setPhysicalDice([{ id: 'd1', name: 'Sparkle', status: 'lost' }]);
    expect(root.querySelectorAll('.dice-chip')).toHaveLength(2);
    expect(root.querySelector('.dice-physical-status')?.textContent).toContain('Lost Sparkle');

    // ...and while it is coming back, still.
    tray.setPhysicalDice([{ id: 'd1', name: 'Sparkle', status: 'connecting' }]);
    expect(root.querySelectorAll('.dice-chip')).toHaveLength(2);
    expect(root.querySelector('.dice-physical-status')?.textContent).toContain('Connecting to Sparkle');

    tray.setPhysicalDice([{ id: 'd1', name: 'Sparkle', status: 'ready' }]);
    expect(root.querySelectorAll('.dice-chip')).toHaveLength(0);
  });

  it('says when a die was thrown again mid-handful', () => {
    tray.update(SET, true);
    tray.setPhysicalDice([{ id: 'd1', name: 'Doom', status: 'ready' }]);
    tray.setCollecting(2, 'Doom');
    expect(root.querySelector('.dice-physical-status')?.textContent)
      .toBe('Doom rolled again — counting the new one');
  });

  it('says so while a thrown handful is still landing', () => {
    tray.update(SET, true);
    tray.setPhysicalDice([{ id: 'd1', name: 'Sparkle', status: 'ready' }]);
    tray.setCollecting(1);
    expect(root.classList.contains('is-collecting')).toBe(true);
    expect(root.querySelector('.dice-physical-status')?.textContent).toBe('A die has landed…');
    tray.setCollecting(3);
    expect(root.querySelector('.dice-physical-status')?.textContent).toBe('3 dice landed…');
    tray.setCollecting(0);
    expect(root.classList.contains('is-collecting')).toBe(false);
    expect(root.querySelector('.dice-physical-status')?.textContent).toContain('connected');
  });

  it('carries no pairing button: that is setup, and lives with the settings', () => {
    tray.update(SET, true);
    expect(root.querySelector('.dice-pair-btn')).toBeNull();
    // ...but a paired die still drives the tray, which is where it is USED.
    tray.setPhysicalDice([{ id: 'd1', name: 'Sparkle', status: 'ready' }]);
    expect(root.querySelector('.dice-physical-status')).not.toBeNull();
  });

  it('keeps the set when hidden for another reason', () => {
    tray.update(SET, true);
    tray.setVisible(false);
    expect(root.hidden).toBe(true);
    tray.setVisible(true);
    expect(root.hidden).toBe(false);
    expect(root.querySelectorAll('.dice-chip')).toHaveLength(2);
  });
});
