import type { ImageAsset, ImageCategory } from '../types.ts';
import { SYSTEM_CATEGORY_IDS } from '../types.ts';
import { ImageAssetStore } from './ImageAssetStore.ts';

/**
 * First-run seeding for the Image Assets library.
 *
 *   • Ensures every system category exists with stable ids (so consumers
 *     can reference SYSTEM_CATEGORY_IDS.textmap etc. without lookup).
 *   • Migrates the 47 hardcoded marker icon Unicode presets into ImageAsset
 *     records under the Unicode category, the first time the function runs
 *     against a fresh imageAssets store.
 *
 * Idempotent — safe to call on every app start. Skips work that's already
 * done. Existing user-defined categories are preserved as-is.
 */

/** The Unicode glyph presets that existed in the v2.10 IconPicker. Kept as a
 *  literal so migration is deterministic — same glyphs always land with the
 *  same display order. */
const UNICODE_PRESETS: ReadonlyArray<{ name: string; char: string }> = [
  { name: 'Diamond filled',   char: '◆' },
  { name: 'Diamond outline',  char: '◇' },
  { name: 'Circle filled',    char: '●' },
  { name: 'Circle outline',   char: '○' },
  { name: 'Square filled',    char: '■' },
  { name: 'Square outline',   char: '□' },
  { name: 'Triangle up',      char: '▲' },
  { name: 'Triangle up out',  char: '△' },
  { name: 'Triangle down',    char: '▼' },
  { name: 'Triangle down out',char: '▽' },
  { name: 'Star filled',      char: '★' },
  { name: 'Star outline',     char: '☆' },
  { name: 'Sparkle',          char: '✦' },
  { name: 'Sparkle outline',  char: '✧' },
  { name: 'Knot',             char: '❖' },
  { name: 'Diamond suit',     char: '♦' },
  { name: 'Spade suit',       char: '♠' },
  { name: 'Heart suit',       char: '♥' },
  { name: 'Club suit',        char: '♣' },
  { name: 'Pawn',             char: '♟' },
  { name: 'Heavy plus',       char: '✚' },
  { name: 'Heavy cross',      char: '✖' },
  { name: 'X mark',           char: '✗' },
  { name: 'X mark heavy',     char: '✘' },
  { name: 'Check light',      char: '✓' },
  { name: 'Check heavy',      char: '✔' },
  { name: 'Speaker',          char: '🔊' },
  { name: 'Circled 1',  char: '①' }, { name: 'Circled 2',  char: '②' },
  { name: 'Circled 3',  char: '③' }, { name: 'Circled 4',  char: '④' },
  { name: 'Circled 5',  char: '⑤' }, { name: 'Circled 6',  char: '⑥' },
  { name: 'Circled 7',  char: '⑦' }, { name: 'Circled 8',  char: '⑧' },
  { name: 'Circled 9',  char: '⑨' }, { name: 'Circled 10', char: '⑩' },
  { name: 'Circled 11', char: '⑪' }, { name: 'Circled 12', char: '⑫' },
  { name: 'Circled 13', char: '⑬' }, { name: 'Circled 14', char: '⑭' },
  { name: 'Circled 15', char: '⑮' }, { name: 'Circled 16', char: '⑯' },
  { name: 'Circled 17', char: '⑰' }, { name: 'Circled 18', char: '⑱' },
  { name: 'Circled 19', char: '⑲' }, { name: 'Circled 20', char: '⑳' },
];

const SYSTEM_CATEGORIES: ReadonlyArray<ImageCategory> = [
  { id: SYSTEM_CATEGORY_IDS.unicode,       name: 'Unicode',       isSystem: true, sortOrder: 0  },
  { id: SYSTEM_CATEGORY_IDS.abstract,      name: 'Abstract',      isSystem: true, sortOrder: 10 },
  { id: SYSTEM_CATEGORY_IDS.fantasy,       name: 'Fantasy',       isSystem: true, sortOrder: 20 },
  { id: SYSTEM_CATEGORY_IDS.scifi,         name: 'Sci-fi',        isSystem: true, sortOrder: 30 },
  { id: SYSTEM_CATEGORY_IDS.contemporary,  name: 'Contemporary',  isSystem: true, sortOrder: 40 },
  { id: SYSTEM_CATEGORY_IDS.textmap,       name: 'Textmap',       isSystem: true, sortOrder: 50 },
  // Uncategorised — dedicated holding pen for icons that the auto-route
  // couldn't place. Users see them clustered here and can drag-to-fix.
  { id: SYSTEM_CATEGORY_IDS.uncategorised, name: 'Uncategorised', isSystem: true, sortOrder: 55 },
  // Fonts is special-cased in the library modal — listing-only for now,
  // pre-populated with the eight OFL fonts that Stream C (Text Maps) will
  // bundle. Stored separately from regular ImageAssets so attribution can
  // travel into the unified Copy attributions output even though users
  // can't yet add fonts themselves.
  { id: SYSTEM_CATEGORY_IDS.fonts,         name: 'Fonts',         isSystem: true, sortOrder: 60 },
];

/** Standard licence label for built-in / user-typed Unicode glyphs. Unicode
 *  characters themselves are not copyrighted — the standard is a public
 *  registry of code points. Font glyph designs are separate; we render via
 *  the browser's system font stack at runtime, so no third-party font asset
 *  travels in the pack. */
export const UNICODE_LICENSE_LABEL = 'Unicode character — Public Domain';

export async function seedImageAssetsIfNeeded(): Promise<void> {
  // 1. Ensure system categories exist. Idempotent — saveCategory upserts.
  const existing = await ImageAssetStore.getAllCategories();
  const existingIds = new Set(existing.map((c) => c.id));
  for (const cat of SYSTEM_CATEGORIES) {
    if (!existingIds.has(cat.id)) {
      await ImageAssetStore.saveCategory(cat);
    }
  }

  // 2. Migrate Unicode presets exactly once. Detect by looking for any
  //    seeded preset id anywhere in the library — not just the Unicode
  //    category, since users can drag-and-drop them into Abstract / their
  //    own categories. If even one preset id is present we treat the
  //    migration as done (the user may have deleted some since; we don't
  //    want to re-seed every load and never want to double-seed because
  //    presets were moved out of Unicode).
  const allAssets = await ImageAssetStore.getAll();
  const hasAnyUnicodePreset = allAssets.some(
    (a) => a.id.startsWith('unicode-preset-'),
  );
  if (!hasAnyUnicodePreset) {
    const now = Date.now();
    let i = 0;
    for (const preset of UNICODE_PRESETS) {
      const asset: ImageAsset = {
        id:           `unicode-preset-${String(i).padStart(3, '0')}`,
        name:         preset.name,
        source:       'unicode',
        categoryId:   SYSTEM_CATEGORY_IDS.unicode,
        tintable:     true,
        unicodeChar:  preset.char,
        license:      UNICODE_LICENSE_LABEL,
        addedAt:      now - i, // Preserve original ordering via timestamps
      };
      await ImageAssetStore.save(asset);
      i++;
    }
  }

  // 3. Backfill the licence label on existing Unicode entries that predate
  //    the proper string (early v2.11.0-dev installs landed with 'N/A').
  //    One-time fix-up; idempotent thereafter.
  for (const a of allAssets) {
    if (a.source === 'unicode' && (a.license === 'N/A' || !a.license)) {
      await ImageAssetStore.update(a.id, { license: UNICODE_LICENSE_LABEL });
    }
  }
}
