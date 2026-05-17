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
    motionBlobMode: m.motionBlobMode === 'cluster'    ? 'multi-few' :
                    m.motionBlobMode === 'multi-few'  ? 'multi-few' :
                    m.motionBlobMode === 'multi-many' ? 'multi-many' :
                                                       'single',
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

  // Backfill null ping IDs with the new builtin defaults so existing tracker
  // configs (saved before B5) auto-pick-up the seeded CC0 sounds.
  const baseTracker  = defaultMotionTrackerConfig();
  const savedTracker = cur.motionTracker ?? baseTracker;
  const motionTracker = {
    ...savedTracker,
    outgoingPingAssetId: savedTracker.outgoingPingAssetId ?? baseTracker.outgoingPingAssetId,
    returnPingAssetId:   savedTracker.returnPingAssetId   ?? baseTracker.returnPingAssetId,
    outgoingPingVolume:  typeof savedTracker.outgoingPingVolume === 'number' ? savedTracker.outgoingPingVolume : baseTracker.outgoingPingVolume,
    returnPingVolume:    typeof savedTracker.returnPingVolume   === 'number' ? savedTracker.returnPingVolume   : baseTracker.returnPingVolume,
  };

  // v2.12 overlay unification — pre-v2.12 polygons don't have a `kind` field;
  // promote them to kind:'fog' so they keep rendering as black fog. Drop any
  // intermediate dev-only fields (fog.brush, mapfx.*) — none of that v2.12
  // dev state has been pushed.
  //
  // Preserve `holes` (donut shapes) and `shaderParams` (per-poly tuning) so
  // a reload doesn't reset the GM's work. Bug fix 2026-05-14: earlier the
  // field-by-field rebuild was silently dropping both.
  //
  // Mid-v2.12 (2026-05-14) the OverlayKind union was trimmed to just the
  // fully-supported kinds (fog / fire / river / ocean / light). Any saved
  // polygon with a now-removed kind (cold/smoke/blood/water/shadow/
  // electric/poison/holy/healing/fear) is migrated to 'fog' so the shape
  // is preserved and the GM can morph it via the dropdown if they want.
  // Keep in sync with the OverlayKind union in types.ts. Adding a new
  // kind without listing it here causes a silent data-loss bug —
  // saved polygons of the new kind get coerced to 'fog' on reload.
  // Caught 2026-05-17 when 'transparent' polygons came back as fog.
  const SUPPORTED_KINDS: Record<string, boolean> = {
    fog: true, fire: true, firestorm: true, river: true, ocean: true,
    light: true, starfield: true, portal: true, thundercloud: true,
    mist: true, aurora: true, embers: true, noise: true, transparent: true,
  };
  const coerceKind = (k: any): string => (typeof k === 'string' && SUPPORTED_KINDS[k]) ? k : 'fog';
  const rawFog = (cur.fog && Array.isArray(cur.fog.polygons)) ? cur.fog.polygons : [];
  const polygons = rawFog.map((p: any) => {
    const out: any = {
      id:        p?.id ?? '',
      kind:      coerceKind(p?.kind),
      vertices:  Array.isArray(p?.vertices) ? p.vertices : [],
      createdAt: typeof p?.createdAt === 'number' ? p.createdAt : Date.now(),
    };
    if (typeof p?.color === 'string')    out.color = p.color;
    if (typeof p?.label === 'string')    out.label = p.label;
    if (Array.isArray(p?.holes))         out.holes = p.holes;
    if (typeof p?.edgeFade === 'number') out.edgeFade = p.edgeFade;
    if (p?.shaderParams && typeof p.shaderParams === 'object') out.shaderParams = p.shaderParams;
    return out;
  }).filter((p: any) => p.id && p.vertices.length >= 3);
  const fog: any = { polygons };
  // Carry the kind-level shaderParams draft forward too. Without this the
  // GM's "next new polygon" tuning resets to defaults on every reload.
  if (cur.fog?.shaderParams && typeof cur.fog.shaderParams === 'object') {
    fog.shaderParams = cur.fog.shaderParams;
  }

  return {
    ...cur,
    // Merge view so newly-added fields (e.g. backgroundColor) fall back to defaults.
    view:    { ...base.view, ...(cur.view ?? {}) },
    markers: Array.isArray(cur.markers) ? cur.markers : base.markers,
    audio,
    motionTracker,
    fog,
  } as SessionState;
}
