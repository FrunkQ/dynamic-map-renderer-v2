import type { MapAsset, StoredMap, CompositeTile } from '../types.ts';
import { MapAssetStore } from '../maps/MapAssetStore.ts';
import { compositeHasOverlap as _compositeHasOverlap } from '../maps/compositeOverlap.ts';
import { downloadAsset } from '../utils/downloadAsset.ts';
import { MapManager } from './MapManager.ts';
import { MapCalibrationModal } from './MapCalibrationModal.ts';
import { getUsedMapAssetIds } from '../storage/assetUsage.ts';
import { detectMapScale, autoApplyPatch } from '../utils/detectMapScale.ts';
import { generateId } from '../utils/id.ts';
import { TextMapEditor } from './TextMapEditor.ts';
import { StarMapDialog } from './StarMapDialog.ts';
import { saveMap as _saveMap, saveMapAsset, getAllMaps } from '../storage/db.ts';
import { iconPencil, iconDownload, iconX } from './uiIcons.ts';

// v2.15.1 — _compositeHasOverlap moved to src/maps/compositeOverlap.ts
// so the reveal-backing rasteriser and this library pill share one
// definition (and never disagree). Imported above under the same name.

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

const ALLOWED_TYPES = new Set([
  // Still images.
  'image/png', 'image/jpeg', 'image/webp',
  // Animated maps — accepted as map assets since v2.12. Kept in lockstep
  // with MapManager.importFile's allow-list; both validators have to
  // agree or the drop-zone rejects a file the importer would have taken.
  'video/webm', 'video/mp4',
]);
const MAX_BYTES = 200 * 1024 * 1024;

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
  /** v2.14.38 — queue of files pending upload. Multi-file selection
   *  via the file input or drag-and-drop appends to the queue;
   *  Clear empties it. Names are stored separately so the user can
   *  rename before clicking Add All. */
  private uploadFiles: { file: File; name: string }[] = [];
  /** assetId → object URL for hover-preview thumbnails. Created lazily on
   *  first hover, revoked when the modal closes. */
  private previewUrlCache = new Map<string, string>();
  private previewPopover: HTMLElement | null = null;
  /** v2.14.37 — when true, the library is in "pick first tile for a
   *  new composite map" mode. Text maps are filtered out; scaled
   *  image maps are sorted to the top; the Use button on a row
   *  creates a composite-map asset + StoredMap and fires onPick with
   *  the resulting composite (rather than a single-asset map). A
   *  banner explains the state. Toggled by + Create a New Composite
   *  Map and cleared on close. */
  private _compositePickMode = false;
  /** v2.14.43 — when set, "Use" returns the picked MapAsset to this
   *  callback (no StoredMap is created) and closes the modal. Used
   *  by the Composite Map editor's "+ Add Map" flow to add another
   *  tile to an existing composite. Set via openForCompositeAddTile;
   *  cleared on resolution. */
  private _compositeAddTileCallback: ((asset: MapAsset | null) => void) | null = null;
  /** v2.14.68 — active pill filters on the library tab. Click a pill
   *  to toggle; multi-selected pills AND together. Cleared on close
   *  so reopening starts fresh. */
  private _activeFilters: Set<string> = new Set();

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

  /** v2.14.43 — open in "pick a tile to add to an existing composite"
   *  mode. The Use button on a row resolves the callback with the
   *  asset (no StoredMap created); closing without picking resolves
   *  with null. Re-uses the same filter / sort / banner UX as the
   *  first-tile pick (just with different banner copy). */
  openForCompositeAddTile(
    onPick: (asset: MapAsset | null) => void,
    opts?: { hasScaledMaster?: boolean },
  ): void {
    this._compositeAddTileCallback = onPick;
    this._compositePickMode = true;
    // v2.14.88 — preselect the 'scaled' pill so the picker opens
    // narrowed to calibrated maps (the recommended pick for a tile).
    // GM can clear the pill to widen the view to unscaled handouts /
    // decorative tiles / etc. — composite-pick mode no longer
    // hard-excludes any kind except other composites.
    // v2.17.14 — only force the scaled filter while the composite has
    // NO calibrated tile yet. Once a master grid exists, open unfiltered
    // so the GM can drop in unscaled tiles (their scale is inferred from
    // the master). The first tile still opens scaled-only.
    this._activeFilters = opts?.hasScaledMaster ? new Set() : new Set(['scaled']);
    // v2.14.46 — re-append to body so this modal lands on top of
    // the composite editor (which was appended after the asset
    // modal's initial DOM construction, so was stacking ABOVE it).
    document.body.appendChild(this.el);
    this.el.hidden = false;
    // Force library tab — picker doesn't make sense from any other.
    const libBtn = this.el.querySelector<HTMLButtonElement>('[data-tab="library"]');
    libBtn?.click();
    void this._renderLibrary();
  }

  close(): void {
    this.el.hidden = true;
    this._clearUpload();
    this._clearWebLinks();
    this._teardownPreviewCache();
    // v2.14.43 — if the modal closes mid-add-tile (X / Esc / backdrop
    // click later), resolve the pending callback with null so the
    // caller isn't left hanging.
    if (this._compositeAddTileCallback) {
      this._compositeAddTileCallback(null);
      this._compositeAddTileCallback = null;
    }
    this._compositePickMode = false;
    // v2.14.68 — drop any active pill filters so re-opening the modal
    // starts with the full library visible.
    this._activeFilters.clear();
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

    // v2.14.112 — Belt-and-braces hover-preview cleanup. A fast cursor
    // swipe across the modal sometimes outpaces the per-row mouseleave,
    // and tab-switches / blurs / context menus eat the leave event
    // entirely. Hide the popover whenever focus or pointer leaves the
    // modal scope so the preview never lingers as visual residue.
    this.el.addEventListener('mouseleave', () => this._hidePreview());
    this.el.addEventListener('focusout',   () => this._hidePreview());
    window.addEventListener('blur',        () => this._hidePreview());

    // Tab switching
    this.el.querySelectorAll('.modal-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        this.el.querySelectorAll('.modal-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        const name = (tab as HTMLElement).dataset['mapTab']!;
        this.el.querySelectorAll<HTMLElement>('.tab-content').forEach((c) => {
          c.hidden = c.id !== `map-tab-${name}`;
        });
        // _renderLibrary will hide the preview; non-library tabs need
        // an explicit hide because rows aren't rebuilt on those.
        this._hidePreview();
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
      const files = (e as DragEvent).dataTransfer?.files;
      if (files && files.length > 0) this._handleUploadFiles(files);
    });
    fileInput.addEventListener('change', () => {
      const files = fileInput.files;
      if (files && files.length > 0) this._handleUploadFiles(files);
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

    // v2.14.37 — Map Compositor entry point. Click → re-render the
    // library in "pick first tile" mode; the next Use creates the
    // composite map.
    this.el.querySelector('#map-library-create-composite-btn')?.addEventListener(
      'click',
      () => void this._enterCompositePickMode(),
    );

    // v2.18 — StarMap entry point: discover the running Star System Explorer
    // session and mint one StarMap map per chosen Player View.
    this.el.querySelector('#map-library-create-starmap-btn')?.addEventListener(
      'click',
      () => void this._createStarMaps(),
    );
  }

  /** v2.18 — Add StarMap flow (docs/starmap-map-kind-design.md 4.2). One
   *  MapAsset {source:'starmap'} + one StoredMap per ticked Player View,
   *  named "<starmap> — <preset>"; the first is picked into the GM. */
  private async _createStarMaps(): Promise<void> {
    const result = await new StarMapDialog().open();
    if (!result || result.presets.length === 0) return;
    const { origin, announce } = result;
    let first: StoredMap | null = null;
    for (const p of result.presets) {
      const assetId = generateId();
      const asset: MapAsset = {
        id:            assetId,
        filename:      `${announce.starmapName || 'StarMap'} — ${p.name}`,
        source:        'starmap',
        locallyStored: true,
        addedAt:       Date.now(),
        starMap: {
          origin,
          sessionId:   announce.sessionId,
          starmapId:   announce.starmapId,
          starmapName: announce.starmapName,
          presetId:    p.id,
          presetName:  p.name,
        },
      };
      await saveMapAsset(asset);
      const map: StoredMap = { id: generateId(), name: asset.filename, mapAssetId: assetId, addedAt: Date.now() };
      await _saveMap(map);
      first ??= map;
    }
    if (first) { this.onPick(first); this.close(); }
  }

  /** v2.14.37 — flip the library into pick-first-tile mode for a new
   *  composite map. No data writes yet — the user's next Use click
   *  drives `_createCompositeFromTile`. */
  private async _enterCompositePickMode(): Promise<void> {
    this._compositePickMode = true;
    // v2.14.88 — preselect the 'scaled' pill (see openForCompositeAddTile).
    this._activeFilters = new Set(['scaled']);
    // Make sure we're on the Library tab — even if the user clicked
    // from a different tab (e.g. Web Links) the picker only makes
    // sense from the library list.
    const libBtn = this.el.querySelector<HTMLButtonElement>('[data-tab="library"]');
    libBtn?.click();
    await this._renderLibrary();
  }

  /** v2.14.37 — render (or remove) the composite-pick banner above
   *  the library list. Banner explains the mode + nudges towards
   *  scaled tiles + offers a Cancel that drops back to normal mode. */
  private _renderCompositeBanner(): void {
    const host = this.el.querySelector<HTMLElement>('#map-library-list')?.parentElement;
    if (!host) return;
    let banner = host.querySelector<HTMLElement>('.composite-pick-banner');
    if (!this._compositePickMode) {
      banner?.remove();
      return;
    }
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'composite-pick-banner';
      // v2.14.43 — banner copy differs depending on whether we're
      // picking the FIRST tile (new composite) or adding ANOTHER
      // tile to an existing composite. Same flow either way.
      const isAddingToExisting = this._compositeAddTileCallback !== null;
      const headline = isAddingToExisting
        ? 'Pick a tile to add to this composite map.'
        : 'Pick the first tile for your composite map.';
      const sub = isAddingToExisting
        ? 'Scaled maps align to the master grid; unscaled tiles place freely. Upload new maps if you don\'t see what you need.'
        : 'Scaled maps are recommended — they set the master grid for the composite. Upload new maps if you don\'t see what you need.';
      banner.innerHTML = `
        <div class="composite-pick-banner__text">
          <strong>${headline}</strong>
          <span>${sub}</span>
        </div>
        <button class="btn btn--ghost btn--xs composite-pick-banner__cancel" type="button" title="Cancel and return to the normal library view.">Cancel</button>
      `;
      banner.querySelector<HTMLButtonElement>('.composite-pick-banner__cancel')?.addEventListener('click', () => {
        this._compositePickMode = false;
        void this._renderLibrary();
      });
      host.insertBefore(banner, host.firstChild);
    }
  }

  /** v2.14.37 — create a new composite map with one tile centred on
   *  the canvas. Composite asset + StoredMap + initial tile array
   *  saved in one shot; onPick fires with the new StoredMap. */
  private async _createCompositeFromTile(firstTileAsset: MapAsset): Promise<void> {
    const compositeAssetId = generateId();
    const tile: CompositeTile = {
      id:         generateId(),
      mapAssetId: firstTileAsset.id,
      x:          0.5,
      y:          0.5,
      rotation:   0,
      // 25% scale per Alex's spec — leaves room around the edges for
      // more tiles to be dropped in.
      scale:      0.25,
    };
    const compositeAsset: MapAsset = {
      id:             compositeAssetId,
      filename:       `${firstTileAsset.filename} (Composite)`,
      source:         'composite-map',
      locallyStored:  true,
      addedAt:        Date.now(),
      compositeTiles: [tile],
      compositeMode:  'modular',
    };
    await saveMapAsset(compositeAsset);
    const map: StoredMap = {
      id:         generateId(),
      name:       compositeAsset.filename,
      mapAssetId: compositeAssetId,
      addedAt:    Date.now(),
    };
    await _saveMap(map);
    this._compositePickMode = false;
    this.onPick(map);
    this.close();
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
    // v2.14.112 — Clear any stale hover preview before tearing down
    // the row DOM. Rows about to be removed never get their mouseleave
    // event, so without this the popover lingers after a tab switch,
    // filter change, delete, or rename.
    this._hidePreview();
    const listEl  = this.el.querySelector<HTMLElement>('#map-library-list')!;
    const emptyEl = this.el.querySelector<HTMLElement>('#map-library-empty')!;
    const filter  = (this.el.querySelector<HTMLInputElement>('#map-library-search')?.value ?? '').toLowerCase();

    const [all, usedIds] = await Promise.all([
      MapAssetStore.getAll(),
      getUsedMapAssetIds(),
    ]);
    let filtered = filter ? all.filter((a) => a.filename.toLowerCase().includes(filter)) : all;

    // v2.14.88 — composite-pick mode: only block nesting (drop
    // composite-map). Text-maps are allowed; creative GMs can layer
    // a labelled handout sheet on top of a battlemap or whatever.
    // Scaled maps sort to the top regardless of pill state so the
    // recommended-pick is still the easy default.
    if (this._compositePickMode) {
      filtered = filtered.filter((a) => a.source !== 'composite-map');
      filtered = [...filtered].sort((a, b) => {
        const aScaled = a.pixelsPerSquare ? 1 : 0;
        const bScaled = b.pixelsPerSquare ? 1 : 0;
        if (aScaled !== bScaled) return bScaled - aScaled;
        return a.filename.localeCompare(b.filename);
      });
    }

    // Banner showing the active mode — only when pick-first-tile is on.
    this._renderCompositeBanner();

    // v2.14.67 — pass an asset-by-id map so composite rows can detect
    // tile overlap (drives the Layered pill) without a fresh DB hit.
    const assetById = new Map(all.map((a) => [a.id, a] as const));

    // v2.14.68 — pill filters. Render the filter row first (built from
    // the kinds actually present in the unfiltered set), then narrow
    // `filtered` by the active filter set. Multi-select ANDs.
    this._renderFilterPills(all, assetById);
    if (this._activeFilters.size > 0) {
      filtered = filtered.filter((a) => this._matchesActiveFilters(a, assetById, usedIds));
    }

    emptyEl.hidden = filtered.length > 0;
    listEl.innerHTML = '';
    for (const asset of filtered) {
      listEl.appendChild(this._libraryRow(asset, usedIds, assetById));
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

  /** v2.14.68 — render the clickable filter-pill row above the list.
   *  Only emits a pill for kinds actually present in the library so
   *  the row doesn't visually noise up empty / single-kind libraries.
   *  Active pills are highlighted; click toggles + triggers re-render. */
  private _renderFilterPills(
    all: MapAsset[],
    assetById: Map<string, MapAsset>,
  ): void {
    const host = this.el.querySelector<HTMLElement>('#map-library-filter-pills');
    if (!host) return;

    // Each entry: { key, label, tagClass, present? }. `present` returns
    // true if at least one asset matches → only then is the pill
    // rendered (avoids "filter by Layered" when no composite is
    // layered).
    const filters: Array<{
      key:     string;
      label:   string;
      cls:     string;
      title:   string;
      present: () => boolean;
    }> = [
      { key: 'composite', label: 'Composite', cls: 'sound-tag--composite',
        title: 'Show only composite maps.',
        present: () => all.some((a) => a.source === 'composite-map') },
      { key: 'layered',   label: 'Layered',   cls: 'sound-tag--layered',
        title: 'Show only composites with overlapping tiles.',
        present: () => all.some((a) => a.source === 'composite-map' && _compositeHasOverlap(a, assetById)) },
      { key: 'text',      label: 'Text',      cls: 'sound-tag--textmap',
        title: 'Show only handout / text maps.',
        present: () => all.some((a) => a.source === 'text-map') },
      { key: 'animated',  label: 'Animated',  cls: 'sound-tag--animated',
        title: 'Show only animated (video) maps.',
        present: () => all.some((a) => (a.blob?.type ?? '').startsWith('video/')) },
      { key: 'url',       label: 'URL',       cls: 'sound-tag--url',
        title: 'Show only web-link maps.',
        present: () => all.some((a) => a.source === 'web-link') },
      { key: 'stored',    label: 'Stored',    cls: 'sound-tag--local',
        title: 'Show only assets whose bytes are saved locally.',
        present: () => all.some((a) => a.locallyStored) },
      { key: 'unused',    label: 'Unused',    cls: 'sound-tag--unused',
        title: 'Show only assets not referenced by any map.',
        present: () => true },  // always meaningful as a filter
      { key: 'scaled',    label: 'Scaled',    cls: 'sound-tag--scaled',
        title: 'Show only calibrated maps (any scale confidence).',
        present: () => all.some((a) => !!a.pixelsPerSquare) },
      { key: 'no-grid',   label: 'No grid',   cls: 'sound-tag--no-grid',
        title: 'Show only assets marked as having no grid.',
        present: () => all.some((a) => !!a.noGrid) },
    ];

    const visible = filters.filter((f) => f.present());
    if (visible.length === 0) {
      host.innerHTML = '';
      return;
    }

    host.innerHTML = visible.map((f) => {
      const active = this._activeFilters.has(f.key);
      return `<button type="button" class="library-filter-pill sound-tag ${f.cls}${active ? ' is-active' : ''}" data-filter="${f.key}" title="${f.title}">${f.label}</button>`;
    }).join('') + (this._activeFilters.size > 0
      ? `<button type="button" class="library-filter-clear" data-filter="__clear" title="Clear all filters.">Clear filters</button>`
      : '');

    host.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset['filter']!;
        if (key === '__clear') {
          this._activeFilters.clear();
        } else if (this._activeFilters.has(key)) {
          this._activeFilters.delete(key);
        } else {
          this._activeFilters.add(key);
        }
        void this._renderLibrary();
      });
    });
  }

  /** v2.14.68 — apply the active filter set. Each filter has a
   *  predicate; the asset must match ALL active predicates to survive
   *  (logical AND). Predicates here mirror the row's pill logic so the
   *  filter feels consistent with what's visible. */
  private _matchesActiveFilters(
    asset:     MapAsset,
    assetById: Map<string, MapAsset>,
    usedIds:   Set<string>,
  ): boolean {
    for (const key of this._activeFilters) {
      switch (key) {
        case 'composite': if (asset.source !== 'composite-map') return false; break;
        case 'layered':   if (!(asset.source === 'composite-map' && _compositeHasOverlap(asset, assetById))) return false; break;
        case 'text':      if (asset.source !== 'text-map') return false; break;
        case 'animated':  if (!(asset.blob?.type ?? '').startsWith('video/')) return false; break;
        case 'url':       if (asset.source !== 'web-link') return false; break;
        case 'stored':    if (!asset.locallyStored) return false; break;
        case 'unused':    if (usedIds.has(asset.id)) return false; break;
        case 'scaled':    if (!asset.pixelsPerSquare) return false; break;
        case 'no-grid':   if (!asset.noGrid) return false; break;
      }
    }
    return true;
  }

  private _libraryRow(
    asset: MapAsset,
    usedIds: Set<string> = new Set(),
    assetById: Map<string, MapAsset> = new Map(),
  ): HTMLElement {
    const isUnused = !usedIds.has(asset.id);

    const isTextMap = asset.source === 'text-map';
    // v2.12 — animated maps (webm / mp4) ride the same MapAsset shape
    // as still images; the blob's MIME tells them apart. Falls back
    // to false for web-link assets that haven't been stored yet (no
    // blob to inspect) — they'll re-evaluate after Store.
    const isAnimated = (asset.blob?.type ?? '').startsWith('video/');

    const tags: string[] = [];
    // Every tag carries an explanatory title — the GM picks up what
    // each pill MEANS by hovering instead of reading docs. Same
    // wording principle: explain the consequence, not the
    // implementation. (e.g. Stored → "travels with your save file"
    // rather than "locallyStored=true".)
    if (isUnused)                    tags.push('<span class="sound-tag sound-tag--unused" title="No map currently uses this asset — safe to delete without breaking anything.">Unused</span>');
    if (isAnimated)                  tags.push('<span class="sound-tag sound-tag--animated" title="A video map (webm or mp4). Plays looped on the GM canvas; fog, markers, and magic-wand fill all work against the currently visible frame.">Animated</span>');
    if (isTextMap)                   tags.push('<span class="sound-tag sound-tag--textmap" title="A text-based handout, not an image. Edit its body, font and layout via the Edit button.">Text</span>');
    // v2.14.50 — Composite pill in the same purple "type" colour as
    // Text. Marks the asset as not-a-plain-image; the rest of the
    // library inherits the default Image-style chrome.
    if (asset.source === 'composite-map') tags.push('<span class="sound-tag sound-tag--composite" title="A composite map — multiple map tiles arranged in modular or layered mode. Edit via the Edit this Composite Map button on the active map.">Composite</span>');
    // v2.14.67 — Layered pill flags composites whose tiles overlap.
    // Signals to the GM that this composite supports per-tile
    // reveal-below semantics with the Make Transparent MapFX kind
    // (once the renderer-side wiring lands).
    if (asset.source === 'composite-map' && _compositeHasOverlap(asset, assetById)) {
      tags.push('<span class="sound-tag sound-tag--layered" title="This composite has overlapping tiles. The Make Transparent MapFX kind reveals the tile directly underneath wherever you paint, rather than the backdrop.">Layered</span>');
    }
    if (asset.source === 'web-link') tags.push('<span class="sound-tag sound-tag--url" title="Fetched from a web URL on demand. The image bytes live remotely; click Store to keep a local copy.">URL</span>');
    if (asset.locallyStored)         tags.push('<span class="sound-tag sound-tag--local" title="The image bytes are saved locally in your browser\'s database. Travels with bundle exports (.mappadux save files) so other GMs / other devices get the actual asset, not just a link.">Stored</span>');
    // Scale badge — driven by scaleConfidence + noGrid, in priority order.
    // v2.14.36 — textmaps don't carry the noGrid opt-out (it's
    // legacy from when textmaps couldn't be scaled at all); they
    // always offer the Scale button when not yet calibrated, same
    // as image maps. Image-map noGrid behaviour unchanged.
    if (asset.noGrid && !isTextMap) {
      tags.push('<span class="sound-tag sound-tag--no-grid map-nogrid-pill" title="You\'ve marked this asset as having no grid (a handout, world map, or stat block). The projector won\'t scale it to 1″ squares. Click the pill to clear this and calibrate properly." role="button" tabindex="0">No grid</span>');
    } else if (asset.pixelsPerSquare && asset.scaleConfidence === 'inferred') {
      // v2.14.41 — reads as "Scaled" in the same orange family as
      // AutoScaled (rather than the cyan from v2.14.40). It is a
      // scaled map; the colour difference is the only signal the
      // scale was inferred from the filename rather than fully
      // confirmed. Tooltip explains.
      tags.push('<span class="sound-tag sound-tag--inferred map-recal-pill" title="Scaled — pixels-per-square inferred from a filename grid hint (e.g. [40x40]) where the image dimensions didn\'t divide cleanly. The value has been rounded. Click to verify or recalibrate by hand." role="button" tabindex="0">Scaled</span>');
    } else if (asset.pixelsPerSquare && asset.scaleConfidence === 'auto-scaled') {
      tags.push('<span class="sound-tag sound-tag--auto-scaled map-autoscaled-pill" title="The auto-detector took a best guess at the grid scale — but wasn\'t fully confident. Click the pill to verify or recalibrate by hand." role="button" tabindex="0">AutoScaled</span>');
    } else if (asset.pixelsPerSquare) {
      tags.push('<span class="sound-tag sound-tag--scaled map-recal-pill" title="The map is calibrated to physical 1″/25 mm squares for true-scale projection. Click to recalibrate if the projection looks off." role="button" tabindex="0">Scaled</span>');
    }
    const tagsHtml = tags.join('');

    const storeBtnHtml = (asset.locallyStored || isTextMap)
      ? ''
      : `<button class="btn btn--ghost btn--xs map-store-btn" title="Download the image bytes and keep a local copy. After storing, this asset travels with your bundle (.mappadux) exports so other GMs or other devices get the actual map, not just a broken link.">Store</button>`;
    const downloadBtnHtml = (asset.locallyStored && !isTextMap)
      ? `<button class="btn btn--ghost btn--xs map-download-btn ui-icon-btn" title="Save this map image to your downloads folder — useful for archiving outside Mappadux or sharing the raw file.">${iconDownload()}</button>`
      : '';
    // v2.14.35 — Text maps get an Edit + Copy. Both text and image
    // maps get a Scale button when not yet calibrated AND not opted
    // out of grids; once calibrated, click the Scaled pill above to
    // recalibrate (no top-level button needed).
    const editTextMapBtnHtml = isTextMap
      ? `<button class="btn btn--ghost btn--xs map-edit-textmap-btn" title="Open the handout editor — edit the body text, fonts, layout, banner image, and reveal animation.">Edit</button>`
      : '';
    // v2.14.36 — noGrid disables the Scale button for image maps
    // (the GM has explicitly opted out). Textmaps ignore noGrid here
    // so they always offer Scale until calibrated.
    const scaleBtnHtml = (asset.pixelsPerSquare || (asset.noGrid && !isTextMap))
      ? ''
      : `<button class="btn btn--ghost btn--xs map-scale-btn" title="Calibrate this map to physical 1″/25 mm squares so the projector can render it at true table scale. Optional for handouts and world maps.">Scale</button>`;
    const copyTextMapBtnHtml = isTextMap
      ? `<button class="btn btn--ghost btn--xs map-copy-textmap-btn" title="Duplicate this handout with a fresh id. Lets you use a polished handout as a template for the next one without overwriting it.">Copy</button>`
      : '';

    // For handouts: show the aspect ratio rather than the rasterised
    // pixel dimensions. The pixel size is an implementation detail
    // (longSide × cfg.width/height) and changes with whatever the
    // rasteriser uses internally; the GM cares about the shape they
    // picked in the editor (16:9, A4 Portrait, etc.).
    // v2.14.50 — when the asset has a grid count (gridSquares.h × .v),
    // append "· 40 × 30 grid" to the pixel dims so the library row
    // reads dimensions AND the grid all at once.
    const baseDimText = isTextMap && asset.textMap
      ? `${textMapAspectLabel(asset.textMap.width, asset.textMap.height)} handout`
      : asset.imageWidth && asset.imageHeight
        ? `${asset.imageWidth} × ${asset.imageHeight}`
        : asset.source;
    const gridSuffix = asset.gridSquares
      ? ` · ${asset.gridSquares.h} × ${asset.gridSquares.v} grid`
      : '';
    const dimText = `${baseDimText}${gridSuffix}`;

    const licenceText = asset.license ?? 'Edit ▸';

    const row = document.createElement('div');
    row.className = 'sound-row-wrap';
    row.innerHTML = `
      <div class="sound-row">
        <div class="sound-row-info">
          <span class="sound-name">${this._esc(asset.filename)}</span>
          ${tagsHtml ? `<span class="sound-tags-row">${tagsHtml}</span>` : ''}
          <span class="sound-meta-row">
            <span class="sound-meta">${this._esc(dimText)} · ${this._esc(licenceText)}</span>
            <button class="sound-edit-btn ui-icon-btn" title="Edit licence + attribution">${iconPencil()}</button>
          </span>
        </div>
        <div class="sound-row-actions">
          ${editTextMapBtnHtml}
          ${copyTextMapBtnHtml}
          ${scaleBtnHtml}
          ${storeBtnHtml}
          ${downloadBtnHtml}
          <button class="btn btn--primary btn--xs map-use-btn" title="Add a new map instance backed by this asset to your map list. The asset stays in the library — you can reuse it for multiple maps (e.g. the same dungeon image for two different encounters with their own fog and markers).">Use</button>
          <button class="btn btn--danger btn--xs map-del-btn ui-icon-btn" title="Remove the asset from your library. Any maps still using it will become &quot;missing&quot; until you Fix Missing Map.">${iconX()}</button>
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
      // v2.14.43 — add-tile callback wins over first-tile creation
      // when both are conceptually set. (compositePickMode is true
      // for either; the callback is set only for "add tile to
      // existing composite".)
      if (this._compositeAddTileCallback) {
        const cb = this._compositeAddTileCallback;
        this._compositeAddTileCallback = null;
        this._compositePickMode = false;
        this.el.hidden = true;
        this._teardownPreviewCache();
        cb(asset);
        return;
      }
      // v2.14.37 — composite-pick mode short-circuits Use into
      // "use this as the first tile of a new composite map".
      if (this._compositePickMode) {
        await this._createCompositeFromTile(asset);
        return;
      }
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

  /** v2.14.38 — accept one or more files, append to queue, show
   *  the file-info section with a per-file row + bulk attribution. */
  private _handleUploadFiles(filesArg: FileList | File[]): void {
    const files = Array.from(filesArg);
    for (const file of files) {
      if (!ALLOWED_TYPES.has(file.type)) {
        alert(`Unsupported file type: ${file.type}. Use PNG, JPG, WebP, WebM, or MP4.`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        alert(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 50 MB.`);
        continue;
      }
      this.uploadFiles.push({
        file,
        name: file.name.replace(/\.[^.]+$/, ''),
      });
    }
    if (this.uploadFiles.length === 0) return;
    // Populate the bulk-attribution licence dropdown once on first show.
    const licenseSel = this.el.querySelector<HTMLSelectElement>('#map-upload-bulk-license');
    if (licenseSel && licenseSel.options.length === 0) {
      licenseSel.innerHTML = '<option value="">— No licence picked —</option>' +
        LICENSE_OPTIONS.map((l) => `<option value="${l}">${l}</option>`).join('');
    }
    this.el.querySelector<HTMLElement>('#map-upload-drop-zone')!.hidden = true;
    this.el.querySelector<HTMLElement>('#map-upload-file-info')!.hidden = false;
    this._renderUploadQueue();
  }

  /** Re-render the queue list — one row per pending file with name
   *  input + remove button. Re-binding handlers each render is cheap
   *  at the file counts we expect (a tile-set is rarely > 20). */
  private _renderUploadQueue(): void {
    const queue = this.el.querySelector<HTMLElement>('#map-upload-queue');
    if (!queue) return;
    queue.innerHTML = '';
    this.uploadFiles.forEach((entry, idx) => {
      const row = document.createElement('div');
      row.className = 'map-upload-queue-row';
      row.innerHTML = `
        <input type="text" class="map-upload-queue-name" placeholder="Map name…" />
        <span class="map-upload-queue-filename"></span>
        <button type="button" class="btn btn--ghost btn--xs map-upload-queue-remove ui-icon-btn" title="Remove this file from the queue.">${iconX()}</button>
      `;
      const nameInput = row.querySelector<HTMLInputElement>('.map-upload-queue-name')!;
      nameInput.value = entry.name;
      nameInput.addEventListener('input', () => {
        const e = this.uploadFiles[idx];
        if (e) e.name = nameInput.value;
      });
      const fnSpan = row.querySelector<HTMLElement>('.map-upload-queue-filename')!;
      fnSpan.textContent = entry.file.name;
      fnSpan.title = `${entry.file.name} · ${(entry.file.size / 1024 / 1024).toFixed(1)} MB`;
      row.querySelector<HTMLButtonElement>('.map-upload-queue-remove')?.addEventListener('click', () => {
        this.uploadFiles.splice(idx, 1);
        if (this.uploadFiles.length === 0) {
          this._clearUpload();
        } else {
          this._renderUploadQueue();
        }
      });
      queue.appendChild(row);
    });
  }

  private _clearUpload(): void {
    this.uploadFiles = [];
    const fileInput = this.el.querySelector<HTMLInputElement>('#map-upload-file-input');
    if (fileInput) fileInput.value = '';
    const dropZone = this.el.querySelector<HTMLElement>('#map-upload-drop-zone');
    const fileInfo = this.el.querySelector<HTMLElement>('#map-upload-file-info');
    if (dropZone) dropZone.hidden = false;
    if (fileInfo) fileInfo.hidden  = true;
    // Clear bulk attribution inputs too — fresh slate on next batch.
    const sel  = this.el.querySelector<HTMLSelectElement>('#map-upload-bulk-license');
    const attr = this.el.querySelector<HTMLInputElement>('#map-upload-bulk-attribution');
    const link = this.el.querySelector<HTMLInputElement>('#map-upload-bulk-link');
    if (sel)  sel.value  = '';
    if (attr) attr.value = '';
    if (link) link.value = '';
    const queue = this.el.querySelector<HTMLElement>('#map-upload-queue');
    if (queue) queue.innerHTML = '';
  }

  private async _addUpload(): Promise<void> {
    if (this.uploadFiles.length === 0) return;
    const addBtn = this.el.querySelector<HTMLButtonElement>('#map-upload-add-btn');
    if (addBtn) { addBtn.disabled = true; addBtn.textContent = `Adding 0 / ${this.uploadFiles.length}…`; }

    // Pull bulk attribution once — applied to every file in the batch.
    const bulkLicense     = this.el.querySelector<HTMLSelectElement>('#map-upload-bulk-license')?.value.trim()     ?? '';
    const bulkAttribution = this.el.querySelector<HTMLInputElement>('#map-upload-bulk-attribution')?.value.trim() ?? '';
    const bulkLink        = this.el.querySelector<HTMLInputElement>('#map-upload-bulk-link')?.value.trim()        ?? '';

    let added = 0;
    const total = this.uploadFiles.length;
    const queue = [...this.uploadFiles];
    for (const entry of queue) {
      try {
        // v2.14.40 — Upload tab is a "load content INTO the library"
        // flow, NOT a "create a map instance" flow (My Library does
        // that via the Use button). importFile creates both an asset
        // AND a StoredMap; delete the StoredMap right after so we
        // keep just the library entry. Web Links already worked this
        // way; this brings Upload into line.
        const map = await this.maps.importFile(entry.file);
        const assetId  = map.mapAssetId;
        const assetName = (entry.name || map.name).trim();
        // Rename the ASSET (not the map — we're about to delete it).
        if (assetName) {
          await MapAssetStore.update(assetId, { filename: assetName });
        }
        // Bulk attribution — same source as the asset's filename.
        if (bulkLicense || bulkAttribution || bulkLink) {
          const patch: Partial<MapAsset> = {};
          if (bulkLicense)     patch.license         = bulkLicense;
          if (bulkAttribution) patch.attribution     = bulkAttribution;
          if (bulkLink)        patch.attributionLink = bulkLink;
          await MapAssetStore.update(assetId, patch);
        }
        // Silent scale-detect (no dialog) — consistent UX whether
        // uploading 1 or 50 files. Uncertain detections leave the
        // asset uncalibrated; user calibrates by hand via the
        // library's Scale button if needed.
        await this._runScaleDetectForAsset(assetId);
        // Drop the auto-created StoredMap. Library entry stays.
        await this.maps.delete(map.id);
        added++;
        if (addBtn) addBtn.textContent = `Adding ${added} / ${total}…`;
      } catch (err) {
        alert(`${entry.file.name}: ${(err as Error).message}`);
      }
    }
    if (addBtn) { addBtn.disabled = false; addBtn.textContent = 'Add All to Library'; }
    // Clear the queue + return user to the Library tab so they can
    // pick which of the newly-added assets to USE.
    this._clearUpload();
    if (added > 0) {
      const libBtn = this.el.querySelector<HTMLButtonElement>('[data-tab="library"]');
      libBtn?.click();
      await this._renderLibrary();
    }
  }

  /** v2.14.40 — silent scale-detect that operates on an asset id
   *  directly (no StoredMap round-trip). Library uploads use this. */
  private async _runScaleDetectForAsset(assetId: string): Promise<void> {
    const asset = await MapAssetStore.get(assetId);
    if (!asset || !asset.imageWidth || !asset.imageHeight) return;
    const blob = await MapAssetStore.getBlob(asset);
    const detection = await detectMapScale({
      nameHints:   [asset.filename],
      imageWidth:  asset.imageWidth,
      imageHeight: asset.imageHeight,
      ...(blob ? { blob } : {}),
    });
    const patch = autoApplyPatch(detection);
    if (patch) {
      await MapAssetStore.update(assetId, patch);
    }
  }

  // v2.14.40 — single-file dialog-aware upload path removed.
  // The Upload tab is a consistent "load INTO library" flow now:
  // silent detect for every file regardless of count, the user
  // picks which to USE from the library afterwards. (Implementation
  // preserved in git history if a dialog-aware import returns.)

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
