import type { ImageAsset, ImageCategory } from '../types.ts';
import { SYSTEM_CATEGORY_IDS } from '../types.ts';
import { ImageAssetStore } from './ImageAssetStore.ts';

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

    // Main area: toolbar + grid
    const toolbar = document.createElement('div');
    toolbar.className = 'img-modal-toolbar';
    toolbar.id = 'img-modal-toolbar';
    main.appendChild(toolbar);

    const grid = document.createElement('div');
    grid.className = 'img-modal-grid';
    grid.id = 'img-modal-grid';
    main.appendChild(grid);

    return overlay;
  }

  private async _reload(): Promise<void> {
    this.categories = await ImageAssetStore.getAllCategories();
    this.assets     = await ImageAssetStore.getAll();
    this._renderSidebar();
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
    const id = 'cat-' + crypto.randomUUID();
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

  private async _promptAddUnicode(): Promise<void> {
    const ch = prompt('Type or paste a single character (or short sequence) to add as an icon:');
    if (!ch) return;
    const trimmed = ch.trim();
    if (!trimmed) return;
    const name = prompt('Name for this icon:', trimmed) ?? trimmed;
    const asset: ImageAsset = {
      id:           'unicode-' + crypto.randomUUID(),
      name:         name.trim() || trimmed,
      source:       'unicode',
      categoryId:   this.selectedCategoryId,
      tintable:     true,
      unicodeChar:  trimmed,
      license:      'N/A',
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
    const id = 'upload-' + crypto.randomUUID();
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

  private _iconCell(asset: ImageAsset): HTMLElement {
    const cell = document.createElement('div');
    cell.className = 'img-modal-cell';
    cell.title = asset.name;

    const visual = document.createElement('div');
    visual.className = 'img-modal-visual';
    this._renderIconVisual(visual, asset);
    cell.appendChild(visual);

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

  private _esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
