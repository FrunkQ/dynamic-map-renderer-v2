import type { MapAsset, StoredMap } from '../types.ts';
import { MapAssetStore } from '../maps/MapAssetStore.ts';
import { MapManager } from './MapManager.ts';

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_BYTES = 50 * 1024 * 1024;

type MapPickedCallback = (map: StoredMap) => void;

/**
 * MapAssetModal — picker dialog for adding a map to the current pack. Mirrors
 * FreesoundModal's three-tab layout (Library / Web Links / Upload) but for
 * map images instead of audio.
 *
 * Flow:
 *   • Library tab: click Use → creates a fresh StoredMap pointing at the
 *     existing MapAsset, fires onPick.
 *   • Web Links tab: paste URL(s) → image-probe each → save MapAssets
 *     metadata-only (no blob until Store). Multi-add only — does NOT
 *     auto-create a map instance; user picks one from Library.
 *   • Upload tab: drop file → save MapAsset with blob → create StoredMap
 *     and fire onPick (single-file, so the auto-use flow is sensible).
 */
export class MapAssetModal {
  private el!: HTMLElement;
  private onPick: MapPickedCallback;
  private maps: MapManager;
  private uploadFile: File | null = null;

  constructor(maps: MapManager, onPick: MapPickedCallback) {
    this.maps   = maps;
    this.onPick = onPick;
    this._buildDOM();
    this._bindEvents();
  }

  open(onPick?: MapPickedCallback): void {
    if (onPick) this.onPick = onPick;
    this.el.hidden = false;
    void this._renderLibrary();
  }

  close(): void {
    this.el.hidden = true;
    this._clearUpload();
    this._clearWebLinks();
  }

  // ─── DOM ──────────────────────────────────────────────────────────────────

  private _buildDOM(): void {
    this.el = document.getElementById('map-asset-modal')!;
  }

  private _bindEvents(): void {
    // Close + click-outside
    this.el.querySelector('#map-modal-close')?.addEventListener('click', () => this.close());
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.close(); });

    // Tab switching
    this.el.querySelectorAll('.modal-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        this.el.querySelectorAll('.modal-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        const name = (tab as HTMLElement).dataset['mapTab']!;
        this.el.querySelectorAll<HTMLElement>('.tab-content').forEach((c) => {
          c.hidden = c.id !== `map-tab-${name}`;
        });
        if (name === 'library') void this._renderLibrary();
      });
    });

    // Library search
    this.el.querySelector('#map-library-search')?.addEventListener('input', () => void this._renderLibrary());

    // Web Links
    this.el.querySelector('#map-weblinks-add-btn')?.addEventListener('click', () => void this._addWebLinks());
    this.el.querySelector('#map-weblinks-clear-btn')?.addEventListener('click', () => this._clearWebLinks());

    // Upload
    const dropZone  = this.el.querySelector<HTMLElement>('#map-upload-drop-zone')!;
    const fileInput = this.el.querySelector<HTMLInputElement>('#map-upload-file-input')!;
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('upload-drop-zone--over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('upload-drop-zone--over'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('upload-drop-zone--over');
      const file = (e as DragEvent).dataTransfer?.files[0];
      if (file) this._handleUploadFile(file);
    });
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) this._handleUploadFile(file);
    });
    this.el.querySelector('#map-upload-add-btn')?.addEventListener('click', () => void this._addUpload());
    this.el.querySelector('#map-upload-clear-btn')?.addEventListener('click', () => this._clearUpload());
  }

  // ─── Library tab ──────────────────────────────────────────────────────────

  private async _renderLibrary(): Promise<void> {
    const listEl  = this.el.querySelector<HTMLElement>('#map-library-list')!;
    const emptyEl = this.el.querySelector<HTMLElement>('#map-library-empty')!;
    const filter  = (this.el.querySelector<HTMLInputElement>('#map-library-search')?.value ?? '').toLowerCase();

    const all = await MapAssetStore.getAll();
    const filtered = filter ? all.filter((a) => a.filename.toLowerCase().includes(filter)) : all;

    emptyEl.hidden = filtered.length > 0;
    listEl.innerHTML = '';
    for (const asset of filtered) {
      listEl.appendChild(this._libraryRow(asset));
    }
  }

  private _libraryRow(asset: MapAsset): HTMLElement {
    const tags: string[] = [];
    if (asset.source === 'web-link') tags.push('<span class="sound-tag sound-tag--url">URL</span>');
    if (asset.locallyStored)         tags.push('<span class="sound-tag sound-tag--local">Stored</span>');
    const tagsHtml = tags.join('');

    const storeBtnHtml = asset.locallyStored
      ? ''
      : `<button class="btn btn--ghost btn--xs map-store-btn" title="Download and keep a local copy">Store</button>`;

    const dimText = asset.imageWidth && asset.imageHeight
      ? `${asset.imageWidth} × ${asset.imageHeight}`
      : asset.source;

    const row = document.createElement('div');
    row.className = 'sound-row-wrap';
    row.innerHTML = `
      <div class="sound-row">
        <div class="sound-row-info">
          <span class="sound-name">${tagsHtml}${this._esc(asset.filename)}</span>
          <span class="sound-meta-row">
            <span class="sound-meta">${this._esc(dimText)}</span>
          </span>
        </div>
        <div class="sound-row-actions">
          ${storeBtnHtml}
          <button class="btn btn--primary btn--xs map-use-btn">Use</button>
          <button class="btn btn--danger btn--xs map-del-btn" title="Remove from library">✕</button>
        </div>
      </div>
    `;

    row.querySelector<HTMLButtonElement>('.map-use-btn')?.addEventListener('click', async () => {
      const map = await this.maps.createMapFromAsset(asset.id, asset.filename.replace(/\.[^.]+$/, ''));
      this.onPick(map);
      this.close();
    });

    row.querySelector<HTMLButtonElement>('.map-store-btn')?.addEventListener('click', async (e) => {
      const btn = e.target as HTMLButtonElement;
      btn.disabled = true; btn.textContent = 'Storing…';
      const ok = await MapAssetStore.store(asset);
      if (ok) await this._renderLibrary();
      else { btn.disabled = false; btn.textContent = '⚠ Failed'; setTimeout(() => { btn.textContent = 'Store'; }, 2000); }
    });

    row.querySelector<HTMLButtonElement>('.map-del-btn')?.addEventListener('click', async () => {
      // Warn if any map instance currently uses this asset.
      const inUse = (await this.maps.getAll()).filter((m) => m.mapAssetId === asset.id);
      const note = inUse.length > 0
        ? `\n\nWARNING: ${inUse.length} map${inUse.length === 1 ? '' : 's'} currently use this asset. ` +
          'They will become "missing" until you Fix Missing Map.'
        : '';
      if (!confirm(`Remove "${asset.filename}" from your library?${note}`)) return;
      await MapAssetStore.delete(asset.id);
      await this._renderLibrary();
    });

    return row;
  }

  // ─── Web Links tab ────────────────────────────────────────────────────────

  private _clearWebLinks(): void {
    const ta      = this.el.querySelector<HTMLTextAreaElement>('#map-weblinks-input');
    const results = this.el.querySelector<HTMLElement>('#map-weblinks-results');
    if (ta) ta.value = '';
    if (results) results.innerHTML = '';
  }

  private async _addWebLinks(): Promise<void> {
    const ta      = this.el.querySelector<HTMLTextAreaElement>('#map-weblinks-input');
    const results = this.el.querySelector<HTMLElement>('#map-weblinks-results');
    const addBtn  = this.el.querySelector<HTMLButtonElement>('#map-weblinks-add-btn');
    if (!ta || !results || !addBtn) return;

    const urls = ta.value.split(/[\s,]+/).map((u) => u.trim()).filter(Boolean);
    if (urls.length === 0) return;

    results.innerHTML = '';
    addBtn.disabled    = true;
    addBtn.textContent = 'Validating…';

    let added = 0;
    for (const url of urls) {
      const row = document.createElement('div');
      row.className   = 'weblinks-result weblinks-result--busy';
      row.textContent = `… ${url}`;
      results.appendChild(row);

      const probe = await _probeImageUrl(url);
      if (!probe.ok) {
        row.className   = 'weblinks-result weblinks-result--fail';
        row.textContent = `✗ ${url} — ${probe.error}`;
        continue;
      }

      const filename = _filenameFromUrl(url);
      const asset: MapAsset = {
        id:            crypto.randomUUID(),
        filename,
        source:        'web-link',
        locallyStored: false,
        sourceUrl:     url,
        imageWidth:    probe.width,
        imageHeight:   probe.height,
        addedAt:       Date.now(),
      };
      try {
        await MapAssetStore.saveMetadataOnly(asset);
        row.className   = 'weblinks-result weblinks-result--ok';
        row.textContent = `✓ ${filename} — added (${probe.width}×${probe.height})`;
        added++;
      } catch (err) {
        row.className   = 'weblinks-result weblinks-result--fail';
        row.textContent = `✗ ${url} — could not save: ${(err as Error).message}`;
      }
    }

    addBtn.disabled    = false;
    addBtn.textContent = 'Validate & Add';
    if (added > 0) ta.value = '';
    void this._renderLibrary();
  }

  // ─── Upload tab ───────────────────────────────────────────────────────────

  private _handleUploadFile(file: File): void {
    if (!ALLOWED_TYPES.has(file.type)) {
      alert(`Unsupported file type: ${file.type}. Use PNG, JPG, or WebP.`);
      return;
    }
    if (file.size > MAX_BYTES) {
      alert(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 50 MB.`);
      return;
    }
    this.uploadFile = file;
    const nameInput = this.el.querySelector<HTMLInputElement>('#map-upload-name-input')!;
    nameInput.value = file.name.replace(/\.[^.]+$/, '');
    this.el.querySelector<HTMLElement>('#map-upload-drop-zone')!.hidden = true;
    this.el.querySelector<HTMLElement>('#map-upload-file-info')!.hidden = false;
  }

  private _clearUpload(): void {
    this.uploadFile = null;
    const fileInput = this.el.querySelector<HTMLInputElement>('#map-upload-file-input');
    if (fileInput) fileInput.value = '';
    const dropZone = this.el.querySelector<HTMLElement>('#map-upload-drop-zone');
    const fileInfo = this.el.querySelector<HTMLElement>('#map-upload-file-info');
    if (dropZone) dropZone.hidden = false;
    if (fileInfo) fileInfo.hidden  = true;
  }

  private async _addUpload(): Promise<void> {
    if (!this.uploadFile) return;
    const file      = this.uploadFile;
    const nameInput = this.el.querySelector<HTMLInputElement>('#map-upload-name-input')!;
    const name      = nameInput.value.trim() || file.name.replace(/\.[^.]+$/, '');

    // Re-use MapManager.importFile so dimensions / id generation logic stays
    // in one place, then trigger the pick callback with the resulting map.
    try {
      const map = await this.maps.importFile(file);
      // importFile uses the file basename as the StoredMap name; honour the
      // user's typed value if they changed it.
      if (name !== map.name) {
        // saveMap is in db.ts; quickest fix is to round-trip via createMapFromAsset
        // … but that'd create a second map. Just set the name directly.
        const { saveMap: _saveMap } = await import('../storage/db.ts');
        await _saveMap({ ...map, name });
        map.name = name;
      }
      this.onPick(map);
      this.close();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  private _esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

// ── Web-link probe helpers ───────────────────────────────────────────────────

function _probeImageUrl(url: string): Promise<{ ok: true; width: number; height: number } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: { ok: true; width: number; height: number } | { ok: false; error: string }) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const timeout = setTimeout(() => finish({ ok: false, error: 'Timed out' }), 15_000);
      img.onload = () => {
        clearTimeout(timeout);
        finish({ ok: true, width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => {
        clearTimeout(timeout);
        finish({ ok: false, error: 'Could not load image (CORS, 404, or wrong file type)' });
      };
      img.src = url;
    } catch (err) {
      finish({ ok: false, error: (err as Error).message });
    }
  });
}

function _filenameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() ?? '';
    const decoded = decodeURIComponent(last).trim();
    return decoded || u.hostname || 'Web Link Map';
  } catch {
    return 'Web Link Map';
  }
}
