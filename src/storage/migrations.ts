import type { SessionState, AudioState } from '../types.ts';
import { STATE_VERSION, defaultSessionState, defaultMotionTrackerConfig } from '../types.ts';

/**
 * Schema migrators — chained version bumps applied to saved SessionState
 * loaded out of IndexedDB. Each migrator takes the prior version and returns
 * the next; keep them small, focused, and side-effect-free.
 *
 * Add a new migrator whenever STATE_VERSION is bumped.
 */

type Migrator = (saved: any) => any;

const MIGRATORS: Record<number, Migrator> = {
  // v1 → v2
  //   • marker.role: 'default' | 'audio_source' | 'listener'   →  marker.roles.audio: 'source' | 'listener'
  //   • marker.motionSource: boolean                            →  marker.roles.motion: 'source'
  //   • drops the deprecated trackerEnabled / trackerScale / hiddenFromTracker fields
  1: (saved: any) => {
    const markers = Array.isArray(saved.markers) ? saved.markers.map(_migrateMarker_v1_v2) : [];
    return { ...saved, version: 2, markers };
  },
};

function _migrateMarker_v1_v2(m: any): any {
  const roles: { audio?: 'source' | 'listener'; motion?: 'source' } = {};
  if (m.role === 'audio_source') roles.audio = 'source';
  else if (m.role === 'listener') roles.audio = 'listener';
  if (m.motionSource === true) roles.motion = 'source';

  const {
    role: _r, motionSource: _ms, trackerEnabled: _te, trackerScale: _ts, hiddenFromTracker: _hft,
    ...rest
  } = m;
  void _r; void _ms; void _te; void _ts; void _hft;

  // New v2 fields with sensible defaults
  return {
    ...rest,
    roles,
    motionMuted:    typeof m.motionMuted === 'boolean' ? m.motionMuted : false,
    motionBlobMode: m.motionBlobMode === 'cluster' ? 'cluster' : 'single',
  };
}

/**
 * Migrate a saved SessionState forward to the latest STATE_VERSION.
 * Returns null if the saved state cannot be understood (no version or version too new).
 */
export function migrateSessionState(saved: any): SessionState | null {
  if (!saved || typeof saved !== 'object') return null;

  // Treat a missing/zero version as v1 (the format we shipped before STATE_VERSION existed)
  let v = typeof saved.version === 'number' && saved.version > 0 ? saved.version : 1;
  let cur = { ...saved, version: v };

  while (v < STATE_VERSION) {
    const fn = MIGRATORS[v];
    if (!fn) return null; // gap in migrator chain — refuse rather than silently corrupt
    cur = fn(cur);
    v   = cur.version;
  }

  if (v !== STATE_VERSION) return null;

  // Backward-compat normalisation that isn't tied to a specific version bump:
  // very old saves had {activeAmbientId, volume} for audio without slots[];
  // pre-B3 saves don't have motionTracker at all.
  const base = defaultSessionState();
  const audio: AudioState = cur.audio && Array.isArray(cur.audio.slots)
    ? { slots: cur.audio.slots }   // strip dead audio.motionTracker stub if present
    : base.audio;

  return {
    ...cur,
    // Merge view so newly-added fields (e.g. backgroundColor) fall back to defaults.
    view:    { ...base.view, ...(cur.view ?? {}) },
    markers: Array.isArray(cur.markers) ? cur.markers : base.markers,
    audio,
    motionTracker: cur.motionTracker ?? defaultMotionTrackerConfig(),
  } as SessionState;
}
