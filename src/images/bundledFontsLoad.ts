/**
 * Bundle the 12 catalog fonts directly into the app so they work
 * offline and don't depend on Google's CDN at runtime. Each
 * @fontsource/* package ships:
 *   • a woff2 subset (Latin, regular weight)
 *   • an index.css with the matching @font-face rule pointing at it
 *
 * Importing each package's `index.css` as a side-effect registers
 * the font with the document. Vite's CSS pipeline rewrites the
 * font-file URLs to hashed asset paths and the workbox precache
 * (vite-plugin-pwa) picks them up automatically so a fresh install
 * caches every face on first load.
 *
 * After this module runs, every catalog family is in
 * document.fonts — `ensureFontsLoaded` filters them out of the
 * Google CSS request via `markBundledFontsAsLocal()` (called from
 * the same path) so we never re-fetch what we already ship.
 *
 * User-added fonts (the "Browse Google Fonts" path in the Image
 * Asset Library + uploaded woff2/ttf blobs) keep their existing
 * pathways — Google CDN for unknown families, FontFace API for
 * uploaded bytes. Only the 12 catalog families are locally bundled
 * by this module.
 *
 * Bundle cost: ~30-60 KB woff2 per face, ~500 KB total. Trade-off
 * accepted: Mappadux is a VTT@Home tool where offline-at-the-table
 * play is a primary use case, so deterministic local fonts are
 * worth the bundle bytes.
 */

import '@fontsource/cinzel';
import '@fontsource/im-fell-dw-pica';
import '@fontsource/special-elite';
import '@fontsource/permanent-marker';
import '@fontsource/caveat';
import '@fontsource/uncial-antiqua';
import '@fontsource/vt323';
import '@fontsource/press-start-2p';
import '@fontsource/playwrite-gb-j';
import '@fontsource/seaweed-script';
import '@fontsource/whisper';
import '@fontsource/medievalsharp';

import { markBundledFontsAsLocal } from './fontCatalog.ts';

// Sync flag so ensureFontsLoaded() knows to skip these from its
// Google CSS request — the @font-face rules above are already in
// the document at this point.
markBundledFontsAsLocal();
