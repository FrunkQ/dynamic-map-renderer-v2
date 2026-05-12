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

/** Pangrams used as font samples in the Fonts category. Each font gets a
 *  deterministic pick from this list (hash of the family name modulo the
 *  array length) so the sample is consistent across re-renders but varies
 *  between fonts. All pangrams hit the full A–Z so the font's character
 *  shows through every glyph. */
const SAMPLE_PANGRAMS: ReadonlyArray<string> = [
  'Sphinx of black quartz, judge my vow.',
  "Cthulhu's big jaw vexed murky zany fops.",
  'Warp five quaking ducks by my lazy vortex.',
  'The five boxing wizards jump quickly.',
  'Pack my box with five dozen liquor jugs.',
  'Quickly zap five bad monks with my wax jar.',
  'Glitchy cyborgs vexed a jumpy pink dwarf.',
  'Whack five jumpy ducks over my glazing box.',
  'Mappadux: Warp five lazy ducks by the vortex.',
  'How quickly daft jumping zebras vex.',
  'Big foxy wizards jump quickly, eh?',
  "My jovial dwarf packs fix'd quartz.",
  "Blowzy night-frumps vex'd Jack Q.",
  'Jackdaws love my big sphinx of quartz.',
  'Glazed nymphs jog back for quick waltz.',
  'Waltz, bad nymph, for quick jigs vex.',
  "Glibly, fax vex'd Mr. Jow's sphinx quartz.",
  'Jived fox nymph grabs quick waltz.',
  'Six big jet planes zoomed over a fuzzy quack.',
  'Ghouls fix murky quartz by a jagged spawn.',
];

/** Deterministic pangram for a given font key (usually the family name). */
export function pangramFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  return SAMPLE_PANGRAMS[Math.abs(h) % SAMPLE_PANGRAMS.length]!;
}

/** Lazy-load font families via the Google Fonts CSS API. Each call replaces
 *  the previous <link> so newly-added user fonts are picked up without a
 *  reload. Pass the live list of families from the imageAssets store —
 *  source of truth lives there once seeding has run.
 *
 *  Locally-uploaded fonts (font assets that carry their own woff2/ttf
 *  blob) bypass this path entirely — they're registered via the
 *  FontFace API by registerLocalFontAsset() below. Pass them in too —
 *  this function filters out families that already have a FontFace
 *  registered so we don't double-fetch from Google for a font that
 *  ships its own bytes. */
let _fontsLinkEl: HTMLLinkElement | null = null;
let _loadedFamiliesKey = '';
export function ensureFontsLoaded(families: readonly string[]): void {
  const unique = Array.from(new Set(families.map((f) => f.trim()).filter(Boolean)))
    .filter((f) => !isLocallyRegistered(f))
    .sort();
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

// ─── Locally-uploaded fonts ─────────────────────────────────────────────

/** Tracks family names we've already registered via FontFace so calls
 *  are idempotent and ensureFontsLoaded() doesn't re-fetch from Google
 *  for a font we already have locally. */
const _localFamilies = new Set<string>();

function isLocallyRegistered(family: string): boolean {
  return _localFamilies.has(family);
}

/** Register an uploaded font file with the document so any CSS using
 *  its `family` resolves to the user's bytes (rather than falling
 *  through to a Google CDN fetch / system fallback). Idempotent on
 *  the family — calling twice with the same family is a no-op. */
export async function registerLocalFontAsset(family: string, blob: Blob): Promise<void> {
  const trimmed = family.trim();
  if (!trimmed) return;
  if (_localFamilies.has(trimmed)) return;
  try {
    const buf = await blob.arrayBuffer();
    const face = new FontFace(trimmed, buf);
    await face.load();
    document.fonts.add(face);
    _localFamilies.add(trimmed);
    // Drop the cache key so the next ensureFontsLoaded() doesn't think
    // its Google <link> is still authoritative — this family no longer
    // needs to be in the CDN request.
    _loadedFamiliesKey = '';
  } catch (err) {
    console.warn(`[fontCatalog] failed to register local font "${trimmed}":`, err);
  }
}

/** Bulk-register every font asset that ships its own blob (uploaded by
 *  the user). Walks a list of ImageAsset-shaped records — designed to
 *  be called with the result of ImageAssetStore.getAll() filtered to
 *  source === 'font'. Bundled Google fonts have no blob and are
 *  silently skipped here; they continue to load via ensureFontsLoaded. */
export async function registerLocalFontsFromAssets(
  assets: ReadonlyArray<{ source: string; fontFamily?: string; blob?: Blob }>,
): Promise<void> {
  for (const a of assets) {
    if (a.source !== 'font') continue;
    if (!a.fontFamily || !a.blob) continue;
    await registerLocalFontAsset(a.fontFamily, a.blob);
  }
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
    name:        'Playwrite GB J',
    family:      'Playwrite GB J',
    vibe:        'British school cursive — diaries, polite letters',
    attribution: 'Playwrite GB J by TypeTogether',
    license:     'SIL OFL 1.1',
    sourceUrl:   'https://fonts.google.com/specimen/Playwrite+GB+J',
  },
  {
    name:        'Seaweed Script',
    family:      'Seaweed Script',
    vibe:        'Brush-script signage — taverns, beach huts, posters',
    attribution: 'Seaweed Script by Pablo Impallari',
    license:     'SIL OFL 1.1',
    sourceUrl:   'https://fonts.google.com/specimen/Seaweed+Script',
  },
  {
    name:        'Whisper',
    family:      'Whisper',
    vibe:        'Delicate cursive — secret notes, hushed messages',
    attribution: 'Whisper by Kimberly Geswein',
    license:     'SIL OFL 1.1',
    sourceUrl:   'https://fonts.google.com/specimen/Whisper',
  },
  {
    name:        'MedievalSharp',
    family:      'MedievalSharp',
    vibe:        'Carved stone / rune-like — rock inscriptions, monuments, dungeon plaques',
    attribution: 'MedievalSharp by Marcelo Magalhães',
    license:     'SIL OFL 1.1',
    sourceUrl:   'https://fonts.google.com/specimen/MedievalSharp',
  },
];
