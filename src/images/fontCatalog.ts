/**
 * Bundled-font catalog — the seed list for the Small Assets Library's Fonts
 * category. Each entry becomes an ImageAsset with source='font' on first
 * run, after which the actual library is the source of truth and users
 * can add more Google Fonts on top.
 *
 * Fonts are loaded at runtime via the Google Fonts CSS API (no woff2 files
 * shipped in the app bundle yet) — Stream C will eventually swap to
 * bundled self-hosted faces, at which point this list still drives the
 * seed but the @font-face source changes.
 */

export interface FontCatalogEntry {
  /** Display name shown in the Fonts category. */
  name:          string;
  /** Family string used in CSS font-family. */
  family:        string;
  /** Short usage hint shown under the name. */
  vibe:          string;
  /** Free-text attribution suitable for the credits block. */
  attribution:   string;
  /** Licence label — all currently SIL OFL 1.1. */
  license:       string;
  /** Canonical project page for this font (Google Fonts page typically). */
  sourceUrl:     string;
}

/** Lazy-load font families via the Google Fonts CSS API. Each call replaces
 *  the previous <link> so newly-added user fonts are picked up without a
 *  reload. Pass the live list of families from the imageAssets store —
 *  source of truth lives there once seeding has run. Stream C will swap
 *  this for bundled self-hosted woff2 + @font-face so the fonts work
 *  offline. */
let _fontsLinkEl: HTMLLinkElement | null = null;
let _loadedFamiliesKey = '';
export function ensureFontsLoaded(families: readonly string[]): void {
  // Stable cache key so we skip the DOM churn when nothing changed.
  const unique = Array.from(new Set(families.map((f) => f.trim()).filter(Boolean))).sort();
  const key = unique.join('|');
  if (key === _loadedFamiliesKey) return;
  _loadedFamiliesKey = key;

  if (unique.length === 0) {
    if (_fontsLinkEl) { _fontsLinkEl.remove(); _fontsLinkEl = null; }
    return;
  }

  const params = unique
    .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}`)
    .join('&');
  const href = `https://fonts.googleapis.com/css2?${params}&display=swap`;

  if (!_fontsLinkEl) {
    _fontsLinkEl = document.createElement('link');
    _fontsLinkEl.rel = 'stylesheet';
    document.head.appendChild(_fontsLinkEl);
  }
  _fontsLinkEl.href = href;
}

export const BUNDLED_FONTS: ReadonlyArray<FontCatalogEntry> = [
  {
    name:        'Cinzel',
    family:      'Cinzel',
    vibe:        'Medieval / Roman capitals — proclamations, fantasy headlines',
    attribution: 'Cinzel by Natanael Gama',
    license:     'SIL OFL 1.1',
    sourceUrl:   'https://fonts.google.com/specimen/Cinzel',
  },
  {
    name:        'IM Fell DW Pica',
    family:      'IM Fell DW Pica',
    vibe:        'Period-correct 17th-century print — old maps, archaic flavour',
    attribution: 'IM Fell DW Pica by Igino Marini',
    license:     'SIL OFL 1.1',
    sourceUrl:   'https://fonts.google.com/specimen/IM+Fell+DW+Pica',
  },
  {
    name:        'Special Elite',
    family:      'Special Elite',
    vibe:        'Broken typewriter — noir, ransom notes, mysteries',
    attribution: 'Special Elite by Astigmatic',
    license:     'SIL OFL 1.1',
    sourceUrl:   'https://fonts.google.com/specimen/Special+Elite',
  },
  {
    name:        'Permanent Marker',
    family:      'Permanent Marker',
    vibe:        'Bold handwritten marker — signage, urgent notes',
    attribution: 'Permanent Marker by Font Diner (Stuart Sandler)',
    license:     'SIL OFL 1.1',
    sourceUrl:   'https://fonts.google.com/specimen/Permanent+Marker',
  },
  {
    name:        'Caveat',
    family:      'Caveat',
    vibe:        'Flowing handwriting — personal letters, journal entries',
    attribution: 'Caveat by Pablo Impallari',
    license:     'SIL OFL 1.1',
    sourceUrl:   'https://fonts.google.com/specimen/Caveat',
  },
  {
    name:        'Uncial Antiqua',
    family:      'Uncial Antiqua',
    vibe:        'Ancient scribe — runes, dwarven inscriptions, sacred text',
    attribution: 'Uncial Antiqua by John Vargas Beltrán',
    license:     'SIL OFL 1.1',
    sourceUrl:   'https://fonts.google.com/specimen/Uncial+Antiqua',
  },
  {
    name:        'VT323',
    family:      'VT323',
    vibe:        'CRT terminal — sci-fi reports, computer outputs',
    attribution: 'VT323 by Peter Hull',
    license:     'SIL OFL 1.1',
    sourceUrl:   'https://fonts.google.com/specimen/VT323',
  },
  {
    name:        'Press Start 2P',
    family:      'Press Start 2P',
    vibe:        '8-bit pixel font — retro game UI, hacker overlays',
    attribution: 'Press Start 2P by CodeMan38',
    license:     'SIL OFL 1.1',
    sourceUrl:   'https://fonts.google.com/specimen/Press+Start+2P',
  },
  {
    name:        'Playwrite England Joined',
    family:      'Playwrite England Joined',
    vibe:        'Cursive school handwriting — diaries, polite letters',
    attribution: 'Playwrite England Joined by TypeTogether',
    license:     'SIL OFL 1.1',
    sourceUrl:   'https://fonts.google.com/specimen/Playwrite+England+Joined',
  },
  {
    name:        'Seaweed Script',
    family:      'Seaweed Script',
    vibe:        'Brush-script signage — taverns, beach huts, posters',
    attribution: 'Seaweed Script by Pablo Impallari',
    license:     'SIL OFL 1.1',
    sourceUrl:   'https://fonts.google.com/specimen/Seaweed+Script',
  },
];
