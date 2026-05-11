import type { ImageAssetSource } from '../../types.ts';

/**
 * ImageSourceConnector — plug-in interface for external icon catalogs.
 * The Image Library modal calls these to populate the "Browse" tabs.
 *
 * v2.11 ships with two implementations:
 *   • Game Icons (game-icons.net) — CC-BY 3.0 medieval/fantasy/sci-fi SVGs
 *   • Lucide — MIT-licensed contemporary line icons
 *
 * Future connectors (Material Symbols, custom user URLs, etc.) plug in by
 * implementing this interface and registering with the modal.
 *
 * The pattern is catalog-based, not authentication-based: each connector
 * provides a manifest (bundled or fetched) describing what's available,
 * and a fetchSvg() method that pulls the actual SVG markup from the
 * source's CDN. No API key needed.
 */

export interface ConnectorManifestEntry {
  /** Stable identifier used to construct the CDN URL — e.g. 'lorc/sword-wound' for game-icons. */
  slug:        string;
  /** Display name shown in the browse grid. */
  name:        string;
  /** Free-text tags for client-side search. */
  tags:        string[];
  /** Display author (when relevant — e.g. 'Lorc' for game-icons.net). Empty for Lucide. */
  author?:     string;
}

export interface ImageSourceConnector {
  /** Unique connector id — must match the ImageAssetSource value used when
   *  imported entries land in the library. */
  readonly id:           ImageAssetSource;
  /** Human-friendly name shown in the browse-tab strip. */
  readonly displayName:  string;
  /** Licence string applied to every imported asset (used in attribution rollup). */
  readonly license:      string;
  /** Stable URL where the source's licence terms live. */
  readonly licenseUrl:   string;
  /** General source URL (for display in attribution). */
  readonly sourceUrl:    string;

  /** Return the connector's manifest. Implementations may bundle a static
   *  list (current v2.11 default) or fetch from a CDN — caller doesn't care. */
  loadManifest(): Promise<ConnectorManifestEntry[]>;

  /** Build the canonical CDN URL for a single manifest entry. Used for
   *  the actual asset fetch and stored as `sourceUrl` on the imported
   *  ImageAsset so attribution can link back. */
  buildUrl(entry: ConnectorManifestEntry): string;

  /** Compose the attribution string shown in the unified Copy attributions
   *  output, e.g. "Icon: 'sword-wound' by Lorc — CC-BY 3.0 via game-icons.net". */
  attributionFor(entry: ConnectorManifestEntry): string;

  /** Pull the SVG markup for a manifest entry. Default implementation:
   *  fetch(buildUrl(entry)) and read the body as text. Override if the
   *  source needs custom headers or post-processing. */
  fetchSvg(entry: ConnectorManifestEntry): Promise<string>;

  /**
   * Whether the SVG markup from this source is single-fill / tintable. Tintable
   * icons take on the marker / inline-insertion colour at render time.
   * game-icons.net are all tintable; Lucide currently-color stroke icons are
   * tintable too (they use stroke="currentColor" or similar).
   */
  readonly tintable: boolean;
}
