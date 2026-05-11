/**
 * Read-only catalog of the OFL fonts that Stream C (Text Maps) will bundle.
 *
 * Listed in the Image Library's Fonts category so users can see what's
 * coming, browse the licence terms, and have the attribution surface in
 * the unified Copy attributions output. No font files are loaded by this
 * module — the bundled font files (woff2) land alongside Stream C and
 * the catalog gets wired to actual <link rel="preload"> + CSS @font-face
 * directives at that point.
 *
 * The Image Library's Attributions rollup reads from this list whenever
 * a font from here ends up referenced by a text-map asset (Stream C).
 */

export interface FontCatalogEntry {
  /** Display name shown in the Fonts category. */
  name:          string;
  /** Family string used in CSS font-family (post Stream C). */
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
];
