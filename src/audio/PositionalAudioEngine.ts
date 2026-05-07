import type { Marker } from '../types.ts';

interface Source {
  node:       AudioBufferSourceNode | null; // null = between random plays
  gain:       GainNode;
  assetId:    string;
  x:          number;
  y:          number;
  maxDist:    number;
  volume:     number;
  loop:       boolean;
  random:     boolean;
  randomFreq: number;
  randomTimer?: ReturnType<typeof setTimeout>;
}

/**
 * Positional audio engine for marker-based audio sources.
 *
 * Behaves like the soundboard engine (loop / random / one-shot) but multiplies
 * gain by an inverse-square distance attenuation based on a listener marker.
 *
 * Coordinate system: normalised map coords (0–1 on each axis).
 * Gain formula:
 *   refDistance = maxDistance * 0.1  (full volume within 10% of range)
 *   positionalGain = clamp(refDist² / dist², 0, 1)
 *   finalGain = baseVolume * positionalGain
 */
export class PositionalAudioEngine {
  private ctx:        AudioContext | null = null;
  private sources     = new Map<string, Source>();    // markerId → Source
  private buffers     = new Map<string, AudioBuffer>(); // assetId → decoded buffer
  private listenerX   = 0.5;
  private listenerY   = 0.5;
  private hasListener = false;

  /** Fired when a source starts playing (or a random one-shot fires).
   *  GMApp uses this to broadcast positional_play to players. */
  onSourceStart?: (markerId: string, assetId: string, loop: boolean, gain: number) => void;
  /** Fired when a source is explicitly removed.
   *  GMApp uses this to broadcast positional_stop to players. */
  onSourceStop?: (markerId: string) => void;

  // ── Buffer management ────────────────────────────────────────────────────

  async storeBuffer(assetId: string, raw: ArrayBuffer): Promise<void> {
    if (this.buffers.has(assetId)) return;
    console.log(`[PAE] storeBuffer: decoding assetId=${assetId} (${raw.byteLength} bytes)`);
    try {
      const ctx = this._ctx();
      const buf = await ctx.decodeAudioData(raw.slice(0));
      this.buffers.set(assetId, buf);
      console.log(`[PAE] storeBuffer: decoded OK assetId=${assetId} duration=${buf.duration.toFixed(2)}s`);
    } catch (err) {
      console.error(`[PAE] storeBuffer: decode FAILED assetId=${assetId}`, err);
    }
  }

  // ── State updates (called on every marker_update) ────────────────────────

  setListenerPosition(x: number, y: number): void {
    const wasListener = this.hasListener;
    this.listenerX   = x;
    this.listenerY   = y;
    this.hasListener = true;
    // Listener just appeared — notify GMApp about sources that are already running
    if (!wasListener && this.onSourceStart) {
      for (const [id, src] of this.sources.entries()) {
        if (src.node !== null) {
          this.onSourceStart(id, src.assetId, src.loop, this._calcGain(src.x, src.y, src.maxDist, src.volume));
        }
      }
    }
    this._refreshGains();
  }

  clearListener(): void {
    console.warn('[PAE] clearListener: no listener marker — all positional audio silenced');
    this.hasListener = false;
    for (const src of this.sources.values()) src.gain.gain.value = 0;
  }

  /**
   * Reconcile the live source set with the current marker array.
   * Call this whenever marker_update arrives (after updating listener position).
   */
  setSources(markers: Marker[]): void {
    const wanted = new Map<string, Marker>(
      markers
        .filter((m) => m.role === 'audio_source' && m.audioTrackId && !m.audioMuted)
        .map((m) => [m.id, m])
    );
    const noBuffer = [...wanted.values()].filter((m) => !this.buffers.has(m.audioTrackId!));
    console.log(
      `[PAE] setSources: total=${markers.length} wanted=${wanted.size} noBuffer=${noBuffer.length}` +
      (noBuffer.length ? ` missing=[${noBuffer.map((m) => m.audioTrackId).join(', ')}]` : '') +
      ` ctxState=${this.ctx?.state ?? 'not created'} hasListener=${this.hasListener}` +
      (this.hasListener ? ` listener=(${this.listenerX.toFixed(3)}, ${this.listenerY.toFixed(3)})` : '')
    );

    // Stop and remove sources that are no longer wanted
    for (const [id, src] of this.sources.entries()) {
      if (!wanted.has(id)) {
        this.onSourceStop?.(id);
        this._stopSource(src);
        this.sources.delete(id);
      }
    }

    // Start or update remaining/new sources
    for (const [id, marker] of wanted.entries()) {
      const existing = this.sources.get(id);
      const buf      = this.buffers.get(marker.audioTrackId!);
      const isRandom = !!(marker.audioRandom && !marker.audioLoop);

      if (!buf) continue; // buffer not yet received

      if (existing && existing.assetId === marker.audioTrackId) {
        // Same sound — check if playback mode has changed
        if (existing.loop !== marker.audioLoop || existing.random !== isRandom) {
          // Mode changed — restart with new settings
          this._stopSource(existing);
          this.sources.delete(id);
          this._startSource(id, marker, buf);
        } else {
          // Update mutable params in place
          existing.x          = marker.position.x;
          existing.y          = marker.position.y;
          existing.maxDist    = marker.audioMaxDistance;
          existing.volume     = marker.audioVolume ?? 1;
          existing.randomFreq = marker.audioRandomFreq ?? 10;
        }
      } else {
        // New sound or asset changed
        if (existing) { this._stopSource(existing); this.sources.delete(id); }
        this._startSource(id, marker, buf);
      }
    }

    this._refreshGains();
  }

  /**
   * Called when a new buffer arrives — start any sources that were waiting for it.
   */
  onBufferReady(assetId: string, markers: Marker[]): void {
    for (const m of markers) {
      if (
        m.role === 'audio_source' &&
        m.audioTrackId === assetId &&
        !m.audioMuted &&
        !this.sources.has(m.id)
      ) {
        const buf = this.buffers.get(assetId);
        if (buf) this._startSource(m.id, m, buf);
      }
    }
    this._refreshGains();
  }

  /** Compute the current positional gain for a marker (used by GMApp for volume broadcasts). */
  calcGainForMarker(m: Marker): number {
    if (!this.hasListener) return 0;
    return this._calcGain(m.position.x, m.position.y, m.audioMaxDistance, m.audioVolume ?? 1);
  }

  /** Call on any user gesture to unblock the browser's autoplay policy. */
  tryResume(): void {
    if (!this.ctx) return;
    console.log(`[PAE] tryResume: ctx.state=${this.ctx.state}`);
    if (this.ctx.state === 'suspended') void this.ctx.resume().then(() => {
      console.log('[PAE] tryResume: context resumed OK');
    });
  }

  dispose(): void {
    for (const src of this.sources.values()) this._stopSource(src);
    this.sources.clear();
    void this.ctx?.close();
    this.ctx = null;
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private _ctx(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private _startSource(markerId: string, marker: Marker, buf: AudioBuffer): void {
    const ctx  = this._ctx();
    console.log(
      `[PAE] _startSource: markerId=${markerId} assetId=${marker.audioTrackId} ` +
      `loop=${marker.audioLoop} random=${marker.audioRandom} pos=(${marker.position.x.toFixed(3)},${marker.position.y.toFixed(3)}) ` +
      `maxDist=${marker.audioMaxDistance} volume=${marker.audioVolume ?? 1} ctxState=${ctx.state}`
    );
    const gain = ctx.createGain();
    gain.gain.value = 0; // _refreshGains sets real value
    gain.connect(ctx.destination);

    const isRandom = !!(marker.audioRandom && !marker.audioLoop);

    const src: Source = {
      node:       null,
      gain,
      assetId:    marker.audioTrackId!,
      x:          marker.position.x,
      y:          marker.position.y,
      maxDist:    marker.audioMaxDistance,
      volume:     marker.audioVolume ?? 1,
      loop:       marker.audioLoop,
      random:     isRandom,
      randomFreq: marker.audioRandomFreq ?? 10,
    };
    this.sources.set(markerId, src);

    if (isRandom) {
      this._scheduleRandom(markerId);
    } else {
      const node = ctx.createBufferSource();
      node.buffer = buf;
      node.loop   = marker.audioLoop;
      node.connect(gain);
      node.start();
      src.node = node;
      // Notify GMApp so it can broadcast positional_play to players
      if (this.hasListener) {
        this.onSourceStart?.(markerId, src.assetId, src.loop,
          this._calcGain(src.x, src.y, src.maxDist, src.volume));
      }
      // For non-looping one-shots: clean up when done
      if (!marker.audioLoop) {
        node.onended = () => { src.node = null; };
      }
    }
  }

  private _stopSource(src: Source): void {
    if (src.randomTimer !== undefined) clearTimeout(src.randomTimer);
    if (src.node) {
      try { src.node.stop(); } catch { /* already stopped */ }
      src.node.disconnect();
    }
    src.gain.disconnect();
  }

  private _scheduleRandom(markerId: string): void {
    const src = this.sources.get(markerId);
    if (!src || !src.random) return;
    const baseMs = (10 * 60 * 1000) / src.randomFreq;
    const delay  = Math.min(-Math.log(Math.random() || 1e-9) * baseMs, 4 * baseMs);
    src.randomTimer = setTimeout(() => this._triggerRandom(markerId), delay);
  }

  private _triggerRandom(markerId: string): void {
    const src = this.sources.get(markerId);
    if (!src || !src.random) return;
    const buf = this.buffers.get(src.assetId);
    if (!buf) { this._scheduleRandom(markerId); return; }

    const ctx  = this._ctx();
    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.loop   = false;
    node.connect(src.gain);
    const gain2 = this._calcGain(src.x, src.y, src.maxDist, src.volume);
    src.gain.gain.value = gain2;
    node.start();
    src.node = node;
    // Notify GMApp so it can broadcast each random fire to players
    this.onSourceStart?.(markerId, src.assetId, false, gain2);
    node.onended = () => {
      src.node = null;
      this._scheduleRandom(markerId);
    };
  }

  private _lastGainLog = 0;

  private _refreshGains(): void {
    if (!this.hasListener) return;
    const now = Date.now();
    const doLog = now - this._lastGainLog > 2000;
    if (doLog) this._lastGainLog = now;

    for (const [id, src] of this.sources.entries()) {
      if (src.node !== null) {
        const g = this._calcGain(src.x, src.y, src.maxDist, src.volume);
        src.gain.gain.value = g;
        if (doLog) {
          const dx = src.x - this.listenerX, dy = src.y - this.listenerY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          console.log(
            `[PAE] gain markerId=${id} gain=${g.toFixed(4)} dist=${dist.toFixed(4)} ` +
            `maxDist=${src.maxDist} src=(${src.x.toFixed(3)},${src.y.toFixed(3)}) ` +
            `listener=(${this.listenerX.toFixed(3)},${this.listenerY.toFixed(3)})`
          );
        }
      } else if (doLog) {
        console.log(`[PAE] gain markerId=${id} — node=null (between random firings or idle)`);
      }
    }
  }

  private _calcGain(sx: number, sy: number, maxDist: number, volume = 1): number {
    const dx   = sx - this.listenerX;
    const dy   = sy - this.listenerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= maxDist || maxDist <= 0) return 0;
    if (dist < 1e-6) return volume;
    const ref = maxDist * 0.1;
    return volume * Math.min(1, (ref * ref) / (dist * dist));
  }
}
