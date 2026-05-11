import type { MapAsset } from '../types.ts';
import {
  saveMapAsset, getMapAsset, getAllMapAssets, deleteMapAsset,
} from '../storage/db.ts';
import { rasterizeTextMap } from './rasterizeTextMap.ts';

/**
 * MapAssetStore — facade over the mapAssets IDB store, mirroring the shape of
 * AudioAssetStore. Assets are reusable image files; the named map instances
 * (StoredMap) reference them by id.
 *
 * Differences from audio:
 *   • Map blobs live INLINE on the MapAsset record (not in a separate `assets`
 *     store) so save/delete are single-store operations.
 *   • There's no API source like Freesound yet, so the priority chain in
 *     getBlob is just stored-blob → runtime cache → web-link fetch.
 */
export class MapAssetStore {
  /** Runtime-only cache for fetched blobs of non-stored web-link assets. */
  private static runtimeBlobs = new Map<string, Blob>();

  static async getAll(): Promise<MapAsset[]> {
    const all = await getAllMapAssets();
    return all.sort((a, b) => b.addedAt - a.addedAt);
  }

  static async get(id: string): Promise<MapAsset | undefined> {
    return getMapAsset(id);
  }

  /** Save the full asset (including any blob present on the record). */
  static async save(asset: MapAsset): Promise<void> {
    await saveMapAsset(asset);
  }

  /** Save metadata only, stripping any blob present. For web-link assets. */
  static async saveMetadataOnly(asset: MapAsset): Promise<void> {
    const { blob: _b, ...rest } = asset;
    void _b;
    await saveMapAsset({ ...rest, locallyStored: false } as MapAsset);
  }

  /** Apply a partial update to an asset's metadata. */
  static async update(id: string, patch: Partial<MapAsset>): Promise<void> {
    const existing = await getMapAsset(id);
    if (!existing) return;
    await saveMapAsset({ ...existing, ...patch });
  }

  /**
   * Promote a non-stored (web-link) asset to locally-stored. Fetches its blob
   * if needed, persists it on the asset record, and flips the flag. Returns
   * true on success, false if the blob couldn't be obtained.
   */
  static async store(asset: MapAsset): Promise<boolean> {
    if (asset.locallyStored && asset.blob) return true;
    const blob = await MapAssetStore.getBlob(asset);
    if (!blob) return false;
    await saveMapAsset({ ...asset, blob, locallyStored: true });
    return true;
  }

  static async delete(id: string): Promise<void> {
    await deleteMapAsset(id);
    MapAssetStore.runtimeBlobs.delete(id);
  }

  /**
   * Resolve the image bytes for an asset.
   *   1. The blob persisted on the record (locallyStored=true).
   *   2. A runtime-cached blob from an earlier this-session fetch /
   *      text-map rasterisation.
   *   3. Text-map handouts: rasterise the textMap config to a PNG.
   *   4. Fetched from `sourceUrl` (web-link) and runtime-cached only — no IDB
   *      write unless the user clicks Store.
   */
  static async getBlob(asset: MapAsset): Promise<Blob | null> {
    if (asset.blob) return asset.blob;
    const cached = MapAssetStore.runtimeBlobs.get(asset.id);
    if (cached) return cached;

    if (asset.source === 'text-map' && asset.textMap) {
      // On-demand rasterisation: the editor stores only the config
      // (bodyHtml + colours + ratio + font). Cache the resulting PNG in
      // the runtime map so repeat loads within the session are cheap.
      // The cache is keyed by asset id so editing the handout (which
      // currently mints a new id) doesn't show a stale render.
      try {
        const blob = await rasterizeTextMap(asset.textMap);
        MapAssetStore.runtimeBlobs.set(asset.id, blob);
        return blob;
      } catch (err) {
        // Surface the failure so the user / dev can diagnose — without
        // this the only signal is the "Missing Map Image" placeholder
        // downstream, with no breadcrumb.
        console.error(
          `[MapAssetStore] text-map rasterisation failed for asset ${asset.id}:`,
          err,
        );
        return null;
      }
    }

    if (asset.source === 'web-link' && asset.sourceUrl) {
      try {
        const res = await fetch(asset.sourceUrl);
        if (!res.ok) return null;
        const blob = await res.blob();
        MapAssetStore.runtimeBlobs.set(asset.id, blob);
        return blob;
      } catch {
        return null;
      }
    }
    return null;
  }

  /** Drop the cached rasterisation for a text-map (or any asset). Call
   *  this when a handout's textMap config has been edited in-place so the
   *  next render goes through the rasteriser again. */
  static invalidateRuntimeCache(id: string): void {
    MapAssetStore.runtimeBlobs.delete(id);
  }

  /**
   * Decode a blob and read the image's intrinsic pixel dimensions. Returns
   * null if the blob isn't a decodable image.
   */
  static async readDimensions(blob: Blob): Promise<{ width: number; height: number } | null> {
    try {
      const bitmap = await createImageBitmap(blob);
      const dims = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return dims;
    } catch {
      return null;
    }
  }

  /**
   * Attribution rows for every map asset — for the unified Attributions
   * modal that aggregates audio + map credits in one place.
   */
  static async getAttributions(): Promise<Array<{ name: string; attribution: string; license: string; pageUrl: string }>> {
    const all = await MapAssetStore.getAll();
    const results: Array<{ name: string; attribution: string; license: string; pageUrl: string }> = [];
    for (const a of all) {
      const license  = a.license ?? 'Unknown';
      const pageUrl  = a.attributionLink ?? a.sourceUrl ?? '';
      const fallback = `Map: "${a.filename}" — ${a.source} — ${license}`;
      results.push({
        name:        a.filename,
        attribution: a.attribution || fallback,
        license,
        pageUrl,
      });
    }
    return results;
  }
}
