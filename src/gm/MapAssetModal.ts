import type { MapAsset, StoredMap } from '../types.ts';
import { MapAssetStore } from '../maps/MapAssetStore.ts';
import { downloadAsset } from '../utils/downloadAsset.ts';
import { MapManager } from './MapManager.ts';
import { MapCalibrationModal } from './MapCalibrationModal.ts';
import { getUsedMapAssetIds } from '../storage/assetUsage.ts';
import { detectMapScale, autoApplyPatch } from '../utils/detectMapScale.ts';
import { ScaleCandidateDialog } from './ScaleCandidateDialog.ts';
import { generateId } from '../utils/id.ts';
import { TextMapEditor } from './TextMapEditor.ts';
import { saveMap as _saveMap, getAllMaps } from '../storage/db.ts';

/** Standard licence options shared with the audio editor. */
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
/** Friendly aspect-ratio label for a handout's textMap config. Falls
 *  back to "W:H" when the ratio isn't one of the named presets. Kept
 *  inline here rather than coupling MapAssetModal to TextMapEditor's
 *  ASPECT_PRESETS — only a handful of pairs ever come through. */
function textMapAspectLabel(w: number, h: number): string {
  if (w === 210 && h === 297) return 'A4 Portrait';
  if (w === 297 && h === 210) return 'A4 Landscape';
  if (w === 16  && h === 9)   return '16:9';
  if (w === 9   && h === 16)  return '9:16';
  if (w === 4   && h === 3)   return '4:3';
  if (w === 3   && h === 4)   return '3:4';
  if (w === 1   && h === 1)   return '1:1';
  if (w === 2   && h === 3)   return '2:3';
  if (w === 3   && h === 2)   return '3:2';
  return `${w}:${h}`;
}

export class MapAssetModal {
  private el!: HTMLElement;
  private onPick: MapPickedCallback;
  private onAssetUpdated: (assetId: string) => void;
  private maps: MapManager;
  private uploadFile: File | null = null;
  /** assetId → object URL for hover-preview thumbnails. Created lazily on
   *  first hover, revoked when the modal closes. */
  private previewUrlCache = new Map<string, string>();
  private previewPopover: HTMLElement | null = null;

  constructor(
    maps: MapManager,
    onPick: MapPickedCallback,
    onAssetUpdated: (assetId: string) => void = () => {},
  ) {
    this.maps   = maps;
    this.onPick = onPick;
    this.onAssetUpdated = onAssetUpdated;
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
    this._teardownPreviewCache();
  }

  /** Drop hover-preview object URLs and the popover element. */
  private _teardownPreviewCache(): void {
    for (const url of this.previewUrlCache.values()) URL.revokeObjectURL(url);
    this.previewUrlCache.clear();
    if (this.previewPopover) {
      this.previewPopover.remove();
      this.previewPopover = null;
    }
  }

  // ─── DOM ──────────────────────────────────────────────────────────────────

  private _buildDOM(): void {
    this.el = document.getElementById('map-asset-modal')!;
  }

  private _bindEvents(): void {
    // Close via × only — click-outside-to-dismiss intentionally disabled
    // so accidental backdrop clicks (or drag-releases outside the dialog)
    // don't trip the modal closed mid-task.
    this.el.querySelector('#map-modal-close')?.addEventListener('click', () => this.close());

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

    // Library footer — Store All / Store All Used / Delete All Unused
    this.el.querySelector('#map-library-store-all-btn')?.addEventListener('click',     () => void this._storeAllInLibrary(false));
    this.el.querySelector('#map-library-store-used-btn')?.addEventListener('click',    () => void this._storeAllInLibrary(true));
    this.el.querySelector('#map-library-delete-unused-btn')?.addEventListener('click', () => void this._deleteUnusedInLibrary());

    // Attributions button — opens the unified attributions modal (audio + map).
    // FreesoundModal owns the showAttributions logic and binds the close /
    // copy-all handlers at construction; we just trigger it via a custom event
    // so we don't have to plumb a reference through.
    this.el.querySelector('#map-library-attributions-btn')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('dmr-show-attributions'));
    });

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

    // ── Create New Handout (Stream C) ─────────────────────────────────
    // Bottom-of-library entry point. Opens the TextMapEditor; on save we
    // create a fresh StoredMap pointing at the new asset and run the
    // onPick callback so the rest of the GM behaves like it would for any
    // newly-added map.
    this.el.querySelector('#map-library-create-handout-btn')?.addEventListener(
      'click',
      () => void this._createHandout(),
    );
  }

  private async _createHandout(): Promise<void> {
    const result = await new TextMapEditor().open();
    if (!result) return;
    const map: StoredMap = {
      id:         generateId(),
      name:       result.asset.filename,
      mapAssetId: result.asset.id,
      addedAt:    Date.now(),
    };
    await _saveMap(map);
    this.onPick(map);
    this.close();
  }

  // ─── Library tab ──────────────────────────────────────────────────────────

  private async _renderLibrary(): Promise<void> {
    const listEl  = this.el.querySelector<HTMLElement>('#map-library-list')!;
    const emptyEl = this.el.querySelector<HTMLElement>('#map-library-empty')!;
    const filter  = (this.el.querySelector<HTMLInputElement>('#map-library-search')?.value ?? '').toLowerCase();

    const [all, usedIds] = await Promise.all([
      MapAssetStore.getAll(),
      getUsedMapAssetIds(),
    ]);
    const filtered = filter ? all.filter((a) => a.filename.toLowerCase().includes(filter)) : all;

    emptyEl.hidden = filtered.length > 0;
    listEl.innerHTML = '';
    for (const asset of filtered) {
      listEl.appendChild(this._libraryRow(asset, usedIds));
    }

    // Footer button visibility — same logic as the audio library.
    const storeAllBtn  = this.el.querySelector<HTMLButtonElement>('#map-library-store-all-btn');
    const storeUsedBtn = this.el.querySelector<HTMLButtonElement>('#map-library-store-used-btn');
    const deleteBtn    = this.el.querySelector<HTMLButtonElement>('#map-library-delete-unused-btn');
    const allCountEl   = this.el.querySelector<HTMLElement>('#map-library-store-all-count');
    const usedCountEl  = this.el.querySelector<HTMLElement>('#map-library-store-used-count');
    const delCountEl   = this.el.querySelector<HTMLElement>('#map-library-delete-unused-count');
    const status       = this.el.querySelector<HTMLElement>('#map-library-store-status');
    const nonStored    = all.filter((a) => !a.locallyStored && a.source === 'web-link');
    const nonStoredUsed = nonStored.filter((a) => usedIds.has(a.id));
    const unused       = all.filter((a) => !usedIds.has(a.id));
    if (storeAllBtn)  storeAllBtn.hidden  = nonStored.length === 0;
    if (storeUsedBtn) storeUsedBtn.hidden = nonStoredUsed.length === 0;
    if (deleteBtn)    deleteBtn.hidden    = unused.length === 0;
    if (allCountEl)   allCountEl.textContent  = nonStored.length      > 0 ? `(${nonStored.length})`     : '';
    if (usedCountEl)  usedCountEl.textContent = nonStoredUsed.length  > 0 ? `(${nonStoredUsed.length})` : '';
    if (delCountEl)   delCountEl.textContent  = unused.length         > 0 ? `(${unused.length})`        : '';
    if (status)       status.textContent = '';
  }

  private async _storeAllInLibrary(onlyUsed: boolean): Promise<void> {
    const status = this.el.querySelector<HTMLElement>('#map-library-store-status');
    if (!status) return;

    const [all, usedIds] = await Promise.all([
      MapAssetStore.getAll(),
      onlyUsed ? getUsedMapAssetIds() : Promise.resolve(new Set<string>()),
    ]);
    const candidates = all.filter((a) =>
      !a.locallyStored && a.source === 'web-link' && (!onlyUsed || usedIds.has(a.id))
    );
    if (candidates.length === 0) return;

    const allBtn  = this.el.querySelector<HTMLButtonElement>('#map-library-store-all-btn');
    const usedBtn = this.el.querySelector<HTMLButtonElement>('#map-library-store-used-btn');
    if (allBtn)  allBtn.disabled  = true;
    if (usedBtn) usedBtn.disabled = true;

    let ok = 0;
    let fail = 0;
    for (let i = 0; i < candidates.length; i++) {
      const asset = candidates[i]!;
      status.textContent = `Storing ${i + 1} of ${candidates.length}: ${asset.filename}…`;
      const success = await MapAssetStore.store(asset);
      if (success) ok++; else fail++;
    }

    const msg = fail === 0
      ? `Stored ${ok} map asset${ok !== 1 ? 's' : ''}.`
      : `Stored ${ok}; ${fail} failed (broken URL or CORS).`;

    await this._renderLibrary();
    if (status) status.textContent = msg;
    if (allBtn)  allBtn.disabled  = false;
    if (usedBtn) usedBtn.disabled = false;
  }

  private async _deleteUnusedInLibrary(): Promise<void> {
    const status = this.el.querySelector<HTMLElement>('#map-library-store-status');
    const [all, usedIds] = await Promise.all([
      MapAssetStore.getAll(),
      getUsedMapAssetIds(),
    ]);
    const unused = all.filter((a) => !usedIds.has(a.id));
    if (unused.length === 0) return;

    const ok = confirm(
      `Delete ${unused.length} unused map asset${unused.length === 1 ? '' : 's'}?\n\n` +
      'These aren\'t referenced by any map in this pack.\n\n' +
      'This cannot be undone.'
    );
    if (!ok) return;

    for (const asset of unused) await MapAssetStore.delete(asset.id);
    await this._renderLibrary();
    if (status) status.textContent = `Deleted ${unused.length} unused asset${unused.length === 1 ? '' : 's'}.`;
  }

  private _libraryRow(asset: MapAsset, usedIds: Set<string> = new Set()): HTMLElement {
    const isUnused = !usedIds.has(asset.id);
    const unusedChip = isUnused
      ? `<span class="sound-unused" title="Not referenced by any map — safe to delete">[!]</span>`
      : '';

    const isTextMap = asset.source === 'text-map';

    const tags: string[] = [];
    if (isTextMap)                   tags.push('<span class="sound-tag sound-tag--textmap" title="Text-based handout — not an image">Text</span>');
    if (asset.source === 'web-link') tags.push('<span class="sound-tag sound-tag--url">URL</span>');
    if (asset.locallyStored)         tags.push('<span class="sound-tag sound-tag--local">Stored</span>');
    // Scale badge — driven by scaleConfidence + noGrid, in priority order.
    // Text maps never have a scale by design, so the scale pills are skipped.
    if (!isTextMap) {
      if (asset.noGrid) {
        tags.push('<span class="sound-tag sound-tag--no-grid map-nogrid-pill" title="Marked as having no grid — click to clear and calibrate" role="button" tabindex="0">No grid</span>');
      } else if (asset.pixelsPerSquare && asset.scaleConfidence === 'auto-scaled') {
        tags.push('<span class="sound-tag sound-tag--auto-scaled map-autoscaled-pill" title="Auto-detected best-guess — click to re-calibrate" role="button" tabindex="0">AutoScaled</span>');
      } else if (asset.pixelsPerSquare) {
        tags.push('<span class="sound-tag sound-tag--scaled map-recal-pill" title="Click to re-calibrate" role="button" tabindex="0">Scaled</span>');
      }
    }
    const tagsHtml = tags.join('');

    const storeBtnHtml = (asset.locallyStored || isTextMap)
      ? ''
      : `<button class="btn btn--ghost btn--xs map-store-btn" title="Download and keep a local copy">Store</button>`;
    const downloadBtnHtml = (asset.locallyStored && !isTextMap)
      ? `<button class="btn btn--ghost btn--xs map-download-btn" title="Download this map image">⬇</button>`
      : '';
    // Text maps get an Edit button + a Copy button (use one as a
    // template); image maps get the Scale button (when not yet
    // calibrated and not opted out of grids).
    const scaleOrEditBtnHtml = isTextMap
      ? `<button class="btn btn--ghost btn--xs map-edit-textmap-btn" title="Edit this handout's body, font, and layout">Edit</button>`
      : (asset.pixelsPerSquare || asset.noGrid)
        ? ''
        : `<button class="btn btn--ghost btn--xs map-scale-btn" title="Calibrate map scale (pixels per 5' square)">Scale</button>`;
    const copyTextMapBtnHtml = isTextMap
      ? `<button class="btn btn--ghost btn--xs map-copy-textmap-btn" title="Duplicate this handout — use one as a template for new ones">Copy</button>`
      : '';

    // For handouts: show the aspect ratio rather than the rasterised
    // pixel dimensions. The pixel size is an implementation detail
    // (longSide × cfg.width/height) and changes with whatever the
    // rasteriser uses internally; the GM cares about the shape they
    // picked in the editor (16:9, A4 Portrait, etc.).
    const dimText = isTextMap && asset.textMap
      ? `${textMapAspectLabel(asset.textMap.width, asset.textMap.height)} handout`
      : asset.imageWidth && asset.imageHeight
        ? `${asset.imageWidth} × ${asset.imageHeight}`
        : asset.source;

    const licenceText = asset.license ?? 'Edit ▸';

    const row = document.createElement('div');
    row.className = 'sound-row-wrap';
    row.innerHTML = `
      <div class="sound-row">
        <div class="sound-row-info">
          <span class="sound-name">${tagsHtml}${unusedChip}${this._esc(asset.filename)}</span>
          <span class="sound-meta-row">
            <span class="sound-meta">${this._esc(dimText)} · ${this._esc(licenceText)}</span>
            <button class="sound-edit-btn" title="Edit licence + attribution">✎</button>
          </span>
        </div>
        <div class="sound-row-actions">
          ${scaleOrEditBtnHtml}
          ${copyTextMapBtnHtml}
          ${storeBtnHtml}
          ${downloadBtnHtml}
          <button class="btn btn--primary btn--xs map-use-btn">Use</button>
          <button class="btn btn--danger btn--xs map-del-btn" title="Remove from library">✕</button>
        </div>
      </div>
      <div class="sound-row-edit" hidden>
        <div class="sound-edit-row">
          <label>Calibration</label>
          <span class="map-edit-calibration-state">${asset.noGrid
            ? '<em>No grid — opted out</em>'
            : asset.pixelsPerSquare
              ? `${asset.pixelsPerSquare.toFixed(1)} px per 5&prime; square`
              : 'Not yet calibrated'}</span>
          <button class="btn btn--ghost btn--xs map-edit-calibrate">Calibrate…</button>
        </div>
        <div class="sound-edit-row">
          <label>No grid</label>
          <label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer;">
            <input type="checkbox" class="map-edit-nogrid" ${asset.noGrid ? 'checked' : ''} />
            <span style="font-size:0.9em; color:var(--text-dim);">For handouts / world maps / stat blocks — hides the calibration prompt and the auto-detector won't touch this map.</span>
          </label>
        </div>
        <div class="sound-edit-row">
          <label>Licence</label>
          <select class="map-edit-license">
            ${LICENSE_OPTIONS.map((l) => `<option value="${this._esc(l)}"${asset.license === l ? ' selected' : ''}>${this._esc(l)}</option>`).join('')}
          </select>
        </div>
        <div class="sound-edit-row">
          <label>Attribution</label>
          <input type="text" class="map-edit-attribution" placeholder='e.g. "Map: My Dungeon" by Author' value="${this._esc(asset.attribution ?? '')}" />
        </div>
        <div class="sound-edit-row">
          <label>Link</label>
          <input type="url" class="map-edit-link" placeholder="https://… (optional)" value="${this._esc(asset.attributionLink ?? asset.sourceUrl ?? '')}" />
        </div>
        <div class="sound-edit-actions">
          <button class="btn btn--primary btn--xs map-edit-save">Save</button>
          <button class="btn btn--ghost btn--xs map-edit-cancel">Cancel</button>
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

    row.querySelector<HTMLButtonElement>('.map-download-btn')?.addEventListener('click', async () => {
      const blob = await MapAssetStore.getBlob(asset);
      if (!blob) return;
      await downloadAsset(asset.filename, blob);
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

    // Hover preview — load the blob lazily on first hover, cache for the session.
    row.addEventListener('mouseenter', (e) => void this._showPreview(asset, e as MouseEvent));
    row.addEventListener('mousemove',  (e) => this._movePreview(e as MouseEvent));
    row.addEventListener('mouseleave', () => this._hidePreview());

    // Inline attribution editor.
    const editPanel = row.querySelector<HTMLElement>('.sound-row-edit');
    row.querySelector<HTMLButtonElement>('.sound-edit-btn')?.addEventListener('click', () => {
      if (editPanel) editPanel.hidden = !editPanel.hidden;
    });
    row.querySelector<HTMLButtonElement>('.map-edit-cancel')?.addEventListener('click', () => {
      if (editPanel) editPanel.hidden = true;
    });
    const openCalibration = async () => {
      const cal = new MapCalibrationModal();
      await cal.open(asset);
      await this._renderLibrary();
    };
    row.querySelector<HTMLButtonElement>('.map-scale-btn')?.addEventListener('click', openCalibration);
    row.querySelector<HTMLButtonElement>('.map-edit-calibrate')?.addEventListener('click', openCalibration);
    // Text-map Copy — duplicate the asset under a fresh id so the GM
    // can use an existing handout as a template. Deep-clones the
    // textMap payload (JSON parse/stringify is safe — TextMapConfig
    // is plain-data: strings, numbers, nested element arrays). Name
    // gets a " - copy" suffix unless it already has one.
    row.querySelector<HTMLButtonElement>('.map-copy-textmap-btn')?.addEventListener('click', async () => {
      if (!asset.textMap) return;
      const baseName = asset.filename.endsWith(' - copy')
        ? asset.filename
        : `${asset.filename} - copy`;
      const copy: MapAsset = {
        ...asset,
        id:        'textmap-' + generateId(),
        filename:  baseName,
        textMap:   JSON.parse(JSON.stringify(asset.textMap)),
        addedAt:   Date.now(),
      };
      await MapAssetStore.save(copy);
      await this._renderLibrary();
    });
    // Text-map Edit button — opens the TextMapEditor with the existing
    // asset. On save the asset record updates in place; library re-renders.
    row.querySelector<HTMLButtonElement>('.map-edit-textmap-btn')?.addEventListener('click', async () => {
      const result = await new TextMapEditor().open({ existing: asset });
      if (!result) return;
      // Editor saves with the original id — invalidate the rasterisation
      // cache so the next load picks up the edits.
      MapAssetStore.invalidateRuntimeCache(asset.id);
      // Propagate the new asset filename into every StoredMap that
      // references this handout (typically a 1:1 mapping). Without
      // this the dropdown + the Name input under it keep showing the
      // pre-edit name even after Save.
      const allMaps = await getAllMaps();
      for (const m of allMaps) {
        if (m.mapAssetId === asset.id && m.name !== result.asset.filename) {
          await _saveMap({ ...m, name: result.asset.filename });
        }
      }
      await this._renderLibrary();
      this.onAssetUpdated(asset.id);
    });
    // Click any of the scale pills to re-calibrate without opening the pen editor.
    row.querySelector<HTMLElement>('.map-recal-pill')?.addEventListener('click', (e) => { e.stopPropagation(); void openCalibration(); });
    row.querySelector<HTMLElement>('.map-autoscaled-pill')?.addEventListener('click', (e) => { e.stopPropagation(); void openCalibration(); });
    // Click the "No grid" pill to clear the opt-out and start calibration.
    row.querySelector<HTMLElement>('.map-nogrid-pill')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await MapAssetStore.update(asset.id, { noGrid: false });
      await openCalibration();
    });
    // "No grid" toggle inside the edit panel — flip immediately, re-render row.
    row.querySelector<HTMLInputElement>('.map-edit-nogrid')?.addEventListener('change', async (e) => {
      const checked = (e.currentTarget as HTMLInputElement).checked;
      await MapAssetStore.update(asset.id, { noGrid: checked });
      await this._renderLibrary();
    });

    row.querySelector<HTMLButtonElement>('.map-edit-save')?.addEventListener('click', async () => {
      const license     = row.querySelector<HTMLSelectElement>('.map-edit-license')?.value ?? asset.license;
      const attribution = row.querySelector<HTMLInputElement>('.map-edit-attribution')?.value.trim() ?? '';
      const link        = row.querySelector<HTMLInputElement>('.map-edit-link')?.value.trim() ?? '';
      const patch: Partial<MapAsset> = {};
      if (license)     patch.license         = license;
      if (attribution) patch.attribution     = attribution;
      if (link)        patch.attributionLink = link;
      await MapAssetStore.update(asset.id, patch);
      await this._renderLibrary();
    });

    return row;
  }

  // ─── Hover preview ────────────────────────────────────────────────────────

  private async _showPreview(asset: MapAsset, e: MouseEvent): Promise<void> {
    let url = this.previewUrlCache.get(asset.id);
    if (!url) {
      const blob = await MapAssetStore.getBlob(asset);
      if (!blob) return;
      url = URL.createObjectURL(blob);
      this.previewUrlCache.set(asset.id, url);
    }
    if (!this.previewPopover) {
      this.previewPopover = document.createElement('div');
      this.previewPopover.className = 'map-preview-popover';
      document.body.appendChild(this.previewPopover);
    }
    this.previewPopover.innerHTML = `<img src="${url}" alt="" />`;
    this.previewPopover.hidden = false;
    this._movePreview(e);
  }

  private _movePreview(e: MouseEvent): void {
    if (!this.previewPopover || this.previewPopover.hidden) return;
    // Position to the right of the cursor by default; flip to left near the
    // right edge so the popover doesn't go off-screen.
    const popW = this.previewPopover.offsetWidth  || 250;
    const popH = this.previewPopover.offsetHeight || 200;
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
        id:            generateId(),
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
        // Detect scale silently — no dialog in the batch flow. Without the
        // blob we only have filename + GCD signals, so this only fires for
        // confidently named files (e.g. "Stockade [32x44].png").
        const detection = await detectMapScale({
          nameHints:   [filename],
          imageWidth:  probe.width,
          imageHeight: probe.height,
        });
        const patch = autoApplyPatch(detection);
        if (patch) await MapAssetStore.update(asset.id, patch);
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
      // Auto-detect grid scale from filename + DPI + GCD. Auto-apply on high
      // confidence; prompt with the candidate dialog when ambiguous; skip
      // entirely when no signals fit (user can still calibrate manually).
      await this._runScaleDetectForUpload(map);
      this.onPick(map);
      this.close();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  /** Single-import path: detect, auto-apply, or open dialog when ambiguous. */
  private async _runScaleDetectForUpload(map: StoredMap): Promise<void> {
    const asset = await MapAssetStore.get(map.mapAssetId);
    if (!asset || !asset.imageWidth || !asset.imageHeight) return;
    const blob = await MapAssetStore.getBlob(asset);
    const detection = await detectMapScale({
      nameHints:   [asset.filename, map.name],
      imageWidth:  asset.imageWidth,
      imageHeight: asset.imageHeight,
      ...(blob ? { blob } : {}),
    });
    const patch = autoApplyPatch(detection);
    if (patch) {
      await MapAssetStore.update(asset.id, patch);
      return;
    }
    if (detection.needsConfirmation && detection.alternates.length > 0) {
      const result = await new ScaleCandidateDialog().open({ detection, mapName: map.name });
      if (result.kind === 'candidate') {
        await MapAssetStore.update(asset.id, {
          pixelsPerSquare: result.candidate.pixelsPerSquare,
          scaleConfidence: 'auto-scaled',
        });
      } else if (result.kind === 'no-grid') {
        await MapAssetStore.update(asset.id, { noGrid: true });
      }
      // 'cancel' leaves the map uncalibrated; user can use Calibrate later.
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
