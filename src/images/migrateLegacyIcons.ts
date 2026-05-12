import { getAllAssets } from '../storage/db.ts';
import { ImageAssetStore } from './ImageAssetStore.ts';
import { SYSTEM_CATEGORY_IDS } from '../types.ts';

const FLAG_KEY = 'mappadux_legacy_icons_migrated';

/**
 * One-shot migration of pre-v2.11 custom icons.
 *
 * Before the Small Asset Library existed, user-uploaded marker icons lived
 * in the generic `assets` store (type='icon') and were referenced by
 * markers as `asset:<uuid>`. The library now owns icon storage, so any
 * legacy records get copied into ImageAssetStore under "Uncategorised"
 * with their original id preserved — existing markers (in saved bundles
 * or live state) keep resolving via the same id without a rewrite.
 *
 * Idempotent: a localStorage flag prevents the copy from running twice.
 * Original legacy records are NOT deleted so a downgrade is recoverable.
 * Skips records whose id already exists in ImageAssetStore (defensive —
 * the user may have already imported these manually).
 */
export async function migrateLegacyIconsIfNeeded(): Promise<void> {
  if (localStorage.getItem(FLAG_KEY) === 'done') return;

  const legacy = await getAllAssets('icon');
  for (const a of legacy) {
    if (await ImageAssetStore.get(a.id)) continue;
    await ImageAssetStore.save({
      id:         a.id,
      name:       a.name,
      source:     'upload',
      categoryId: SYSTEM_CATEGORY_IDS.uncategorised,
      tintable:   false,
      blob:       a.blob,
      mimeType:   a.blob.type || 'image/png',
      addedAt:    a.addedAt,
    });
  }

  localStorage.setItem(FLAG_KEY, 'done');
}
