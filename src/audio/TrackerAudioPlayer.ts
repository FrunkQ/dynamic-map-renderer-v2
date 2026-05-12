/**
 * TrackerAudioPlayer — fire-and-forget playback for the motion tracker's
 * outgoing-ping and return-ping sound effects.
 *
 * Intentionally simple: each play() spawns a new <audio> element from the
 * cached data URL. Multiple concurrent plays naturally overlap (matching the
 * concurrent-rings behaviour). No master mute or volume — the tracker's own
 * `motionMuted` flag silences everything by halting scans before they fire.
 */
export class TrackerAudioPlayer {
  /** assetId → data URL. Cleared and refreshed via setOutgoing/setReturn. */
  private outgoingUrl: string | null = null;
  private returnUrl:   string | null = null;
  private outgoingAssetId: string | null = null;
  private returnAssetId:   string | null = null;
  private outgoingVolume = 0.8;
  private returnVolume   = 0.8;
  private _muteAll       = false;

  /** Silences the tracker ping without halting the visual scan — used
   *  by the Markers-panel master mute. The tracker animation keeps
   *  playing; only the audio is gated. */
  setMuteAll(muted: boolean): void { this._muteAll = muted; }

  setOutgoingVolume(v: number): void { this.outgoingVolume = Math.max(0, Math.min(1, v)); }
  setReturnVolume(v: number):   void { this.returnVolume   = Math.max(0, Math.min(1, v)); }

  setOutgoing(assetId: string | null, dataUrl: string | null): void {
    this.outgoingAssetId = assetId;
    this.outgoingUrl     = dataUrl;
  }

  setReturn(assetId: string | null, dataUrl: string | null): void {
    this.returnAssetId = assetId;
    this.returnUrl     = dataUrl;
  }

  getOutgoingAssetId(): string | null { return this.outgoingAssetId; }
  getReturnAssetId():   string | null { return this.returnAssetId;   }

  playOutgoing(): void { this._play(this.outgoingUrl, this.outgoingVolume); }
  playReturn():   void { this._play(this.returnUrl,   this.returnVolume);   }

  private _play(url: string | null, volume: number): void {
    if (!url || this._muteAll) return;
    const a = new Audio(url);
    a.volume = volume;
    void a.play().catch(() => { /* ignore autoplay rejection */ });
  }
}
