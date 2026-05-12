/**
 * SoundboardEngine — GM-side audio playback.
 *
 * Manages one HTMLAudioElement per active slot.
 * Slots can play/stop/loop independently with individual volumes.
 * Blobs are stored as object URLs and data URLs for P2P delivery.
 */
export class SoundboardEngine {
  private audioEls  = new Map<string, HTMLAudioElement>(); // slotId → <audio>
  private blobUrls  = new Map<string, string>();            // assetId → object URL
  private dataUrls  = new Map<string, string>();            // assetId → data URL
  private _muteAll  = false;
  /** Slots paused by setMuteAll(true) — used to resume the right ones on unmute. */
  private _pausedByMute = new Set<string>();

  /** Fired when a non-looping slot finishes playing naturally. */
  onSlotEnded: ((slotId: string) => void) | null = null;

  prepareAsset(assetId: string, blobUrl: string, dataUrl: string): void {
    const old = this.blobUrls.get(assetId);
    if (old) URL.revokeObjectURL(old);
    this.blobUrls.set(assetId, blobUrl);
    this.dataUrls.set(assetId, dataUrl);
  }

  play(slotId: string, assetId: string, loop: boolean, volume: number): Promise<void> {
    const blobUrl = this.blobUrls.get(assetId);
    if (!blobUrl) return Promise.resolve();

    let el = this.audioEls.get(slotId);
    if (!el) {
      el = new Audio();
      this.audioEls.set(slotId, el);
    }

    if (el.src !== blobUrl) {
      el.pause();
      el.src = blobUrl;
    }

    // Always restart from the beginning — supports pew-pew retriggering
    el.currentTime = 0;
    el.loop        = loop;
    el.volume      = Math.max(0, Math.min(1, volume));
    el.muted       = this._muteAll;

    // Wire ended callback so one-shot sounds reset the play button
    el.onended = loop ? null : () => { this.onSlotEnded?.(slotId); };

    return el.play().catch(() => { /* autoplay blocked — caller handles */ });
  }

  stop(slotId: string): void {
    const el = this.audioEls.get(slotId);
    if (!el) return;
    el.pause();
    el.currentTime = 0;
  }

  stopAll(): void {
    for (const slotId of this.audioEls.keys()) this.stop(slotId);
  }

  setVolume(slotId: string, volume: number): void {
    const el = this.audioEls.get(slotId);
    if (el) el.volume = Math.max(0, Math.min(1, volume));
  }

  setLoop(slotId: string, loop: boolean): void {
    const el = this.audioEls.get(slotId);
    if (!el) return;
    el.loop = loop;
    // Re-wire ended callback based on new loop state
    el.onended = loop ? null : () => { this.onSlotEnded?.(slotId); };
  }

  setMuteAll(muted: boolean): void {
    const wasMuted = this._muteAll;
    this._muteAll = muted;
    if (muted && !wasMuted) {
      // Snapshot which slots are currently playing so unmute can resume
      // exactly those — pausing freezes the playback position so looping
      // background tracks pick up where they left off.
      this._pausedByMute.clear();
      for (const [slotId, el] of this.audioEls.entries()) {
        if (!el.paused) {
          this._pausedByMute.add(slotId);
          el.pause();
        }
      }
    } else if (!muted && wasMuted) {
      // Clear el.muted on anything that was started during the mute
      // (play() copies this._muteAll onto the new element), then resume
      // the slots we paused so loops continue where they left off.
      for (const el of this.audioEls.values()) el.muted = false;
      for (const slotId of this._pausedByMute) {
        const el = this.audioEls.get(slotId);
        if (el) void el.play().catch(() => { /* autoplay blocked — caller handles */ });
      }
      this._pausedByMute.clear();
    }
  }

  isMutedAll(): boolean { return this._muteAll; }

  isPlaying(slotId: string): boolean {
    const el = this.audioEls.get(slotId);
    return !!el && !el.paused;
  }

  isLoaded(assetId: string): boolean {
    return this.blobUrls.has(assetId);
  }

  /** 0–1 playback progress for a slot; -1 if not playing or duration unknown. */
  getProgress(slotId: string): number {
    const el = this.audioEls.get(slotId);
    if (!el || el.paused || !el.duration || isNaN(el.duration)) return -1;
    return el.currentTime / el.duration;
  }

  getDataUrl(assetId: string): string | undefined {
    return this.dataUrls.get(assetId);
  }

  unloadAsset(assetId: string): void {
    const blobUrl = this.blobUrls.get(assetId);
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      this.blobUrls.delete(assetId);
    }
    this.dataUrls.delete(assetId);
  }

  dispose(): void {
    this.stopAll();
    for (const url of this.blobUrls.values()) URL.revokeObjectURL(url);
    this.blobUrls.clear();
    this.dataUrls.clear();
    this.audioEls.clear();
  }
}
