/**
 * VamperSongPlayer — the Soundtracks panel's engine for local songs.
 *
 * A thin wrapper over Vamper's Looper (github.com/FrunkQ/vamper,
 * installed by commit, see package.json): one song loaded at a time,
 * its slots turned into cues (vamperCues.ts), and the panel's
 * 0..100 volume mapped through the same perceptual taper as the
 * Soundboard. The Looper does the analysis (cached per song in its
 * own IndexedDB database), the bar-quantised changes and the joins.
 *
 * The AudioContext is only created on first play, which is always a
 * click, so the browser's autoplay policy never blocks it.
 */

import { Looper, snapToBar, type LoadProgress, type LooperState } from 'vamper';
import { AudioAssetStore } from './AudioAssetStore.ts';
import { perceptualVolume } from './volumeCurve.ts';
import { vamperCues } from './vamperCues.ts';
import type { SoundtrackSlot } from '../types.ts';

export class VamperSongPlayer {
  private looper:  Looper | null = null;
  private assetId: string | null = null;
  private title = '';
  private indexOf = new Map<string, number>();
  /** The load in flight, so a second click on the same song waits for it. */
  private loading: Promise<void> | null = null;

  /** The song loaded (or being loaded), if any. */
  get loadedAssetId(): string | null { return this.assetId; }

  /** Decode + analyse the library asset, unless it is already the
   *  loaded song. `onProgress` gets a one-line status for the panel. */
  async load(assetId: string, onProgress: (text: string) => void): Promise<void> {
    if (this.assetId === assetId && this.looper?.score?.final) return;
    if (this.assetId === assetId && this.loading) return this.loading;
    this.loading = this._load(assetId, onProgress).finally(() => { this.loading = null; });
    return this.loading;
  }

  private async _load(assetId: string, onProgress: (text: string) => void): Promise<void> {
    const asset = await AudioAssetStore.get(assetId);
    if (!asset) throw new Error('That song is no longer in the audio library.');
    const blob = await AudioAssetStore.getBlob(asset);
    if (!blob) throw new Error(`Couldn't read "${asset.name}" from the audio library.`);
    this.looper ??= new Looper();
    this.looper.stop();
    this.assetId = assetId;
    this.title   = asset.name;
    this.indexOf.clear();
    await this.looper.load(new File([blob], asset.name, { type: blob.type }), (p: LoadProgress) => {
      onProgress(_progressText(asset.name, p));
    });
  }

  /** Rebuild the cue list from the slots that use the loaded song. */
  setCues(slots: SoundtrackSlot[]): void {
    const l = this.looper;
    if (!l?.score || !this.assetId) return;
    const set = vamperCues(l.score, slots, this.assetId);
    l.cues = set.cues;
    this.indexOf = set.indexOf;
  }

  /** Play the slot's passage: from silence it starts at once, while
   *  playing it lands on the next bar. */
  goTo(slotId: string): void {
    const i = this.indexOf.get(slotId);
    if (i === undefined || !this.looper) return;
    if (this.looper.paused) this.looper.resume();
    this.looper.goTo(i);
  }

  /** Jump the playhead (song seconds, snapped to a bar) and play on —
   *  for auditioning where a passage should start or end. */
  seek(sec: number): void {
    const l = this.looper;
    if (!l?.score) return;
    l.play(snapToBar(l.score, sec));
  }

  /** Volume 0..100 (fader position), faded over `ms`. */
  setVolume(volume: number, ms = 0): void {
    this.looper?.setVolume(perceptualVolume(volume / 100), ms / 1000);
  }

  pause():  void { this.looper?.pause(); }
  resume(): void { this.looper?.resume(); }
  stop():   void { this.looper?.stop(); }
  get paused(): boolean { return !!this.looper?.paused; }

  state(): LooperState | null { return this.looper?.score ? this.looper.state() : null; }
  get durationSec(): number { return this.looper?.buffer?.duration ?? 0; }

  /** "Song · bar 12 · → Combat in 1.4 s" for the now-playing line. */
  nowPlaying(): string {
    const s = this.state();
    if (!s) return this.title || '…';
    const parts = [this.title, `bar ${s.bar}`];
    if (s.pending) parts.push(`→ ${s.pending.label} in ${s.pending.inSec.toFixed(1)} s`);
    return parts.join(' · ');
  }

  dispose(): void {
    this.looper?.dispose();
    this.looper  = null;
    this.assetId = null;
    this.indexOf.clear();
  }
}

function _progressText(name: string, p: LoadProgress): string {
  if (p.stage === 'decode') return `Loading "${name}"…`;
  if (p.stage === 'done')   return '';
  const pct = Math.round(p.done * 100);
  const eta = p.etaSec !== null ? ` · about ${Math.max(1, Math.round(p.etaSec))} s left` : '';
  return `Finding the bars in "${name}" (first time only): ${pct}%${eta}`;
}
