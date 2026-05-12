import type { StoredMap, MapAsset } from '../types.ts';
import {
  saveMap, getAllMaps, deleteMap, getMap, loadConfig, saveConfig,
} from '../storage/db.ts';
import { MapAssetStore } from '../maps/MapAssetStore.ts';
import { generateMissingMapPlaceholder } from '../maps/placeholder.ts';
import { generateId } from '../utils/id.ts';

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

    // Read intrinsic pixel dimensions now so the missing-asset placeholder (C10)
    // can match the original geometry later without re-decoding.
    const dims = await MapAssetStore.readDimensions(blob);

    const asset: MapAsset = {
      id:            assetId,
      filename:      file.name,
      source:        'upload',
      locallyStored: true,
      blob,
      addedAt:       now,
      ...(dims ? { imageWidth: dims.width, imageHeight: dims.height } : {}),
    };
    await MapAssetStore.save(asset);

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

  /** Update just the display name of a map instance. */
  async rename(id: string, name: string): Promise<void> {
    const map = await getMap(id);
    if (!map) return;
    await saveMap({ ...map, name });
  }

  /**
   * Clone a map instance: same MapAsset (asset is shared, not duplicated),
   * fresh per-map config copied across with regenerated marker + soundboard
   * slot IDs so the clone is fully independent. Name gets a " - copy" suffix
   * unless it already ends with one.
   */
  async cloneMap(id: string): Promise<StoredMap | null> {
    const original = await getMap(id);
    if (!original) return null;
    const config = await loadConfig(id);

    const newId = generateId();
    const newName = original.name.endsWith(' - copy') ? original.name : `${original.name} - copy`;
    const newMap: StoredMap = {
      id:         newId,
      name:       newName,
      mapAssetId: original.mapAssetId,
      addedAt:    Date.now(),
    };
    await saveMap(newMap);

    if (config) {
      // Deep clone, then regenerate any IDs that should be unique per map instance.
      const cloned = JSON.parse(JSON.stringify(config)) as typeof config;
      cloned.markers = cloned.markers.map((m) => ({ ...m, id: generateId() }));
      if (cloned.audio?.slots) {
        cloned.audio.slots = cloned.audio.slots.map((s) => ({ ...s, id: generateId() }));
      }
      // state.map gets overwritten by loadForMap; no need to fix it here.
      await saveConfig(newId, cloned);
    }

    return newMap;
  }

  /**
   * Create a fresh named map instance pointing at an existing MapAsset. Used
   * by the Add Map dialog when the user picks a map from My Library or after
   * a fresh Upload / Web-Link add. The asset is NOT duplicated.
   */
  async createMapFromAsset(assetId: string, name: string): Promise<StoredMap> {
    const map: StoredMap = {
      id:         generateId(),
      name,
      mapAssetId: assetId,
      addedAt:    Date.now(),
    };
    await saveMap(map);
    return map;
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

    const asset = await MapAssetStore.get(map.mapAssetId);
    if (asset) {
      const blob = await MapAssetStore.getBlob(asset);
      if (blob) {
        // Backfill image dimensions if we never recorded them — used by the
        // missing-asset placeholder so fog/marker geometry stays sensible.
        if (asset.imageWidth === undefined || asset.imageHeight === undefined) {
          const dims = await MapAssetStore.readDimensions(blob);
          if (dims) await MapAssetStore.update(asset.id, { imageWidth: dims.width, imageHeight: dims.height });
        }
        return blob.arrayBuffer();
      }
    }

    // Asset metadata or blob unavailable — synthesise a placeholder at the
    // remembered dimensions so existing fog/markers/viewport rectangles stay
    // positioned correctly until the GM clicks Fix Missing Map.
    const w = asset?.imageWidth  ?? 1920;
    const h = asset?.imageHeight ?? 1080;
    const placeholder = await generateMissingMapPlaceholder(w, h);
    return placeholder.arrayBuffer();
  }

  /** Rasterise the STARTING FRAME for a handout map — background +
   *  elements flagged noAnimate. Used by the reveal animation flow to
   *  initialise the player + projector at the "before" state. Returns
   *  null when the map isn't a handout or has no animation. */
  async getStartingFrameBlob(id: string): Promise<ArrayBuffer | null> {
    const map = await getMap(id);
    if (!map) return null;
    const asset = await MapAssetStore.get(map.mapAssetId);
    if (!asset || asset.source !== 'text-map') return null;
    const blob = await MapAssetStore.getStartingFrameBlob(asset);
    return blob ? blob.arrayBuffer() : null;
  }

  /**
   * True when the map's underlying asset blob isn't available — the asset
   * was deleted, the web-link is broken, or the user is offline without a
   * cached copy. Driven by MapAssetStore.getBlob's runtime cache so calling
   * this twice is cheap.
   */
  async isAssetMissing(id: string): Promise<boolean> {
    const map = await getMap(id);
    if (!map) return false;
    if ((map as unknown as { blob?: Blob }).blob) return false; // legacy inline blob
    const asset = await MapAssetStore.get(map.mapAssetId);
    if (!asset) return true;
    if (asset.locallyStored && asset.blob) return false;
    const blob = await MapAssetStore.getBlob(asset);
    return !blob;
  }

  /** Re-point a map instance at a different MapAsset. Used by Fix Missing Map. */
  async retargetMap(mapId: string, newAssetId: string): Promise<void> {
    const map = await getMap(mapId);
    if (!map) return;
    await saveMap({ ...map, mapAssetId: newAssetId });
  }

  /**
   * Resolve the underlying MapAsset for a map instance. Synthesises a minimal
   * MapAsset from the legacy inline blob when the map hasn't been migrated yet.
   */
  async getAsset(id: string): Promise<MapAsset | null> {
    const map = await getMap(id);
    if (!map) return null;

    const asset = await MapAssetStore.get(map.mapAssetId);
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
   * by another map. C12 trash tracking surfaces unused assets.
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
    await MapAssetStore.delete(assetId);
  }
}
