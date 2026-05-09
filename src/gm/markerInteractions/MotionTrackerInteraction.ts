import type { Marker, MotionTrackerConfig } from '../../types.ts';
import { defaultMotionTrackerConfig } from '../../types.ts';
import type { MarkerInteraction, InteractionContext } from './MarkerInteraction.ts';

export interface ActiveScan {
  /** performance.now() at scan start. */
  startTime: number;
  /** Tracker marker position (normalised map coords) at scan start. */
  centre:    { x: number; y: number };
  /** Detection radius this scan was launched with. */
  range:     number;
  /** Seconds the ring takes to reach `range`. */
  speedSecs: number;
  /** Ring + blob colour. */
  colour:    string;
}

export interface ActiveBlob {
  /** performance.now() at hit moment. */
  startTime: number;
  /** Detected source marker (used so the renderer can read its size/icon footprint). */
  sourceId:  string;
  /** Map-coords at hit moment (snapshotted in case the source moves). */
  position:  { x: number; y: number };
  /** Fade duration — equals the tracker rate so blobs are gone before the next scan. */
  fadeMs:    number;
  /** 'single' or 'cluster' mode at hit time. */
  mode:      'single' | 'cluster';
}

/**
 * Drives the motion-tracker scan/detect cycle off marker state.
 * Emitter:  markers with roles.motion === 'source' (and motionMuted !== true)
 * Receiver: the singleton marker with roles.motion === 'tracker' (and motionMuted !== true)
 *
 * State machine: idle → scanning (speedSecs) → idle (rate − speed) → scanning → ...
 *
 * The interaction owns timing only; rendering and audio playback are handled
 * by callbacks the host supplies. P2P broadcast is layered on later (B6).
 */
export class MotionTrackerInteraction implements MarkerInteraction {
  readonly id = 'motionTracker';

  /** Hardcoded for B2 — B3 will source this from per-map state. */
  private config: MotionTrackerConfig = defaultMotionTrackerConfig();

  private trackerId:  string | null = null;
  /** Latest marker array — captured each onMarkersChanged so a scheduled scan can find the live tracker. */
  private markers:    Marker[] = [];
  private sources:    Marker[] = [];
  /** Map aspect ratio (width/height). X-distances must be scaled by this so the
   *  detection circle matches the visual ring radius on non-square maps. */
  private mapAspect:  number = 1;
  /** Multiple concurrent scans when rate < speed — each ring expires after speedSecs. */
  private active:     ActiveScan[] = [];
  private blobs:      ActiveBlob[] = [];

  private nextScanTimer:    ReturnType<typeof setTimeout> | null = null;
  private hitTimers:        ReturnType<typeof setTimeout>[]      = [];

  /** Fired whenever rendering state changes (scan start/end/source hit). Host wires to a redraw. */
  onChange?: () => void;
  /** Fired at the moment a scan begins — host plays the outgoing ping. */
  onScanStart?: (scan: ActiveScan) => void;
  /** Fired when the ring crosses a source — host plays the return ping. */
  onSourceHit?: (source: Marker) => void;

  // ── Public read-only state for renderers ───────────────────────────────────

  /** All currently expanding scan rings. Multiple may overlap when rate < speed. */
  getActiveScans(): ActiveScan[]     { return this.active; }
  getActiveBlobs(): ActiveBlob[]     { return this.blobs;  }
  getConfig(): MotionTrackerConfig   { return this.config; }

  /** B3 entry point — host swaps config in when state.motionTracker changes. */
  setConfig(cfg: MotionTrackerConfig): void {
    this.config = cfg;
    // Kick the scheduler if anything material to timing changed
    if (this.trackerId) this._rescheduleNextScan(this.config.rate * 1000);
  }

  /** Host calls this on map load so detection geometry matches the visual ring. */
  setMapAspect(ar: number): void {
    this.mapAspect = Math.max(0.0001, ar);
  }

  // ── MarkerInteraction hooks ────────────────────────────────────────────────

  onMarkersChanged(_ctx: InteractionContext): void {
    this.markers = _ctx.markers;
    const tracker = this.markers.find((m) => m.roles.motion === 'tracker' && !m.motionMuted) ?? null;
    this.sources  = this.markers.filter((m) => m.roles.motion === 'source' && !m.motionMuted);

    if (!tracker) {
      // Tracker absent or muted — stop everything
      if (this.trackerId !== null) this._stopAll();
      this.trackerId = null;
      return;
    }

    if (this.trackerId !== tracker.id) {
      // New tracker (or first tracker) — fresh scan loop, with no delay before first ping
      this._stopAll();
      this.trackerId = tracker.id;
      this._scheduleScan(0);
    }
    // Tracker position may have moved — that takes effect on the *next* scan, not the active one
  }

  /** Map-load entry point — `loadForMap` notifies ['map','view','filter','fog'] without 'markers',
   *  so onMarkersChanged never fires on a fresh load. We reuse the same logic here. */
  async onMapLoaded(ctx: InteractionContext): Promise<void> {
    this.onMarkersChanged(ctx);
  }

  reset(): void {
    this._stopAll();
    this.trackerId = null;
    this.sources   = [];
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private _stopAll(): void {
    if (this.nextScanTimer) { clearTimeout(this.nextScanTimer); this.nextScanTimer = null; }
    for (const t of this.hitTimers) clearTimeout(t);
    this.hitTimers = [];
    this.active    = [];
    this.blobs     = [];
    this.onChange?.();
  }

  private _scheduleScan(delayMs: number): void {
    if (this.nextScanTimer) clearTimeout(this.nextScanTimer);
    this.nextScanTimer = setTimeout(() => {
      this.nextScanTimer = null;
      this._startScan();
    }, delayMs);
  }

  /** Cancel and re-arm the next-scan timer (used when config.rate changes mid-cycle). */
  private _rescheduleNextScan(rateMs: number): void {
    if (!this.trackerId) return;
    this._scheduleScan(rateMs);
  }

  private _startScan(): void {
    // Re-resolve the tracker's *current* position each time so it follows drags
    const tracker = this.trackerId ? this.markers.find((m) => m.id === this.trackerId) : null;
    if (!tracker || tracker.motionMuted) {
      this._stopAll();
      this.trackerId = null;
      return;
    }
    const centre = { ...tracker.position };
    const cfg = this.config;
    const scan: ActiveScan = {
      startTime: performance.now(),
      centre,
      range:     cfg.range,
      speedSecs: cfg.speed,
      colour:    cfg.colour,
    };
    this.active.push(scan);
    this.onScanStart?.(scan);
    this.onChange?.();

    // Schedule per-source hits at t = (dist / range) * speed.
    // Distances are computed in Y-axis-normalised units (the same units the
    // ring's pixel radius is drawn in), so X-deltas get multiplied by aspect.
    for (const src of this.sources) {
      const dx = (src.position.x - centre.x) * this.mapAspect;
      const dy =  src.position.y - centre.y;
      const dist = Math.hypot(dx, dy);
      if (dist > cfg.range) continue;
      const tMs = (dist / cfg.range) * cfg.speed * 1000;
      const handle = setTimeout(() => this._fireHit(src), tMs);
      this.hitTimers.push(handle);
    }

    // Schedule next scan relative to *this* scan's start (rate is start-to-start).
    // When rate < speed the new scan begins while the previous ring is still
    // expanding — both rings are rendered together until each expires.
    const rateMs  = cfg.rate * 1000;
    this._scheduleScan(Math.max(0, rateMs));
  }

  private _fireHit(source: Marker): void {
    if (this.active.length === 0) return;
    this.blobs.push({
      startTime: performance.now(),
      sourceId:  source.id,
      position:  { ...source.position },
      fadeMs:    this.config.rate * 1000,
      mode:      source.motionBlobMode,
    });
    this.onSourceHit?.(source);
    this.onChange?.();
  }

  /** Prune expired scans + fully-faded blobs. Call from the render loop. */
  pruneFaded(now = performance.now()): void {
    const beforeScans = this.active.length;
    const beforeBlobs = this.blobs.length;
    this.active = this.active.filter((s) => now - s.startTime < s.speedSecs * 1000);
    this.blobs  = this.blobs.filter((b) => now - b.startTime < b.fadeMs);
    if (this.active.length !== beforeScans || this.blobs.length !== beforeBlobs) this.onChange?.();
  }
}
