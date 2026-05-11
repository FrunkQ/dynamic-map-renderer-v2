import type { ImageAsset, ImageCategory } from '../types.ts';
import { SYSTEM_CATEGORY_IDS } from '../types.ts';
import { ImageAssetStore } from './ImageAssetStore.ts';
import type { ImageSourceConnector, ConnectorManifestEntry } from './connectors/types.ts';
import { gameIconsConnector } from './connectors/gameIcons.ts';
import { lucideConnector } from './connectors/lucide.ts';
import { generateId } from '../utils/id.ts';
import { UNICODE_LICENSE_LABEL } from './seedImageAssets.ts';
import { BUNDLED_FONTS } from './fontCatalog.ts';

const CONNECTORS: readonly ImageSourceConnector[] = [
  gameIconsConnector,
  lucideConnector,
];

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
}

export class ImageAssetModal {
  private overlay: HTMLElement | null = null;
  private selectedCategoryId: string  = SYSTEM_CATEGORY_IDS.unicode;
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

  async open(opts: ImageAssetModalOptions = {}): Promise<void> {
    if (opts.initialCategoryId) this.selectedCategoryId = opts.initialCategoryId;

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
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog img-modal-dialog';
    overlay.appendChild(dialog);

    // Header
    const header = document.createElement('div');
    header.className = 'modal-header';
    const title = document.createElement('span');
    title.className = 'modal-title';
    title.textContent = 'Image Library';
    header.appendChild(title);
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

    // System category section
    const sysHeader = document.createElement('div');
    sysHeader.className = 'img-modal-sidebar-section';
    sysHeader.textContent = 'System';
    host.appendChild(sysHeader);
    for (const cat of this.categories.filter((c) => c.isSystem)) {
      host.appendChild(this._categoryRow(cat));
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
    return row;
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
    // Category title + count
    const cat = this.categories.find((c) => c.id === this.selectedCategoryId);
    const countInCat = this.assets.filter((a) => a.categoryId === this.selectedCategoryId).length;
    const title = document.createElement('div');
    title.className = 'img-modal-cat-title';
    title.textContent = `${cat?.name ?? 'Unknown'} · ${countInCat}`;
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

    // Add buttons
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
      this._renderGrid();
    });
    host.appendChild(search);

    // "Show all" toggle — escape hatch for users who want to browse the
    // full curated set without typing.
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

    // "Import into" target — dropdown so the user can choose where imports
    // land without leaving the Browse tab to click in the sidebar. Defaults
    // to whichever sidebar category is currently selected.
    const label = document.createElement('span');
    label.className = 'img-modal-import-target';
    label.textContent = 'Imports →';
    host.appendChild(label);

    const targetSel = document.createElement('select');
    targetSel.className = 'img-modal-target-select';
    for (const cat of this.categories) {
      const opt = document.createElement('option');
      opt.value = cat.id;
      opt.textContent = cat.name;
      if (cat.id === this.selectedCategoryId) opt.selected = true;
      targetSel.appendChild(opt);
    }
    targetSel.addEventListener('change', () => {
      this.selectedCategoryId = targetSel.value;
      // Refresh sidebar so the active category visually matches the new
      // target. Grid doesn't need a re-render — it's connector content.
      this._renderSidebar();
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

    const filtered = this.assets
      .filter((a) => a.categoryId === this.selectedCategoryId)
      .filter((a) => {
        if (!this.searchQuery) return true;
        const haystack = (a.name + ' ' + (a.tags ?? []).join(' ')).toLowerCase();
        return haystack.includes(this.searchQuery);
      });

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

  /** Read-only render of the bundled font catalog. Each entry shows the
   *  name in its own family for preview (loads from system font fallback
   *  until Stream C wires the actual @font-face), the vibe hint, and the
   *  attribution + clickable licence/source link. */
  private _renderFontsCategory(host: HTMLElement): void {
    const intro = document.createElement('div');
    intro.className = 'img-modal-empty';
    intro.style.gridColumn = '1 / -1';
    intro.style.textAlign = 'left';
    intro.innerHTML = `
      <p style="margin:0 0 var(--space-sm);">
        <strong>Fonts</strong> bundled with Mappadux ship with Stream C
        (Text Maps). For now this is a read-only listing so creators can
        see what's coming and verify the OFL attribution.
      </p>
      <p style="margin:0; font-size:0.85em;">
        All bundled fonts are SIL OFL 1.1. Names below use the bundled
        family when Stream C lands; for now they fall back to system fonts.
      </p>
    `;
    host.appendChild(intro);

    for (const font of BUNDLED_FONTS) {
      host.appendChild(this._fontRow(font));
    }
  }

  private _fontRow(font: typeof BUNDLED_FONTS[number]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'img-modal-font-row';

    const sample = document.createElement('div');
    sample.className = 'img-modal-font-sample';
    sample.style.fontFamily = `'${font.family}', sans-serif`;
    sample.textContent = font.name;
    row.appendChild(sample);

    const meta = document.createElement('div');
    meta.className = 'img-modal-font-meta';
    meta.innerHTML = `
      <div class="img-modal-font-vibe">${this._esc(font.vibe)}</div>
      <div class="img-modal-font-attrib">
        ${this._esc(font.attribution)} ·
        <a href="${this._esc(font.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="img-modal-license-chip">${this._esc(font.license)}</a>
      </div>
    `;
    row.appendChild(meta);

    return row;
  }

  private _renderConnectorGrid(host: HTMLElement): void {
    const conn = CONNECTORS.find((c) => c.id === this.activeTab);
    if (!conn) return;
    const manifest = this.connectorManifests.get(conn.id) ?? [];

    if (manifest.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'img-modal-empty';
      empty.textContent = `Manifest unavailable. Check your connection and try again.`;
      host.appendChild(empty);
      return;
    }

    // Search-first UX: with no query AND no "Show all" toggle, show a prompt
    // rather than the full manifest. Avoids firing 30+ CDN fetches on every
    // tab open and matches the feel of the upstream catalog browsers.
    if (!this.connectorSearchQuery && !this.connectorShowAll) {
      const prompt = document.createElement('div');
      prompt.className = 'img-modal-empty';
      prompt.innerHTML = `
        <p style="margin:0 0 var(--space-sm);">Search by name or tag to browse <strong>${this._esc(conn.displayName)}</strong>.</p>
        <p style="margin:0; font-size:0.85em;">Try terms like <em>sword</em>, <em>dragon</em>, <em>key</em>, or use <strong>Show all</strong> to browse the curated starter set.</p>
      `;
      host.appendChild(prompt);
      return;
    }

    const filtered = manifest.filter((entry) => {
      if (!this.connectorSearchQuery) return true;
      const haystack = (entry.name + ' ' + entry.tags.join(' ') + ' ' + (entry.author ?? '')).toLowerCase();
      return haystack.includes(this.connectorSearchQuery);
    });

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'img-modal-empty';
      empty.textContent = 'No icons match that search.';
      host.appendChild(empty);
      return;
    }

    for (const entry of filtered) {
      host.appendChild(this._connectorCell(conn, entry));
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
    const asset: ImageAsset = {
      id,
      name:            entry.name,
      source:          conn.id,
      categoryId:      this.selectedCategoryId,
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
    cell.title = asset.name;

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
