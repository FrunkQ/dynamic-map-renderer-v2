/**
 * Convert legacy SoundtracksConfig (the v2.15.7–v2.15.11 fixed-slot
 * shape) to the v2.15.12+ N-slot shape. Idempotent — already-new
 * configs pass through unchanged. The migration is one-shot per
 * config object; results aren't persisted until the user saves.
 *
 * Legacy shape had four optional slots: { preSetup, theme, outro,
 * playlist } where each was { volume?, tracks: [] }. The new shape
 * is { slots: SoundtrackSlot[] } where slots[0] is the silent anchor
 * and the rest are user-authored.
 */

import type { SoundtracksConfig, SoundtrackSlot, SoundtrackTrack } from '../types.ts';
import { generateId } from '../utils/id.ts';

/** Legacy slot shape from v2.15.7..v2.15.19. Carried tracks[] and a
 *  mode picker; v2.15.20 collapsed it to a single-track-per-slot. */
interface LegacySlot {
  id?:       string;
  label?:    string;
  mode?:     'silent' | 'play-once' | 'loop' | 'playlist' | 'normal';
  tracks?:   unknown[];
  track?:    unknown;
  volume?:   number;
  startSec?: number;
  endSec?:   number;
  shuffle?:  boolean;
  loop?:     boolean;
}
interface LegacyFixedShape {
  preSetup?: LegacySlot;
  theme?:    LegacySlot;
  outro?:    LegacySlot;
  playlist?: LegacySlot;
  slots?:    unknown;
  crossfadeMs?: number;
}

const DEFAULT_CROSSFADE_MS = 1500;

/** Bring any shape (current, fixed-keys legacy, multi-track legacy) up
 *  to the current single-track-per-slot SoundtracksConfig. */
export function migrateSoundtracksConfig(input: SoundtracksConfig | LegacyFixedShape | undefined): SoundtracksConfig {
  if (!input) return _withSilent({ slots: [], crossfadeMs: DEFAULT_CROSSFADE_MS });

  // Slots-array shape (current or v2.15.7..19 multi-track flavour).
  if (Array.isArray((input as SoundtracksConfig).slots)) {
    const slots = ((input as { slots: LegacySlot[] }).slots ?? []).map(_migrateSlot);
    return _withSilent({
      slots,
      crossfadeMs: (input as SoundtracksConfig).crossfadeMs ?? DEFAULT_CROSSFADE_MS,
    });
  }

  // Original v2.15.7 fixed-keys shape — translate each populated key.
  const legacy = input as LegacyFixedShape;
  const out: SoundtrackSlot[] = [];
  const carry = (label: string, l: LegacySlot | undefined): void => {
    if (!l) return;
    const migrated = _migrateSlot({ ...l, label });
    if (migrated.kind !== 'silent' && (migrated.track || migrated.kind === 'normal')) {
      out.push(migrated);
    }
  };
  carry('Pre-setup', legacy.preSetup);
  carry('Theme',     legacy.theme);
  carry('Outro',     legacy.outro);
  carry('Playlist',  legacy.playlist);
  return _withSilent({
    slots: out,
    crossfadeMs: legacy.crossfadeMs ?? DEFAULT_CROSSFADE_MS,
  });
}

function _migrateSlot(raw: LegacySlot): SoundtrackSlot {
  const id    = typeof raw.id === 'string' ? raw.id : generateId();
  const label = typeof raw.label === 'string' ? raw.label : 'Slot';
  // Silent anchor preserved verbatim.
  if (raw.mode === 'silent') {
    return { id, label, kind: 'silent' };
  }
  // Single-track field already present (current shape).
  if (_isTrack(raw.track)) {
    return _buildNormal(id, label, raw.track, raw);
  }
  // Legacy tracks[] — keep the first item; drop extras silently.
  // Variety is now achieved by adding more slots, not by packing
  // multiple items into one. The user can copy-add the missing
  // tracks as fresh slots if they want them back.
  if (Array.isArray(raw.tracks)) {
    const first = raw.tracks.find(_isTrack);
    if (first) return _buildNormal(id, label, first, raw);
  }
  return { id, label, kind: 'normal' };
}

function _buildNormal(
  id: string,
  label: string,
  track: SoundtrackTrack,
  raw: LegacySlot,
): SoundtrackSlot {
  const loop = raw.loop ?? (raw.mode === 'loop' || raw.mode === 'playlist');
  const base: SoundtrackSlot = { id, label, kind: 'normal', track, loop };
  if (raw.shuffle  !== undefined) base.shuffle  = raw.shuffle;
  if (raw.startSec !== undefined) base.startSec = raw.startSec;
  if (raw.endSec   !== undefined) base.endSec   = raw.endSec;
  if (raw.volume   !== undefined) base.volume   = raw.volume;
  return base;
}

function _isTrack(v: unknown): v is SoundtrackTrack {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  if (r['kind'] === 'youtube'          && typeof r['videoId']  === 'string') return true;
  if (r['kind'] === 'youtube-playlist' && typeof r['listId']   === 'string') return true;
  if (r['kind'] === 'spotify'          && typeof r['trackUri'] === 'string') return true;
  if (r['kind'] === 'vamper'           && typeof r['assetId']  === 'string') return true;
  return false;
}

/** Guarantee a silent anchor slot at index 0. v2.15.31 renamed
 *  the label from "Silent" to "Silence" so any existing config
 *  that carries the old label normalises on the way through. */
function _withSilent(cfg: SoundtracksConfig): SoundtracksConfig {
  const SILENT_ID = '_silent';
  const first = cfg.slots[0];
  if (first && first.id === SILENT_ID && first.kind === 'silent') {
    if (first.label !== 'Silence') {
      return { ...cfg, slots: [{ ...first, label: 'Silence' }, ...cfg.slots.slice(1)] };
    }
    return cfg;
  }
  return {
    ...cfg,
    slots: [
      { id: SILENT_ID, label: 'Silence', kind: 'silent' },
      ...cfg.slots.filter((s) => s.id !== SILENT_ID),
    ],
  };
}

export function newUserSlot(label = 'New slot'): SoundtrackSlot {
  return {
    id:    generateId(),
    label,
    kind:  'normal',
  };
}
