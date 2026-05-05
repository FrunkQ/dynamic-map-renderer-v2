import { getAllMaps, getMap, saveMap, loadConfig, saveConfig } from './db.ts';
import type { SessionState, StoredMap } from '../types.ts';

const BUNDLE_VERSION = 1;

interface MapEntry {
  id:       string;
  name:     string;
  addedAt:  number;
  mimeType: string;
  imageB64: string;
  config:   SessionState | null;
}

export interface DMRBundle {
  version:    typeof BUNDLE_VERSION;
  exportedAt: number;
  maps:       MapEntry[];
}

// ─── Encoding helpers ─────────────────────────────────────────────────────────

/** ArrayBuffer → base64 string, chunked to avoid call-stack limits on large files */
function ab2b64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (let i = 0; i < bytes.length; i += 65536) {
    str += String.fromCharCode(...bytes.subarray(i, Math.min(i + 65536, bytes.length)));
  }
  return btoa(str);
}

/** base64 string → Blob */
function b64ToBlob(b64: string, mimeType: string): Blob {
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Export all maps + their saved configs as a downloadable .json bundle.
 */
export async function exportBundle(): Promise<void> {
  const maps = await getAllMaps();
  const entries: MapEntry[] = [];

  for (const map of maps) {
    const ab     = await map.blob.arrayBuffer();
    const config = await loadConfig(map.id);
    entries.push({
      id:       map.id,
      name:     map.name,
      addedAt:  map.addedAt,
      mimeType: map.blob.type || 'image/png',
      imageB64: ab2b64(ab),
      config:   config ?? null,
    });
  }

  const bundle: DMRBundle = { version: BUNDLE_VERSION, exportedAt: Date.now(), maps: entries };

  const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `dmr-maps-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Import a bundle file.  Maps are upserted (new ones added, existing IDs
 * overwritten with the bundle's version).
 * Returns counts of how many maps were added vs updated.
 */
export async function importBundle(
  file: File
): Promise<{ added: number; updated: number }> {
  const text = await file.text();

  let bundle: DMRBundle;
  try {
    bundle = JSON.parse(text) as DMRBundle;
  } catch {
    throw new Error('Invalid bundle — could not parse JSON');
  }

  if (bundle.version !== BUNDLE_VERSION) {
    throw new Error(`Unsupported bundle version: ${String(bundle.version)}`);
  }
  if (!Array.isArray(bundle.maps)) {
    throw new Error('Invalid bundle — missing maps array');
  }

  let added   = 0;
  let updated = 0;

  for (const entry of bundle.maps) {
    const existing = await getMap(entry.id);

    const map: StoredMap = {
      id:      entry.id,
      name:    entry.name,
      addedAt: entry.addedAt,
      blob:    b64ToBlob(entry.imageB64, entry.mimeType),
    };

    await saveMap(map);
    if (entry.config) await saveConfig(entry.id, entry.config);

    if (existing) updated++; else added++;
  }

  return { added, updated };
}
