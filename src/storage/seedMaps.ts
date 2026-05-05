import { getAllMaps } from './db.ts';
import { importBundle } from './bundleIO.ts';

const DEFAULT_BUNDLE_URL = '/default-bundle.json';

/**
 * On first run (empty map library) fetch and import the default bundle from
 * public/default-bundle.json. If the file is absent or the bundle is empty
 * the app simply starts with no maps — non-fatal.
 */
export async function seedDefaultMaps(): Promise<void> {
  const existing = await getAllMaps();
  if (existing.length > 0) return; // DB already has maps — skip

  try {
    const res = await fetch(DEFAULT_BUNDLE_URL);
    if (!res.ok) return; // No default bundle present — that's fine

    const file = new File([await res.blob()], 'default-bundle.json', { type: 'application/json' });
    await importBundle(file);
  } catch {
    // Non-fatal — app still works without a preloaded bundle
  }
}
