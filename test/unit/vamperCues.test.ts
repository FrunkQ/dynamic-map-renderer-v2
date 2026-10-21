import { describe, it, expect } from 'vitest';
import type { Score } from 'vamper';
import { vamperCues } from '../../src/audio/vamperCues.ts';
import { migrateSoundtracksConfig } from '../../src/stagecraft/soundtracksMigrate.ts';
import type { SoundtrackSlot } from '../../src/types.ts';

/** A 60 s song at 120 bpm in 4/4: a bar every 2 s, beats every 0.5 s. */
function score(): Score {
  const beats = [];
  for (let i = 0; i * 0.5 < 60; i++) {
    beats.push({ t: i * 0.5, bar: Math.floor(i / 4) + 1, beat: (i % 4) + 1, downbeat: i % 4 === 0, strength: 1 });
  }
  return { beats, track: { durationSec: 60 } } as unknown as Score;
}

const song = (id: string, extra: Partial<SoundtrackSlot> = {}): SoundtrackSlot =>
  ({ id, label: id, kind: 'normal', track: { kind: 'vamper', assetId: 'song-a' }, ...extra });

describe('vamperCues — Soundtrack slots on one song become Vamper cues', () => {
  it('snaps rough Start / End to whole bars, and Loop picks the mode', () => {
    const { cues, indexOf } = vamperCues(score(), [
      { id: '_silent', label: 'Silence', kind: 'silent' },
      song('Calm',   { startSec: 0.3, endSec: 15.7, loop: true }),
      song('Combat', { startSec: 31.1 }),
    ], 'song-a');
    expect(cues).toEqual([
      { name: 'Calm',   from: 0,  to: 16, mode: 'loop' },
      { name: 'Combat', from: 32, to: 58, mode: 'once' },
    ]);
    expect(indexOf.get('Calm')).toBe(0);
    expect(indexOf.get('Combat')).toBe(1);
    expect(indexOf.has('_silent')).toBe(false);
  });

  it('ignores slots on other songs and other providers', () => {
    const { cues } = vamperCues(score(), [
      song('Mine'),
      { ...song('Other'), track: { kind: 'vamper', assetId: 'song-b' } },
      { id: 'yt', label: 'yt', kind: 'normal', track: { kind: 'youtube', videoId: 'x' } },
    ], 'song-a');
    expect(cues.map((c) => c.name)).toEqual(['Mine']);
  });

  it('keeps a passage at least one bar long', () => {
    const { cues } = vamperCues(score(), [song('Tiny', { startSec: 10, endSec: 10.4, loop: true })], 'song-a');
    expect(cues[0]).toMatchObject({ from: 10, to: 12 });
  });
});

describe('soundtracks migration keeps local-song slots', () => {
  it('passes a vamper track through unchanged', () => {
    const cfg = migrateSoundtracksConfig({ slots: [song('Calm', { loop: true, startSec: 4 })] });
    expect(cfg.slots[1]?.track).toEqual({ kind: 'vamper', assetId: 'song-a' });
    expect(cfg.slots[1]?.startSec).toBe(4);
  });
});
