import { getAllMaps, getMap, saveMap, loadConfig, saveConfig, getAllAssets, saveAsset, getAllAudioAssets, saveAudioAsset, getAsset, saveMapAsset, getAllMapAssets, getMapAsset, hasMapAssetsStore, loadSession, saveSession } from './db.ts';
import type { SessionState, AudioAsset, MapAsset, SplashConfig, ThemeConfig } from '../types.ts';
import {
  EncryptedBundleError,
  encryptBundleBytes,
  isEncryptedBundleEnvelope,
} from './bundleCrypto.ts';
import { gzipString, gunzipToString, startsWithGzipMagic } from './bundleCompression.ts';

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
  /** Map-image pixels per 1"/25 mm grid square — set via the Calibrate flow.
   *  Travels in the bundle so calibration survives save/load. */
  pixelsPerSquare?: number;
  /** Last calibration-line endpoints + typed-squares value, so re-opening the
   *  calibration UI starts from where the user left off rather than centred. */
  calibrationLine?: MapAsset['calibrationLine'];
}

/** Map asset known only by URL — metadata travels, blob does not. */
type RemoteMapAssetEntry = MapAsset;

interface IconEntry {
  id:       string;
  name:     string;
  mimeType: string;
  dataB64:  string;
  addedAt?: number;
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
  /** User-editable link added via the My Library attribution editor. */
  attributionLink?:     string;
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
  /** Human-friendly pack name set in the customisation area. Restored on
   *  import; used as the default save filename. Optional — older bundles
   *  predate this field and load without a name. */
  packName?:      string;
  /** Creator-customisable splash / About content. Travels with the pack so
   *  creators can brand bundles with their image, body text, and links. */
  splash?:        SplashConfig;
  /** Optional UI theme — light/dark mode + custom accent. Applies to chrome
   *  only. Travels with the bundle so packs ship a branded look. */
  theme?:         ThemeConfig;
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

export interface ExportedBundle {
  /** The serialised bundle ready to write to disk. */
  blob: Blob;
  /** Suggested filename (incl. .mappadux extension). The caller is free to
   *  override this — e.g., when the user typed their own name in the save
   *  dialog — but using it preserves the date stamp and the encryption hint. */
  suggestedName: string;
}

/**
 * Build the bundle payload for download. Returns the blob and a suggested
 * filename — the caller decides how to actually save it (native save-file
 * picker, anchor download, etc.). If `opts.password` is set, the bundle is
 * wrapped in an AES-GCM envelope before serialising.
 */
export async function exportBundle(opts?: { password?: string }): Promise<ExportedBundle> {
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
        pixelsPerSquare:  asset.pixelsPerSquare,
        calibrationLine:  asset.calibrationLine,
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
      addedAt:  asset.addedAt,
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
        attributionLink:     meta.attributionLink,
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

  // Pull workspace-level metadata (pack name, splash, theme) so they travel
  // in the bundle.
  const session  = await loadSession();
  const packName = session?.packName?.trim() ?? '';
  const splash   = session?.splash;
  const theme    = session?.theme;

  const bundle: DMRBundle = {
    version:       BUNDLE_VERSION,
    bundleSchema:  2,
    exportedAt:    Date.now(),
    ...(packName.length > 0        ? { packName } : {}),
    ...(splash                     ? { splash } : {}),
    ...(theme                      ? { theme } : {}),
    maps:          entries,
    mapInstances,
    ...(storedMapAssets.length > 0 ? { storedMapAssets } : {}),
    ...(remoteMapAssets.length > 0 ? { remoteMapAssets } : {}),
    ...(iconEntries.length > 0     ? { customIcons:  iconEntries } : {}),
    ...(storedAudio.length > 0     ? { storedAudio:  storedAudio } : {}),
    ...(remoteAudio.length > 0     ? { remoteAudio:  remoteAudio } : {}),
  };

  // Always gzip — shrinks both plain and encrypted output by stripping the
  // repeated JSON structure / strings before downstream encoding inflates
  // them with base64.
  const plainJson  = JSON.stringify(bundle);
  const compressed = await gzipString(plainJson);
  const encrypt    = !!opts?.password;

  const datestamp     = new Date().toISOString().slice(0, 10);
  const suggestedName = encrypt
    ? `mappadux-pack-encrypted-${datestamp}.mappadux`
    : `mappadux-pack-${datestamp}.mappadux`;

  let blob: Blob;
  if (encrypt) {
    const envelope = await encryptBundleBytes(compressed, opts!.password!, { compressed: true });
    blob = new Blob([JSON.stringify(envelope)], { type: 'application/json' });
  } else {
    // Binary gzip stream. Loaders detect via the 0x1f 0x8b magic bytes.
    blob = new Blob([compressed as BlobPart], { type: 'application/octet-stream' });
  }
  return { blob, suggestedName };
}

/**
 * Import a bundle file. Maps are upserted (new ones added, existing IDs
 * overwritten with the bundle's version).
 *
 * Handles three on-disk formats transparently:
 *   1. gzipped JSON         (current plain saves)         — magic 0x1f 0x8b
 *   2. raw JSON envelope    (encrypted save)              — throws EncryptedBundleError
 *   3. raw JSON bundle      (legacy plain `.json` exports) — read as-is
 *
 * Returns counts of how many maps were added vs updated.
 */
export async function importBundle(
  file: File,
): Promise<{ added: number; updated: number }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (startsWithGzipMagic(bytes)) {
    return importBundleText(await gunzipToString(bytes));
  }
  return importBundleText(new TextDecoder().decode(bytes));
}

/**
 * Import a bundle from already-extracted JSON text. Used directly by the GM
 * shell after decrypting (and optionally decompressing) an encrypted bundle.
 */
export async function importBundleText(
  text: string,
): Promise<{ added: number; updated: number }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Invalid bundle — could not parse JSON');
  }

  if (isEncryptedBundleEnvelope(parsed)) {
    throw new EncryptedBundleError(parsed);
  }

  const bundle = parsed as DMRBundle;
  if (bundle.version !== BUNDLE_VERSION) {
    throw new Error(`Unsupported bundle version: ${String(bundle.version)}`);
  }
  if (!Array.isArray(bundle.maps)) {
    throw new Error('Invalid bundle — missing maps array');
  }
  if (!await hasMapAssetsStore()) {
    throw new Error(
      'Database upgrade pending — close any other Mappadux tabs and reload before importing.'
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
          pixelsPerSquare: e.pixelsPerSquare,
          calibrationLine: e.calibrationLine,
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

  // Restore custom icons if present. addedAt fallback handles older bundles.
  if (Array.isArray(bundle.customIcons)) {
    for (const icon of bundle.customIcons) {
      const blob = b64ToBlob(icon.dataB64, icon.mimeType);
      await saveAsset({
        id:      icon.id,
        name:    icon.name,
        type:    'icon',
        blob,
        addedAt: icon.addedAt ?? Date.now(),
      });
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
        attributionLink:     entry.attributionLink,
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

  // Restore workspace-level metadata (pack name, splash) from the bundle.
  // Only write if we already have a session record — don't fabricate one here.
  const existingSession = await loadSession();
  if (existingSession) {
    const next = { ...existingSession };
    let dirty = false;
    if (typeof bundle.packName === 'string' && bundle.packName.length > 0) {
      next.packName = bundle.packName;
      dirty = true;
    }
    if (bundle.splash) {
      next.splash = bundle.splash;
      dirty = true;
    }
    if (bundle.theme) {
      next.theme = bundle.theme;
      dirty = true;
    }
    if (dirty) await saveSession(next);
  }

  return { added, updated };
}
