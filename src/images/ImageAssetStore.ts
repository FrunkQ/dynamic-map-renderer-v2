import type { ImageAsset, ImageCategory } from '../types.ts';
import {
  saveImageAsset, getImageAsset, getAllImageAssets, deleteImageAsset,
  saveImageCategory, getAllImageCategories, deleteImageCategory,
} from '../storage/db.ts';

/**
 * ImageAssetStore — facade over the imageAssets + imageCategories IDB stores.
 * Mirrors MapAssetStore / AudioAssetStore. Holds Unicode glyphs (no blob),
 * SVG icons (svgSource on the record), and raster icons (blob on the record)
 * all in one store, distinguished by `source` + which payload field is set.
 *
 * Categories are first-class records: system categories pinned with
 * sortOrder 0..99, user-defined categories 100+.
 */
export class ImageAssetStore {
  // ─── Assets ──────────────────────────────────────────────────────────────

  static async getAll(): Promise<ImageAsset[]> {
    const all = await getAllImageAssets();
    return all.sort((a, b) => b.addedAt - a.addedAt);
  }

  static async getByCategory(categoryId: string): Promise<ImageAsset[]> {
    const all = await ImageAssetStore.getAll();
    return all.filter((a) => a.categoryId === categoryId);
  }

  static async get(id: string): Promise<ImageAsset | undefined> {
    return getImageAsset(id);
  }

  static async save(asset: ImageAsset): Promise<void> {
    await saveImageAsset(asset);
  }

  static async update(id: string, patch: Partial<ImageAsset>): Promise<void> {
    const existing = await getImageAsset(id);
    if (!existing) return;
    await saveImageAsset({ ...existing, ...patch });
  }

  static async delete(id: string): Promise<void> {
    await deleteImageAsset(id);
  }

  // ─── Categories ──────────────────────────────────────────────────────────

  static async getAllCategories(): Promise<ImageCategory[]> {
    const all = await getAllImageCategories();
    return all.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  static async saveCategory(cat: ImageCategory): Promise<void> {
    await saveImageCategory(cat);
  }

  /** Remove a user-defined category. Will refuse for system categories. Any
   *  assets in the deleted category are reassigned to the Unicode category
   *  as a safe default — caller can decide whether to move them elsewhere
   *  before deleting, but we never orphan assets. */
  static async deleteCategory(id: string): Promise<void> {
    const all = await getAllImageCategories();
    const cat = all.find((c) => c.id === id);
    if (!cat) return;
    if (cat.isSystem) return; // refuse — system categories are pinned

    // Reassign any assets in this category to Unicode (the only universally
    // safe fallback — every install has it).
    const orphans = await ImageAssetStore.getByCategory(id);
    for (const asset of orphans) {
      await ImageAssetStore.update(asset.id, { categoryId: 'sys-unicode' });
    }
    await deleteImageCategory(id);
  }

  // ─── Attribution rollup ──────────────────────────────────────────────────

  /**
   * Attribution rows for every image asset that has a non-empty attribution
   * or licence — for the unified Attributions modal that aggregates audio +
   * map + image credits in one place.
   */
  static async getAttributions(): Promise<
    Array<{ name: string; attribution: string; license: string; pageUrl: string }>
  > {
    const all = await ImageAssetStore.getAll();
    const results: Array<{ name: string; attribution: string; license: string; pageUrl: string }> = [];
    for (const a of all) {
      // Skip plain Unicode entries — they don't need attribution.
      if (a.source === 'unicode' && !a.attribution && !a.license) continue;
      // Skip user uploads with no attribution declared — the user knows.
      if (a.source === 'upload' && !a.attribution && !a.license) continue;

      const license  = a.license ?? 'Unknown';
      const pageUrl  = a.attributionLink ?? a.sourceUrl ?? '';
      const fallback = `Icon: "${a.name}" — ${a.source} — ${license}`;
      results.push({
        name:        a.name,
        attribution: a.attribution || fallback,
        license,
        pageUrl,
      });
    }
    return results;
  }
}
