import type { AudioAsset } from '../types.ts';
import { FreesoundClient } from '../audio/FreesoundClient.ts';
import { freesoundConnector } from '../audio/connectors/FreesoundConnector.ts';
import type { AssetSourceConnector, AssetSearchPage } from '../audio/connectors/AssetSourceConnector.ts';
import { AudioAssetStore } from '../audio/AudioAssetStore.ts';
import { getUsedAudioAssetIds } from '../storage/assetUsage.ts';

// Duration filter options shown in the dropdown
const DURATION_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: '≤ 10s',   value: 10  },
  { label: '≤ 20s',   value: 20  },
  { label: '≤ 30s',   value: 30  },
  { label: '≤ 60s',   value: 60  },
  { label: '≤ 120s',  value: 120 },
  { label: 'Any length', value: null },
];

/** Standard licence options offered when a user edits an asset's attribution. */
const LICENSE_OPTIONS: string[] = [
  'CC0 (Public Domain)',
  'CC-BY',
  'CC-BY-SA',
  'CC-BY-NC',
  'CC-BY-NC-SA',
  'CC-BY-ND',
  'CC-BY-NC-ND',
  'Permission Granted',
  'Other',
];

type AssignCallback = (asset: AudioAsset) => void;

export class FreesoundModal {
  private el!:              HTMLElement;
  private previewEl:        HTMLAudioElement | null = null;
  private previewingUrl:    string | null = null;
  private onAssign:         AssignCallback;
  private selectedDuration: number | null = 30;
  /** Active search connector. v2.8 will let the modal switch between several. */
  private searchConnector:  AssetSourceConnector<any> = freesoundConnector;
  private searchResults:    any[] = [];
  private nextPageUrl:      string | null = null;
  private totalCount:       number = 0;
  private uploadFile:       File | null = null;

  constructor(onAssign: AssignCallback) {
    this.onAssign = onAssign;
    this._buildDOM();
    this._bindEvents();
  }

  open(onAssign?: AssignCallback): void {
    if (onAssign) this.onAssign = onAssign;
    this.el.hidden = false;
    this._renderLibrary();
  }

  close(): void {
    this.el.hidden = true;
    this._stopPreview();
    this._clearUpload();
  }

  // ─── DOM construction ─────────────────────────────────────────────────────

  private _buildDOM(): void {
    const overlay = document.getElementById('freesound-modal')!;
    this.el = overlay;

    // Populate duration options
    const sel = this.el.querySelector<HTMLSelectElement>('#fs-duration-select')!;
    sel.innerHTML = '';
    for (const opt of DURATION_OPTIONS) {
      const o = document.createElement('option');
      o.value       = opt.value === null ? '' : String(opt.value);
      o.textContent = opt.label;
      if (opt.value === 30) o.selected = true;
      sel.appendChild(o);
    }

    // Seed API key if saved
    const keyInput = this.el.querySelector<HTMLInputElement>('#fs-api-key')!;
    const saved = FreesoundClient.getApiKey();
    if (saved) keyInput.value = saved;
  }

  private _bindEvents(): void {
    // Close
    this.el.querySelector('#modal-close-btn')?.addEventListener('click', () => this.close());
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });

    // Tab switching
    this.el.querySelectorAll('.modal-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        this.el.querySelectorAll('.modal-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        const name = (tab as HTMLElement).dataset['tab']!;
        this.el.querySelectorAll<HTMLElement>('.tab-content').forEach((c) => {
          c.hidden = c.id !== `tab-${name}`;
        });
        if (name === 'library') this._renderLibrary();
      });
    });

    // Library search filter
    this.el.querySelector('#library-search')?.addEventListener('input', () => this._renderLibrary());

    // Library 'Store All' — fetch + persist every non-stored Freesound / URL asset
    this.el.querySelector('#library-store-all-btn')?.addEventListener('click', () => void this._storeAllInLibrary(false));
    // Library 'Store All Used' — same but only the assets actually referenced somewhere
    this.el.querySelector('#library-store-used-btn')?.addEventListener('click', () => void this._storeAllInLibrary(true));
    // Library 'Delete All Unused' — permanently remove every audio asset not referenced anywhere
    this.el.querySelector('#library-delete-unused-btn')?.addEventListener('click', () => void this._deleteUnusedInLibrary());

    // Library 'Attributions' — opens the global attributions modal
    this.el.querySelector('#library-attributions-btn')?.addEventListener('click', () => void this._showAttributions());

    // Attributions modal close + click-outside (binds once at construction time)
    const attrModal = document.getElementById('attributions-modal');
    if (attrModal) {
      attrModal.querySelector('#attr-modal-close')?.addEventListener('click', () => { attrModal.hidden = true; });
      attrModal.addEventListener('click', (e) => { if (e.target === attrModal) attrModal.hidden = true; });
      attrModal.querySelector('#attr-copy-all-btn')?.addEventListener('click', () => void this._copyAllAttributions());
    }

    // Freesound search
    this.el.querySelector('#fs-search-btn')?.addEventListener('click', () => void this._doSearch());
    this.el.querySelector<HTMLInputElement>('#fs-search-input')?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') void this._doSearch();
    });

    // Duration select
    this.el.querySelector('#fs-duration-select')?.addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value;
      this.selectedDuration = v ? Number(v) : null;
    });

    // API key save
    this.el.querySelector('#fs-save-key-btn')?.addEventListener('click', () => {
      const val = this.el.querySelector<HTMLInputElement>('#fs-api-key')!.value.trim();
      if (val) {
        FreesoundClient.setApiKey(val);
        this._setSearchStatus('API key saved.');
      }
    });

    // Upload tab
    const dropZone  = this.el.querySelector<HTMLElement>('#upload-drop-zone')!;
    const fileInput = this.el.querySelector<HTMLInputElement>('#upload-file-input')!;

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

    this.el.querySelector('#upload-add-btn')?.addEventListener('click',   () => void this._addUpload());
    this.el.querySelector('#upload-clear-btn')?.addEventListener('click', () => this._clearUpload());

    // Web Links tab
    this.el.querySelector('#weblinks-add-btn')?.addEventListener('click',   () => void this._addWebLinks());
    this.el.querySelector('#weblinks-clear-btn')?.addEventListener('click', () => this._clearWebLinks());
  }

  // ─── Library tab ──────────────────────────────────────────────────────────

  private async _renderLibrary(): Promise<void> {
    const listEl  = this.el.querySelector<HTMLElement>('#library-list')!;
    const emptyEl = this.el.querySelector<HTMLElement>('#library-empty')!;
    const filter  = (this.el.querySelector<HTMLInputElement>('#library-search')?.value ?? '').toLowerCase();

    const [all, usedIds] = await Promise.all([
      AudioAssetStore.getAll(),
      getUsedAudioAssetIds(),
    ]);
    const filtered = filter ? all.filter((a) => a.name.toLowerCase().includes(filter)) : all;

    emptyEl.hidden = filtered.length > 0;
    listEl.innerHTML = '';

    for (const asset of filtered) {
      listEl.appendChild(this._libraryRow(asset, usedIds));
    }

    // Footer buttons — visible only when there's work for each.
    const storeAllBtn   = this.el.querySelector<HTMLButtonElement>('#library-store-all-btn');
    const storeUsedBtn  = this.el.querySelector<HTMLButtonElement>('#library-store-used-btn');
    const deleteBtn     = this.el.querySelector<HTMLButtonElement>('#library-delete-unused-btn');
    const allCountEl    = this.el.querySelector<HTMLElement>('#library-store-all-count');
    const usedCountEl   = this.el.querySelector<HTMLElement>('#library-store-used-count');
    const delCountEl    = this.el.querySelector<HTMLElement>('#library-delete-unused-count');
    const status        = this.el.querySelector<HTMLElement>('#library-store-all-status');
    const nonStored     = all.filter((a) => !a.locallyStored && (a.source === 'freesound' || a.source === 'web-link'));
    const nonStoredUsed = nonStored.filter((a) => usedIds.has(a.id));
    const unused        = all.filter((a) => !usedIds.has(a.id));
    if (storeAllBtn)  storeAllBtn.hidden  = nonStored.length === 0;
    if (storeUsedBtn) storeUsedBtn.hidden = nonStoredUsed.length === 0;
    if (deleteBtn)    deleteBtn.hidden    = unused.length === 0;
    if (allCountEl)   allCountEl.textContent  = nonStored.length     > 0 ? `(${nonStored.length})`     : '';
    if (usedCountEl)  usedCountEl.textContent = nonStoredUsed.length > 0 ? `(${nonStoredUsed.length})` : '';
    if (delCountEl)   delCountEl.textContent  = unused.length        > 0 ? `(${unused.length})`        : '';
    if (status)       status.textContent = '';
  }

  private async _storeAllInLibrary(onlyUsed: boolean): Promise<void> {
    const status = this.el.querySelector<HTMLElement>('#library-store-all-status');
    if (!status) return;

    const [all, usedIds] = await Promise.all([
      AudioAssetStore.getAll(),
      onlyUsed ? getUsedAudioAssetIds() : Promise.resolve(new Set<string>()),
    ]);
    const candidates = all.filter((a) =>
      !a.locallyStored
      && (a.source === 'freesound' || a.source === 'web-link')
      && (!onlyUsed || usedIds.has(a.id))
    );
    if (candidates.length === 0) return;

    const allBtn  = this.el.querySelector<HTMLButtonElement>('#library-store-all-btn');
    const usedBtn = this.el.querySelector<HTMLButtonElement>('#library-store-used-btn');
    if (allBtn)  allBtn.disabled  = true;
    if (usedBtn) usedBtn.disabled = true;

    let ok = 0;
    let fail = 0;
    for (let i = 0; i < candidates.length; i++) {
      const asset = candidates[i]!;
      status.textContent = `Storing ${i + 1} of ${candidates.length}: ${asset.name}…`;
      const success = await AudioAssetStore.store(asset);
      if (success) ok++; else fail++;
    }

    const msg = fail === 0
      ? `Stored ${ok} asset${ok !== 1 ? 's' : ''}.`
      : `Stored ${ok}; ${fail} failed (likely missing API key or broken URL).`;

    await this._renderLibrary();
    // _renderLibrary clears the status — re-set it after so the result is visible.
    if (status) status.textContent = msg;
    if (allBtn)  allBtn.disabled  = false;
    if (usedBtn) usedBtn.disabled = false;
  }

  private async _deleteUnusedInLibrary(): Promise<void> {
    const status = this.el.querySelector<HTMLElement>('#library-store-all-status');

    const [all, usedIds] = await Promise.all([
      AudioAssetStore.getAll(),
      getUsedAudioAssetIds(),
    ]);
    const unused = all.filter((a) => !usedIds.has(a.id));
    if (unused.length === 0) return;

    const ok = confirm(
      `Delete ${unused.length} unused audio asset${unused.length === 1 ? '' : 's'}?\n\n` +
      'These aren\'t referenced by any map\'s soundboard slots, marker audio sources, or motion-tracker pings.\n\n' +
      'This cannot be undone.'
    );
    if (!ok) return;

    for (const asset of unused) await AudioAssetStore.delete(asset.id);

    await this._renderLibrary();
    if (status) status.textContent = `Deleted ${unused.length} unused asset${unused.length === 1 ? '' : 's'}.`;
  }

  private _libraryRow(asset: AudioAsset, usedIds: Set<string> = new Set()): HTMLElement {
    const isUnused = !usedIds.has(asset.id);
    const unusedChip = isUnused
      ? `<span class="sound-unused" title="Not referenced by any map — safe to delete">[!]</span>`
      : '';
    const tags: string[] = [];
    if (asset.source === 'freesound') tags.push('<span class="sound-tag sound-tag--freesound">Freesound</span>');
    if (asset.source === 'web-link')  tags.push('<span class="sound-tag sound-tag--url">URL</span>');
    // 'Stored' = "this asset travels in bundle exports". Shown on any
    // locallyStored asset — Uploads (always stored), Freesound/URL items
    // promoted via Store, and the built-in tracker pings.
    if (asset.locallyStored) {
      tags.push('<span class="sound-tag sound-tag--local">Stored</span>');
    }
    const tagsHtml = tags.join('');

    // Show a Store button only when the asset isn't yet locally stored.
    const storeBtnHtml = asset.locallyStored
      ? ''
      : `<button class="btn btn--ghost btn--xs sound-store-btn" title="Download and keep a local copy">Store</button>`;

    // Freesound attributions are locked (the API supplies them); Upload + Web Link
    // rows are editable so users can record where the audio came from. Edit
    // affordance sits next to the licence text since that's what it edits.
    const editable = asset.source !== 'freesound';
    const editIconHtml = editable
      ? `<button class="sound-edit-btn" title="Edit licence + attribution">✎</button>`
      : '';

    const row = document.createElement('div');
    row.className = 'sound-row-wrap';
    row.innerHTML = `
      <div class="sound-row">
        <div class="sound-row-info">
          <span class="sound-name">${tagsHtml}${unusedChip}${this._esc(asset.name)}</span>
          <span class="sound-meta-row">
            <span class="sound-meta">${this._esc(asset.license ?? asset.source)}</span>
            ${editIconHtml}
          </span>
        </div>
        <div class="sound-row-actions">
          <button class="btn btn--ghost btn--xs sound-preview-btn" data-url="">▶ Preview</button>
          ${storeBtnHtml}
          <button class="btn btn--primary btn--xs sound-use-btn">Use</button>
          <button class="btn btn--danger btn--xs sound-del-btn" title="Remove from library">✕</button>
        </div>
      </div>
      ${editable ? `
        <div class="sound-row-edit" hidden>
          <div class="sound-edit-row">
            <label>Licence</label>
            <select class="sound-edit-license">
              ${LICENSE_OPTIONS.map((l) => `<option value="${this._esc(l)}"${asset.license === l ? ' selected' : ''}>${this._esc(l)}</option>`).join('')}
            </select>
          </div>
          <div class="sound-edit-row">
            <label>Attribution</label>
            <input type="text" class="sound-edit-attribution" placeholder='e.g. "Sound: My Recording" by Author' value="${this._esc(asset.attribution ?? '')}" />
          </div>
          <div class="sound-edit-row">
            <label>Link</label>
            <input type="url" class="sound-edit-link" placeholder="https://… (optional)" value="${this._esc(asset.attributionLink ?? asset.sourceUrl ?? '')}" />
          </div>
          <div class="sound-edit-actions">
            <button class="btn btn--primary btn--xs sound-edit-save">Save</button>
            <button class="btn btn--ghost btn--xs sound-edit-cancel">Cancel</button>
          </div>
        </div>
      ` : ''}
    `;

    const previewBtn = row.querySelector<HTMLButtonElement>('.sound-preview-btn')!;
    const useBtn     = row.querySelector<HTMLButtonElement>('.sound-use-btn')!;
    const delBtn     = row.querySelector<HTMLButtonElement>('.sound-del-btn')!;
    const storeBtn   = row.querySelector<HTMLButtonElement>('.sound-store-btn');
    const editBtn    = row.querySelector<HTMLButtonElement>('.sound-edit-btn');
    const editPanel  = row.querySelector<HTMLElement>('.sound-row-edit');

    previewBtn.addEventListener('click', async () => {
      const blob = await AudioAssetStore.getBlob(asset);
      if (!blob) { previewBtn.textContent = '⚠ Missing'; return; }
      const url = URL.createObjectURL(blob);
      this._previewAudio(url, previewBtn);
    });

    useBtn.addEventListener('click', () => {
      this.onAssign(asset);
      this.close();
    });

    storeBtn?.addEventListener('click', async () => {
      storeBtn.disabled    = true;
      storeBtn.textContent = 'Storing…';
      const ok = await AudioAssetStore.store(asset);
      if (ok) {
        await this._renderLibrary(); // re-render so the row refreshes with Local tag, no Store button
      } else {
        storeBtn.disabled    = false;
        storeBtn.textContent = '⚠ Failed';
        setTimeout(() => { storeBtn.textContent = 'Store'; }, 2000);
      }
    });

    delBtn.addEventListener('click', async () => {
      if (!confirm(`Remove "${asset.name}" from your library?`)) return;
      await AudioAssetStore.delete(asset.id);
      await this._renderLibrary();
    });

    editBtn?.addEventListener('click', () => {
      if (editPanel) editPanel.hidden = !editPanel.hidden;
    });

    row.querySelector<HTMLButtonElement>('.sound-edit-cancel')?.addEventListener('click', () => {
      if (editPanel) editPanel.hidden = true;
    });

    row.querySelector<HTMLButtonElement>('.sound-edit-save')?.addEventListener('click', async () => {
      const license     = row.querySelector<HTMLSelectElement>('.sound-edit-license')?.value ?? asset.license;
      const attribution = row.querySelector<HTMLInputElement>('.sound-edit-attribution')?.value.trim() ?? '';
      const link        = row.querySelector<HTMLInputElement>('.sound-edit-link')?.value.trim() ?? '';
      const patch: Partial<AudioAsset> = {};
      if (license)     patch.license         = license;
      if (attribution) patch.attribution     = attribution;
      if (link)        patch.attributionLink = link;
      await AudioAssetStore.update(asset.id, patch);
      await this._renderLibrary();
    });

    return row;
  }

  // ─── Freesound search tab ─────────────────────────────────────────────────

  private async _doSearch(): Promise<void> {
    const query = this.el.querySelector<HTMLInputElement>('#fs-search-input')!.value.trim();
    if (!query) return;

    if (this.searchConnector.requiresConfig && !this.searchConnector.isConfigured()) {
      this._setSearchStatus('No API key set — paste one below first.');
      return;
    }

    this._setSearchStatus('Searching…');
    const resultsEl = this.el.querySelector<HTMLElement>('#fs-results')!;
    resultsEl.innerHTML = '';
    this.searchResults = [];
    this.nextPageUrl   = null;
    this.totalCount    = 0;

    try {
      const page = await this.searchConnector.search(query, { maxDurationSecs: this.selectedDuration });
      if (page.results.length === 0) {
        this._setSearchStatus('No results found.');
        return;
      }
      this._appendPage(page);
    } catch (err) {
      this._setSearchStatus(`Error: ${(err as Error).message}`);
    }
  }

  private async _loadMore(): Promise<void> {
    if (!this.nextPageUrl) return;
    const btn = this.el.querySelector<HTMLButtonElement>('#fs-more-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }

    try {
      const page = await this.searchConnector.fetchPage(this.nextPageUrl);
      this._appendPage(page);
    } catch (err) {
      this._setSearchStatus(`Error: ${(err as Error).message}`);
      if (btn) { btn.disabled = false; btn.textContent = this._moreLabel(); }
    }
  }

  private _appendPage(page: AssetSearchPage<any>): void {
    const resultsEl = this.el.querySelector<HTMLElement>('#fs-results')!;

    // Remove existing More button before appending new rows
    resultsEl.querySelector('#fs-more-btn')?.remove();

    this.searchResults.push(...page.results);
    this.nextPageUrl = page.nextUrl;
    this.totalCount  = page.count;

    for (const r of page.results) {
      resultsEl.appendChild(this._resultRow(r));
    }

    const shown = this.searchResults.length;
    if (page.nextUrl) {
      this._setSearchStatus(`Showing ${shown} of ${this.totalCount}`);
      const btn = document.createElement('button');
      btn.id        = 'fs-more-btn';
      btn.className = 'btn btn--ghost btn--sm fs-more-btn';
      btn.textContent = this._moreLabel();
      btn.addEventListener('click', () => void this._loadMore());
      resultsEl.appendChild(btn);
    } else {
      this._setSearchStatus(shown === this.totalCount
        ? `${this.totalCount} result${this.totalCount !== 1 ? 's' : ''}`
        : `Showing ${shown} of ${this.totalCount}`);
    }
  }

  private _moreLabel(): string {
    const remaining = this.totalCount - this.searchResults.length;
    return `More results… (${remaining} remaining)`;
  }

  private _resultRow(result: any): HTMLElement {
    const data = this.searchConnector.resultRow(result);
    const row = document.createElement('div');
    row.className = 'sound-row';
    row.innerHTML = `
      <div class="sound-row-info">
        <span class="sound-name">${this._esc(data.name)}</span>
        <span class="sound-meta">${this._esc(data.meta)} ·
          <span class="sound-license ${data.needsAttribution ? 'sound-license--attrib' : ''}">${this._esc(data.license)}</span>
        </span>
        ${data.needsAttribution && data.attribution
          ? `<span class="sound-attrib-hint">Attribution required: "${this._esc(data.attribution)}"</span>`
          : ''}
      </div>
      <div class="sound-row-actions">
        <button class="btn btn--ghost btn--xs sound-preview-btn">▶ Preview</button>
        <button class="btn btn--primary btn--xs sound-import-btn">Import</button>
      </div>
    `;

    const previewBtn = row.querySelector<HTMLButtonElement>('.sound-preview-btn')!;
    const importBtn  = row.querySelector<HTMLButtonElement>('.sound-import-btn')!;

    previewBtn.addEventListener('click', () => {
      this._previewAudio(data.previewUrl, previewBtn);
    });

    importBtn.addEventListener('click', async () => {
      importBtn.disabled = true;
      importBtn.textContent = 'Importing…';
      try {
        const id    = crypto.randomUUID();
        const asset = this.searchConnector.toAudioAsset(result, id);
        // Save metadata only — Freesound assets are URL-like by default. Blob
        // is fetched on demand into the runtime cache; click Store in My
        // Library to make the asset offline-usable + portable in bundle exports.
        await AudioAssetStore.saveMetadataOnly(asset);
        this.onAssign(asset);
        this.close();
      } catch (err) {
        importBtn.disabled = false;
        importBtn.textContent = 'Import';
        this._setSearchStatus(`Import failed: ${(err as Error).message}`);
      }
    });

    return row;
  }

  // ─── Audio preview ────────────────────────────────────────────────────────

  private _previewAudio(url: string, btn: HTMLButtonElement): void {
    if (this.previewingUrl === url) {
      this._stopPreview();
      btn.textContent = '▶ Preview';
      return;
    }
    this._stopPreview();

    this.previewEl = new Audio(url);
    this.previewEl.volume = 0.6;
    this.previewingUrl = url;
    btn.textContent = '⏹ Stop';

    this.previewEl.addEventListener('ended', () => {
      btn.textContent = '▶ Preview';
      this.previewingUrl = null;
    });

    void this.previewEl.play().catch(() => {
      btn.textContent = '▶ Preview';
    });
  }

  private _stopPreview(): void {
    if (this.previewEl) {
      this.previewEl.pause();
      this.previewEl = null;
    }
    this.previewingUrl = null;
    // Reset all preview buttons
    this.el.querySelectorAll('.sound-preview-btn').forEach((b) => {
      if ((b as HTMLButtonElement).textContent?.startsWith('⏹')) {
        (b as HTMLButtonElement).textContent = '▶ Preview';
      }
    });
  }

  private _setSearchStatus(msg: string): void {
    const el = this.el.querySelector<HTMLElement>('#fs-status');
    if (el) el.textContent = msg;
  }

  // ─── Upload tab ───────────────────────────────────────────────────────────

  private _handleUploadFile(file: File): void {
    this.uploadFile = file;
    const nameInput = this.el.querySelector<HTMLInputElement>('#upload-name-input')!;
    nameInput.value = file.name.replace(/\.[^.]+$/, ''); // strip extension
    this.el.querySelector<HTMLElement>('#upload-drop-zone')!.hidden  = true;
    this.el.querySelector<HTMLElement>('#upload-file-info')!.hidden = false;
  }

  private _clearUpload(): void {
    this.uploadFile = null;
    const fileInput = this.el.querySelector<HTMLInputElement>('#upload-file-input');
    if (fileInput) fileInput.value = '';
    const dropZone = this.el.querySelector<HTMLElement>('#upload-drop-zone');
    const fileInfo = this.el.querySelector<HTMLElement>('#upload-file-info');
    if (dropZone) dropZone.hidden = false;
    if (fileInfo) fileInfo.hidden  = true;
  }

  private async _addUpload(): Promise<void> {
    if (!this.uploadFile) return;
    const addBtn    = this.el.querySelector<HTMLButtonElement>('#upload-add-btn')!;
    const nameInput = this.el.querySelector<HTMLInputElement>('#upload-name-input')!;
    const name = nameInput.value.trim() || this.uploadFile.name.replace(/\.[^.]+$/, '');

    addBtn.disabled    = true;
    addBtn.textContent = 'Saving…';
    try {
      const asset: AudioAsset = {
        id:            crypto.randomUUID(),
        name,
        source:        'upload',
        locallyStored: true,
        license:       'Unknown / Manual import',
        addedAt:       Date.now(),
      };
      await AudioAssetStore.save(asset, this.uploadFile);
      this.onAssign(asset);
      this.close();
    } catch {
      addBtn.disabled    = false;
      addBtn.textContent = 'Add to Library';
    }
  }

  // ─── Attributions modal ───────────────────────────────────────────────────

  private async _showAttributions(): Promise<void> {
    const modal = document.getElementById('attributions-modal');
    if (!modal) return;
    const list   = await AudioAssetStore.getAttributions();
    const bodyEl = modal.querySelector('#attr-list')!;
    bodyEl.innerHTML = '';

    if (list.length === 0) {
      bodyEl.innerHTML = '<p class="attr-empty">No audio assets in library yet.</p>';
    } else {
      for (const item of list) {
        const row = document.createElement('div');
        row.className = 'attr-row';
        const linkHtml = item.pageUrl
          ? ` <a href="${this._esc(item.pageUrl)}" target="_blank" rel="noopener" class="attr-link">Link ↗</a>`
          : '';
        row.innerHTML = `
          <span class="attr-text">${this._esc(item.attribution)}</span>
          <span class="attr-license ${item.license.startsWith('CC0') ? '' : 'attr-license--required'}">${this._esc(item.license)}</span>${linkHtml}
        `;
        bodyEl.appendChild(row);
      }
    }
    const status = modal.querySelector<HTMLElement>('#attr-copy-status');
    if (status) status.textContent = '';
    modal.hidden = false;
  }

  /** Build a clipboard-friendly attribution block for the user's docs / credits. */
  private async _copyAllAttributions(): Promise<void> {
    const modal  = document.getElementById('attributions-modal');
    const status = modal?.querySelector<HTMLElement>('#attr-copy-status') ?? null;
    const list   = await AudioAssetStore.getAttributions();
    if (list.length === 0) {
      if (status) status.textContent = 'Nothing to copy.';
      return;
    }
    const lines: string[] = ['Audio assets used in map pack:', ''];
    for (const item of list) {
      const parts = [`"${item.name}"`];
      if (item.attribution && item.attribution !== `Sound: "${item.name}" — ${item.license || 'Unknown'}`) {
        parts.push(item.attribution);
      }
      if (item.license) parts.push(item.license);
      if (item.pageUrl) parts.push(item.pageUrl);
      lines.push(parts.join(' — '));
    }
    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      if (status) status.textContent = `Copied ${list.length} entr${list.length === 1 ? 'y' : 'ies'} to clipboard.`;
    } catch {
      if (status) status.textContent = 'Copy failed — see console.';
      console.log('[Attributions]\n', text);
    }
  }

  // ─── Web Links tab ────────────────────────────────────────────────────────

  private _clearWebLinks(): void {
    const ta = this.el.querySelector<HTMLTextAreaElement>('#weblinks-input');
    const results = this.el.querySelector<HTMLElement>('#weblinks-results');
    if (ta) ta.value = '';
    if (results) results.innerHTML = '';
  }

  private async _addWebLinks(): Promise<void> {
    const ta      = this.el.querySelector<HTMLTextAreaElement>('#weblinks-input');
    const results = this.el.querySelector<HTMLElement>('#weblinks-results');
    const addBtn  = this.el.querySelector<HTMLButtonElement>('#weblinks-add-btn');
    if (!ta || !results || !addBtn) return;

    const urls = ta.value.split(/[\s,]+/).map((u) => u.trim()).filter(Boolean);
    if (urls.length === 0) return;

    results.innerHTML = '';
    addBtn.disabled    = true;
    addBtn.textContent = 'Validating…';

    let added = 0;
    for (const url of urls) {
      const row = document.createElement('div');
      row.className = 'weblinks-result weblinks-result--busy';
      row.textContent = `… ${url}`;
      results.appendChild(row);

      const probe = await _probeAudioUrl(url);
      if (!probe.ok) {
        row.className   = 'weblinks-result weblinks-result--fail';
        row.textContent = `✗ ${url} — ${probe.error}`;
        continue;
      }

      const name = _nameFromUrl(url);
      const asset: AudioAsset = {
        id:            crypto.randomUUID(),
        name,
        source:        'web-link',
        locallyStored: false,
        sourceUrl:     url,
        license:       'Unknown — provide attribution in your library',
        durationSecs:  probe.durationSecs,
        addedAt:       Date.now(),
      };
      try {
        await AudioAssetStore.saveMetadataOnly(asset);
        row.className   = 'weblinks-result weblinks-result--ok';
        row.textContent = `✓ ${name} — added`;
        added++;
      } catch (err) {
        row.className   = 'weblinks-result weblinks-result--fail';
        row.textContent = `✗ ${url} — could not save: ${(err as Error).message}`;
      }
    }

    addBtn.disabled    = false;
    addBtn.textContent = 'Validate & Add';
    if (added > 0) ta.value = '';
  }

  private _esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

// ── Web-link helpers ──────────────────────────────────────────────────────────

/**
 * Probe a URL by asking an Audio element to load its metadata. Resolves with
 * the duration (in whole seconds) on success, or an error message on failure.
 * Times out after 15s.
 */
function _probeAudioUrl(url: string): Promise<{ ok: true; durationSecs: number } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: { ok: true; durationSecs: number } | { ok: false; error: string }) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    try {
      const a = new Audio();
      a.preload = 'metadata';
      a.crossOrigin = 'anonymous';
      const timeout = setTimeout(() => finish({ ok: false, error: 'Timed out' }), 15_000);
      a.onloadedmetadata = () => {
        clearTimeout(timeout);
        finish({ ok: true, durationSecs: Math.round(a.duration || 0) });
      };
      a.onerror = () => {
        clearTimeout(timeout);
        finish({ ok: false, error: 'Could not load audio (CORS, 404, or wrong file type)' });
      };
      a.src = url;
    } catch (err) {
      finish({ ok: false, error: (err as Error).message });
    }
  });
}

/** Best-effort display name from a URL — last path segment, decoded, ext stripped. */
function _nameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() ?? '';
    const decoded = decodeURIComponent(last).replace(/\.[^.]+$/, '').trim();
    return decoded || u.hostname || 'Web Link Audio';
  } catch {
    return 'Web Link Audio';
  }
}
