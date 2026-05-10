import { getAllMaps } from './db.ts';
import { importBundle } from './bundleIO.ts';

const DEFAULT_BUNDLE_URL = '/default-bundle.json';

/**
 * On first run (empty map library) fetch and import the default bundle from
 * public/default-bundle.json. If the file is absent or the bundle is empty
 * the app simply starts with no maps — non-fatal.
 *
 * Returns the suggested pack name to attach to the session when the seed
 * actually fired (e.g. "Getting Started" for the canned starter pack), or
 * `null` if nothing was seeded. The session record itself doesn't exist
 * yet at this point — startHost creates it — so the caller is responsible
 * for forwarding this value into the eventual saveSession call.
 */
export async function seedDefaultMaps(): Promise<string | null> {
  const existing = await getAllMaps();
  if (existing.length > 0) return null; // DB already has maps — skip

  try {
    const res = await fetch(DEFAULT_BUNDLE_URL);
    if (!res.ok) return null; // No default bundle present — that's fine

    const file = new File([await res.blob()], 'default-bundle.json', { type: 'application/json' });
    const { added } = await importBundle(file);
    return added > 0 ? 'Getting Started' : null;
  } catch {
    // Non-fatal — app still works without a preloaded bundle
    return null;
  }
}
