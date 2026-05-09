import { getAllMaps, saveMap, saveMapAsset, getMapAsset, hasMapAssetsStore } from './db.ts';
import type { MapAsset } from '../types.ts';

/**
 * One-shot legacy migration: pre-v2.7.x maps stored their blob inline in the
 * `maps` IDB store. The C6 schema splits the blob out into a separate MapAsset
 * row. This helper detects legacy rows on app start and migrates them.
 *
 * Idempotent — only acts on rows that still have the legacy `.blob` field and
 * lack a `.mapAssetId`. Safe to run on every app load.
 *
 * Skips entirely if the v3 schema upgrade hasn't completed — that way we don't
 * destroy the user's working legacy rows by writing a half-shape over them.
 */
export async function migrateLegacyMaps(): Promise<void> {
  if (!await hasMapAssetsStore()) {
    console.warn('[migrate] mapAssets store unavailable — legacy map migration skipped this load.');
    return;
  }

  const maps = await getAllMaps();
  for (const map of maps) {
    const legacy = map as unknown as { blob?: Blob; mapAssetId?: string };
    if (legacy.mapAssetId) continue;            // already migrated
    if (!legacy.blob) continue;                 // nothing to migrate

    // Reuse the map's existing id as the MapAsset id — keeps the relationship
    // simple in the most common case (one map per asset). New uploads will
    // generate distinct ids.
    const assetId  = map.id;
    const existing = await getMapAsset(assetId);
    if (!existing) {
      const asset: MapAsset = {
        id:            assetId,
        filename:      map.name,
        source:        'upload',
        locallyStored: true,
        blob:          legacy.blob,
        addedAt:       map.addedAt,
      };
      await saveMapAsset(asset);
    }

    // Rewrite the StoredMap to point at the asset (drops the legacy blob field).
    await saveMap({ id: map.id, name: map.name, mapAssetId: assetId, addedAt: map.addedAt });
  }
}
