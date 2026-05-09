import type { StoredMap, MapAsset } from '../types.ts';
import {
  saveMap, getAllMaps, deleteMap, getMap,
  saveMapAsset, getMapAsset, deleteMapAsset,
} from '../storage/db.ts';

function generateId(): string {
  return crypto.randomUUID();
}

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * MapManager — owns the relationship between named map instances (StoredMap)
 * and the underlying image data (MapAsset). One MapAsset can back many maps.
 *
 * External API kept stable so GMApp doesn't need to change: callers pass map
 * instance ids and receive ArrayBuffers / display fields.
 */
export class MapManager {
  /**
   * Import a local file: creates a fresh MapAsset (with the blob) and a fresh
   * StoredMap pointing at it. Returns the StoredMap so the caller can drop it
   * into the dropdown immediately.
   */
  async importFile(file: File): Promise<StoredMap> {
    if (!ALLOWED_TYPES.has(file.type)) {
      throw new Error(`Unsupported file type: ${file.type}. Use PNG, JPG, or WebP.`);
    }
    if (file.size > MAX_BYTES) {
      throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 50 MB.`);
    }

    const blob = new Blob([await file.arrayBuffer()], { type: file.type });
    const assetId = generateId();
    const mapId   = generateId();
    const now     = Date.now();

    const asset: MapAsset = {
      id:            assetId,
      filename:      file.name,
      source:        'upload',
      locallyStored: true,
      blob,
      addedAt:       now,
    };
    await saveMapAsset(asset);

    const map: StoredMap = {
      id:         mapId,
      name:       file.name.replace(/\.[^.]+$/, ''),
      mapAssetId: assetId,
      addedAt:    now,
    };
    await saveMap(map);
    return map;
  }

  /** All map instances (what the user sees in the dropdown). */
  async getAll(): Promise<StoredMap[]> {
    return getAllMaps();
  }

  /**
   * Resolve the image bytes for a map instance. Looks up the linked MapAsset
   * and returns its blob as ArrayBuffer.
   *
   * Falls back to the legacy inline `blob` on the StoredMap record when the
   * map predates the C6 schema split and hasn't been migrated yet — that way
   * existing data keeps working when the v3 upgrade is delayed.
   */
  async getBlob(id: string): Promise<ArrayBuffer | null> {
    const map = await getMap(id);
    if (!map) return null;

    // Pre-C6 maps carried their blob inline. The migration runs at app start,
    // but if the schema upgrade is blocked the migration skips and the legacy
    // shape persists. Honour it here so the map still loads.
    const legacyBlob = (map as unknown as { blob?: Blob }).blob;
    if (legacyBlob) return legacyBlob.arrayBuffer();

    const asset = await getMapAsset(map.mapAssetId);
    if (!asset?.blob) return null;
    return asset.blob.arrayBuffer();
  }

  /**
   * Resolve the underlying MapAsset for a map instance. Useful for callers
   * that need the original blob/mime/dimensions without going through ArrayBuffer.
   *
   * Synthesises a minimal MapAsset from the legacy inline blob when the map
   * hasn't been migrated yet, so callers don't have to special-case.
   */
  async getAsset(id: string): Promise<MapAsset | null> {
    const map = await getMap(id);
    if (!map) return null;

    const asset = await getMapAsset(map.mapAssetId);
    if (asset) return asset;

    const legacyBlob = (map as unknown as { blob?: Blob }).blob;
    if (legacyBlob) {
      return {
        id:            map.id,
        filename:      map.name,
        source:        'upload',
        locallyStored: true,
        blob:          legacyBlob,
        addedAt:       map.addedAt,
      };
    }
    return null;
  }

  /**
   * Delete a map instance. Leaves the MapAsset in place — it might be in use
   * by another map. C12 trash tracking will surface unused assets later.
   */
  async delete(id: string): Promise<void> {
    await deleteMap(id);
  }

  /** Permanently remove a MapAsset (and any map instances pointing at it). */
  async deleteAsset(assetId: string): Promise<void> {
    const all = await getAllMaps();
    for (const m of all.filter((m) => m.mapAssetId === assetId)) {
      await deleteMap(m.id);
    }
    await deleteMapAsset(assetId);
  }
}
