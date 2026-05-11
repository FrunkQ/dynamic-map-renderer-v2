import type { ImageAsset, ImageCategory } from '../types.ts';
import { SYSTEM_CATEGORY_IDS } from '../types.ts';
import { ImageAssetStore } from './ImageAssetStore.ts';
import type { ImageSourceConnector, ConnectorManifestEntry } from './connectors/types.ts';
import { gameIconsConnector } from './connectors/gameIcons.ts';
import { lucideConnector } from './connectors/lucide.ts';
import { generateId } from '../utils/id.ts';
import { UNICODE_LICENSE_LABEL } from './seedImageAssets.ts';
import { ensureFontsLoaded, pangramFor } from './fontCatalog.ts';
import { fuzzySearch } from '../utils/fuzzySearch.ts';

const CONNECTORS: readonly ImageSourceConnector[] = [
  gameIconsConnector,
  lucideConnector,
];

/** Pseudo-category id used for the sidebar "All" row — shows every asset
 *  regardless of categoryId. Not stored in IDB. */
const ALL_CATEGORY_ID = '__all__';

/** Auto-route map — when an imported icon's tags include any of these
 *  keywords, route it to the matching system category. Order matters:
 *  Sci-fi is checked first (its keywords are highly specific), then
 *  Fantasy (the broadest medieval/magic bucket), then Contemporary
 *  (modern utility), with Abstract as the fall-through.
 *
 *  Keyword lists are drawn from common game-icons.net slug terms — slugs
 *  like 'lorc/dragon-head' produce tags ['dragon','head'] via the build
 *  script's split-on-hyphens extraction, so the rule fires on any of
 *  those parts. */
const AUTO_CATEGORY_RULES: ReadonlyArray<{ keywords: readonly string[]; categoryId: string }> = [
  // Sci-fi: tech, space, future, anything obviously not medieval. Listed
  // first so 'robot-knight' lands in scifi rather than fantasy.
  { keywords: [
      'scifi','sci-fi','cyber','cyborg','android','mech','robot','bot','drone',
      'space','spaceship','starship','rocket','asteroid','planet','satellite',
      'ufo','alien','mutant','galactic','cosmic','nebula','astronaut','spacesuit','jetpack',
      'laser','blaster','plasma','ray','beam','photon','radiation','reactor',
      'tech','technology','cpu','processor','chip','circuit','console','terminal','datapad',
      'computer','server','antenna','beacon','scanner','sensor','radar','radio',
      'futuristic','futurist','neon','retro-future',
    ], categoryId: 'sys-scifi' },

  // Fantasy: medieval, magic, creatures, classic TTRPG gear. Broadest bucket.
  { keywords: [
      'fantasy','medieval','knight','paladin','barbarian','druid','ranger','bard','monk','cleric','rogue',
      // Races / creatures
      'dwarf','dwarven','elf','elven','orc','orcish','goblin','kobold','troll','ogre','gnome','halfling',
      'dragon','wyvern','drake','hydra','phoenix','unicorn','centaur','minotaur','beholder',
      'wolf','bear','boar','spider','snake','serpent','viper','rat','bat','crow','raven','hawk','falcon',
      'demon','devil','imp','succubus','undead','skeleton','zombie','ghost','wraith','lich','vampire','werewolf',
      'fairy','fae','sprite','pixie','dryad','satyr','gnoll',
      // Magic
      'magic','arcane','spell','scroll','rune','sorcery','enchant','enchantment','glyph','sigil',
      'wizard','witch','mage','sorcerer','warlock','necromancer',
      'cauldron','potion','elixir','vial','grimoire','tome','spellbook',
      'divine','holy','blessing','curse','hex','ritual','summon','conjure',
      // Weapons
      'sword','greatsword','broadsword','rapier','scimitar','katana','dagger','dirk',
      'axe','battleaxe','halberd','poleaxe','glaive','spear','pike','lance','javelin',
      'mace','warhammer','flail','club','quarterstaff','staff',
      'bow','longbow','crossbow','arrow','quiver','sling',
      // Armour / gear
      'shield','buckler','helm','helmet','gauntlet','greaves','plate','chainmail','leather','gambeson',
      'cloak','robe','sash','tabard','heraldry','crown','crest','banner',
      // Places
      'castle','keep','tower','dungeon','temple','shrine','altar','crypt','tomb','ruins',
      'cavern','cave','mine','forge','anvil','tavern','inn','mead','brewery','manor',
      'portal','gate','dais','obelisk',
      // Items
      'chest','treasure','loot','coin','gem','jewel','jewelry','ring','amulet','talisman','relic','idol',
      'lantern','torch','candle','brazier','goblet','chalice','flagon',
      // Elemental / themes
      'flame','fire','frost','ice','poison','acid','blood','bone','skull',
    ], categoryId: 'sys-fantasy' },

  // Contemporary: modern UI / utility / everyday objects.
  { keywords: [
      'ui','interface','app','widget',
      'arrow','arrows','cross','check','tick','info','alert','warning','error','help','question',
      'nav','navigation','direction','compass','map','pin','marker','flag','target','crosshair',
      'menu','hamburger','gear','settings','config','tool','tools','wrench','spanner','screwdriver','drill',
      'time','clock','hourglass','watch','calendar','timer','stopwatch',
      'search','magnifier','glass','eye','vision','watch','binoculars',
      'lock','unlock','key','padlock','password','secure',
      'phone','smartphone','mobile','laptop','tablet','desktop','monitor','screen','keyboard','mouse',
      'mail','envelope','letter','message','chat','speech','bubble',
      'file','folder','document','paper','pen','pencil','clipboard','book','notebook',
      'camera','photo','image','picture','video','microphone','speaker','headphones','volume','sound',
      'user','users','person','people','group','team','contact','profile','account',
      'home','house','office','building',
      'car','truck','bus','train','plane','airplane','boat','bike','motorcycle','bicycle','scooter',
      'heart','star','bookmark','tag','label',
      'cup','mug','glass','bottle','plate','spoon','fork','knife',
      'sun','moon','cloud','rain','snow','umbrella',
    ], categoryId: 'sys-contemporary' },

  // Abstract: catch-all geometric / symbolic.
  { keywords: [
      'abstract','shape','symbol','geometric',
      'circle','square','triangle','rectangle','hexagon','pentagon','diamond','octagon',
      'star','starburst','dot','dots','line','lines',
      'plus','minus','equal','asterisk','ampersand','hash',
      'pattern','grid','dots','noise',
    ], categoryId: 'sys-abstract' },
];

function suggestCategoryFromTags(tags: readonly string[]): string | null {
  const lower = new Set(tags.map((t) => t.toLowerCase()));
  for (const rule of AUTO_CATEGORY_RULES) {
    if (rule.keywords.some((kw) => lower.has(kw))) return rule.categoryId;
  }
  return null;
}

/** Pull designer + licence metadata for a Google Fonts family by reading
 *  the project's METADATA.pb from raw.githubusercontent.com (CORS open).
 *  Returns null when the fetch fails or the family isn't in any of the
 *  three licence directories the repo uses.
 *
 *  METADATA.pb is protobuf text format; we parse the `designer:` and
 *  `license:` lines with regex. Some families list multiple designer
 *  entries (one per line), others use a single comma-separated string —
 *  both are handled. */
async function fetchGoogleFontMetadata(
  family: string,
): Promise<{ designer: string; license: string } | null> {
  // The repo slug is lowercase + spaces stripped: "Playwrite GB J" -> "playwritegbj".
  const slug = family.toLowerCase().replace(/\s+/g, '');
  const licenseDirs = ['ofl', 'apache', 'ufl'] as const;
  const LICENSE_LABELS: Record<string, string> = {
    OFL:     'SIL OFL 1.1',
    APACHE2: 'Apache 2.0',
    UFL:     'Ubuntu Font Licence 1.0',
  };
  for (const dir of licenseDirs) {
    const url = `https://raw.githubusercontent.com/google/fonts/main/${dir}/${slug}/METADATA.pb`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const text = await res.text();
      // Multiple `designer: "X"` lines, OR a single line with comma-joined names.
      const designerMatches = [...text.matchAll(/^\s*designer:\s*"([^"]+)"/gm)];
      const designer = designerMatches.map((m) => m[1]).join(', ');
      const licenseMatch = text.match(/^\s*license:\s*"([^"]+)"/m);
      const rawLicense = licenseMatch?.[1] ?? '';
      const license = LICENSE_LABELS[rawLicense] ?? (rawLicense || 'See Google Fonts page');
      return { designer, license };
    } catch {
      // Try the next licence dir.
    }
  }
  return null;
}

/** Pull the family name AND any tag-like metadata from either a Google
 *  Fonts specimen URL or a raw family string. Returns null when the input
 *  is empty after parsing.
 *
 *  Tags come from the URL's `categoryFilters` query parameter, which
 *  Google Fonts uses to record the user's filter context when they share
 *  a URL — e.g.
 *    https://fonts.google.com/specimen/Kablammo?categoryFilters=Feeling:%2FExpressive%2FInnovative
 *  gives us ['expressive','innovative'] which feed straight into the
 *  asset's tags. Multiple filter groups (Feeling, Classification, Serif,
 *  Calligraphy, etc.) are all collected. */
function extractFamilyFromInput(input: string): { family: string; tags: string[] } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const urlMatch = trimmed.match(/fonts\.google\.com\/specimen\/([^?#/]+)(\?[^#]*)?/i);
  if (urlMatch && urlMatch[1]) {
    let family: string;
    try { family = decodeURIComponent(urlMatch[1].replace(/\+/g, ' ')); }
    catch { family = urlMatch[1].replace(/\+/g, ' '); }

    const tags: string[] = [];
    if (urlMatch[2]) {
      try {
        const params = new URLSearchParams(urlMatch[2]);
        const filters = params.get('categoryFilters');
        if (filters) {
          // Format: "Feeling:/Expressive/Innovative,Classification:/Display"
          // (raw "/" is sometimes URL-escaped — URLSearchParams already decoded).
          for (const group of filters.split(',')) {
            const colonIdx = group.indexOf(':');
            if (colonIdx < 0) continue;
            const values = group.slice(colonIdx + 1).split('/').filter(Boolean);
            for (const v of values) tags.push(v.toLowerCase());
          }
        }
      } catch {
        // Tags are nice-to-have; never let a parse error block the import.
      }
    }
    return { family, tags };
  }

  // Not a URL — assume it's already a family name. Strip surrounding quotes
  // people sometimes paste from prose.
  return { family: trimmed.replace(/^["']|["']$/g, ''), tags: [] };
}

/**
 * ImageAssetModal — Image Assets Library browser. Third first-class asset
 * library alongside Maps + Audio. Layout: a category sidebar on the left,
 * a grid of icon thumbnails on the right, an add-toolbar at the top of
 * the main area (paste Unicode glyph, upload PNG/SVG; source connectors
 * for game-icons.net and Lucide land in a follow-up commit).
 *
 * Browse-only at this milestone — the modal is opened from the hamburger
 * "Image Library…" entry. Marker icon integration follows; the existing
 * IconPicker continues to back markers in the meantime.
 */
export interface ImageAssetModalOptions {
  /** When set, opens with this category selected. Defaults to Unicode. */
  initialCategoryId?: string;
  /** When set, opens in "pick" mode: clicking any icon cell calls this
   *  callback with the picked asset and closes the modal. The × delete
   *  badges are hidden in this mode so a single click reads as a pick.
   *  Used by the TextMapEditor inline-icon-insert flow. */
  pickMode?: boolean;
  onPick?:   (asset: ImageAsset) => void;
}

export class ImageAssetModal {
  private overlay: HTMLElement | null = null;
  private pickMode: boolean            = false;
  private onPickCallback: ((asset: ImageAsset) => void) | null = null;
  // Opens on "All" by default so users land on a full view of their library
  // rather than seeing only the Unicode presets. Callers can override via
  // ImageAssetModalOptions.initialCategoryId (e.g. text-map editor opening
  // straight to the Textmap category).
  private selectedCategoryId: string  = ALL_CATEGORY_ID;
  private searchQuery: string         = '';
  private categories: ImageCategory[] = [];
  private assets: ImageAsset[]        = [];
  private blobUrls: string[]          = []; // collected for revocation on close
  private previewPopover: HTMLElement | null = null;
  /** Which tab is active. 'library' shows the local categories+assets grid;
   *  a connector id shows that connector's manifest as importable rows. */
  private activeTab: 'library' | string = 'library';
  /** Cached manifest entries per connector — fetched on first tab open. */
  private connectorManifests = new Map<string, ConnectorManifestEntry[]>();
  /** Connector tab's own search query — separate from the library search so
   *  switching tabs doesn't clobber state. */
  private connectorSearchQuery: string = '';
  /** When true the connector grid shows every manifest entry. Default false:
   *  the grid is empty until the user types a search, which keeps fetch
   *  traffic light and the experience feels search-first like the public
   *  catalogs themselves. */
  private connectorShowAll: boolean = false;
  /** How many results to render in the connector grid. Bumped by 60 each
   *  time the user clicks the "More" button. Resets on search change or
   *  tab switch. */
  private connectorResultLimit: number = 60;
  /** Target-category override on connector imports. 'auto' = route by the
   *  manifest entry's tags via suggestCategoryFromTags(). Otherwise this
   *  mirrors `selectedCategoryId`. */
  private connectorImportTarget: string = 'auto';

  async open(opts: ImageAssetModalOptions = {}): Promise<void> {
    if (opts.initialCategoryId) this.selectedCategoryId = opts.initialCategoryId;
    this.pickMode = !!opts.pickMode;
    this.onPickCallback = opts.onPick ?? null;

    this.overlay = this._buildShell();
    document.body.appendChild(this.overlay);
    document.addEventListener('keydown', this._onKey);

    await this._reload();
  }

  close(): void {
    if (this.overlay) this.overlay.remove();
    this.overlay = null;
    document.removeEventListener('keydown', this._onKey);
    for (const url of this.blobUrls) URL.revokeObjectURL(url);
    this.blobUrls = [];
    if (this.previewPopover) {
      this.previewPopover.remove();
      this.previewPopover = null;
    }
  }

  private _onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.close();
  };

  // ─── Build shell + render ────────────────────────────────────────────────

  private _buildShell(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    // Click-outside-to-dismiss intentionally disabled — use × / Escape.

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog img-modal-dialog';
    overlay.appendChild(dialog);

    // Header
    const header = document.createElement('div');
    header.className = 'modal-header';
    const title = document.createElement('span');
    title.className = 'modal-title';
    title.textContent = 'Small Assets Library';
    header.appendChild(title);
    // "Stored" pill — same look as the per-row Stored tag on the Audio and
    // Map libraries, but pinned to the modal header because every icon in
    // this library is stored locally on import (small SVGs, no streaming).
    // Hover tooltip explains the consistency.
    const storeTag = document.createElement('span');
    storeTag.className = 'sound-tag sound-tag--local img-modal-store-tag';
    storeTag.title = 'Small files — all stored in the local browser DB on import. No streaming, no per-icon Store toggle.';
    storeTag.textContent = 'Stored';
    header.appendChild(storeTag);
    const closeX = document.createElement('button');
    closeX.type = 'button';
    closeX.className = 'modal-close';
    closeX.textContent = '×';
    closeX.addEventListener('click', () => this.close());
    header.appendChild(closeX);
    dialog.appendChild(header);

    // Body: sidebar + main
    const body = document.createElement('div');
    body.className = 'img-modal-body';
    dialog.appendChild(body);

    const sidebar = document.createElement('div');
    sidebar.className = 'img-modal-sidebar';
    sidebar.id = 'img-modal-sidebar';
    body.appendChild(sidebar);

    const main = document.createElement('div');
    main.className = 'img-modal-main';
    body.appendChild(main);

    // Tab strip — library + one per registered connector
    const tabs = document.createElement('div');
    tabs.className = 'img-modal-tabs';
    tabs.id = 'img-modal-tabs';
    main.appendChild(tabs);

    // Main area: toolbar + grid
    const toolbar = document.createElement('div');
    toolbar.className = 'img-modal-toolbar';
    toolbar.id = 'img-modal-toolbar';
    main.appendChild(toolbar);

    const grid = document.createElement('div');
    grid.className = 'img-modal-grid';
    grid.id = 'img-modal-grid';
    main.appendChild(grid);

    // Footer with the unified Attributions button — opens the same modal as
    // Map / Audio libraries via the shared 'dmr-show-attributions' event so
    // creators get one rollup of credits across all three asset libraries.
    const footer = document.createElement('div');
    footer.className = 'img-modal-footer';
    const attrBtn = document.createElement('button');
    attrBtn.type = 'button';
    attrBtn.className = 'btn btn--ghost btn--sm';
    attrBtn.textContent = 'ℹ Attributions & Licences';
    attrBtn.title = 'View the combined credits for every audio, map, and image asset in the pack';
    attrBtn.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('dmr-show-attributions'));
    });
    footer.appendChild(attrBtn);
    dialog.appendChild(footer);

    return overlay;
  }

  private _renderTabs(): void {
    const host = this.overlay?.querySelector<HTMLElement>('#img-modal-tabs');
    if (!host) return;
    host.innerHTML = '';

    const libTab = document.createElement('button');
    libTab.type = 'button';
    libTab.className = 'img-modal-tab' + (this.activeTab === 'library' ? ' is-active' : '');
    libTab.textContent = 'My Library';
    libTab.addEventListener('click', () => {
      this.activeTab = 'library';
      this._renderTabs();
      this._renderToolbar();
      this._renderGrid();
    });
    host.appendChild(libTab);

    for (const c of CONNECTORS) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'img-modal-tab' + (this.activeTab === c.id ? ' is-active' : '');
      tab.textContent = `Browse ${c.displayName}`;
      tab.title = `${c.license} — ${c.sourceUrl}`;
      tab.addEventListener('click', () => void this._switchToConnectorTab(c));
      host.appendChild(tab);
    }
  }

  private async _switchToConnectorTab(c: ImageSourceConnector): Promise<void> {
    this.activeTab = c.id;
    this.connectorSearchQuery = '';
    this.connectorShowAll = false;
    this.connectorResultLimit = 60;
    // Lazy-load the manifest on first visit; cache thereafter.
    if (!this.connectorManifests.has(c.id)) {
      try {
        const manifest = await c.loadManifest();
        this.connectorManifests.set(c.id, manifest);
      } catch (err) {
        this.connectorManifests.set(c.id, []);
        console.warn(`Connector ${c.id} manifest load failed:`, err);
      }
    }
    this._renderTabs();
    this._renderToolbar();
    this._renderGrid();
  }

  private async _reload(): Promise<void> {
    this.categories = await ImageAssetStore.getAllCategories();
    this.assets     = await ImageAssetStore.getAll();
    this._renderSidebar();
    this._renderTabs();
    this._renderToolbar();
    this._renderGrid();
  }

  // ─── Sidebar ─────────────────────────────────────────────────────────────

  private _renderSidebar(): void {
    const host = this.overlay?.querySelector<HTMLElement>('#img-modal-sidebar');
    if (!host) return;
    host.innerHTML = '';

    // "All" pseudo-row — shows every icon/marker asset across every
    // category (fonts excluded; they live in their own Special section
    // and aren't visually browseable as icons).
    host.appendChild(this._allRow());

    // Icons & Markers — the icon-style system categories.
    const iconsHeader = document.createElement('div');
    iconsHeader.className = 'img-modal-sidebar-section';
    iconsHeader.textContent = 'Icons & Markers';
    host.appendChild(iconsHeader);
    const iconCategoryIds = new Set<string>([
      SYSTEM_CATEGORY_IDS.unicode,
      SYSTEM_CATEGORY_IDS.abstract,
      SYSTEM_CATEGORY_IDS.fantasy,
      SYSTEM_CATEGORY_IDS.scifi,
      SYSTEM_CATEGORY_IDS.contemporary,
      SYSTEM_CATEGORY_IDS.uncategorised,
    ]);
    for (const cat of this.categories.filter((c) => c.isSystem && iconCategoryIds.has(c.id))) {
      host.appendChild(this._categoryRow(cat));
    }

    // Special — non-icon system categories (Fonts is text-style; Textmap
    // is the auto-fill destination for inline icons added via the Text
    // Map editor in Stream C).
    const specialCategoryIds = new Set<string>([
      SYSTEM_CATEGORY_IDS.fonts,
      SYSTEM_CATEGORY_IDS.textmap,
    ]);
    const specialCats = this.categories.filter((c) => c.isSystem && specialCategoryIds.has(c.id));
    if (specialCats.length > 0) {
      const specialHeader = document.createElement('div');
      specialHeader.className = 'img-modal-sidebar-section';
      specialHeader.textContent = 'Special';
      host.appendChild(specialHeader);
      for (const cat of specialCats) {
        host.appendChild(this._categoryRow(cat));
      }
    }

    // User category section
    const userCats = this.categories.filter((c) => !c.isSystem);
    if (userCats.length > 0) {
      const userHeader = document.createElement('div');
      userHeader.className = 'img-modal-sidebar-section';
      userHeader.textContent = 'Your categories';
      host.appendChild(userHeader);
      for (const cat of userCats) {
        host.appendChild(this._categoryRow(cat));
      }
    }

    // "+ New Category" footer
    const addRow = document.createElement('button');
    addRow.type = 'button';
    addRow.className = 'img-modal-sidebar-add';
    addRow.textContent = '+ New Category';
    addRow.addEventListener('click', () => void this._promptNewCategory());
    host.appendChild(addRow);
  }

  private _allRow(): HTMLElement {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'img-modal-sidebar-cat';
    if (this.selectedCategoryId === ALL_CATEGORY_ID) row.classList.add('is-active');
    // Fonts excluded — they're not visually browseable as icons and have
    // their own dedicated Special section.
    const total = this.assets.filter((a) => a.source !== 'font').length;
    row.innerHTML = `<span class="img-cat-name"><strong>All</strong></span><span class="img-cat-count">${total}</span>`;
    row.addEventListener('click', () => {
      this.selectedCategoryId = ALL_CATEGORY_ID;
      this.searchQuery = '';
      this._renderSidebar();
      this._renderToolbar();
      this._renderGrid();
    });
    return row;
  }

  private _categoryRow(cat: ImageCategory): HTMLElement {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'img-modal-sidebar-cat';
    if (cat.id === this.selectedCategoryId) row.classList.add('is-active');
    const count = this.assets.filter((a) => a.categoryId === cat.id).length;
    row.innerHTML = `<span class="img-cat-name">${this._esc(cat.name)}</span><span class="img-cat-count">${count}</span>`;
    row.addEventListener('click', () => {
      this.selectedCategoryId = cat.id;
      this.searchQuery = '';
      this._renderSidebar();
      this._renderToolbar();
      this._renderGrid();
    });
    if (!cat.isSystem) {
      // Right-click → delete (user categories only)
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        void this._confirmDeleteCategory(cat);
      });
    }
    // Drop target — accept dragged icons to recategorise. Fonts is read-only
    // (it's a virtual catalog, not a real IDB category), so skip it.
    if (cat.id !== SYSTEM_CATEGORY_IDS.fonts) {
      this._wireDropTarget(row, cat.id);
    }
    return row;
  }

  /** Make the given element a drop target for drag-from-grid icon moves.
   *  On drop, updates the asset's categoryId and re-renders both the
   *  sidebar (counts shift) and the grid (asset disappears from the
   *  current view if it left this category). */
  private _wireDropTarget(el: HTMLElement, targetCategoryId: string): void {
    el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer) return;
      const types = e.dataTransfer.types;
      if (!types.includes('application/x-mappadux-image-asset')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('is-drop-target');
    });
    el.addEventListener('dragleave', () => {
      el.classList.remove('is-drop-target');
    });
    el.addEventListener('drop', async (e) => {
      el.classList.remove('is-drop-target');
      if (!e.dataTransfer) return;
      const assetId = e.dataTransfer.getData('application/x-mappadux-image-asset');
      if (!assetId) return;
      e.preventDefault();
      const asset = this.assets.find((a) => a.id === assetId);
      if (!asset || asset.categoryId === targetCategoryId) return;
      await ImageAssetStore.update(assetId, { categoryId: targetCategoryId });
      this.assets = await ImageAssetStore.getAll();
      this._renderSidebar();
      this._renderGrid();
    });
  }

  private async _promptNewCategory(): Promise<void> {
    const name = prompt('Category name:');
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = 'cat-' + generateId();
    await ImageAssetStore.saveCategory({
      id,
      name: trimmed,
      isSystem: false,
      sortOrder: 100 + Date.now() / 1000, // user categories pushed below system rows
    });
    this.selectedCategoryId = id;
    await this._reload();
  }

  private async _confirmDeleteCategory(cat: ImageCategory): Promise<void> {
    const inThisCategory = this.assets.filter((a) => a.categoryId === cat.id).length;
    const msg = inThisCategory > 0
      ? `Delete category "${cat.name}"? ${inThisCategory} icon${inThisCategory !== 1 ? 's' : ''} will move to Unicode.`
      : `Delete category "${cat.name}"?`;
    if (!confirm(msg)) return;
    await ImageAssetStore.deleteCategory(cat.id);
    if (this.selectedCategoryId === cat.id) {
      this.selectedCategoryId = SYSTEM_CATEGORY_IDS.unicode;
    }
    await this._reload();
  }

  // ─── Toolbar ─────────────────────────────────────────────────────────────

  private _renderToolbar(): void {
    const host = this.overlay?.querySelector<HTMLElement>('#img-modal-toolbar');
    if (!host) return;
    host.innerHTML = '';

    if (this.activeTab === 'library') {
      this._renderLibraryToolbar(host);
    } else {
      this._renderConnectorToolbar(host);
    }
  }

  private _renderLibraryToolbar(host: HTMLElement): void {
    // Category title — the per-category count lives on the sidebar row and
    // updates correctly during drag-to-recategorise. Repeating it here was
    // confusing because the toolbar wasn't repainted on drag.
    const cat = this.selectedCategoryId === ALL_CATEGORY_ID
      ? { name: 'All' }
      : this.categories.find((c) => c.id === this.selectedCategoryId);
    const title = document.createElement('div');
    title.className = 'img-modal-cat-title';
    title.textContent = cat?.name ?? 'Unknown';
    host.appendChild(title);

    // Search box
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'img-modal-search';
    search.placeholder = 'Search by name or tag…';
    search.value = this.searchQuery;
    search.addEventListener('input', () => {
      this.searchQuery = search.value.trim().toLowerCase();
      this._renderGrid();
    });
    host.appendChild(search);

    // Add buttons — Fonts category swaps in font-specific actions; every
    // other category exposes the Unicode-glyph and Upload-image flows.
    if (this.selectedCategoryId === SYSTEM_CATEGORY_IDS.fonts) {
      const addFont = document.createElement('button');
      addFont.type = 'button';
      addFont.className = 'btn btn--primary btn--xs';
      addFont.textContent = '+ Google Font';
      addFont.addEventListener('click', () => void this._promptAddGoogleFont());
      host.appendChild(addFont);

      const browseFonts = document.createElement('a');
      browseFonts.className = 'btn btn--ghost btn--xs';
      browseFonts.href = 'https://fonts.google.com';
      browseFonts.target = '_blank';
      browseFonts.rel = 'noopener noreferrer';
      browseFonts.textContent = 'Browse fonts.google.com ↗';
      browseFonts.style.textDecoration = 'none';
      host.appendChild(browseFonts);
    } else {
      const addGlyph = document.createElement('button');
      addGlyph.type = 'button';
      addGlyph.className = 'btn btn--ghost btn--xs';
      addGlyph.textContent = '+ Unicode glyph';
      addGlyph.addEventListener('click', () => void this._promptAddUnicode());
      host.appendChild(addGlyph);

      const addUpload = document.createElement('button');
      addUpload.type = 'button';
      addUpload.className = 'btn btn--primary btn--xs';
      addUpload.textContent = '+ Upload image';
      addUpload.addEventListener('click', () => this._promptUpload());
      host.appendChild(addUpload);
    }
  }

  private _renderConnectorToolbar(host: HTMLElement): void {
    const conn = CONNECTORS.find((c) => c.id === this.activeTab);
    if (!conn) return;

    // Title + licence chip
    const title = document.createElement('div');
    title.className = 'img-modal-cat-title';
    title.textContent = conn.displayName;
    host.appendChild(title);

    const lic = document.createElement('a');
    lic.className = 'img-modal-license-chip';
    lic.href = conn.licenseUrl;
    lic.target = '_blank';
    lic.rel = 'noopener noreferrer';
    lic.textContent = conn.license;
    host.appendChild(lic);

    // Search — drives the search-first UX. Typing reveals matches; an
    // empty search box with showAll=false leaves the grid intentionally
    // empty so we don't fetch SVG previews on every tab open.
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'img-modal-search';
    search.placeholder = 'Search this source…';
    search.value = this.connectorSearchQuery;
    search.addEventListener('input', () => {
      this.connectorSearchQuery = search.value.trim().toLowerCase();
      // Typing automatically dismisses the "Show all" state — the search
      // narrows the result set, never expands beyond a match.
      if (this.connectorSearchQuery) this.connectorShowAll = false;
      // New query → reset pagination so the first page is the most-relevant 60.
      this.connectorResultLimit = 60;
      this._renderGrid();
    });
    host.appendChild(search);

    // "Show all" toggle — escape hatch for users who want to browse the
    // full curated set without typing. Hidden when the connector opts out
    // (e.g. Lucide with 1500 entries would spam CDN previews).
    if (conn.allowShowAll !== false) {
      const showAllBtn = document.createElement('button');
      showAllBtn.type = 'button';
      showAllBtn.className = 'btn btn--ghost btn--xs';
      showAllBtn.textContent = this.connectorShowAll ? 'Hide all' : 'Show all';
      showAllBtn.addEventListener('click', () => {
        this.connectorShowAll = !this.connectorShowAll;
        this.connectorSearchQuery = '';
        this._renderToolbar();
        this._renderGrid();
      });
      host.appendChild(showAllBtn);
    }

    // "Import into" target — dropdown to pick where imports land. Includes
    // an "Auto (by tags)" option that uses suggestCategoryFromTags() to
    // route each import to its best-fit system category.
    const label = document.createElement('span');
    label.className = 'img-modal-import-target';
    label.textContent = 'Imports →';
    host.appendChild(label);

    const targetSel = document.createElement('select');
    targetSel.className = 'img-modal-target-select';
    const autoOpt = document.createElement('option');
    autoOpt.value = 'auto';
    autoOpt.textContent = '🪄 Auto (by tags)';
    if (this.connectorImportTarget === 'auto') autoOpt.selected = true;
    targetSel.appendChild(autoOpt);
    for (const cat of this.categories) {
      // Fonts isn't a valid import target; skip it.
      if (cat.id === SYSTEM_CATEGORY_IDS.fonts) continue;
      const opt = document.createElement('option');
      opt.value = cat.id;
      opt.textContent = cat.name;
      if (cat.id === this.connectorImportTarget) opt.selected = true;
      targetSel.appendChild(opt);
    }
    targetSel.addEventListener('change', () => {
      this.connectorImportTarget = targetSel.value;
    });
    host.appendChild(targetSel);
  }

  private async _promptAddUnicode(): Promise<void> {
    const ch = prompt('Type or paste a single character (or short sequence) to add as an icon:');
    if (!ch) return;
    const trimmed = ch.trim();
    if (!trimmed) return;
    const name = prompt('Name for this icon:', trimmed) ?? trimmed;
    const asset: ImageAsset = {
      id:           'unicode-' + generateId(),
      name:         name.trim() || trimmed,
      source:       'unicode',
      categoryId:   this.selectedCategoryId,
      tintable:     true,
      unicodeChar:  trimmed,
      license:      UNICODE_LICENSE_LABEL,
      addedAt:      Date.now(),
    };
    await ImageAssetStore.save(asset);
    await this._reload();
  }

  private _promptUpload(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/svg+xml';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      if (file) void this._handleUpload(file);
    });
    document.body.appendChild(input);
    input.click();
  }

  private async _handleUpload(file: File): Promise<void> {
    const name = file.name.replace(/\.[^.]+$/, '');
    const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
    const id = 'upload-' + generateId();
    if (isSvg) {
      // Store SVG as text — small, fillable at render time. We don't try to
      // detect tintability automatically (a single-fill SVG would be, but
      // multi-colour SVGs wouldn't); user can toggle in a later edit pass.
      const svgSource = await file.text();
      const asset: ImageAsset = {
        id, name, source: 'upload',
        categoryId: this.selectedCategoryId,
        tintable: false, // safe default for arbitrary user SVGs
        svgSource,
        mimeType: 'image/svg+xml',
        addedAt: Date.now(),
      };
      await ImageAssetStore.save(asset);
    } else {
      const asset: ImageAsset = {
        id, name, source: 'upload',
        categoryId: this.selectedCategoryId,
        tintable: false,
        blob: file,
        mimeType: file.type,
        addedAt: Date.now(),
      };
      await ImageAssetStore.save(asset);
    }
    await this._reload();
  }

  // ─── Grid ────────────────────────────────────────────────────────────────

  private _renderGrid(): void {
    const host = this.overlay?.querySelector<HTMLElement>('#img-modal-grid');
    if (!host) return;
    // Revoke any previously-issued object URLs from this render pass.
    for (const url of this.blobUrls) URL.revokeObjectURL(url);
    this.blobUrls = [];
    host.innerHTML = '';

    if (this.activeTab === 'library') {
      this._renderLibraryGrid(host);
    } else {
      this._renderConnectorGrid(host);
    }
  }

  private _renderLibraryGrid(host: HTMLElement): void {
    // Fonts is a read-only listing for now — special-case it. Stream C
    // (Text Maps) will wire actual font loading; until then the category
    // exists to surface attribution and show users what's coming.
    if (this.selectedCategoryId === SYSTEM_CATEGORY_IDS.fonts) {
      this._renderFontsCategory(host);
      return;
    }

    const inCategory = this.selectedCategoryId === ALL_CATEGORY_ID
      ? this.assets.filter((a) => a.source !== 'font') // All hides fonts
      : this.assets.filter((a) => a.categoryId === this.selectedCategoryId);
    const filtered = this.searchQuery
      ? fuzzySearch(
          inCategory.map((a) => ({ slug: a.id, name: a.name, tags: a.tags ?? [] })),
          this.searchQuery,
        ).map((r) => inCategory.find((a) => a.id === r.entry.slug)!).filter(Boolean)
      : inCategory;

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'img-modal-empty';
      empty.textContent = this.searchQuery
        ? 'No icons match that search.'
        : 'No icons in this category yet — use the toolbar above to add one.';
      host.appendChild(empty);
      return;
    }

    for (const asset of filtered) {
      host.appendChild(this._iconCell(asset));
    }
  }

  /** Render the Fonts category from the imageAssets store (source='font').
   *  Both bundled defaults and user-added Google Fonts live here; each
   *  shows a large sample in its own family, the licence chip, and a ×
   *  delete affordance on user-added entries. The "+ Google Font" button
   *  at the top lets users add more by family name. */
  private _renderFontsCategory(host: HTMLElement): void {
    const allFonts = this.assets.filter((a) => a.source === 'font');
    // Trigger CSS load for whatever families are in the library now —
    // includes user-added entries that the bundled link wouldn't cover.
    ensureFontsLoaded(allFonts.map((f) => f.fontFamily).filter((f): f is string => !!f));

    // Filter by the toolbar search box — matches font name, family, tags.
    const filtered = this.searchQuery
      ? fuzzySearch(
          allFonts.map((a) => ({
            slug: a.fontFamily ?? a.name,
            name: a.name,
            tags: a.tags ?? [],
          })),
          this.searchQuery,
        ).map((r) => allFonts.find((a) => (a.fontFamily ?? a.name) === r.entry.slug)!).filter(Boolean)
      : allFonts;

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'img-modal-empty';
      empty.textContent = this.searchQuery
        ? 'No fonts match that search.'
        : 'No fonts in the library yet — use + Google Font in the toolbar to add one.';
      host.appendChild(empty);
      return;
    }

    // No body intro — the + Google Font / Browse buttons live in the
    // toolbar above, freeing the grid for the actual font samples.
    for (const font of filtered) {
      host.appendChild(this._fontRow(font));
    }
  }

  private _fontRow(font: ImageAsset): HTMLElement {
    const row = document.createElement('div');
    row.className = 'img-modal-font-row';

    // Name first — bold, theme text, easy to scan when browsing.
    const name = document.createElement('div');
    name.className = 'img-modal-font-name';
    name.textContent = font.name;
    row.appendChild(name);

    // Pangram in the actual family, sitting below the name as the visual
    // showcase. Deterministic pick keeps the sample consistent across
    // renders so each font has its own "voice".
    const sample = document.createElement('div');
    sample.className = 'img-modal-font-sample';
    sample.style.fontFamily = `'${font.fontFamily ?? font.name}', sans-serif`;
    sample.textContent = pangramFor(font.fontFamily ?? font.name);
    row.appendChild(sample);

    // Extra info: vibe tags + attribution + clickable licence chip.
    const meta = document.createElement('div');
    meta.className = 'img-modal-font-meta';
    const attrib = font.attribution ?? font.name;
    const licenseLabel = font.license ?? 'SIL OFL 1.1';
    const link = font.sourceUrl ?? font.attributionLink ?? '#';
    const tagsLine = (font.tags ?? []).length > 0
      ? `<div class="img-modal-font-vibe">${this._esc((font.tags ?? []).join(' · '))}</div>`
      : '';
    meta.innerHTML = `
      ${tagsLine}
      <div class="img-modal-font-attrib">
        ${this._esc(attrib)} ·
        <a href="${this._esc(link)}" target="_blank" rel="noopener noreferrer" class="img-modal-license-chip">${this._esc(licenseLabel)}</a>
      </div>
    `;
    row.appendChild(meta);

    // Action buttons (top-right of the row) — only on user-added fonts;
    // bundled ones are protected (their deterministic ids re-seed). Edit
    // lets the user fix attribution after import (e.g. paste the
    // "Designed by …" line they forgot at add time).
    const isBundled = font.id.startsWith('font-bundled-');
    if (!isBundled) {
      const actions = document.createElement('div');
      actions.className = 'img-modal-font-actions';

      const refetch = document.createElement('button');
      refetch.type = 'button';
      refetch.className = 'img-modal-font-action';
      refetch.title = 'Refetch designer + licence from google/fonts';
      refetch.textContent = '↻';
      refetch.addEventListener('click', () => void this._refetchFontAttribution(font, refetch));
      actions.appendChild(refetch);

      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'img-modal-font-action';
      edit.title = 'Edit attribution';
      edit.textContent = '✎';
      edit.addEventListener('click', () => void this._promptEditFontAttribution(font));
      actions.appendChild(edit);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'img-modal-font-action img-modal-font-action--danger';
      del.title = 'Delete this font';
      del.textContent = '×';
      del.addEventListener('click', async () => {
        if (!confirm(`Delete font "${font.name}"? Text maps using it will revert to fallback fonts.`)) return;
        await ImageAssetStore.delete(font.id);
        await this._reload();
      });
      actions.appendChild(del);

      row.appendChild(actions);
    }

    return row;
  }

  /** Accept either a Google Fonts specimen URL or a raw family name, then
   *  validate by hitting the Google Fonts CSS API. The CSS endpoint returns
   *  real `@font-face` rules when the family exists, or HTTP 400 (or empty
   *  CSS) when it doesn't — so a positive check is both presence-of-status
   *  AND presence-of-`@font-face` in the body. */
  private async _promptAddGoogleFont(): Promise<void> {
    const raw = prompt(
      'Paste the Google Fonts specimen URL or type the family name:\n' +
      '(e.g. "https://fonts.google.com/specimen/Roboto+Slab"\n' +
      '  or  "Roboto Slab")',
    );
    if (!raw) return;
    const parsed = extractFamilyFromInput(raw.trim());
    if (!parsed) {
      alert("Couldn't parse a family name from that input. Try the URL from fonts.google.com or just the family name like \"Roboto Slab\".");
      return;
    }
    const { family, tags: urlTags } = parsed;
    const id = 'font-user-' + family.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const existing = await ImageAssetStore.get(id);
    if (existing) {
      alert(`"${family}" is already in the library.`);
      return;
    }
    const slug = encodeURIComponent(family).replace(/%20/g, '+');
    // Validate against the Google Fonts CSS API. Successful response
    // means the family really exists and Google will serve a face for it.
    let valid = false;
    try {
      const res = await fetch(`https://fonts.googleapis.com/css2?family=${slug}&display=swap`);
      if (res.ok) {
        const css = await res.text();
        valid = /@font-face\s*\{/.test(css);
      }
    } catch (err) {
      console.warn('[Add Google Font] validation fetch failed:', err);
    }
    if (!valid) {
      alert(
        `Google Fonts didn't recognise "${family}". Check the spelling matches the family page on fonts.google.com — case and punctuation matter (e.g. "IM Fell DW Pica" not "IM Fell").`,
      );
      return;
    }
    // Try to pull designer + licence info from the google/fonts GitHub
    // repo's METADATA.pb file — raw.githubusercontent.com serves with
    // permissive CORS so this works straight from the browser. Falls back
    // to a manual prompt when the fetch / parse fails (renamed families,
    // network issues, anything we don't recognise).
    let attribution: string;
    let license = 'SIL OFL 1.1 (per Google Fonts)';
    const meta = await fetchGoogleFontMetadata(family);
    if (meta) {
      attribution = meta.designer
        ? `${family} by ${meta.designer}`
        : `${family} via Google Fonts`;
      if (meta.license) license = meta.license;
    } else {
      const designers = prompt(
        `Couldn't auto-fetch designer info for "${family}".\n\n` +
        'Paste the "Designed by …" names from the Google Fonts specimen page, ' +
        'or leave blank for the default.',
      )?.trim() ?? '';
      attribution = designers
        ? `${family} by ${designers}`
        : `${family} via Google Fonts`;
    }
    // Tags combine the categoryFilters from the URL (Expressive,
    // Innovative, etc.) with a 'user-added' marker so the row makes
    // sense if the URL didn't carry any filter context.
    const tags = urlTags.length > 0
      ? Array.from(new Set([...urlTags, 'user-added']))
      : ['user-added'];
    const asset: ImageAsset = {
      id,
      name:            family,
      source:          'font',
      categoryId:      SYSTEM_CATEGORY_IDS.fonts,
      tintable:        false,
      fontFamily:      family,
      license,
      attribution,
      attributionLink: `https://fonts.google.com/specimen/${slug}`,
      sourceUrl:       `https://fonts.google.com/specimen/${slug}`,
      tags,
      addedAt:         Date.now(),
    };
    await ImageAssetStore.save(asset);
    await this._reload();
  }

  /** Edit the attribution string on an existing user-added font — useful when
   *  the user forgot to paste designer info at import time, or wants to
   *  refine the wording. */
  private async _promptEditFontAttribution(font: ImageAsset): Promise<void> {
    const current = font.attribution ?? `${font.name} via Google Fonts`;
    const next = prompt(`Attribution for "${font.name}":`, current);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === current) return;
    await ImageAssetStore.update(font.id, { attribution: trimmed });
    await this._reload();
  }

  /** Refetch designer + licence from google/fonts METADATA.pb for an
   *  existing user-added font. Useful for entries that landed before the
   *  auto-fetch was added (or whose metadata has been updated upstream).
   *  Briefly disables the button + shows a spinner glyph so the user knows
   *  the network call is in flight. */
  private async _refetchFontAttribution(font: ImageAsset, btn: HTMLButtonElement): Promise<void> {
    const family = font.fontFamily ?? font.name;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '…';
    try {
      const meta = await fetchGoogleFontMetadata(family);
      if (!meta) {
        alert(
          `Couldn't find metadata for "${family}" in the google/fonts repo. ` +
          'Either the family was renamed, the licence directory has changed, or ' +
          'the repo path is unreachable. Edit the attribution manually with the ✎ button.',
        );
        return;
      }
      const attribution = meta.designer
        ? `${family} by ${meta.designer}`
        : `${family} via Google Fonts`;
      const patch: Partial<ImageAsset> = { attribution };
      const nextLicense = meta.license || font.license;
      if (nextLicense) patch.license = nextLicense;
      await ImageAssetStore.update(font.id, patch);
      await this._reload();
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  private _renderConnectorGrid(host: HTMLElement): void {
    const conn = CONNECTORS.find((c) => c.id === this.activeTab);
    if (!conn) return;
    const manifest = this.connectorManifests.get(conn.id) ?? [];
    const minChars = conn.minSearchChars ?? 1;
    const allowShowAll = conn.allowShowAll !== false;

    if (manifest.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'img-modal-empty';
      empty.textContent = `Manifest unavailable. Check your connection and try again.`;
      host.appendChild(empty);
      return;
    }

    // Empty / too-short query, and Show all not active → search-first prompt.
    if (
      !this.connectorShowAll
      && (this.connectorSearchQuery.length < minChars)
    ) {
      const prompt = document.createElement('div');
      prompt.className = 'img-modal-empty';
      const sizeHint = manifest.length > 200
        ? ` from <strong>${manifest.length.toLocaleString()}</strong> icons`
        : '';
      const minHint = minChars > 1
        ? `Type at least <strong>${minChars} characters</strong> to search${sizeHint}.`
        : `Type to search${sizeHint}.`;
      const showAllHint = allowShowAll
        ? ' Or click <strong>Show all</strong> for the full set.'
        : '';
      prompt.innerHTML = `
        <p style="margin:0 0 var(--space-sm);">Browsing <strong>${this._esc(conn.displayName)}</strong> — ${minHint}${showAllHint}</p>
        <p style="margin:0; font-size:0.85em;">Try terms like <em>sword</em>, <em>dragon</em>, <em>key</em>, <em>arrow</em>, <em>map</em>.</p>
      `;
      host.appendChild(prompt);
      return;
    }

    const filtered = this.connectorSearchQuery
      ? fuzzySearch(manifest, this.connectorSearchQuery).map((r) => r.entry)
      : manifest;

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'img-modal-empty';
      empty.textContent = 'No icons match that search.';
      host.appendChild(empty);
      return;
    }

    // Paginated render — fuzzy-search returns scored results, so the first
    // page is the most relevant matches. "More" button loads the next 60.
    const limit = this.connectorResultLimit;
    const capped = filtered.length > limit;
    const toRender = capped ? filtered.slice(0, limit) : filtered;

    for (const entry of toRender) {
      host.appendChild(this._connectorCell(conn, entry));
    }

    if (capped) {
      const moreWrap = document.createElement('div');
      moreWrap.className = 'img-modal-more';
      moreWrap.style.gridColumn = '1 / -1';

      const status = document.createElement('span');
      status.className = 'img-modal-more-status';
      status.textContent = `Showing ${limit.toLocaleString()} of ${filtered.length.toLocaleString()} matches`;
      moreWrap.appendChild(status);

      const moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'btn btn--primary btn--sm';
      const nextBatch = Math.min(60, filtered.length - limit);
      moreBtn.textContent = `More results (${nextBatch.toLocaleString()})`;
      moreBtn.addEventListener('click', () => {
        this.connectorResultLimit += 60;
        this._renderGrid();
      });
      moreWrap.appendChild(moreBtn);

      host.appendChild(moreWrap);
    }
  }

  private _connectorCell(conn: ImageSourceConnector, entry: ConnectorManifestEntry): HTMLElement {
    const cell = document.createElement('div');
    cell.className = 'img-modal-cell img-modal-cell--connector';
    cell.title = entry.name;

    const visual = document.createElement('div');
    visual.className = 'img-modal-visual';
    // Lazy-load preview SVG on first render of the cell; fall back to a
    // placeholder while the network request is in flight. We don't preload
    // the whole grid — only the cells the user scrolls past.
    visual.innerHTML = '<div class="img-modal-broken" style="font-size:18px;">…</div>';
    cell.appendChild(visual);

    void this._renderConnectorPreview(visual, conn, entry);

    const label = document.createElement('div');
    label.className = 'img-modal-label';
    label.textContent = entry.name;
    cell.appendChild(label);

    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'img-modal-import';
    importBtn.textContent = 'Import';
    importBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      importBtn.disabled = true;
      importBtn.textContent = '…';
      try {
        await this._importFromConnector(conn, entry);
        importBtn.textContent = 'Imported ✓';
      } catch (err) {
        importBtn.disabled = false;
        importBtn.textContent = 'Failed — retry';
        console.warn('Import failed:', err);
      }
    });
    cell.appendChild(importBtn);

    cell.addEventListener('mouseenter', (e) => {
      // Hover preview reuses the connector entry's name; visual is shared
      // with the grid cell rendering above.
      this._showConnectorPreview(conn, entry, e);
    });
    cell.addEventListener('mousemove',  (e) => this._movePreview(e));
    cell.addEventListener('mouseleave', () => this._hidePreview());

    return cell;
  }

  private async _renderConnectorPreview(
    container: HTMLElement,
    conn: ImageSourceConnector,
    entry: ConnectorManifestEntry,
  ): Promise<void> {
    try {
      const svg = await conn.fetchSvg(entry);
      container.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'img-modal-svg';
      wrap.innerHTML = svg;
      const svgEl = wrap.querySelector('svg');
      if (svgEl) {
        svgEl.setAttribute('width',  '100%');
        svgEl.setAttribute('height', '100%');
        if (conn.tintable) {
          svgEl.querySelectorAll('[fill]').forEach((el) => el.setAttribute('fill', 'currentColor'));
          svgEl.querySelectorAll('[stroke]').forEach((el) => {
            const cur = el.getAttribute('stroke');
            if (cur && cur !== 'none') el.setAttribute('stroke', 'currentColor');
          });
        }
      }
      container.appendChild(wrap);
    } catch {
      container.innerHTML = '<div class="img-modal-broken">⚠</div>';
    }
  }

  private async _importFromConnector(
    conn: ImageSourceConnector,
    entry: ConnectorManifestEntry,
  ): Promise<void> {
    const svg = await conn.fetchSvg(entry);
    const id = `${conn.id}-${entry.slug.replace(/[^\w-]/g, '_')}-${Date.now().toString(36)}`;
    // Pick where to land. Auto: route by tags; if no rule fires, drop into
    // Uncategorised so the user has a clear holding pen they can sort out
    // with drag-to-category. Explicit target overrides Auto entirely.
    let categoryId: string;
    if (this.connectorImportTarget === 'auto') {
      categoryId = suggestCategoryFromTags(entry.tags) ?? SYSTEM_CATEGORY_IDS.uncategorised;
    } else {
      categoryId = this.connectorImportTarget;
    }
    const asset: ImageAsset = {
      id,
      name:            entry.name,
      source:          conn.id,
      categoryId,
      tintable:        conn.tintable,
      svgSource:       svg,
      mimeType:        'image/svg+xml',
      license:         conn.license,
      attribution:     conn.attributionFor(entry),
      attributionLink: conn.sourceUrl,
      sourceUrl:       conn.buildUrl(entry),
      tags:            entry.tags,
      addedAt:         Date.now(),
    };
    await ImageAssetStore.save(asset);
    // Refresh sidebar counts without leaving the connector tab.
    this.assets = await ImageAssetStore.getAll();
    this._renderSidebar();
  }

  private async _showConnectorPreview(
    conn: ImageSourceConnector,
    entry: ConnectorManifestEntry,
    e: MouseEvent,
  ): Promise<void> {
    if (!this.previewPopover) {
      this.previewPopover = document.createElement('div');
      this.previewPopover.className = 'img-modal-preview-popover';
      document.body.appendChild(this.previewPopover);
    }
    this.previewPopover.innerHTML = '';

    const big = document.createElement('div');
    big.className = 'img-modal-preview-visual';
    big.innerHTML = '<div class="img-modal-broken" style="font-size:24px;">…</div>';
    this.previewPopover.appendChild(big);

    const label = document.createElement('div');
    label.className = 'img-modal-preview-label';
    label.textContent = entry.name;
    this.previewPopover.appendChild(label);

    const meta = document.createElement('div');
    meta.className = 'img-modal-preview-meta';
    meta.textContent = `${conn.displayName} · ${conn.license}${entry.author ? ` · ${entry.author}` : ''}`;
    this.previewPopover.appendChild(meta);

    this.previewPopover.hidden = false;
    this._movePreview(e);

    // Lazy-load the preview SVG into the popover.
    try {
      const svg = await conn.fetchSvg(entry);
      big.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'img-modal-svg';
      wrap.innerHTML = svg;
      const svgEl = wrap.querySelector('svg');
      if (svgEl) {
        svgEl.setAttribute('width',  '100%');
        svgEl.setAttribute('height', '100%');
        if (conn.tintable) {
          svgEl.querySelectorAll('[fill]').forEach((el) => el.setAttribute('fill', 'currentColor'));
          svgEl.querySelectorAll('[stroke]').forEach((el) => {
            const cur = el.getAttribute('stroke');
            if (cur && cur !== 'none') el.setAttribute('stroke', 'currentColor');
          });
        }
      }
      big.appendChild(wrap);
    } catch {
      big.innerHTML = '<div class="img-modal-broken">⚠</div>';
    }
  }

  private _iconCell(asset: ImageAsset): HTMLElement {
    const cell = document.createElement('div');
    cell.className = 'img-modal-cell';
    cell.title = this.pickMode ? `Insert "${asset.name}"` : asset.name;

    // Pick mode — click resolves the modal with this asset. Drag-to-
    // recategorise is still useful in normal browse mode but disabled here
    // since the click is now the primary action.
    if (this.pickMode) {
      cell.classList.add('img-modal-cell--pickable');
      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        this._hidePreview();
        const cb = this.onPickCallback;
        this.close();
        cb?.(asset);
      });
    }

    // Drag source — let the user drag any icon onto a sidebar category to
    // move it. dataTransfer payload is the asset id; the dragover/drop
    // handlers on category rows do the actual update.
    cell.draggable = !this.pickMode;
    cell.addEventListener('dragstart', (e) => {
      if (!e.dataTransfer) return;
      e.dataTransfer.setData('application/x-mappadux-image-asset', asset.id);
      e.dataTransfer.effectAllowed = 'move';
      // Hide the hover preview while a drag is in flight — it'd otherwise
      // follow the cursor and obscure the drop targets.
      this._hidePreview();
      cell.classList.add('is-dragging');
    });
    cell.addEventListener('dragend', () => {
      cell.classList.remove('is-dragging');
    });

    const visual = document.createElement('div');
    visual.className = 'img-modal-visual';
    this._renderIconVisual(visual, asset);
    cell.appendChild(visual);

    // Hover preview — bigger version of the icon plus its name, mirroring the
    // map library's thumbnail preview behaviour.
    cell.addEventListener('mouseenter', (e) => this._showPreview(asset, e));
    cell.addEventListener('mousemove',  (e) => this._movePreview(e));
    cell.addEventListener('mouseleave', () => this._hidePreview());

    const label = document.createElement('div');
    label.className = 'img-modal-label';
    label.textContent = asset.name;
    cell.appendChild(label);

    // No delete affordance in pick mode — a single click means insert.
    if (!this.pickMode) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'img-modal-del';
      del.title = 'Delete this icon';
      del.textContent = '×';
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete "${asset.name}"?`)) return;
        await ImageAssetStore.delete(asset.id);
        await this._reload();
      });
      cell.appendChild(del);
    }

    return cell;
  }

  /** Render an ImageAsset into the given container — used for both the
   *  library grid thumbnails and (later) marker preview / inline-icon
   *  insertion previews. Default tint: --text (the library's neutral hue);
   *  consumers that want a custom colour swap fill at render time. */
  private _renderIconVisual(container: HTMLElement, asset: ImageAsset): void {
    container.innerHTML = '';
    if (asset.source === 'unicode' && asset.unicodeChar) {
      const span = document.createElement('span');
      span.className = 'img-modal-unicode';
      span.textContent = asset.unicodeChar;
      container.appendChild(span);
      return;
    }
    if (asset.svgSource) {
      // Inline the SVG, scope styles via inline width/height attributes.
      const wrap = document.createElement('div');
      wrap.className = 'img-modal-svg';
      wrap.innerHTML = asset.svgSource;
      const svg = wrap.querySelector('svg');
      if (svg) {
        svg.setAttribute('width',  '100%');
        svg.setAttribute('height', '100%');
        // Tintable icons: ensure fill is currentColor so CSS color drives it.
        if (asset.tintable) {
          svg.querySelectorAll('[fill]').forEach((el) => el.setAttribute('fill', 'currentColor'));
        }
      }
      container.appendChild(wrap);
      return;
    }
    if (asset.blob) {
      const url = URL.createObjectURL(asset.blob);
      this.blobUrls.push(url);
      const img = document.createElement('img');
      img.className = 'img-modal-img';
      img.src = url;
      img.alt = asset.name;
      container.appendChild(img);
      return;
    }
    // Fallback — broken or empty asset
    const broken = document.createElement('span');
    broken.className = 'img-modal-broken';
    broken.textContent = '?';
    container.appendChild(broken);
  }

  // ─── Hover preview popover ───────────────────────────────────────────────

  private _showPreview(asset: ImageAsset, e: MouseEvent): void {
    if (!this.previewPopover) {
      this.previewPopover = document.createElement('div');
      this.previewPopover.className = 'img-modal-preview-popover';
      document.body.appendChild(this.previewPopover);
    }
    this.previewPopover.innerHTML = '';

    const big = document.createElement('div');
    big.className = 'img-modal-preview-visual';
    this._renderIconVisual(big, asset);
    this.previewPopover.appendChild(big);

    const label = document.createElement('div');
    label.className = 'img-modal-preview-label';
    label.textContent = asset.name;
    this.previewPopover.appendChild(label);

    if (asset.attribution || asset.license) {
      const meta = document.createElement('div');
      meta.className = 'img-modal-preview-meta';
      const bits: string[] = [];
      if (asset.attribution) bits.push(asset.attribution);
      if (asset.license)     bits.push(asset.license);
      meta.textContent = bits.join(' · ');
      this.previewPopover.appendChild(meta);
    }

    this.previewPopover.hidden = false;
    this._movePreview(e);
  }

  private _movePreview(e: MouseEvent): void {
    if (!this.previewPopover || this.previewPopover.hidden) return;
    const popW = this.previewPopover.offsetWidth  || 220;
    const popH = this.previewPopover.offsetHeight || 240;
    let x = e.clientX + 16;
    let y = e.clientY + 16;
    if (x + popW > window.innerWidth - 8)  x = e.clientX - popW - 16;
    if (y + popH > window.innerHeight - 8) y = e.clientY - popH - 16;
    this.previewPopover.style.left = `${Math.max(8, x)}px`;
    this.previewPopover.style.top  = `${Math.max(8, y)}px`;
  }

  private _hidePreview(): void {
    if (this.previewPopover) this.previewPopover.hidden = true;
  }

  private _esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
