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

  it('keeps the set when hidden for another reason', () => {
    tray.update(SET, true);
    tray.setVisible(false);
    expect(root.hidden).toBe(true);
    tray.setVisible(true);
    expect(root.hidden).toBe(false);
    expect(root.querySelectorAll('.dice-chip')).toHaveLength(2);
  });
});
