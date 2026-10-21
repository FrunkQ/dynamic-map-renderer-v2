/**
 * Soundtrack slots → Vamper cues. Pure, so it is unit-tested without
 * audio.
 *
 * Every slot whose track is the same local song is one cue in that
 * song: Start / End trim are the passage (rough seconds, snapped to
 * whole bars by Vamper's barSpan), Loop holds it (`loop`), otherwise
 * it plays on from Start (`once`). No Start = the top of the song,
 * no End = its last bar.
 */

import { barSpan, type Cue, type Score } from 'vamper';
import type { SoundtrackSlot } from '../types.ts';

export interface VamperCueSet {
  cues:    Cue[];
  /** slot id → index into `cues`. */
  indexOf: Map<string, number>;
}

export function vamperCues(score: Score, slots: SoundtrackSlot[], assetId: string): VamperCueSet {
  const cues: Cue[] = [];
  const indexOf = new Map<string, number>();
  for (const s of slots) {
    if (s.track?.kind !== 'vamper' || s.track.assetId !== assetId) continue;
    const [from, to] = barSpan(score, s.startSec ?? 0, s.endSec ?? null);
    indexOf.set(s.id, cues.length);
    cues.push({ name: s.label, from, to, mode: s.loop ? 'loop' : 'once' });
  }
  return { cues, indexOf };
}
