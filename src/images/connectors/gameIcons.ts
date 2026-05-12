import type { ImageSourceConnector, ConnectorManifestEntry } from './types.ts';
import bundledManifest from './manifests/game-icons.json' with { type: 'json' };
import { fetchSvgCached } from './connectorFetch.ts';

/**
 * Game Icons (game-icons.net) — CC-BY 3.0 fantasy / sci-fi / abstract SVG
 * icons by Lorc, Delapouite, Skoll, Quoting, and other contributors. ~4,000
 * icons total.
 *
 * The manifest is loaded from `./manifests/game-icons.json`, which is a
 * checked-in JSON file. By default the repo ships a ~15-entry starter set
 * so the connector works out of the box. Run `npm run build-icons` to
 * regenerate the manifest from the upstream GitHub repo — that overwrites
 * the JSON with the full ~4,000-entry catalog. The connector adjusts its
 * UI (minSearchChars, allowShowAll) automatically based on the size of
 * whatever manifest is in the file.
 *
 * SVGs are served via jsDelivr from the project's GitHub repo. All entries
 * have a `<path fill="#000">` baseline that we rewrite to currentColor at
 * render time so consumers can tint freely.
 */

const SVG_BASE = 'https://cdn.jsdelivr.net/gh/game-icons/icons@master';

const MANIFEST: ConnectorManifestEntry[] = bundledManifest as ConnectorManifestEntry[];
const IS_LARGE_CATALOG = MANIFEST.length > 200;

export const gameIconsConnector: ImageSourceConnector = {
  id:             'game-icons',
  displayName:    'Game Icons',
  license:        'CC-BY 3.0',
  licenseUrl:     'https://creativecommons.org/licenses/by/3.0/',
  sourceUrl:      'https://game-icons.net/',
  tintable:       true,
  // Manifest-size-driven: a freshly built catalog (~4,000 entries) needs the
  // tight UI controls (2-char minimum, no Show all). The shipped starter
  // (~15 entries) doesn't, so the user can still click Show all to browse
  // before they've run `npm run build-icons`.
  minSearchChars: IS_LARGE_CATALOG ? 2 : 1,
  allowShowAll:   !IS_LARGE_CATALOG,

  async loadManifest(): Promise<ConnectorManifestEntry[]> {
    return MANIFEST;
  },

  buildUrl(entry: ConnectorManifestEntry): string {
    return `${SVG_BASE}/${entry.slug}.svg`;
  },

  attributionFor(entry: ConnectorManifestEntry): string {
    const who = entry.author ? ` by ${entry.author}` : '';
    return `Icon: "${entry.name}"${who} — CC-BY 3.0 via game-icons.net`;
  },

  async fetchSvg(entry: ConnectorManifestEntry): Promise<string> {
    return fetchSvgCached(gameIconsConnector.buildUrl(entry));
  },
};
