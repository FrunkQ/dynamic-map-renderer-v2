import { getAllMaps, getMap, saveMap, loadConfig, saveConfig, getAllAssets, saveAsset, getAllAudioAssets, saveAudioAsset, getAsset, saveMapAsset, getAllMapAssets, getMapAsset, hasMapAssetsStore } from './db.ts';
import type { SessionState, AudioAsset, MapAsset } from '../types.ts';

const BUNDLE_VERSION = 1;

/**
 * Legacy v1 bundle map entry — combines map + asset + config into one record.
 * Written by exports before v2.7.15; still readable for back-compat.
 */
interface LegacyMapEntry {
  id:       string;
  name:     string;
  addedAt:  number;
  mimeType: string;
  imageB64: string;
  config:   SessionState | null;
}

/** Named map instance — points at a MapAsset by id. */
interface MapInstanceEntry {
  id:         string;
  name:       string;
  mapAssetId: string;
  addedAt:    number;
  config:     SessionState | null;
}

/** Map asset with embedded blob — any locallyStored MapAsset travels here. */
interface StoredMapAssetEntry {
  id:               string;
  filename:         string;
  source:           MapAsset['source'];
  addedAt:          number;
  mimeType:         string;
  dataB64:          string;
  imageWidth?:      number;
  imageHeight?:     number;
  sourceUrl?:       string;
  license?:         string;
  attribution?:     string;
  attributionLink?: string;
}

/** Map asset known only by URL — metadata travels, blob does not. */
type RemoteMapAssetEntry = MapAsset;

interface IconEntry {
  id:       string;
  name:     string;
  mimeType: string;
  dataB64:  string;
}

interface AudioEntry {
  id:       string;
  name:     string;
  mimeType: string;
  dataB64:  string;
  addedAt:  number;
}

/**
 * Audio with its blob embedded — this is what travels when the user has clicked
 * Store on the asset (or it's an Upload, which is implicitly stored). Carries
 * the full asset metadata so import can recreate the row accurately, regardless
 * of the original source.
 */
interface StoredAudioEntry {
  id:       string;
  name:     string;
  mimeType: string;
  dataB64:  string;
  addedAt:  number;
  source:   AudioAsset['source'];
  license?:             string;
  attribution?:         string;
  username?:            string;
  durationSecs?:        number;
  sourceUrl?:           string;
  freesoundId?:         number;
  freesoundPreviewUrl?: string;
  freesoundPageUrl?:    string;
}

/**
 * Audio known only by URL/API — metadata travels in the bundle, blob does not.
 * Recipient fetches at runtime (and may need an API key for Freesound).
 */
type RemoteAudioEntry = AudioAsset;

export interface DMRBundle {
  version:        typeof BUNDLE_VERSION;
  exportedAt:     number;
  /** Bundle format flavour — written by exports from v2.7.15+. Legacy bundles
   *  predate the field and use the `maps` (LegacyMapEntry) array. */
  bundleSchema?:  2;
  /** Legacy combined map+asset+config records. Always written for back-compat
   *  with older importers; new importers prefer `mapInstances` + `*MapAssets`. */
  maps:           LegacyMapEntry[];
  /** New shape: named map instances pointing at MapAsset ids. */
  mapInstances?:  MapInstanceEntry[];
  /** Map assets with embedded blob — any locallyStored=true MapAsset. */
  storedMapAssets?: StoredMapAssetEntry[];
  /** Map assets known only by URL — metadata only. */
  remoteMapAssets?: RemoteMapAssetEntry[];
  customIcons?:   IconEntry[];
  /** Audio with embedded blob — any `locallyStored=true` asset goes here. */
  storedAudio?:   StoredAudioEntry[];
  /** Metadata-only audio — Freesound + Web Link items the user hasn't Stored. */
  remoteAudio?:   RemoteAudioEntry[];

  // ── Legacy fields (read on import, no longer written on export) ──
  /** @deprecated read-only, replaced by `storedAudio`. */
  uploadedAudio?: AudioEntry[];
  /** @deprecated read-only, replaced by `remoteAudio`. */
  freesoundAudio?: AudioAsset[];
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

/** Strip keys whose values are `undefined` so optional fields aren't set explicitly. */
function _omitUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
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
  const maps          = await getAllMaps();
  const mapAssetsAll  = await getAllMapAssets();
  const mapInstances: MapInstanceEntry[]      = [];
  const storedMapAssets: StoredMapAssetEntry[] = [];
  const remoteMapAssets: RemoteMapAssetEntry[] = [];
  const legacyEntries: LegacyMapEntry[]       = [];

  for (const map of maps) {
    const config = await loadConfig(map.id);
    mapInstances.push({
      id:         map.id,
      name:       map.name,
      mapAssetId: map.mapAssetId,
      addedAt:    map.addedAt,
      config:     config ?? null,
    });

    // Build a legacy MapEntry too — older importers can still pull the maps
    // out of the bundle. They lose the asset-sharing relationship but get a
    // working map each. We embed the asset's blob inline.
    const asset = await getMapAsset(map.mapAssetId);
    if (asset?.blob) {
      const ab = await asset.blob.arrayBuffer();
      legacyEntries.push({
        id:       map.id,
        name:     map.name,
        addedAt:  map.addedAt,
        mimeType: asset.blob.type || 'image/png',
        imageB64: ab2b64(ab),
        config:   config ?? null,
      });
    }
  }

  // Stored vs Remote map assets
  for (const asset of mapAssetsAll) {
    if (asset.locallyStored && asset.blob) {
      const ab = await asset.blob.arrayBuffer();
      storedMapAssets.push(_omitUndefined({
        id:               asset.id,
        filename:         asset.filename,
        source:           asset.source,
        addedAt:          asset.addedAt,
        mimeType:         asset.blob.type || 'image/png',
        dataB64:          ab2b64(ab),
        imageWidth:       asset.imageWidth,
        imageHeight:      asset.imageHeight,
        sourceUrl:        asset.sourceUrl,
        license:          asset.license,
        attribution:      asset.attribution,
        attributionLink:  asset.attributionLink,
      }) as StoredMapAssetEntry);
    } else if (asset.source === 'web-link') {
      const { blob: _b, ...metaOnly } = asset;
      void _b;
      remoteMapAssets.push(metaOnly as RemoteMapAssetEntry);
    }
  }
  const entries = legacyEntries; // legacy field still populated for back-compat

  // Export custom icon assets
  const iconAssets = await getAllAssets('icon');
  const iconEntries: IconEntry[] = [];
  for (const asset of iconAssets) {
    const ab = await asset.blob.arrayBuffer();
    iconEntries.push({
      id:       asset.id,
      name:     asset.name,
      mimeType: asset.blob.type || 'image/png',
      dataB64:  ab2b64(ab),
    });
  }

  // Audio: split into stored (with blob) vs remote (metadata only) by the
  // user's Store decisions. Stored items become offline-usable for the
  // recipient; remote items still need the API key / network at runtime.
  const allAudioMeta = await getAllAudioAssets();
  const storedAudio: StoredAudioEntry[] = [];
  const remoteAudio: RemoteAudioEntry[] = [];

  for (const meta of allAudioMeta) {
    if (meta.locallyStored) {
      const stored = await getAsset(meta.id);
      if (!stored) continue;
      const ab = await stored.blob.arrayBuffer();
      storedAudio.push(_omitUndefined({
        id:       meta.id,
        name:     meta.name,
        mimeType: stored.blob.type || 'audio/mpeg',
        dataB64:  ab2b64(ab),
        addedAt:  meta.addedAt,
        source:   meta.source,
        license:             meta.license,
        attribution:         meta.attribution,
        username:            meta.username,
        durationSecs:        meta.durationSecs,
        sourceUrl:           meta.sourceUrl,
        freesoundId:         meta.freesoundId,
        freesoundPreviewUrl: meta.freesoundPreviewUrl,
        freesoundPageUrl:    meta.freesoundPageUrl,
      }) as StoredAudioEntry);
    } else if (meta.source === 'freesound' || meta.source === 'web-link') {
      // Skip uploads with locallyStored=false — that's an inconsistent state and
      // we have nothing to fall back on for them.
      remoteAudio.push(meta);
    }
  }

  const bundle: DMRBundle = {
    version:       BUNDLE_VERSION,
    bundleSchema:  2,
    exportedAt:    Date.now(),
    maps:          entries,
    mapInstances,
    ...(storedMapAssets.length > 0 ? { storedMapAssets } : {}),
    ...(remoteMapAssets.length > 0 ? { remoteMapAssets } : {}),
    ...(iconEntries.length > 0     ? { customIcons:  iconEntries } : {}),
    ...(storedAudio.length > 0     ? { storedAudio:  storedAudio } : {}),
    ...(remoteAudio.length > 0     ? { remoteAudio:  remoteAudio } : {}),
  };

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
  if (!await hasMapAssetsStore()) {
    throw new Error(
      'Database upgrade pending — close any other Dynamic Map Renderer tabs and reload before importing.'
    );
  }

  let added   = 0;
  let updated = 0;

  if (bundle.bundleSchema === 2 && Array.isArray(bundle.mapInstances)) {
    // New format — split asset / instance shape.
    if (Array.isArray(bundle.storedMapAssets)) {
      for (const e of bundle.storedMapAssets) {
        const blob = b64ToBlob(e.dataB64, e.mimeType);
        const asset = _omitUndefined({
          id:              e.id,
          filename:        e.filename,
          source:          e.source,
          locallyStored:   true,
          blob,
          imageWidth:      e.imageWidth,
          imageHeight:     e.imageHeight,
          sourceUrl:       e.sourceUrl,
          license:         e.license,
          attribution:     e.attribution,
          attributionLink: e.attributionLink,
          addedAt:         e.addedAt,
        }) as MapAsset;
        await saveMapAsset(asset);
      }
    }
    if (Array.isArray(bundle.remoteMapAssets)) {
      for (const asset of bundle.remoteMapAssets) {
        const { blob: _b, ...metaOnly } = asset;
        void _b;
        await saveMapAsset({ ...metaOnly, locallyStored: false } as MapAsset);
      }
    }
    for (const entry of bundle.mapInstances) {
      const existing = await getMap(entry.id);
      await saveMap({
        id:         entry.id,
        name:       entry.name,
        mapAssetId: entry.mapAssetId,
        addedAt:    entry.addedAt,
      });
      if (entry.config) await saveConfig(entry.id, entry.config);
      if (existing) updated++; else added++;
    }
  } else {
    // Legacy v1 shape — combine the entry's blob into a fresh MapAsset (id == entry.id),
    // then a StoredMap pointing at it.
    for (const entry of bundle.maps) {
      const existing = await getMap(entry.id);
      const blob = b64ToBlob(entry.imageB64, entry.mimeType);
      const asset: MapAsset = {
        id:            entry.id,
        filename:      entry.name,
        source:        'upload',
        locallyStored: true,
        blob,
        addedAt:       entry.addedAt,
      };
      await saveMapAsset(asset);
      await saveMap({
        id:         entry.id,
        name:       entry.name,
        mapAssetId: entry.id,
        addedAt:    entry.addedAt,
      });
      if (entry.config) await saveConfig(entry.id, entry.config);
      if (existing) updated++; else added++;
    }
  }

  // Restore custom icons if present
  if (Array.isArray(bundle.customIcons)) {
    for (const icon of bundle.customIcons) {
      const blob = b64ToBlob(icon.dataB64, icon.mimeType);
      await saveAsset({ id: icon.id, name: icon.name, type: 'icon', blob, addedAt: Date.now() });
    }
  }

  // Restore Stored audio assets (blob embedded — full metadata preserved)
  if (Array.isArray(bundle.storedAudio)) {
    for (const entry of bundle.storedAudio) {
      const blob = b64ToBlob(entry.dataB64, entry.mimeType);
      const asset = _omitUndefined({
        id:                  entry.id,
        name:                entry.name,
        source:              entry.source,
        locallyStored:       true,
        license:             entry.license,
        attribution:         entry.attribution,
        username:            entry.username,
        durationSecs:        entry.durationSecs,
        sourceUrl:           entry.sourceUrl,
        freesoundId:         entry.freesoundId,
        freesoundPreviewUrl: entry.freesoundPreviewUrl,
        freesoundPageUrl:    entry.freesoundPageUrl,
        addedAt:             entry.addedAt,
      }) as AudioAsset;
      await saveAudioAsset(asset);
      await saveAsset({ id: entry.id, name: entry.name, type: 'audio', blob, addedAt: entry.addedAt });
    }
  }

  // Restore Remote audio metadata (no blob — recipient fetches at runtime)
  if (Array.isArray(bundle.remoteAudio)) {
    for (const asset of bundle.remoteAudio) {
      await saveAudioAsset({ ...asset, locallyStored: false } as AudioAsset);
    }
  }

  // ── Legacy fields (bundles exported before v2.7.7) ──────────────────────────
  if (Array.isArray(bundle.uploadedAudio)) {
    for (const entry of bundle.uploadedAudio) {
      const blob = b64ToBlob(entry.dataB64, entry.mimeType);
      const asset: AudioAsset = {
        id:            entry.id,
        name:          entry.name,
        source:        'upload',
        locallyStored: true,
        license:       'Unknown / Manual import',
        addedAt:       entry.addedAt,
      };
      await saveAudioAsset(asset);
      await saveAsset({ id: entry.id, name: entry.name, type: 'audio', blob, addedAt: entry.addedAt });
    }
  }
  if (Array.isArray(bundle.freesoundAudio)) {
    for (const asset of bundle.freesoundAudio) {
      await saveAudioAsset({ ...asset, locallyStored: false } as AudioAsset);
    }
  }

  return { added, updated };
}
