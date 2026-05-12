import type { MapAsset, TextMapConfig, TextMapElement, TextMapTextElement } from '../types.ts';
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
  private elementNodes   = new Map<string, HTMLElement>();
  private selectedId:    string | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private dragState: DragState | null = null;
  private libraryFonts: string[] = [];

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !this.dragState) this._resolve(null);
    if ((e.key === 'Delete' || e.key === 'Backspace')
        && this.selectedId
        && document.activeElement?.tagName !== 'INPUT'
        && document.activeElement?.tagName !== 'SELECT'
        && !this._editingActiveSelection()) {
      e.preventDefault();
      this._deleteSelected();
    }
  };

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
    const toolbar = this._buildToolbar();
    dialog.appendChild(toolbar);
    // Per-element controls slot lives INSIDE the top toolbar — when an
    // element is selected, its controls append here so everything you
    // can change is in one place at the top of the screen.
    const elSlot = document.createElement('div');
    elSlot.className = 'txt-map-toolbar-element';
    elSlot.hidden = true;
    toolbar.appendChild(elSlot);
    this.elementToolbarEl = elSlot;

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

    // Name input
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'txt-map-input txt-map-toolbar-name';
    nameInput.value = this.name;
    nameInput.placeholder = 'Handout name';
    nameInput.addEventListener('input', () => { this.name = nameInput.value; });
    tb.appendChild(nameInput);

    // Aspect ratio
    const aspectSel = document.createElement('select');
    aspectSel.className = 'txt-map-input';
    aspectSel.title = 'Aspect ratio';
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
    tb.appendChild(aspectSel);

    // Background colour
    tb.appendChild(this._buildColourInput('Background', this.cfg.backgroundColor, (v) => {
      this.cfg.backgroundColor = v;
      if (this.pageEl) this.pageEl.style.backgroundColor = v;
    }));

    // Text colour
    tb.appendChild(this._buildColourInput('Text colour', this.cfg.textColor, (v) => {
      this.cfg.textColor = v;
      if (this.pageEl) this.pageEl.style.color = v;
    }));

    // Default font
    const fontSel = document.createElement('select');
    fontSel.className = 'txt-map-input';
    fontSel.title = 'Default font (text elements inherit unless overridden)';
    for (const f of FALLBACK_FONTS) {
      const o = document.createElement('option');
      o.value = f; o.textContent = f;
      if (f === this.cfg.fontFamily) o.selected = true;
      fontSel.appendChild(o);
    }
    void this._populateFontSelect(fontSel);
    fontSel.addEventListener('change', () => {
      this.cfg.fontFamily = fontSel.value;
      if (this.pageEl) this.pageEl.style.fontFamily = `'${fontSel.value}', serif`;
    });
    tb.appendChild(fontSel);


    // Add Text button
    const addText = document.createElement('button');
    addText.type = 'button';
    addText.className = 'btn btn--ghost btn--sm';
    addText.textContent = '+ Text';
    addText.addEventListener('click', () => this._addNewText());
    tb.appendChild(addText);

    // Add Image button — picks from the Small Assets Library.
    const addImg = document.createElement('button');
    addImg.type = 'button';
    addImg.className = 'btn btn--ghost btn--sm';
    addImg.textContent = '+ Image';
    addImg.title = 'Pick an image from the Small Assets Library';
    addImg.addEventListener('click', () => void this._addNewImage());
    tb.appendChild(addImg);

    // + Upload — one-click path that loads an image file straight from
    // disk into the Textmap category and drops it on the page. For
    // colour raster images (photos, painted maps, etc.) — no need to
    // round-trip through the Small Assets Library modal. The asset is
    // saved with tintable: false so its native colours are preserved.
    const uploadBtn = document.createElement('button');
    uploadBtn.type = 'button';
    uploadBtn.className = 'btn btn--ghost btn--sm';
    uploadBtn.textContent = '+ Upload';
    uploadBtn.title = 'Upload an image from disk and drop it on the page';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.hidden = true;
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (f) void this._uploadAndAddImage(f);
      fileInput.value = ''; // allow the same file to be picked again
    });
    uploadBtn.addEventListener('click', () => fileInput.click());
    tb.append(uploadBtn, fileInput);

    return tb;
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

  private async _populateFontSelect(sel: HTMLSelectElement): Promise<void> {
    const all = await ImageAssetStore.getAll();
    const fonts = all
      .filter((a) => a.source === 'font' && a.fontFamily)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (fonts.length === 0) return;
    sel.innerHTML = '';
    for (const f of fonts) {
      const o = document.createElement('option');
      o.value = f.fontFamily!; o.textContent = f.name;
      if (f.fontFamily === this.cfg.fontFamily) o.selected = true;
      sel.appendChild(o);
    }
    if (!fonts.some((f) => f.fontFamily === this.cfg.fontFamily)) {
      const o = document.createElement('option');
      o.value = this.cfg.fontFamily;
      o.textContent = `${this.cfg.fontFamily} (missing)`;
      o.selected = true;
      sel.insertBefore(o, sel.firstChild);
    }
  }

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

  /** Rebuild the per-element toolbar based on what's selected. Hides the
   *  bar entirely when nothing is selected so it doesn't take vertical
   *  space. Re-runs after every selection change AND after async font
   *  loads complete (so the font picker can fill in). */
  private _renderElementToolbar(): void {
    const tb = this.elementToolbarEl;
    if (!tb) return;
    tb.innerHTML = '';
    if (!this.selectedId) { tb.hidden = true; return; }
    const el = this.elements.find((x) => x.id === this.selectedId);
    if (!el) { tb.hidden = true; return; }
    tb.hidden = false;

    if (el.type === 'text') this._buildTextElementToolbar(tb, el);
    else if (el.type === 'image') this._buildImageElementToolbar(tb, el);
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

    // Font family — pulls from the Image Library's font registry (same
    // list as the page-level default). "Default" entry returns to the
    // page-level font.
    tb.appendChild(this._toolbarLabel('Font'));
    const fontSel = document.createElement('select');
    fontSel.className = 'txt-map-input';
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = `(use page default: ${this.cfg.fontFamily})`;
    fontSel.appendChild(defaultOpt);
    for (const f of this.libraryFonts.length > 0 ? this.libraryFonts : FALLBACK_FONTS) {
      const o = document.createElement('option');
      o.value = f; o.textContent = f;
      if (f === el.fontFamily) o.selected = true;
      fontSel.appendChild(o);
    }
    if (!el.fontFamily) defaultOpt.selected = true;
    fontSel.addEventListener('change', () => {
      if (fontSel.value === '') delete el.fontFamily;
      else el.fontFamily = fontSel.value;
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

  private _buildImageElementToolbar(tb: HTMLElement, _el: TextMapElement): void {
    tb.appendChild(this._toolbarLabel('Image'));
    const hint = document.createElement('span');
    hint.className = 'txt-map-element-hint';
    hint.textContent = 'Drag the bottom-right corner to resize. Drag the top bar to move.';
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
