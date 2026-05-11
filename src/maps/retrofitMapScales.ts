import { detectMapScale, autoApplyPatch } from '../utils/detectMapScale.ts';
import { MapAssetStore } from './MapAssetStore.ts';
import { getAllMaps } from '../storage/db.ts';

/**
 * Retrofit pass that walks the MapAsset library, runs the scale detector on
 * any asset that lacks `pixelsPerSquare` AND isn't opted out via `noGrid`,
 * and auto-applies high-confidence detections. Ambiguous ones are reported
 * but left untouched — the user can resolve them later from the asset
 * editor or a future Settings → Rescan action.
 *
 * Never touches assets that already have a `pixelsPerSquare` (manual or
 * prior detection) — the creator's earlier calibration always wins.
 */
export interface RetrofitSummary {
  inspected: number;
  applied:   number;
  ambiguous: number;
  skipped:   number;
}

export async function retrofitMapScales(): Promise<RetrofitSummary> {
  const summary: RetrofitSummary = { inspected: 0, applied: 0, ambiguous: 0, skipped: 0 };

  const assets = await MapAssetStore.getAll();
  // Use the StoredMap's display name as an additional name hint — creators
  // often put "[40x30]" in the visible map name rather than the raw filename.
  const maps = await getAllMaps();
  const nameByAssetId = new Map<string, string>();
  for (const m of maps) {
    if (!nameByAssetId.has(m.mapAssetId)) nameByAssetId.set(m.mapAssetId, m.name);
  }

  for (const asset of assets) {
    summary.inspected++;
    if (asset.pixelsPerSquare !== undefined) { summary.skipped++; continue; }
    if (asset.noGrid)                         { summary.skipped++; continue; }
    if (!asset.imageWidth || !asset.imageHeight) { summary.skipped++; continue; }

    let blob: Blob | undefined;
    if (asset.locallyStored) {
      const b = await MapAssetStore.getBlob(asset);
      if (b) blob = b;
    }
    const nameHints: string[] = [asset.filename];
    const mapName = nameByAssetId.get(asset.id);
    if (mapName) nameHints.push(mapName);

    const detection = await detectMapScale({
      nameHints,
      imageWidth:  asset.imageWidth,
      imageHeight: asset.imageHeight,
      ...(blob ? { blob } : {}),
    });
    const patch = autoApplyPatch(detection);
    if (patch) {
      await MapAssetStore.update(asset.id, patch);
      summary.applied++;
    } else if (detection.needsConfirmation) {
      summary.ambiguous++;
    } else {
      summary.skipped++;
    }
  }
  return summary;
}
