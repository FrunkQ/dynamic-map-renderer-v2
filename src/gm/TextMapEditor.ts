import type { MapAsset, TextMapConfig, TextMapElement, TextMapTextElement, TextMapAnimation } from '../types.ts';
import { transitionRegistry } from '../transitions/TransitionRegistry.ts';
import { SYSTEM_CATEGORY_IDS } from '../types.ts';
import { MapAssetStore } from '../maps/MapAssetStore.ts';
import { predictTextMapPixelDimensions } from '../maps/rasterizeTextMap.ts';
import {
  ensureTextMapElements,
  newTextElement,
  newImageElement,
  clampElementGeometry,
} from '../maps/textMapElements.ts';
import { ImageAssetStore } from '../images/ImageAssetStore.ts';
import { ImageAssetModal } from '../images/ImageAssetModal.ts';
import { ensureFontsLoaded, registerLocalFontsFromAssets } from '../images/fontCatalog.ts';
import { generateId } from '../utils/id.ts';
import { sanitizeSplashHtml } from '../utils/sanitizeHtml.ts';
import { renderAssetToInlineHtml } from '../utils/resolveAssetImages.ts';

/**
 * TextMapEditor — element-canvas handout editor (v2.11 Stream C, M4).
 *
 * Each handout is a page with free-positioned text and image elements,
 * edited directly on the parchment rather than via a side-panel rich-
 * text field. Text content is contenteditable in-place; geometry (x, y,
 * w, h) lives in % of the page so the same layout rasterises crisply at
 * any resolution.
 *
 * Mental model:
 *   - The dialog opens at 96vw x 94vh.
 *   - A toolbar across the top carries page-level controls + add buttons.
 *   - The page below sizes to fit the available canvas area and keeps
 *     the chosen aspect ratio.
 *   - Each element is an absolutely-positioned div inside the page. A
 *     thin drag-bar at the top and a resize-handle at the bottom-right
 *     are visible when the element is selected; everything else stays
 *     out of the way of normal contenteditable typing.
 *
 * Round-trips with the legacy single-bodyHtml model via
 * ensureTextMapElements() — older saves open as a single full-page
 * text element.
 */

export interface TextMapEditorResult {
  asset: MapAsset;
}

const ASPECT_PRESETS: ReadonlyArray<{ label: string; w: number; h: number }> = [
  { label: '16 : 9 Landscape',         w: 16,  h: 9   },
  { label: 'A4 Portrait (1 : √2)',     w: 210, h: 297 },
  { label: 'A4 Landscape (√2 : 1)',    w: 297, h: 210 },
  { label: '4 : 3 Landscape',          w: 4,   h: 3   },
  { label: 'Square (1 : 1)',           w: 1,   h: 1   },
  { label: '2 : 3 Tall',               w: 2,   h: 3   },
];

const DEFAULT_CONFIG: TextMapConfig = {
  width:           16,
  height:          9,
  fontFamily:      'Cinzel',
  fontScale:       1,
  backgroundColor: '#f4e9c8',
  textColor:       '#1a1a1a',
  elements:        [],
};

const FALLBACK_FONTS: ReadonlyArray<string> = ['Cinzel', 'Georgia', 'Times New Roman'];

// Inline Lucide-style SVGs used for the clipboard + edit icon buttons.
// Stroked monochrome, currentColor, 14px viewport — matches the rest of
// the app's flat-icon aesthetic.
const SVG_EDIT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" '
  + 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M12 20h9"/>'
  + '<path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
const SVG_SCISSORS =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" '
  + 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
  + '<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/>'
  + '<circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/></svg>';
const SVG_COPY =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" '
  + 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
  + '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>'
  + '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
const SVG_CLIPBOARD =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" '
  + 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
  + '<rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>'
  + '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>';

type DragMode = 'move' | 'resize';

interface DragState {
  elementId: string;
  mode:      DragMode;
  startClientX: number;
  startClientY: number;
  startGeom:    { x: number; y: number; w: number; h: number };
  pageWidthPx:  number;
  pageHeightPx: number;
  capture:      HTMLElement;
  pointerId:    number;
  onMove:       (ev: PointerEvent) => void;
  onUp:         (ev: PointerEvent) => void;
}

export class TextMapEditor {
  private overlay:  HTMLElement | null = null;
  private resolver: ((value: TextMapEditorResult | null) => void) | null = null;
  private cfg:      TextMapConfig = { ...DEFAULT_CONFIG };
  private elements: TextMapElement[] = [];
  private name:     string = 'New Handout';
  private existingAssetId: string | null = null;
  private existingAddedAt: number | null = null;

  private pageEl:        HTMLElement | null = null;
  private elementToolbarEl: HTMLElement | null = null;
  private elementSectionEl: HTMLElement | null = null;
  private animationNameEl:  HTMLElement | null = null;
  private elementNodes   = new Map<string, HTMLElement>();
  private selectedId:    string | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private dragState: DragState | null = null;
  private libraryFonts: string[] = [];
  /** Internal clipboard for Ctrl+C / Ctrl+X / Ctrl+V on whole elements.
   *  Stores a snapshot of the source element's data (not a live ref) so
   *  paste creates a true duplicate. */
  private clipboardElement: TextMapElement | null = null;

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !this.dragState) {
      this._resolve(null);
      return;
    }
    // Skip everything below when the user is typing into an input /
    // select / contenteditable so the browser's native behaviour wins
    // (typing characters, copy/paste of text inside a text element).
    const t = document.activeElement;
    if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement
        || t instanceof HTMLTextAreaElement || this._editingActiveSelection()) {
      return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    if (this.selectedId) {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        this._deleteSelected();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        this._copySelected();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        this._copySelected();
        this._deleteSelected();
        return;
      }
    }
    if (ctrl && e.key.toLowerCase() === 'v' && this.clipboardElement) {
      e.preventDefault();
      this._pasteFromClipboard();
    }
  };

  /** Snapshot the selected element into the internal clipboard. Deep
   *  enough — TextMapElement values are flat (primitives + string
   *  fields), so a shallow spread is a true copy. */
  private _copySelected(): void {
    if (!this.selectedId) return;
    const el = this.elements.find((e) => e.id === this.selectedId);
    if (!el) return;
    this.clipboardElement = { ...el };
  }

  /** Duplicate the clipboard element with a fresh id, slightly offset
   *  so it doesn't sit exactly on top of the original. Select the new
   *  element so the user can immediately drag / type into it. */
  private _pasteFromClipboard(): void {
    const src = this.clipboardElement;
    if (!src) return;
    const offsetX = Math.max(0, Math.min(100 - src.w, src.x + 5));
    const offsetY = Math.max(0, Math.min(100 - src.h, src.y + 5));
    let fresh: TextMapElement;
    if (src.type === 'text') {
      fresh = { ...src, id: 'text-' + generateId(), x: offsetX, y: offsetY };
    } else {
      fresh = { ...src, id: 'img-' + generateId(), x: offsetX, y: offsetY };
    }
    this.elements.push(fresh);
    this._mountElement(fresh);
    this._select(fresh.id);
  }

  open(opts: { existing?: MapAsset } = {}): Promise<TextMapEditorResult | null> {
    if (opts.existing?.textMap) {
      this.cfg = { ...DEFAULT_CONFIG, ...opts.existing.textMap };
      this.name = opts.existing.filename;
      this.existingAssetId = opts.existing.id;
      this.existingAddedAt = opts.existing.addedAt;
    } else {
      this.cfg = { ...DEFAULT_CONFIG, elements: [newTextElement()] };
    }
    // Resolve elements (handles legacy bodyHtml migration).
    this.elements = ensureTextMapElements(this.cfg);
    if (this.elements.length === 0) this.elements = [newTextElement()];

    this.overlay = this._build(!!opts.existing);
    document.body.appendChild(this.overlay);
    document.addEventListener('keydown', this.onKey);
    void this._loadFontsForPreview();
    return new Promise((resolve) => { this.resolver = resolve; });
  }

  private async _loadFontsForPreview(): Promise<void> {
    const all = await ImageAssetStore.getAll();
    const fontAssets = all.filter((a) => a.source === 'font' && a.fontFamily);
    const families = fontAssets.map((a) => a.fontFamily!);
    // Register any uploaded-font blobs via FontFace first; that filters
    // them out of the Google CDN request so we don't double-fetch.
    await registerLocalFontsFromAssets(fontAssets);
    ensureFontsLoaded(families);
    this.libraryFonts = families.length > 0 ? families : FALLBACK_FONTS.slice();
    this._renderElementToolbar();
  }

  private _resolve(value: TextMapEditorResult | null): void {
    if (this.resizeObserver) { this.resizeObserver.disconnect(); this.resizeObserver = null; }
    if (this.dragState) this._abortDrag();
    if (this.overlay) this.overlay.remove();
    this.overlay = null;
    document.removeEventListener('keydown', this.onKey);
    this.resolver?.(value);
    this.resolver = null;
  }

  // ─── Build ──────────────────────────────────────────────────────────────

  private _build(isEdit: boolean): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    // Click-outside-to-dismiss intentionally disabled — use Cancel / × / Escape.

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog txt-map-dialog txt-map-dialog--canvas';
    overlay.appendChild(dialog);

    // ── Header ───────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.className = 'modal-header';
    const title = document.createElement('span');
    title.className = 'modal-title';
    title.textContent = isEdit ? 'Edit Handout' : 'Create Handout';
    header.appendChild(title);
    const closeX = document.createElement('button');
    closeX.type = 'button';
    closeX.className = 'modal-close';
    closeX.textContent = '×';
    closeX.addEventListener('click', () => this._resolve(null));
    header.appendChild(closeX);
    dialog.appendChild(header);

    // ── Toolbar ──────────────────────────────────────────────────────────
    // Three sections: left (Name), centre (add buttons + contextual
    // element controls), right (Layout = paper size + colour). The
    // per-element controls slot is appended inside the centre section
    // by _buildToolbar() so they sit next to the add buttons.
    dialog.appendChild(this._buildToolbar());

    // ── Canvas wrap ──────────────────────────────────────────────────────
    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'txt-map-canvas-wrap';
    canvasWrap.addEventListener('pointerdown', (e) => {
      // Click in the empty canvas area (not on an element) → deselect.
      if (e.target === canvasWrap || e.target === this.pageEl) {
        this._select(null);
      }
    });
    dialog.appendChild(canvasWrap);

    const page = document.createElement('div');
    page.className = 'txt-map-page';
    page.id = 'txt-map-page';
    page.style.backgroundColor = this.cfg.backgroundColor;
    page.style.color = this.cfg.textColor;
    page.style.fontFamily = `'${this.cfg.fontFamily}', serif`;
    canvasWrap.appendChild(page);
    this.pageEl = page;

    // ── Footer ───────────────────────────────────────────────────────────
    const footer = document.createElement('div');
    footer.className = 'txt-map-footer';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn--ghost';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this._resolve(null));
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn btn--primary';
    save.textContent = isEdit ? 'Save' : 'Create';
    save.addEventListener('click', () => void this._onSave());
    footer.append(cancel, save);
    dialog.appendChild(footer);

    // Initial paint after mount so getBoundingClientRect is valid.
    requestAnimationFrame(() => {
      this._renderAllElements();
      this._fitPage();
      if (!this.resizeObserver) {
        this.resizeObserver = new ResizeObserver(() => this._fitPage());
        this.resizeObserver.observe(canvasWrap);
      }
    });

    return overlay;
  }

  private _buildToolbar(): HTMLElement {
    const tb = document.createElement('div');
    tb.className = 'txt-map-toolbar';

    // ── LEFT — Name section | Add Content section | Clipboard section
    const left = document.createElement('div');
    left.className = 'txt-map-toolbar-left';
    left.appendChild(this._buildNameSection());
    left.appendChild(this._buildToolbarDivider());
    left.appendChild(this._buildAddContentSection());
    left.appendChild(this._buildToolbarDivider());
    left.appendChild(this._buildClipboardSection());
    tb.appendChild(left);

    // ── CENTRE — Element Properties section (label + slot). Hidden
    //            when nothing is selected.
    const centre = document.createElement('div');
    centre.className = 'txt-map-toolbar-centre';
    const centreSection = document.createElement('div');
    centreSection.className = 'txt-map-toolbar-section';
    centreSection.hidden = true;
    const centreLabel = document.createElement('span');
    centreLabel.className = 'txt-map-toolbar-section-label';
    centreLabel.textContent = 'Element Properties:';
    centreSection.appendChild(centreLabel);
    const elSlot = document.createElement('div');
    elSlot.className = 'txt-map-toolbar-section-row txt-map-toolbar-element';
    centreSection.appendChild(elSlot);
    centre.appendChild(centreSection);
    tb.appendChild(centre);
    this.elementToolbarEl = elSlot;
    this.elementSectionEl = centreSection;

    // ── RIGHT — Layout section | Animation section ─────────────────────
    const right = document.createElement('div');
    right.className = 'txt-map-toolbar-right';
    right.appendChild(this._buildLayoutSection());
    right.appendChild(this._buildToolbarDivider());
    right.appendChild(this._buildAnimationSection());
    tb.appendChild(right);

    return tb;
  }

  /** Generic "section heading + content row below" wrapper. The
   *  toolbar uses this pattern for every section so labels align and
   *  vertical rhythm is consistent. */
  private _buildSectionShell(labelText: string): { section: HTMLElement; row: HTMLElement } {
    const section = document.createElement('div');
    section.className = 'txt-map-toolbar-section';
    const label = document.createElement('span');
    label.className = 'txt-map-toolbar-section-label';
    label.textContent = labelText;
    const row = document.createElement('div');
    row.className = 'txt-map-toolbar-section-row';
    section.append(label, row);
    return { section, row };
  }

  private _buildToolbarDivider(): HTMLElement {
    const d = document.createElement('div');
    d.className = 'txt-map-toolbar-divider';
    return d;
  }

  private _buildNameSection(): HTMLElement {
    const { section, row } = this._buildSectionShell('Name:');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'txt-map-input txt-map-toolbar-name';
    nameInput.value = this.name;
    nameInput.placeholder = 'Handout name';
    // Suppress browser autofill — without this it'll happily offer up
    // phone numbers / email / whatever else it's stored for a generic
    // text input on this page.
    nameInput.autocomplete = 'off';
    nameInput.setAttribute('autocomplete', 'off');
    nameInput.name = 'mappadux-handout-name';
    nameInput.spellcheck = false;
    nameInput.addEventListener('input', () => { this.name = nameInput.value; });
    row.appendChild(nameInput);
    return section;
  }

  private _buildAddContentSection(): HTMLElement {
    const { section, row } = this._buildSectionShell('Add Content:');

    const addText = document.createElement('button');
    addText.type = 'button';
    addText.className = 'btn btn--ghost btn--sm';
    addText.textContent = '+ Text';
    addText.addEventListener('click', () => this._addNewText());
    row.appendChild(addText);

    const addImg = document.createElement('button');
    addImg.type = 'button';
    addImg.className = 'btn btn--ghost btn--sm';
    addImg.textContent = '+ Image Asset';
    addImg.title = 'Pick an image from the Small Assets Library';
    addImg.addEventListener('click', () => void this._addNewImage());
    row.appendChild(addImg);

    const uploadBtn = document.createElement('button');
    uploadBtn.type = 'button';
    uploadBtn.className = 'btn btn--ghost btn--sm';
    uploadBtn.textContent = '+ Upload New Image';
    uploadBtn.title = 'Upload an image from disk and drop it on the page';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.hidden = true;
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (f) void this._uploadAndAddImage(f);
      fileInput.value = '';
    });
    uploadBtn.addEventListener('click', () => fileInput.click());
    row.append(uploadBtn, fileInput);

    return section;
  }

  private _buildClipboardSection(): HTMLElement {
    const { section, row } = this._buildSectionShell('Clipboard:');
    const cutBtn   = this._mkIconBtn(SVG_SCISSORS,  'Cut selected element (Ctrl+X)',
      () => { if (this.selectedId) { this._copySelected(); this._deleteSelected(); } });
    const copyBtn  = this._mkIconBtn(SVG_COPY,      'Copy selected element (Ctrl+C)',
      () => { if (this.selectedId) this._copySelected(); });
    const pasteBtn = this._mkIconBtn(SVG_CLIPBOARD, 'Paste element (Ctrl+V)',
      () => { if (this.clipboardElement) this._pasteFromClipboard(); });
    row.append(cutBtn, copyBtn, pasteBtn);
    return section;
  }

  private _buildLayoutSection(): HTMLElement {
    const { section, row } = this._buildSectionShell('Layout:');

    const aspectSel = document.createElement('select');
    aspectSel.className = 'txt-map-input';
    aspectSel.title = 'Paper size / aspect ratio';
    for (const p of ASPECT_PRESETS) {
      const o = document.createElement('option');
      o.value = `${p.w}x${p.h}`;
      o.textContent = p.label;
      if (p.w === this.cfg.width && p.h === this.cfg.height) o.selected = true;
      aspectSel.appendChild(o);
    }
    aspectSel.addEventListener('change', () => {
      const parts = aspectSel.value.split('x').map((n) => parseInt(n, 10));
      const w = parts[0];
      const h = parts[1];
      if (w && h) { this.cfg.width = w; this.cfg.height = h; this._fitPage(); }
    });
    row.appendChild(aspectSel);

    row.appendChild(this._buildColourInput('Paper colour', this.cfg.backgroundColor, (v) => {
      this.cfg.backgroundColor = v;
      if (this.pageEl) this.pageEl.style.backgroundColor = v;
    }));

    return section;
  }

  private _buildAnimationSection(): HTMLElement {
    const { section, row } = this._buildSectionShell('Animation:');

    // Enable checkbox — mirror of the master switch in the picker
    // modal. Toggling on populates cfg.animation with defaults if
    // empty; toggling off keeps the saved config but flags it
    // disabled, so flipping back on restores the previous picked
    // transition.
    const enableLabel = document.createElement('label');
    enableLabel.className = 'txt-map-toolbar-checkbox';
    const enableCheck = document.createElement('input');
    enableCheck.type = 'checkbox';
    enableCheck.checked = this.cfg.animation?.enabled === true;
    enableCheck.addEventListener('change', () => {
      if (enableCheck.checked) {
        if (!this.cfg.animation) {
          this.cfg.animation = {
            enabled: true, autoReveal: true,
            transitionId: 'written_reveal',
            params: { ...transitionRegistry.defaultParams('written_reveal') },
          };
        } else {
          this.cfg.animation.enabled = true;
        }
      } else {
        if (this.cfg.animation) this.cfg.animation.enabled = false;
      }
      this._refreshAnimationSection();
    });
    enableLabel.append(enableCheck, document.createTextNode(' Enable'));
    row.appendChild(enableLabel);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'txt-map-animation-name';
    row.appendChild(nameSpan);
    this.animationNameEl = nameSpan;

    const editBtn = this._mkIconBtn(SVG_EDIT, 'Edit animation settings', () => {
      this._openAnimationPicker();
    });
    row.appendChild(editBtn);

    this._refreshAnimationSection();
    return section;
  }

  /** Update the Animation section's name span + checkbox to reflect the
   *  current cfg.animation. Called on init, on the Enable checkbox
   *  change, and after the animation picker closes. */
  private _refreshAnimationSection(): void {
    if (!this.animationNameEl) return;
    if (!this.cfg.animation?.enabled) {
      this.animationNameEl.textContent = '(disabled)';
      this.animationNameEl.style.opacity = '0.55';
    } else {
      const def = transitionRegistry.get(this.cfg.animation.transitionId);
      this.animationNameEl.textContent = def?.label ?? this.cfg.animation.transitionId;
      this.animationNameEl.style.opacity = '1';
    }
  }

  /** Open the reveal-animation picker. Lets the GM enable the reveal,
   *  pick a handout-suitable transition, tweak its params, and choose
   *  whether the reveal fires automatically on map load or waits for
   *  a GM trigger. Stored on cfg.animation. */
  private _openAnimationPicker(): void {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog modal-dialog--sm';
    overlay.appendChild(dialog);

    // Working copy — committed back to cfg.animation on Save.
    const cur: TextMapAnimation = this.cfg.animation
      ? { ...this.cfg.animation, params: { ...this.cfg.animation.params } }
      : { enabled: false, autoReveal: true, transitionId: 'written_reveal', params: {} };

    // Header
    const header = document.createElement('div');
    header.className = 'modal-header';
    const title = document.createElement('span');
    title.className = 'modal-title';
    title.textContent = 'Reveal Animation';
    header.appendChild(title);
    const closeX = document.createElement('button');
    closeX.type = 'button';
    closeX.className = 'modal-close';
    closeX.textContent = '×';
    const close = (commit: boolean): void => {
      if (commit) {
        if (cur.enabled) {
          this.cfg.animation = cur;
        } else {
          // Disabled: drop the field entirely so the player / projector
          // skip the reveal pathway altogether.
          const { animation: _a, ...rest } = this.cfg;
          void _a;
          this.cfg = rest as TextMapConfig;
        }
        // Keep the toolbar's Animation row in sync with the saved
        // config — the Enable checkbox + name span both pull from
        // cfg.animation.
        this._refreshAnimationSection();
      }
      overlay.remove();
    };
    closeX.addEventListener('click', () => close(false));
    header.appendChild(closeX);
    dialog.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.style.padding = 'var(--space-md)';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.gap = 'var(--space-md)';
    dialog.appendChild(body);

    // Master switch
    const enable = document.createElement('label');
    enable.className = 'txt-map-toolbar-checkbox';
    const enableCheck = document.createElement('input');
    enableCheck.type = 'checkbox';
    enableCheck.checked = cur.enabled;
    enable.append(enableCheck, document.createTextNode(' Reveal animation enabled'));
    body.appendChild(enable);

    // Auto / manual trigger
    const auto = document.createElement('label');
    auto.className = 'txt-map-toolbar-checkbox';
    const autoCheck = document.createElement('input');
    autoCheck.type = 'checkbox';
    autoCheck.checked = cur.autoReveal;
    auto.append(autoCheck, document.createTextNode(' Play automatically when map loads (otherwise the GM kicks it off via the Start button)'));
    body.appendChild(auto);

    // Transition picker — filtered to forHandout-tagged definitions.
    const sel = document.createElement('select');
    sel.className = 'select-full';
    const handoutDefs = transitionRegistry.getAll().filter((d) => d.forHandout);
    for (const d of handoutDefs) {
      const o = document.createElement('option');
      o.value = d.id; o.textContent = d.label;
      if (d.id === cur.transitionId) o.selected = true;
      sel.appendChild(o);
    }
    const selWrap = document.createElement('div');
    const selLabel = document.createElement('div');
    selLabel.className = 'txt-map-toolbar-group-label';
    selLabel.textContent = 'Transition';
    selWrap.append(selLabel, sel);
    body.appendChild(selWrap);

    // Param panel — re-rendered when the transition changes.
    const paramHost = document.createElement('div');
    paramHost.style.display = 'flex';
    paramHost.style.flexDirection = 'column';
    paramHost.style.gap = 'var(--space-sm)';
    body.appendChild(paramHost);

    const renderParams = (): void => {
      const def = transitionRegistry.get(cur.transitionId);
      paramHost.innerHTML = '';
      if (!def || def.params.length === 0) return;
      for (const p of def.params) {
        const row = document.createElement('label');
        row.style.display = 'flex';
        row.style.flexDirection = 'column';
        row.style.gap = '4px';
        const lbl = document.createElement('span');
        lbl.className = 'txt-map-toolbar-group-label';
        lbl.textContent = p.label;
        row.appendChild(lbl);
        if (p.type === 'slider') {
          const sliderRow = document.createElement('div');
          sliderRow.style.display = 'flex';
          sliderRow.style.alignItems = 'center';
          sliderRow.style.gap = 'var(--space-sm)';
          const slider = document.createElement('input');
          slider.type = 'range';
          slider.min = String(p.min); slider.max = String(p.max); slider.step = String(p.step);
          slider.style.flex = '1';
          slider.value = String(cur.params[p.id] ?? p.default);
          const valSpan = document.createElement('span');
          valSpan.className = 'txt-map-element-slider-val';
          // Display milliseconds as seconds (1 decimal) — easier to
          // parse than "30000 ms". Param is still stored in ms; only
          // the displayed text changes.
          const fmt = (n: number): string => {
            if (p.unit === 'ms') return `${(n / 1000).toFixed(1)} s`;
            return `${n}${p.unit ? ' ' + p.unit : ''}`;
          };
          valSpan.textContent = fmt(parseFloat(slider.value));
          slider.addEventListener('input', () => {
            const v = parseFloat(slider.value);
            cur.params[p.id] = v;
            valSpan.textContent = fmt(v);
          });
          sliderRow.append(slider, valSpan);
          row.appendChild(sliderRow);
        } else {
          const optSel = document.createElement('select');
          optSel.className = 'select-full';
          for (const opt of p.options) {
            const o = document.createElement('option');
            o.value = opt.value; o.textContent = opt.label;
            if ((cur.params[p.id] ?? p.default) === opt.value) o.selected = true;
            optSel.appendChild(o);
          }
          optSel.addEventListener('change', () => { cur.params[p.id] = optSel.value; });
          row.appendChild(optSel);
        }
        paramHost.appendChild(row);
      }
    };

    sel.addEventListener('change', () => {
      cur.transitionId = sel.value;
      // Reset params to the new transition's defaults — params are
      // per-transition so old values rarely apply.
      cur.params = transitionRegistry.defaultParams(sel.value);
      renderParams();
    });
    // Ensure defaults are filled in for the initially-selected transition
    // if cur.params is empty.
    if (Object.keys(cur.params).length === 0) {
      cur.params = transitionRegistry.defaultParams(cur.transitionId);
    }
    renderParams();

    enableCheck.addEventListener('change', () => {
      cur.enabled = enableCheck.checked;
    });
    autoCheck.addEventListener('change', () => {
      cur.autoReveal = autoCheck.checked;
    });

    // Footer
    const footer = document.createElement('div');
    footer.style.padding = 'var(--space-md)';
    footer.style.borderTop = '1px solid var(--border)';
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = 'var(--space-sm)';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn--ghost';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => close(false));
    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'btn btn--primary';
    okBtn.textContent = 'Save';
    okBtn.addEventListener('click', () => close(true));
    footer.append(cancelBtn, okBtn);
    dialog.appendChild(footer);

    document.body.appendChild(overlay);
  }

  /** Save a user-picked image file to the Image Library (Textmap
   *  category, tintable: false so raster colour is preserved), then
   *  drop a new image element onto the canvas pointing at it. */
  private async _uploadAndAddImage(file: File): Promise<void> {
    const id = `upload-${generateId()}`;
    const asset = {
      id,
      name:        file.name.replace(/\.[^.]+$/, '') || 'Uploaded image',
      source:      'upload' as const,
      categoryId:  SYSTEM_CATEGORY_IDS.textmap,
      tintable:    false,
      blob:        file,
      mimeType:    file.type || 'image/png',
      addedAt:     Date.now(),
    };
    await ImageAssetStore.save(asset);
    const el = newImageElement(id);
    this.elements.push(el);
    this._mountElement(el);
    this._select(el.id);
  }

  private _buildColourInput(title: string, value: string, onInput: (v: string) => void): HTMLElement {
    const input = document.createElement('input');
    input.type = 'color';
    input.className = 'txt-map-color';
    input.title = title;
    input.value = value;
    input.addEventListener('input', () => onInput(input.value));
    return input;
  }

  /** Build a small icon button — inline monochrome SVG, ghost-style
   *  background. Used for the cut/copy/paste cluster next to the add
   *  buttons. */
  private _mkIconBtn(svg: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn--ghost btn--sm txt-map-icon-btn';
    b.title = title;
    b.innerHTML = svg;
    b.addEventListener('click', onClick);
    return b;
  }

  // (page-level font picker removed — font is a per-element concern.
  //  The per-element font select builds its list from this.libraryFonts
  //  in _buildTextElementToolbar.)

  // ─── Page fit ───────────────────────────────────────────────────────────

  private _fitPage(): void {
    const page = this.pageEl;
    const wrap = page?.parentElement;
    if (!page || !wrap) return;
    const cw = wrap.clientWidth  - 16;
    const ch = wrap.clientHeight - 16;
    if (cw <= 0 || ch <= 0) return;
    const aspect = this.cfg.width / this.cfg.height;
    let w = cw;
    let h = w / aspect;
    if (h > ch) { h = ch; w = h * aspect; }
    page.style.width  = `${Math.round(w)}px`;
    page.style.height = `${Math.round(h)}px`;
    // Anchor base font-size to page width — matches the rasteriser's
    // pxW / 60 formula so preview and rasterised map render at the same
    // scale.
    const basePx = Math.max(1, Math.round((w / 60) * this.cfg.fontScale));
    page.style.fontSize = `${basePx}px`;
  }

  // ─── Elements ───────────────────────────────────────────────────────────

  private _renderAllElements(): void {
    if (!this.pageEl) return;
    for (const node of this.elementNodes.values()) node.remove();
    this.elementNodes.clear();
    for (const el of this.elements) this._mountElement(el);
  }

  private _mountElement(el: TextMapElement): HTMLElement {
    if (!this.pageEl) throw new Error('page not mounted');
    const host = document.createElement('div');
    host.className = `txt-map-el txt-map-el--${el.type}`;
    host.dataset.elementId = el.id;
    this._applyGeometry(host, el);

    // Body (the typeable / image-rendering region)
    const body = document.createElement('div');
    body.className = 'txt-map-el-body';
    if (el.type === 'text') {
      body.contentEditable = 'true';
      body.spellcheck = true;
      this._applyTextStyle(body, el);
      body.innerHTML = sanitizeSplashHtml(el.html ?? '');
      body.addEventListener('input', () => this._onTextInput(el.id, body));
      body.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = e.clipboardData?.getData('text/plain') ?? '';
        document.execCommand('insertText', false, text);
      });
      // Click → select. Don't focus contenteditable on first click of an
      // unselected element so the drag-bar is reachable.
      body.addEventListener('pointerdown', (e) => {
        if (this.selectedId !== el.id) {
          e.preventDefault();
          this._select(el.id);
        }
      });
    } else if (el.type === 'image') {
      body.classList.add('txt-map-el-body--image');
      // Async resolve — paint a placeholder while we wait.
      body.textContent = '🖼';
      void renderAssetToInlineHtml(el.assetId, { sizeEm: 1 }).then((html) => {
        if (html) body.innerHTML = html;
      });
      body.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this._select(el.id);
      });
      // Apply persisted tint so currentColor inside the SVG resolves
      // correctly on mount, not just on edit.
      if (el.tint) host.style.color = el.tint;
    }
    host.appendChild(body);

    // Chrome: drag bar + resize handle (only visible when selected, via CSS)
    const dragBar = document.createElement('div');
    dragBar.className = 'txt-map-el-drag';
    dragBar.title = 'Drag to move';
    dragBar.addEventListener('pointerdown', (e) => this._startDrag(e, el.id, 'move'));
    host.appendChild(dragBar);

    const resize = document.createElement('div');
    resize.className = 'txt-map-el-resize';
    resize.title = 'Drag to resize';
    resize.addEventListener('pointerdown', (e) => this._startDrag(e, el.id, 'resize'));
    host.appendChild(resize);

    // Delete button — only visible when selected.
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'txt-map-el-delete';
    del.title = 'Delete element';
    del.textContent = '×';
    del.addEventListener('pointerdown', (e) => e.stopPropagation());
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      this._deleteElement(el.id);
    });
    host.appendChild(del);

    this.pageEl.appendChild(host);
    this.elementNodes.set(el.id, host);
    return host;
  }

  private _applyGeometry(host: HTMLElement, el: TextMapElement): void {
    host.style.left   = `${el.x}%`;
    host.style.top    = `${el.y}%`;
    host.style.width  = `${el.w}%`;
    host.style.height = `${el.h}%`;
  }

  private _applyTextStyle(body: HTMLElement, el: TextMapTextElement): void {
    if (el.fontFamily) body.style.fontFamily = `'${el.fontFamily}', serif`;
    else               body.style.fontFamily = '';
    if (el.fontScale)  body.style.fontSize   = `${el.fontScale * 100}%`;
    else               body.style.fontSize   = '';
    if (el.color)      body.style.color      = el.color;
    else               body.style.color      = '';
    if (el.textAlign)  body.style.textAlign  = el.textAlign;
    else               body.style.textAlign  = '';
  }

  private _select(id: string | null): void {
    if (this.selectedId === id) return;
    if (this.selectedId) {
      const prev = this.elementNodes.get(this.selectedId);
      prev?.classList.remove('txt-map-el--selected');
    }
    this.selectedId = id;
    if (id) {
      const cur = this.elementNodes.get(id);
      cur?.classList.add('txt-map-el--selected');
    }
    this._renderElementToolbar();
  }

  /** Rebuild the per-element toolbar based on what's selected. The
   *  containing section ("Element Properties:") hides entirely when
   *  nothing is selected so the centre column collapses. Re-runs
   *  after every selection change AND after async font loads complete
   *  (so the font picker can fill in). */
  private _renderElementToolbar(): void {
    const tb = this.elementToolbarEl;
    const section = this.elementSectionEl;
    if (!tb || !section) return;
    tb.innerHTML = '';
    if (!this.selectedId) { section.hidden = true; return; }
    const el = this.elements.find((x) => x.id === this.selectedId);
    if (!el) { section.hidden = true; return; }
    section.hidden = false;

    if (el.type === 'text')  this._buildTextElementToolbar(tb, el);
    if (el.type === 'image') this._buildImageElementToolbar(tb, el);

    // Trailing controls — shared between text + image elements.
    this._buildElementCommonControls(tb, el);
  }

  /** Layering + animation-flag controls common to every element type.
   *  Appended after the per-type controls so the bar reads:
   *    Element Properties: [type-specific] | To Back | To Front | [✓] Don't animate */
  private _buildElementCommonControls(tb: HTMLElement, el: TextMapElement): void {
    // Subtle divider before the shared controls so the per-type group
    // visually separates from the universal ones.
    const sep = document.createElement('span');
    sep.className = 'txt-map-toolbar-sep';
    tb.appendChild(sep);

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'btn btn--ghost btn--sm';
    backBtn.textContent = 'To Back';
    backBtn.title = 'Send element behind everything else';
    backBtn.addEventListener('click', () => this._moveToBack(el.id));
    tb.appendChild(backBtn);

    const frontBtn = document.createElement('button');
    frontBtn.type = 'button';
    frontBtn.className = 'btn btn--ghost btn--sm';
    frontBtn.textContent = 'To Front';
    frontBtn.title = 'Bring element in front of everything else';
    frontBtn.addEventListener('click', () => this._moveToFront(el.id));
    tb.appendChild(frontBtn);

    // Don't animate — flag this element as part of the starting frame
    // of the reveal animation (it appears immediately, no transition).
    // Used by the rasteriser to split the handout into "before" and
    // "after" frames for the transition system.
    const animLabel = document.createElement('label');
    animLabel.className = 'txt-map-toolbar-checkbox';
    animLabel.title = 'When the handout reveal animation runs, this element shows immediately as part of the starting frame';
    const animCheck = document.createElement('input');
    animCheck.type = 'checkbox';
    animCheck.checked = el.noAnimate === true;
    animCheck.addEventListener('change', () => {
      el.noAnimate = animCheck.checked;
    });
    animLabel.append(animCheck, document.createTextNode(' Don\'t animate'));
    tb.appendChild(animLabel);
  }

  /** Move an element to the END of the elements array (paints on top).
   *  DOM follows the array via insertBefore / appendChild. */
  private _moveToFront(id: string): void {
    const idx = this.elements.findIndex((e) => e.id === id);
    if (idx < 0 || idx === this.elements.length - 1) return;
    const removed = this.elements.splice(idx, 1)[0];
    if (!removed) return;
    this.elements.push(removed);
    const node = this.elementNodes.get(id);
    if (node && this.pageEl) this.pageEl.appendChild(node);
  }

  /** Move an element to the START of the elements array (paints behind
   *  everything else). */
  private _moveToBack(id: string): void {
    const idx = this.elements.findIndex((e) => e.id === id);
    if (idx <= 0) return;
    const removed = this.elements.splice(idx, 1)[0];
    if (!removed) return;
    this.elements.unshift(removed);
    const node = this.elementNodes.get(id);
    if (node && this.pageEl) this.pageEl.insertBefore(node, this.pageEl.firstChild);
  }

  private _buildTextElementToolbar(tb: HTMLElement, el: TextMapTextElement): void {
    // Label
    tb.appendChild(this._toolbarLabel('Text'));

    // Colour — defaults to page textColor when the element doesn't override.
    const colour = document.createElement('input');
    colour.type = 'color';
    colour.className = 'txt-map-color';
    colour.title = 'Text colour for this element';
    colour.value = el.color ?? this.cfg.textColor;
    colour.addEventListener('input', () => {
      el.color = colour.value;
      const node = this.elementNodes.get(el.id);
      const body = node?.querySelector<HTMLElement>('.txt-map-el-body');
      if (body) this._applyTextStyle(body, el);
    });
    tb.appendChild(colour);

    // Font size — slider 0.5..4 multiplier on the page-level basePx.
    tb.appendChild(this._toolbarLabel('Size'));
    const size = document.createElement('input');
    size.type = 'range';
    size.min = '0.5'; size.max = '4'; size.step = '0.1';
    size.value = String(el.fontScale ?? 1);
    size.className = 'txt-map-element-slider';
    size.title = 'Font size multiplier for this element';
    const sizeVal = document.createElement('span');
    sizeVal.className = 'txt-map-element-slider-val';
    sizeVal.textContent = `${(el.fontScale ?? 1).toFixed(1)}×`;
    size.addEventListener('input', () => {
      const v = parseFloat(size.value);
      el.fontScale = v;
      sizeVal.textContent = `${v.toFixed(1)}×`;
      const node = this.elementNodes.get(el.id);
      const body = node?.querySelector<HTMLElement>('.txt-map-el-body');
      if (body) this._applyTextStyle(body, el);
    });
    tb.append(size, sizeVal);

    // Font family — pulls from the Image Library's font registry.
    // Each option is rendered in its OWN font so the user previews the
    // glyph shapes in the dropdown rather than guessing from family
    // names. The closed select also mirrors the picked font.
    tb.appendChild(this._toolbarLabel('Font'));
    const fontSel = document.createElement('select');
    fontSel.className = 'txt-map-input';
    const currentFamily = el.fontFamily ?? this.cfg.fontFamily;
    fontSel.style.fontFamily = `'${currentFamily}', sans-serif`;
    for (const f of this.libraryFonts.length > 0 ? this.libraryFonts : FALLBACK_FONTS) {
      const o = document.createElement('option');
      o.value = f; o.textContent = f;
      o.style.fontFamily = `'${f}', sans-serif`;
      if (f === currentFamily) o.selected = true;
      fontSel.appendChild(o);
    }
    fontSel.addEventListener('change', () => {
      el.fontFamily = fontSel.value;
      fontSel.style.fontFamily = `'${fontSel.value}', sans-serif`;
      const node = this.elementNodes.get(el.id);
      const body = node?.querySelector<HTMLElement>('.txt-map-el-body');
      if (body) this._applyTextStyle(body, el);
    });
    tb.appendChild(fontSel);

    // Alignment
    tb.appendChild(this._toolbarLabel('Align'));
    const alignWrap = document.createElement('div');
    alignWrap.className = 'txt-map-align-group';
    for (const a of ['left', 'center', 'right', 'justify'] as const) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--ghost btn--sm';
      btn.textContent = a === 'left' ? '⯇' : a === 'center' ? '═' : a === 'right' ? '⯈' : '☰';
      btn.title = a.charAt(0).toUpperCase() + a.slice(1);
      if (el.textAlign === a) btn.classList.add('btn--active');
      btn.addEventListener('click', () => {
        el.textAlign = a;
        const node = this.elementNodes.get(el.id);
        const body = node?.querySelector<HTMLElement>('.txt-map-el-body');
        if (body) this._applyTextStyle(body, el);
        // Refresh button states.
        alignWrap.querySelectorAll('.btn--active').forEach((b) => b.classList.remove('btn--active'));
        btn.classList.add('btn--active');
      });
      alignWrap.appendChild(btn);
    }
    tb.appendChild(alignWrap);
  }

  private _buildImageElementToolbar(tb: HTMLElement, el: TextMapElement): void {
    if (el.type !== 'image') return;
    // Tint colour — applied to the host element's `color` so any inline
    // SVG inside (Lucide / game-icons) using currentColor takes this
    // colour. Has no visible effect on raster bitmaps; harmless to show
    // anyway. The rasteriser persists this via el.tint.
    tb.appendChild(this._toolbarLabel('Colour'));
    const colour = document.createElement('input');
    colour.type = 'color';
    colour.className = 'txt-map-color';
    colour.title = 'Tint colour for monochrome SVG icons (no effect on raster images)';
    colour.value = el.tint ?? this.cfg.textColor;
    colour.addEventListener('input', () => {
      el.tint = colour.value;
      const node = this.elementNodes.get(el.id);
      if (node) (node as HTMLElement).style.color = colour.value;
    });
    tb.appendChild(colour);
    const hint = document.createElement('span');
    hint.className = 'txt-map-element-hint';
    hint.textContent = 'Drag handle bar to move • corner to resize';
    tb.appendChild(hint);
  }

  private _toolbarLabel(text: string): HTMLElement {
    const l = document.createElement('span');
    l.className = 'txt-map-element-toolbar-label';
    l.textContent = text;
    return l;
  }

  private _editingActiveSelection(): boolean {
    const active = document.activeElement as HTMLElement | null;
    if (!active) return false;
    return active.isContentEditable === true;
  }

  private _onTextInput(id: string, body: HTMLElement): void {
    const el = this.elements.find((e) => e.id === id) as TextMapTextElement | undefined;
    if (!el) return;
    el.html = body.innerHTML;
  }

  private _addNewText(): void {
    const el = newTextElement();
    this.elements.push(el);
    const node = this._mountElement(el);
    this._select(el.id);
    // Move caret into the new element so the user can just start typing.
    setTimeout(() => {
      const body = node.querySelector<HTMLElement>('.txt-map-el-body');
      if (body) {
        body.focus();
        const range = document.createRange();
        range.selectNodeContents(body);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }, 0);
  }

  private async _addNewImage(): Promise<void> {
    const modal = new ImageAssetModal();
    return new Promise<void>((resolve) => {
      let picked = false;
      void modal.open({
        initialCategoryId: SYSTEM_CATEGORY_IDS.textmap,
        pickMode: true,
        onPick: (asset) => {
          picked = true;
          const el = newImageElement(asset.id);
          this.elements.push(el);
          this._mountElement(el);
          this._select(el.id);
          resolve();
        },
      });
      const origClose = modal.close.bind(modal);
      modal.close = () => {
        origClose();
        if (!picked) resolve();
      };
    });
  }

  private _deleteSelected(): void {
    if (!this.selectedId) return;
    this._deleteElement(this.selectedId);
  }

  private _deleteElement(id: string): void {
    const idx = this.elements.findIndex((e) => e.id === id);
    if (idx < 0) return;
    this.elements.splice(idx, 1);
    const node = this.elementNodes.get(id);
    node?.remove();
    this.elementNodes.delete(id);
    if (this.selectedId === id) this.selectedId = null;
  }

  // ─── Drag / resize ──────────────────────────────────────────────────────

  private _startDrag(e: PointerEvent, id: string, mode: DragMode): void {
    if (!this.pageEl) return;
    e.preventDefault();
    e.stopPropagation();
    this._select(id);
    const el = this.elements.find((x) => x.id === id);
    if (!el) return;
    const rect = this.pageEl.getBoundingClientRect();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const state: DragState = {
      elementId:    id,
      mode,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startGeom:    { x: el.x, y: el.y, w: el.w, h: el.h },
      pageWidthPx:  rect.width,
      pageHeightPx: rect.height,
      capture:      target,
      pointerId:    e.pointerId,
      onMove:       (ev) => this._onDragMove(ev),
      onUp:         (ev) => this._onDragEnd(ev),
    };
    this.dragState = state;
    target.addEventListener('pointermove', state.onMove);
    target.addEventListener('pointerup',   state.onUp);
    target.addEventListener('pointercancel', state.onUp);
  }

  private _onDragMove(ev: PointerEvent): void {
    const state = this.dragState;
    if (!state) return;
    const el = this.elements.find((x) => x.id === state.elementId);
    if (!el) return;
    const dxPct = ((ev.clientX - state.startClientX) / state.pageWidthPx)  * 100;
    const dyPct = ((ev.clientY - state.startClientY) / state.pageHeightPx) * 100;
    if (state.mode === 'move') {
      el.x = state.startGeom.x + dxPct;
      el.y = state.startGeom.y + dyPct;
    } else {
      el.w = state.startGeom.w + dxPct;
      el.h = state.startGeom.h + dyPct;
    }
    clampElementGeometry(el);
    const node = this.elementNodes.get(state.elementId);
    if (node) this._applyGeometry(node, el);
  }

  private _onDragEnd(_ev: PointerEvent): void {
    this._abortDrag();
  }

  private _abortDrag(): void {
    const state = this.dragState;
    if (!state) return;
    try { state.capture.releasePointerCapture(state.pointerId); } catch { /* ignore */ }
    state.capture.removeEventListener('pointermove', state.onMove);
    state.capture.removeEventListener('pointerup',   state.onUp);
    state.capture.removeEventListener('pointercancel', state.onUp);
    this.dragState = null;
  }

  // ─── Save ───────────────────────────────────────────────────────────────

  private async _onSave(): Promise<void> {
    const name = this.name.trim() || 'New Handout';
    // Sanitise every text element's html before persistence.
    const elementsClean: TextMapElement[] = this.elements.map((e) => {
      if (e.type === 'text') {
        return { ...e, html: sanitizeSplashHtml(e.html ?? '') };
      }
      return { ...e };
    });
    const cfgToSave: TextMapConfig = {
      ...this.cfg,
      elements: elementsClean,
    };
    // Drop the legacy bodyHtml field now that we have proper elements —
    // exactOptionalPropertyTypes won't let us assign undefined, so the
    // delete is required.
    delete (cfgToSave as { bodyHtml?: string }).bodyHtml;
    const { pxW, pxH } = predictTextMapPixelDimensions(cfgToSave);
    const asset: MapAsset = {
      id:            this.existingAssetId ?? ('textmap-' + generateId()),
      filename:      name,
      source:        'text-map',
      locallyStored: true,
      imageWidth:    pxW,
      imageHeight:   pxH,
      noGrid:        true,
      textMap:       cfgToSave,
      addedAt:       this.existingAddedAt ?? Date.now(),
    };
    await MapAssetStore.save(asset);
    MapAssetStore.invalidateRuntimeCache(asset.id);
    this._resolve({ asset });
  }
}
