import type { MapAsset, TextMapConfig } from '../types.ts';
import { SYSTEM_CATEGORY_IDS } from '../types.ts';
import { MapAssetStore } from '../maps/MapAssetStore.ts';
import { predictTextMapPixelDimensions } from '../maps/rasterizeTextMap.ts';
import { ImageAssetStore } from '../images/ImageAssetStore.ts';
import { ImageAssetModal } from '../images/ImageAssetModal.ts';
import { ensureFontsLoaded } from '../images/fontCatalog.ts';
import { generateId } from '../utils/id.ts';
import { sanitizeSplashHtml } from '../utils/sanitizeHtml.ts';
import { resolveAssetImages, renderAssetToInlineHtml } from '../utils/resolveAssetImages.ts';
import { createRichTextEditor } from './RichTextEditor.ts';

/**
 * TextMapEditor — Stream C handout editor.
 *
 * Resolves with the new MapAsset on Save (or null on Cancel). Caller routes
 * the asset into the user's pack (Add Map flow creates a StoredMap pointing
 * at it).
 *
 * This milestone (M1) is the data-model + scaffolding: plain textarea body,
 * aspect picker, font picker, background colour. Follow-up commits will
 * extract the rich-text toolbar from AboutDialog, add inline icon insertion
 * from the Image Library, drag-handle resize on inserted images, and the
 * typewriter animation panel.
 */

export interface TextMapEditorResult {
  asset: MapAsset;
}

/** Aspect-ratio presets. The w/h values express the RATIO only — they're
 *  pure ratio numerator / denominator, not a render target. A4 uses the
 *  canonical 210:297 mm so the shape is exact (the previous 1080×1527
 *  carried a tiny 0.024% rounding error against true √2). The renderer
 *  picks an actual resolution per use case — see TextMapConfig comment
 *  in types.ts. */
const ASPECT_PRESETS: ReadonlyArray<{ label: string; w: number; h: number }> = [
  { label: 'A4 Portrait (1 : √2)',     w: 210,  h: 297 },
  { label: 'A4 Landscape (√2 : 1)',    w: 297,  h: 210 },
  { label: '16 : 9 Landscape',         w: 16,   h: 9   },
  { label: '4 : 3 Landscape',          w: 4,    h: 3   },
  { label: 'Square (1 : 1)',           w: 1,    h: 1   },
  { label: '2 : 3 Tall',               w: 2,    h: 3   },
];

const DEFAULT_TEXT_MAP: TextMapConfig = {
  bodyHtml:        '<p>Proclamation, journal entry, ransom note, or sealed letter — your text here.</p>',
  // 16:9 is the most common handout shape (matches projector / monitor /
  // landscape table-cam framing). A4 portrait is one click away in the
  // aspect picker for letter-style handouts.
  width:           16,
  height:          9,
  fontFamily:      'Cinzel',
  fontScale:       1,
  backgroundColor: '#f4e9c8',
  textColor:       '#1a1a1a',
};

export class TextMapEditor {
  private overlay:  HTMLElement | null = null;
  private resolver: ((value: TextMapEditorResult | null) => void) | null = null;
  private draft:    TextMapConfig = { ...DEFAULT_TEXT_MAP };
  private name:     string = 'New Handout';
  private resizeObserver: ResizeObserver | null = null;
  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this._resolve(null);
  };

  open(opts: { existing?: MapAsset } = {}): Promise<TextMapEditorResult | null> {
    if (opts.existing?.textMap) {
      this.draft = { ...opts.existing.textMap };
      this.name  = opts.existing.filename;
    }
    this.overlay = this._build(!!opts.existing);
    document.body.appendChild(this.overlay);
    document.addEventListener('keydown', this.onKey);
    void this._loadFontsForPreview();
    return new Promise((resolve) => { this.resolver = resolve; });
  }

  private async _loadFontsForPreview(): Promise<void> {
    // Pull every font family in the library so the preview can render any
    // bundled or user-added face the creator picks.
    const allFonts = await ImageAssetStore.getAll();
    const families = allFonts
      .filter((a) => a.source === 'font' && a.fontFamily)
      .map((a) => a.fontFamily!);
    ensureFontsLoaded(families);
  }

  private _resolve(value: TextMapEditorResult | null): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.overlay) this.overlay.remove();
    this.overlay = null;
    document.removeEventListener('keydown', this.onKey);
    this.resolver?.(value);
    this.resolver = null;
  }

  private _build(isEdit: boolean): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    // Click-outside-to-dismiss intentionally disabled — use Cancel / × / Escape.

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog txt-map-dialog';
    overlay.appendChild(dialog);

    // Header
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

    // Body: two columns — controls on left, preview canvas on right.
    const body = document.createElement('div');
    body.className = 'txt-map-body';
    dialog.appendChild(body);

    const controls = document.createElement('div');
    controls.className = 'txt-map-controls';
    body.appendChild(controls);

    const previewWrap = document.createElement('div');
    previewWrap.className = 'txt-map-preview-wrap';
    body.appendChild(previewWrap);

    const preview = document.createElement('div');
    preview.className = 'txt-map-preview';
    preview.id = 'txt-map-preview';
    previewWrap.appendChild(preview);

    // ── Name input ─────────────────────────────────────────────────────
    controls.appendChild(this._labelled('Handout name', this._buildNameInput()));

    // ── Aspect ratio picker ────────────────────────────────────────────
    controls.appendChild(this._labelled('Aspect ratio', this._buildAspectPicker()));

    // ── Font picker ────────────────────────────────────────────────────
    controls.appendChild(this._labelled('Font', this._buildFontPicker()));

    // ── Font size slider ───────────────────────────────────────────────
    controls.appendChild(this._labelled('Font size', this._buildFontScale()));

    // ── Background colour ──────────────────────────────────────────────
    controls.appendChild(this._labelled('Background', this._buildColourRow('backgroundColor')));

    // ── Text colour ────────────────────────────────────────────────────
    controls.appendChild(this._labelled('Text colour', this._buildColourRow('textColor')));

    // ── Body text (plain textarea for M1 — rich editor lands later) ────
    controls.appendChild(this._labelled('Body', this._buildBodyTextarea()));

    // Footer: Cancel + Save
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

    // Initial preview render after the dialog mounts, plus initial colour
    // sync on the body editor so existing inline icons immediately render
    // in the handout's textColor.
    requestAnimationFrame(() => {
      this._renderPreview();
      this._syncEditorColors();
    });

    return overlay;
  }

  private _labelled(label: string, control: HTMLElement): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'txt-map-field';
    const l = document.createElement('label');
    l.className = 'txt-map-field-label';
    l.textContent = label;
    wrap.appendChild(l);
    wrap.appendChild(control);
    return wrap;
  }

  private _buildNameInput(): HTMLElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'txt-map-input';
    input.value = this.name;
    input.placeholder = 'New Handout';
    input.addEventListener('input', () => {
      this.name = input.value;
    });
    return input;
  }

  private _buildAspectPicker(): HTMLElement {
    const sel = document.createElement('select');
    sel.className = 'txt-map-input';
    sel.title = 'Shape of the page. Actual resolution is picked by the renderer per use case (preview, projector, print).';
    for (const preset of ASPECT_PRESETS) {
      const opt = document.createElement('option');
      opt.value = `${preset.w}x${preset.h}`;
      opt.textContent = preset.label;
      if (preset.w === this.draft.width && preset.h === this.draft.height) opt.selected = true;
      sel.appendChild(opt);
    }
    const customOpt = document.createElement('option');
    customOpt.value = 'custom';
    customOpt.textContent = 'Custom ratio…';
    sel.appendChild(customOpt);

    sel.addEventListener('change', () => {
      if (sel.value === 'custom') {
        const w = parseInt(prompt('Width units (ratio numerator):', String(this.draft.width)) ?? '', 10);
        const h = parseInt(prompt('Height units (ratio denominator):', String(this.draft.height)) ?? '', 10);
        if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
          this.draft.width = w;
          this.draft.height = h;
        }
      } else {
        const [w, h] = sel.value.split('x').map((n) => parseInt(n, 10));
        if (w && h) {
          this.draft.width = w;
          this.draft.height = h;
        }
      }
      this._renderPreview();
    });
    return sel;
  }

  private _buildFontPicker(): HTMLElement {
    const sel = document.createElement('select');
    sel.className = 'txt-map-input';
    // Populate asynchronously from the Image Library's fonts.
    void this._populateFontPicker(sel);
    sel.addEventListener('change', () => {
      this.draft.fontFamily = sel.value;
      this._renderPreview();
    });
    return sel;
  }

  private async _populateFontPicker(sel: HTMLSelectElement): Promise<void> {
    const allFonts = await ImageAssetStore.getAll();
    const fonts = allFonts
      .filter((a) => a.source === 'font' && a.fontFamily)
      .sort((a, b) => a.name.localeCompare(b.name));
    sel.innerHTML = '';
    for (const f of fonts) {
      const opt = document.createElement('option');
      opt.value = f.fontFamily!;
      opt.textContent = f.name;
      if (f.fontFamily === this.draft.fontFamily) opt.selected = true;
      sel.appendChild(opt);
    }
    if (!fonts.some((f) => f.fontFamily === this.draft.fontFamily)) {
      // Selected font missing from library (deleted?) — add a placeholder.
      const opt = document.createElement('option');
      opt.value = this.draft.fontFamily;
      opt.textContent = `${this.draft.fontFamily} (missing)`;
      opt.selected = true;
      sel.insertBefore(opt, sel.firstChild);
    }
  }

  private _buildFontScale(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'txt-map-slider-row';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0.5';
    slider.max = '4';
    slider.step = '0.1';
    slider.value = String(this.draft.fontScale);
    const valLabel = document.createElement('span');
    valLabel.className = 'txt-map-slider-val';
    valLabel.textContent = `${this.draft.fontScale.toFixed(1)}×`;
    slider.addEventListener('input', () => {
      this.draft.fontScale = parseFloat(slider.value);
      valLabel.textContent = `${this.draft.fontScale.toFixed(1)}×`;
      this._renderPreview();
    });
    wrap.append(slider, valLabel);
    return wrap;
  }

  private _buildColourRow(key: 'backgroundColor' | 'textColor'): HTMLElement {
    const input = document.createElement('input');
    input.type = 'color';
    input.value = this.draft[key];
    input.className = 'txt-map-color';
    input.addEventListener('input', () => {
      this.draft[key] = input.value;
      this._renderPreview();
      this._syncEditorColors();
    });
    return input;
  }

  /** Apply the handout's background / text colour to the body editor so
   *  the user sees inline icons in the chosen colour while typing — not
   *  just in the preview. Inline SVG icons read `color` from the editor
   *  via currentColor, so this is what makes the live tinting work. */
  private _syncEditorColors(): void {
    const editor = this.overlay?.querySelector<HTMLElement>('.rte-editor');
    if (!editor) return;
    editor.style.color = this.draft.textColor;
    editor.style.backgroundColor = this.draft.backgroundColor;
  }

  private _buildBodyTextarea(): HTMLElement {
    // Rich-text editor shared with the About splash body. The page-level
    // Font + Text-colour controls (above) are the single source of truth
    // for those — disable the toolbar's inline pickers so they don't
    // silently override the page settings. Bold / italic / lists /
    // alignment / inline icon insertion stay for inline emphasis.
    return createRichTextEditor({
      initialHtml:      this.draft.bodyHtml,
      placeholder:      'Body of the handout — proclamation, journal entry, ransom note…',
      showFontPicker:   false,
      showColourPicker: false,
      onChange: (html) => {
        this.draft.bodyHtml = html;
        this._renderPreview();
      },
      onInsertIcon: () => this._pickInlineIcon(),
    });
  }

  /** Opens the Small Assets Library in pick mode (defaulting to the
   *  Textmap category). The picked icon is rendered as inline SVG inside
   *  a sized wrapper span so `currentColor` inside the SVG resolves to
   *  the host editor / preview's CSS color — no data-URL sandbox, no
   *  baked colour, and live re-tinting when the handout's textColor
   *  changes.
   *
   *  Raster blobs fall through to <img src="blob:..."> in the same
   *  wrapper (no tint possible there, just sizing). Click the inserted
   *  icon to cycle through 1em / 1.5em / 2em / 3em / 4em sizes — see
   *  RichTextEditor for the handler. */
  private async _pickInlineIcon(): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      let picked = false;
      const modal = new ImageAssetModal();
      void modal.open({
        initialCategoryId: SYSTEM_CATEGORY_IDS.textmap,
        pickMode: true,
        onPick: async (asset) => {
          picked = true;
          const html = await renderAssetToInlineHtml(asset.id, { sizeEm: 2 });
          if (!html) {
            resolve(null);
            return;
          }
          resolve(html);
        },
      });
      // If the user closes without picking, resolve null so the editor
      // doesn't hang in a half-inserted state.
      const origClose = modal.close.bind(modal);
      modal.close = () => {
        origClose();
        if (!picked) resolve(null);
      };
    });
  }

  /** Render the preview. The page element's pixel dimensions are computed
   *  in `_fitPage()` from the container size + chosen aspect ratio, so
   *  changing fonts / colours / body text never shifts the canvas size —
   *  only the wrap's available room does (handled by ResizeObserver).
   *  Sanitised body HTML lives inside an inner scroll container. */
  private _renderPreview(): void {
    const host = this.overlay?.querySelector<HTMLElement>('#txt-map-preview');
    const wrap = this.overlay?.querySelector<HTMLElement>('.txt-map-preview-wrap');
    if (!host || !wrap) return;
    host.innerHTML = '';

    const page = document.createElement('div');
    page.className = 'txt-map-page';
    page.style.backgroundColor = this.draft.backgroundColor;
    page.style.color = this.draft.textColor;
    page.style.fontFamily = `'${this.draft.fontFamily}', sans-serif`;
    page.style.fontSize = `${this.draft.fontScale}em`;

    const content = document.createElement('div');
    content.className = 'txt-map-page-content';
    const sanitised = sanitizeSplashHtml(this.draft.bodyHtml);
    content.innerHTML = sanitised;
    page.appendChild(content);

    // Resolve any inline asset: image references to data / blob URLs so
    // they show in the preview. This is async (IDB lookup) — fire and
    // forget; the body paints unchanged until the resolved HTML lands.
    if (sanitised.includes('asset:')) {
      void resolveAssetImages(sanitised).then((resolved) => {
        if (content.isConnected) content.innerHTML = resolved;
      });
    }

    host.appendChild(page);
    this._fitPage();

    // Set up the resize observer once — re-fit when the wrap changes size
    // (dialog resize, viewport resize). Idempotent across renders.
    if (!this.resizeObserver) {
      this.resizeObserver = new ResizeObserver(() => this._fitPage());
      this.resizeObserver.observe(wrap);
    }
  }

  /** Compute pixel width/height for the page so it fits inside the wrap
   *  while honouring the chosen aspect ratio. The page's dimensions are
   *  then independent of content — font changes don't reshape it. */
  private _fitPage(): void {
    const page = this.overlay?.querySelector<HTMLElement>('.txt-map-page');
    const wrap = this.overlay?.querySelector<HTMLElement>('.txt-map-preview-wrap');
    if (!page || !wrap) return;
    const cw = wrap.clientWidth - 8;
    const ch = wrap.clientHeight - 8;
    if (cw <= 0 || ch <= 0) return;
    const aspect = this.draft.width / this.draft.height;
    let w = cw;
    let h = w / aspect;
    if (h > ch) { h = ch; w = h * aspect; }
    page.style.width  = `${Math.round(w)}px`;
    page.style.height = `${Math.round(h)}px`;
  }

  private async _onSave(): Promise<void> {
    const name = this.name.trim() || 'New Handout';
    const sanitized = sanitizeSplashHtml(this.draft.bodyHtml);
    // Asset metadata stores pixel-accurate dimensions — the dimensions
    // the rasteriser will actually produce at the default long-side. The
    // raw ratio (e.g. 210 / 297) stays inside textMap so the editor can
    // round-trip the user's chosen shape on re-open. Downstream code
    // (marker placement, calibration, fog) reads imageWidth/imageHeight
    // as pixels.
    const { pxW, pxH } = predictTextMapPixelDimensions(this.draft);
    const asset: MapAsset = {
      id:            'textmap-' + generateId(),
      filename:      name,
      source:        'text-map',
      locallyStored: true,
      imageWidth:    pxW,
      imageHeight:   pxH,
      noGrid:        true, // text-maps never carry a grid
      textMap:       { ...this.draft, bodyHtml: sanitized },
      addedAt:       Date.now(),
    };
    await MapAssetStore.save(asset);
    // If this id has been rendered before in this session (e.g. user
    // re-saved the same handout), drop the cached rasterisation so the
    // next load picks up the edits.
    MapAssetStore.invalidateRuntimeCache(asset.id);
    this._resolve({ asset });
  }
}
