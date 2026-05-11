# Adding a New Image Source Connector

Image source connectors are how the Image Assets Library imports icons from external catalogs (game-icons.net, Lucide, future sources). Adding one is two files plus one line in the registry.

## How it works

Each connector implements the `ImageSourceConnector` interface:

```
ImageAssetModal
  └── Browse tab strip — one tab per registered connector
        ├── loadManifest() — returns ConnectorManifestEntry[] (cached client-side)
        ├── grid filtered by search query
        └── click → fetchSvg() + save as ImageAsset with source=<connector.id>
```

The pattern is **catalog-based, not authenticated**. Each connector exposes a static (or dynamically fetched) manifest of available icons, then resolves each entry's SVG markup on demand via `fetchSvg()`. No API keys, no rate limits, no quota juggling — search runs client-side against the manifest, downloads happen one-by-one as the user clicks Import.

## File structure

```
src/images/connectors/
  types.ts              ← shared ImageSourceConnector interface (don't edit)
  gameIcons.ts          ← Game Icons (CC-BY 3.0) — reference example
  lucide.ts             ← Lucide (MIT) — reference example
  your_source.ts        ← your new connector
  ADDING_IMAGE_SOURCES.md ← this file
```

The connector list is registered in `src/images/ImageAssetModal.ts`:

```typescript
const CONNECTORS: readonly ImageSourceConnector[] = [
  gameIconsConnector,
  lucideConnector,
  yourSourceConnector,   // ← add here
];
```

## Minimal example

```typescript
import type { ImageSourceConnector, ConnectorManifestEntry } from './types.ts';

const SVG_BASE = 'https://cdn.example.com/icons';

const STARTER_MANIFEST: ConnectorManifestEntry[] = [
  { slug: 'sword',  name: 'Sword',  tags: ['weapon','melee'],     author: 'You' },
  { slug: 'shield', name: 'Shield', tags: ['gear','defence'],     author: 'You' },
  // ...
];

export const yourSourceConnector: ImageSourceConnector = {
  id:          'your-source',           // must match a new value in ImageAssetSource
  displayName: 'Your Source',
  license:     'CC0',
  licenseUrl:  'https://creativecommons.org/publicdomain/zero/1.0/',
  sourceUrl:   'https://cdn.example.com/',
  tintable:    true,

  async loadManifest() { return STARTER_MANIFEST; },

  buildUrl(entry)        { return `${SVG_BASE}/${entry.slug}.svg`; },
  attributionFor(entry)  { return `Icon: "${entry.name}" — CC0 via Your Source`; },

  async fetchSvg(entry) {
    const res = await fetch(this.buildUrl(entry));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  },
};
```

### Required additions outside the connector file

1. **Add the connector's `id` to the `ImageAssetSource` union in `src/types.ts`:**
   ```typescript
   export type ImageAssetSource =
     | 'unicode' | 'upload' | 'game-icons' | 'lucide'
     | 'your-source';   // ← add here
   ```
2. **Register the connector in `src/images/ImageAssetModal.ts`** (the `CONNECTORS` array — see above).

That's all. The modal automatically renders a "Browse <DisplayName>" tab; the source connector type travels in bundles round-trip via `imageAssets[].source`.

## What goes in a manifest entry

| Field    | Required | Notes |
|----------|----------|-------|
| `slug`   | yes      | Stable id used to construct the CDN URL. Whatever path fragment the source uses — `lorc/broadsword` for game-icons, `map-pin` for Lucide, etc. |
| `name`   | yes      | Display name in the browse grid + the imported library row. |
| `tags`   | yes      | Free-text tags for the client-side search box. Lowercase, no punctuation. |
| `author` | optional | Display author when relevant (game-icons.net icons credit individual artists). Omit if irrelevant. |

## Manifest strategies

- **Bundle a static manifest** (current v2.11 default for both connectors) — fast, no network dependency at modal-open time. Good for curated subsets.
- **Fetch a manifest from a known URL** — let the connector hit a JSON endpoint on first browse, then cache it client-side. Good for large catalogs you don't want to ship in the app bundle.
- **Search via a remote endpoint** — return manifest entries from a `?q=…` query. The Lucide search bar in the modal can be wired to call this if the connector exposes a `searchManifest(query)` method (not implemented yet — extension point for v2.12+).

## Tintability

Set `tintable: true` if your source ships single-fill SVGs (e.g. game-icons.net is all `<path fill="#000">`) or stroke icons with `stroke="currentColor"` (Lucide). The modal will rewrite the fill / stroke to `currentColor` at render time so consumers (markers, inline text-map insertions) can recolour freely.

Set `tintable: false` if your icons have intrinsic colours that shouldn't be lost (e.g. multi-colour illustrations). The library will preserve them verbatim.

## Licensing & attribution

Every icon imported via a connector lands in the user's library with `attribution`, `license`, and `sourceUrl` populated. The unified "Copy attributions" output (Audio + Maps + Images) gathers them automatically, so creators distributing packs always credit the source.

Pick licences carefully:
- **CC0 / public domain** — no attribution required, but we still credit by convention.
- **MIT / BSD** — no attribution required for non-software use of icons but credit anyway.
- **CC-BY** — attribution **required**. Bundles always carry the attribution string, so this is fine, but make sure your `attributionFor()` returns something the recipient can paste into their credits page.
- **CC-BY-SA, GPL** — viral / share-alike. Avoid unless you're sure derivative packs can comply.
- **CC-BY-NC, "Free for personal use"** — incompatible with redistributable bundles. Don't add as a connector.

## Future: catalog connectors for Maps and Audio

The connector pattern is deliberately generic — the same shape applies to:

- **Map sources** — public battlemap repositories (e.g. Reddit /r/battlemaps mirrors, Patreon-distributed packs with public manifests). Would slot in beside the existing Upload + Web Link tabs in `MapAssetModal`.
- **Audio sources** — same pattern as Freesound today, but generalised so other catalogs (OpenGameArt, ccMixter, BBC Sound Effects) plug in symmetrically.

Future direction: lift `ImageSourceConnector`, `ConnectorManifestEntry`, and the modal's tab+browse rendering into shared modules under `src/connectors/` (or similar), then have Maps + Audio modals consume them with their own concrete connector implementations. The current `FreesoundModal` becomes an `AudioSourceConnector` implementation rather than a bespoke modal.

## Test plan when shipping a new connector

1. Open Image Library → click your new Browse tab → grid populates from `loadManifest()`.
2. Click an icon → it imports into the currently-selected library category with tintable / attribution / sourceUrl set.
3. Save a Map Pack → confirm the imported icon travels (DevTools → bundle JSON `imageAssets[].source` shows your connector id).
4. Load the pack on a fresh instance → icon present, attribution preserved.
5. "Copy attributions" includes the icon's attribution string.
