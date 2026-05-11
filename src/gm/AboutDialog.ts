import type { SplashConfig, SplashLink, ThemeConfig } from '../types.ts';
import { applyTheme } from '../utils/applyTheme.ts';
import { sanitizeSplashHtml, escapeHtml } from '../utils/sanitizeHtml.ts';

/**
 * About / Splash dialog. Two modes in one component:
 *
 *   • Display — shown after a Load Map Pack import (when the bundle carried
 *     creator content) and any time the user picks "About…" from the
 *     hamburger. Renders the creator's title / body / banner / links above
 *     a fixed Mappadux footer (Discord / Ko-fi / GitHub / licence — never
 *     customisable, always present).
 *
 *   • Edit — toggled via the pencil button. Lets the GM (and creators) edit
 *     the title / body / banner / links, then Save persists back to the
 *     workspace and closes; Cancel discards.
 *
 * Resolves with the (possibly-edited) SplashConfig the user committed, or
 * null if they closed without saving.
 */

const DISCORD_URL = 'https://discord.gg/UAEq4zzjD8';
const GITHUB_URL  = 'https://github.com/FrunkQ/dynamic-map-renderer-v2';
const KOFI_URL    = 'https://ko-fi.com/frunkq';
const SITE_URL    = 'https://www.mappadux.com/';

export interface AboutDialogOptions {
  packName: string;
  splash:   SplashConfig | undefined;
  theme:    ThemeConfig  | undefined;
  /** Open straight in edit mode (e.g. when triggered from "Customise pack…"). */
  startInEdit?: boolean;
}

export interface AboutDialogResult {
  /** Edited splash config (when the user pressed Save). */
  splash: SplashConfig;
  /** Edited theme config (when the user pressed Save). */
  theme:  ThemeConfig;
}

export class AboutDialog {
  private overlay: HTMLElement | null = null;
  private resolver: ((value: AboutDialogResult | null) => void) | null = null;
  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this._resolve(null);
  };

  /** Working copy in edit mode — committed to result on Save. */
  private draft: SplashConfig = {};
  /** Working copy of theme. Live-applied on edit, restored on Cancel. */
  private themeDraft: ThemeConfig = {};
  /** Snapshot of theme at open-time so Cancel can revert live previews. */
  private themeOriginal: ThemeConfig = {};
  private editing = false;
  private packName = '';

  open(opts: AboutDialogOptions): Promise<AboutDialogResult | null> {
    this.packName = opts.packName;
    this.draft = { ...(opts.splash ?? {}) };
    this.themeDraft    = { ...(opts.theme ?? {}) };
    this.themeOriginal = { ...(opts.theme ?? {}) };
    this.editing = !!opts.startInEdit;

    this.overlay = this._build();
    document.body.appendChild(this.overlay);
    document.addEventListener('keydown', this.onKey);
    return new Promise((resolve) => { this.resolver = resolve; });
  }

  private _resolve(value: AboutDialogResult | null): void {
    // Any cancel path while editing must revert live theme previews back to
    // whatever was active when the dialog opened.
    if (value === null && this.editing) {
      applyTheme(this.themeOriginal);
    }
    if (this.overlay) this.overlay.remove();
    this.overlay = null;
    document.removeEventListener('keydown', this.onKey);
    this.resolver?.(value);
    this.resolver = null;
  }

  private _build(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this._resolve(null);
    });

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog about-dialog';
    overlay.appendChild(dialog);

    // ── Header ──
    const header = document.createElement('div');
    header.className = 'modal-header';

    const title = document.createElement('span');
    title.className = 'modal-title';
    title.textContent = this.editing ? 'Customise About' : 'About';
    header.appendChild(title);

    const closeX = document.createElement('button');
    closeX.type = 'button';
    closeX.className = 'modal-close';
    closeX.textContent = '×';
    closeX.addEventListener('click', () => this._resolve(null));
    header.appendChild(closeX);

    dialog.appendChild(header);

    // ── Body container — re-rendered on mode toggle ──
    const body = document.createElement('div');
    body.className = 'about-body';
    dialog.appendChild(body);

    // Action footer is now folded into the always-on Mappadux footer
    // below — Cancel/Save (edit mode) and OK (display mode) live in the
    // same right-column slot alongside the duck icon and version line.
    // Keeps the dialog from stacking two horizontal footer rows.

    // ── Always-on Mappadux footer (never editable) ──
    const footer = document.createElement('div');
    footer.className = 'about-footer';
    footer.appendChild(this._buildAlwaysFooter());
    dialog.appendChild(footer);

    // Mode-aware render. Editing is set once via the constructor (display vs
    // edit) and never flipped at runtime — the hamburger has separate
    // entries for "About…" and "Customise pack…".
    title.textContent = this.editing ? 'Customise About' : 'About';
    body.appendChild(this.editing ? this._buildEditView() : this._buildDisplayView());

    return overlay;
  }

  // ─── Display mode ───────────────────────────────────────────────────────

  private _buildDisplayView(): HTMLElement {
    const root = document.createElement('div');
    root.className = 'about-display';

    // Banner image — creator-supplied if present, otherwise the Mappadux
    // duck icon as a default banner, slid down 25% so the hat + face land
    // nicely inside the 16:6 banner aspect rather than the centred middle band.
    const img = document.createElement('img');
    img.className = 'about-image';
    img.alt = '';
    if (this.draft.imageDataUrl) {
      img.src = this.draft.imageDataUrl;
      if (this.draft.imagePosition) img.style.objectPosition = this.draft.imagePosition;
    } else {
      img.src = '/icons/icon-512.png';
      img.style.objectPosition = '50% 25%';
    }
    root.appendChild(img);

    // Title — creator's title, fall back to pack name, fall back to default.
    const titleEl = document.createElement('h2');
    titleEl.className = 'about-title';
    titleEl.textContent =
      (this.draft.title?.trim()) ||
      (this.packName.trim()) ||
      'Mappadux — VTT@Home';
    root.appendChild(titleEl);

    // Body — prefer rich HTML; fall back to legacy plain-text (escape + line breaks);
    // fall back again to the default body when nothing's set.
    const bodyEl = document.createElement('div');
    bodyEl.className = 'about-text';
    const bodyHtml = (this.draft.bodyHtml ?? '').trim();
    const bodyPlain = (this.draft.body ?? '').trim();
    if (bodyHtml.length > 0) {
      bodyEl.innerHTML = sanitizeSplashHtml(bodyHtml);
    } else if (bodyPlain.length > 0) {
      bodyEl.innerHTML = escapeHtml(bodyPlain).replace(/\n/g, '<br>');
    } else {
      bodyEl.innerHTML = this._defaultBody();
    }
    root.appendChild(bodyEl);

    // Creator links
    const creatorLinks = (this.draft.links ?? []).filter(
      (l) => l.label.trim().length > 0 && l.url.trim().length > 0,
    );
    if (creatorLinks.length > 0) {
      const linksEl = document.createElement('div');
      linksEl.className = 'about-links';
      const heading = document.createElement('div');
      heading.className = 'about-links-heading';
      heading.textContent = 'Creator links';
      linksEl.appendChild(heading);
      const list = document.createElement('ul');
      list.className = 'about-links-list';
      for (const l of creatorLinks) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = l.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = l.label;
        li.appendChild(a);
        list.appendChild(li);
      }
      linksEl.appendChild(list);
      root.appendChild(linksEl);
    }

    return root;
  }

  // ─── Edit mode ──────────────────────────────────────────────────────────

  private _buildEditView(): HTMLElement {
    const root = document.createElement('div');
    root.className = 'about-edit';

    // Title input
    root.appendChild(this._labelled('Title', (() => {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'select-full';
      input.value = this.draft.title ?? '';
      input.placeholder = this.packName || 'Mappadux — VTT@Home';
      input.addEventListener('input', () => { this.draft.title = input.value; });
      return input;
    })()));

    // Rich body editor
    root.appendChild(this._labelled('Description', this._buildRichBodyEditor()));

    // Banner image upload + drag-to-pan crop picker
    root.appendChild(this._buildImageEditor());

    // Links editor
    root.appendChild(this._buildLinksEditor());

    // Theme editor — applies live so the user can see previews; reverts on Cancel.
    root.appendChild(this._buildThemeEditor());

    return root;
  }

  private _buildThemeEditor(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'about-theme';

    const heading = document.createElement('div');
    heading.className = 'about-theme-heading';
    heading.textContent = 'Theme';
    wrap.appendChild(heading);

    // ── Mode row: label on the left, dark/light segmented buttons on the right
    const modeRow = document.createElement('div');
    modeRow.className = 'about-theme-row';
    const modeLabel = document.createElement('span');
    modeLabel.className = 'about-theme-row-label';
    modeLabel.textContent = 'Mode';
    modeRow.appendChild(modeLabel);

    const segWrap = document.createElement('div');
    segWrap.className = 'about-seg';
    const mkSeg = (value: 'dark' | 'light', text: string): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'about-seg-btn';
      b.textContent = text;
      b.dataset.value = value;
      b.addEventListener('click', () => {
        if (value === 'dark') delete this.themeDraft.mode;
        else this.themeDraft.mode = 'light';
        applyTheme(this.themeDraft);
        refreshSeg();
      });
      return b;
    };
    const darkBtn  = mkSeg('dark',  'Dark');
    const lightBtn = mkSeg('light', 'Light');
    segWrap.append(darkBtn, lightBtn);
    const refreshSeg = () => {
      const active = this.themeDraft.mode === 'light' ? 'light' : 'dark';
      darkBtn.classList.toggle('about-seg-btn--active',  active === 'dark');
      lightBtn.classList.toggle('about-seg-btn--active', active === 'light');
    };
    refreshSeg();
    modeRow.appendChild(segWrap);
    wrap.appendChild(modeRow);

    // ── Accent row: label, swatch input, hex echo, reset
    const accentRow = document.createElement('div');
    accentRow.className = 'about-theme-row';
    const accentLabel = document.createElement('span');
    accentLabel.className = 'about-theme-row-label';
    accentLabel.textContent = 'Accent';
    accentRow.appendChild(accentLabel);

    const accentControls = document.createElement('div');
    accentControls.className = 'about-accent';

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'about-accent-swatch';
    colorInput.value = this.themeDraft.accent ?? '#0d9adb';
    colorInput.title = 'Pick accent colour';

    const hex = document.createElement('span');
    hex.className = 'about-accent-hex';
    hex.textContent = colorInput.value.toUpperCase();

    colorInput.addEventListener('input', () => {
      this.themeDraft.accent = colorInput.value;
      hex.textContent = colorInput.value.toUpperCase();
      applyTheme(this.themeDraft);
    });

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'btn btn--ghost btn--xs';
    resetBtn.textContent = 'Reset';
    resetBtn.title = 'Reset accent to Mappadux default';
    resetBtn.addEventListener('click', () => {
      delete this.themeDraft.accent;
      colorInput.value = '#0d9adb';
      hex.textContent = '#0D9ADB';
      applyTheme(this.themeDraft);
    });

    accentControls.append(colorInput, hex, resetBtn);
    accentRow.appendChild(accentControls);
    wrap.appendChild(accentRow);

    return wrap;
  }

  /**
   * Rich-text body editor — small toolbar over a contenteditable region.
   * Uses `document.execCommand` (deprecated-but-supported) for bold /
   * alignment / lists / colour / font; output is sanitised on save and
   * again on display via sanitizeSplashHtml.
   */
  private _buildRichBodyEditor(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'rte';

    // Toolbar
    const tb = document.createElement('div');
    tb.className = 'rte-toolbar';
    // Buttons must NOT steal focus from the editable region — clicking them
    // while text is selected has to keep the selection alive for execCommand.
    tb.addEventListener('mousedown', (e) => e.preventDefault());

    const editor = document.createElement('div');
    editor.className = 'rte-editor select-full';
    editor.contentEditable = 'true';
    editor.spellcheck = true;

    // Seed contents: HTML wins, plain-text body is escaped + line-broken,
    // otherwise placeholder via :empty CSS rule.
    if ((this.draft.bodyHtml ?? '').trim().length > 0) {
      editor.innerHTML = sanitizeSplashHtml(this.draft.bodyHtml!);
    } else if ((this.draft.body ?? '').trim().length > 0) {
      editor.innerHTML = escapeHtml(this.draft.body!).replace(/\n/g, '<br>');
    }
    editor.dataset.placeholder = 'Tell people about this pack…';

    const exec = (cmd: string, value?: string) => {
      editor.focus();
      document.execCommand(cmd, false, value);
      this.draft.bodyHtml = editor.innerHTML;
    };

    const mkBtn = (label: string, title: string, onClick: () => void, opts?: { bold?: boolean; italic?: boolean }): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rte-btn';
      b.title = title;
      b.textContent = label;
      if (opts?.bold)   b.style.fontWeight = '700';
      if (opts?.italic) b.style.fontStyle  = 'italic';
      b.addEventListener('click', () => onClick());
      return b;
    };

    const sep = () => {
      const s = document.createElement('span');
      s.className = 'rte-sep';
      return s;
    };

    tb.appendChild(mkBtn('B', 'Bold (Ctrl+B)',   () => exec('bold'),   { bold: true }));
    tb.appendChild(mkBtn('I', 'Italic (Ctrl+I)', () => exec('italic'), { italic: true }));
    tb.appendChild(mkBtn('U', 'Underline (Ctrl+U)', () => {
      exec('underline');
    }));

    tb.appendChild(sep());

    tb.appendChild(mkBtn('⯇', 'Align left',   () => exec('justifyLeft')));
    tb.appendChild(mkBtn('═', 'Align centre', () => exec('justifyCenter')));
    tb.appendChild(mkBtn('⯈', 'Align right',  () => exec('justifyRight')));

    tb.appendChild(sep());

    tb.appendChild(mkBtn('• List', 'Bulleted list',  () => exec('insertUnorderedList')));
    tb.appendChild(mkBtn('1. List', 'Numbered list', () => exec('insertOrderedList')));

    tb.appendChild(sep());

    // Font select
    const fontSel = document.createElement('select');
    fontSel.className = 'rte-select';
    fontSel.title = 'Font';
    const fonts: Array<[string, string]> = [
      ['System',     'system-ui, -apple-system, sans-serif'],
      ['Serif',      'Georgia, "Times New Roman", serif'],
      ['Mono',       '"JetBrains Mono", "Fira Code", monospace'],
      ['Display',    '"Trebuchet MS", "Lucida Sans", sans-serif'],
    ];
    for (const [label, value] of fonts) {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      fontSel.appendChild(o);
    }
    fontSel.addEventListener('change', () => exec('fontName', fontSel.value));
    fontSel.addEventListener('mousedown', (e) => e.stopPropagation());
    tb.appendChild(fontSel);

    // Colour
    const colorInput = document.createElement('input');
    colorInput.type  = 'color';
    colorInput.title = 'Text colour';
    colorInput.className = 'rte-color';
    colorInput.value = '#c8d8e8';
    colorInput.addEventListener('input', () => exec('foreColor', colorInput.value));
    // Prevent the picker from stealing focus before exec runs.
    colorInput.addEventListener('mousedown', (e) => e.stopPropagation());
    tb.appendChild(colorInput);

    wrap.append(tb, editor);

    // Persist changes as the user types / pastes.
    editor.addEventListener('input', () => {
      this.draft.bodyHtml = editor.innerHTML;
    });
    // Strip rich formatting from paste — keeps the editor predictable and
    // avoids hauling in random remote styles.
    editor.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain') ?? '';
      document.execCommand('insertText', false, text);
    });

    return wrap;
  }

  /**
   * Banner image editor — upload + drag-to-pan crop picker.
   *
   * The preview is at the same aspect / object-fit as the display banner
   * (`object-fit: cover`) so what the user sees is what gets shown on the
   * About dialog later. Drag inside the preview to slide the image — the
   * `object-position` X/Y % is saved on draft and applied at render.
   *
   * Math: with object-fit:cover, the image is scaled so its short axis
   * matches the preview, and the long axis overflows. object-position
   * 0% ↔ 100% maps the overflow range across the preview. Drag delta in
   * preview pixels divided by the overflow gives the position delta.
   */
  private _buildImageEditor(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '4px';

    const label = document.createElement('span');
    label.className = 'about-edit-label';
    label.textContent = 'Banner image (optional)';
    wrap.appendChild(label);

    // Preview frame at banner aspect — drag-to-pan target.
    const frame = document.createElement('div');
    frame.className = 'about-image-frame';
    const preview = document.createElement('img');
    preview.className = 'about-image about-image--preview';
    preview.alt = '';
    preview.draggable = false;
    frame.appendChild(preview);
    wrap.appendChild(frame);

    const hint = document.createElement('span');
    hint.className = 'about-image-hint';
    hint.textContent = 'Drag the image to choose which part shows in the banner.';
    wrap.appendChild(hint);

    // Show / hide preview frame based on whether we have an image.
    const setHasImage = (has: boolean) => {
      frame.hidden = !has;
      hint.hidden  = !has;
    };
    setHasImage(!!this.draft.imageDataUrl);

    if (this.draft.imageDataUrl) {
      preview.src = this.draft.imageDataUrl;
    }
    if (this.draft.imagePosition) {
      preview.style.objectPosition = this.draft.imagePosition;
    }

    // ── drag-to-pan ──
    // Capture state per drag:
    //   posX/Y       — current % object-position (0..100 each axis)
    //   startX/Y     — pointer-down position
    //   overflowX/Y  — px of image outside the frame on each axis
    let posX = 50, posY = 50;
    if (this.draft.imagePosition) {
      const m = /([\d.]+)%\s+([\d.]+)%/.exec(this.draft.imagePosition);
      if (m) { posX = parseFloat(m[1]!); posY = parseFloat(m[2]!); }
    }

    let dragging = false;
    let startX = 0, startY = 0, startPosX = 50, startPosY = 50;
    let overflowX = 0, overflowY = 0;

    const computeOverflow = () => {
      const frameW = frame.clientWidth;
      const frameH = frame.clientHeight;
      const iw = preview.naturalWidth;
      const ih = preview.naturalHeight;
      if (!iw || !ih || !frameW || !frameH) { overflowX = 0; overflowY = 0; return; }
      const frameAspect = frameW / frameH;
      const imgAspect   = iw / ih;
      if (imgAspect > frameAspect) {
        // Image wider than frame ratio → height fills, width overflows
        const renderedW = frameH * imgAspect;
        overflowX = renderedW - frameW;
        overflowY = 0;
      } else {
        // Image taller / narrower → width fills, height overflows
        const renderedH = frameW / imgAspect;
        overflowX = 0;
        overflowY = renderedH - frameH;
      }
    };

    const apply = () => {
      preview.style.objectPosition = `${posX}% ${posY}%`;
      this.draft.imagePosition     = `${posX}% ${posY}%`;
    };

    preview.addEventListener('load', () => {
      computeOverflow();
      apply();
    });

    frame.addEventListener('pointerdown', (e) => {
      if (overflowX === 0 && overflowY === 0) return; // nothing to pan
      computeOverflow();
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startPosX = posX;
      startPosY = posY;
      frame.setPointerCapture(e.pointerId);
      frame.classList.add('about-image-frame--dragging');
    });

    frame.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      // Dragging the image right (dx > 0) reveals the LEFT side ⇒ posX decreases.
      if (overflowX > 0) {
        posX = clamp(startPosX - (dx / overflowX) * 100, 0, 100);
      }
      if (overflowY > 0) {
        posY = clamp(startPosY - (dy / overflowY) * 100, 0, 100);
      }
      apply();
    });

    const endDrag = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      frame.releasePointerCapture(e.pointerId);
      frame.classList.remove('about-image-frame--dragging');
    };
    frame.addEventListener('pointerup', endDrag);
    frame.addEventListener('pointercancel', endDrag);

    // ── upload / replace / remove buttons ──
    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.gap = '6px';

    const uploadBtn = document.createElement('label');
    uploadBtn.className = 'btn btn--ghost btn--sm';
    uploadBtn.textContent = this.draft.imageDataUrl ? 'Replace image' : 'Upload image';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif';
    fileInput.hidden = true;
    uploadBtn.appendChild(fileInput);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn btn--ghost btn--sm';
    clearBtn.textContent = 'Remove image';
    clearBtn.hidden = !this.draft.imageDataUrl;

    const recenterBtn = document.createElement('button');
    recenterBtn.type = 'button';
    recenterBtn.className = 'btn btn--ghost btn--sm';
    recenterBtn.textContent = 'Re-centre';
    recenterBtn.hidden = !this.draft.imageDataUrl;
    recenterBtn.addEventListener('click', () => {
      posX = 50; posY = 50;
      apply();
    });

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const dataUrl = await readFileAsDataUrl(file);
        this.draft.imageDataUrl  = dataUrl;
        delete this.draft.imagePosition; // reset crop on new upload
        posX = 50; posY = 50;
        preview.src = dataUrl;
        setHasImage(true);
        uploadBtn.firstChild!.textContent = 'Replace image';
        // textContent above doesn't replace label text reliably across DOM
        // because of the nested input — set the label's first text node.
        for (const node of Array.from(uploadBtn.childNodes)) {
          if (node.nodeType === Node.TEXT_NODE) { node.textContent = 'Replace image'; break; }
        }
        clearBtn.hidden = false;
        recenterBtn.hidden = false;
      } finally {
        fileInput.value = '';
      }
    });

    clearBtn.addEventListener('click', () => {
      delete this.draft.imageDataUrl;
      delete this.draft.imagePosition;
      preview.src = '';
      setHasImage(false);
      for (const node of Array.from(uploadBtn.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) { node.textContent = 'Upload image'; break; }
      }
      clearBtn.hidden = true;
      recenterBtn.hidden = true;
    });

    btnRow.append(uploadBtn, recenterBtn, clearBtn);
    wrap.appendChild(btnRow);

    return wrap;
  }

  private _buildLinksEditor(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '4px';

    const label = document.createElement('span');
    label.className = 'about-edit-label';
    label.textContent = 'Creator links (optional)';
    wrap.appendChild(label);

    const list = document.createElement('div');
    list.className = 'about-links-edit';
    wrap.appendChild(list);

    const draftLinks: SplashLink[] = [...(this.draft.links ?? [])];
    if (draftLinks.length === 0) draftLinks.push({ label: '', url: '' });
    this.draft.links = draftLinks;

    const renderRows = () => {
      list.replaceChildren();
      draftLinks.forEach((link, idx) => {
        const row = document.createElement('div');
        row.className = 'about-links-row';
        row.style.display = 'grid';
        row.style.gridTemplateColumns = '1fr 2fr auto';
        row.style.gap = '6px';

        const labelInput = document.createElement('input');
        labelInput.type = 'text';
        labelInput.className = 'select-full';
        labelInput.placeholder = 'Label (e.g. Patreon)';
        labelInput.value = link.label;
        labelInput.addEventListener('input', () => { link.label = labelInput.value; });

        const urlInput = document.createElement('input');
        urlInput.type = 'url';
        urlInput.className = 'select-full';
        urlInput.placeholder = 'https://…';
        urlInput.value = link.url;
        urlInput.addEventListener('input', () => { link.url = urlInput.value; });

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn btn--ghost btn--sm';
        removeBtn.textContent = '−';
        removeBtn.title = 'Remove link';
        removeBtn.addEventListener('click', () => {
          draftLinks.splice(idx, 1);
          if (draftLinks.length === 0) draftLinks.push({ label: '', url: '' });
          renderRows();
        });

        row.append(labelInput, urlInput, removeBtn);
        list.appendChild(row);
      });
    };
    renderRows();

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn--ghost btn--sm';
    addBtn.textContent = '+ Add link';
    addBtn.addEventListener('click', () => {
      draftLinks.push({ label: '', url: '' });
      renderRows();
    });
    wrap.appendChild(addBtn);

    return wrap;
  }

  // ─── Always-on Mappadux footer ──────────────────────────────────────────

  private _buildAlwaysFooter(): HTMLElement {
    const root = document.createElement('div');
    root.className = 'about-mpx-footer';

    // Left column: small Mappadux duck icon, visually balancing the
    // action button on the right.
    const iconCol = document.createElement('div');
    iconCol.className = 'about-mpx-icon';
    const icon = document.createElement('img');
    icon.src = '/icons/icon-192.png';
    icon.alt = '';
    iconCol.appendChild(icon);
    root.appendChild(iconCol);

    // Centre column: version, links, licence stacked.
    const info = document.createElement('div');
    info.className = 'about-mpx-info';

    const versionLine = document.createElement('div');
    versionLine.className = 'about-mpx-version';
    versionLine.textContent = `Mappadux v${__APP_VERSION__} — VTT@Home`;
    info.appendChild(versionLine);

    const linksRow = document.createElement('div');
    linksRow.className = 'about-mpx-links';
    const links: Array<[string, string]> = [
      ['mappadux.com', SITE_URL],
      ['Discord',     DISCORD_URL],
      ['Ko-fi',       KOFI_URL],
      ['GitHub',      GITHUB_URL],
    ];
    links.forEach(([label, url], i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'about-mpx-sep';
        sep.textContent = '·';
        linksRow.appendChild(sep);
      }
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = label;
      linksRow.appendChild(a);
    });
    info.appendChild(linksRow);

    const licence = document.createElement('div');
    licence.className = 'about-mpx-licence';
    licence.textContent = 'MIT © FrunkQ';
    info.appendChild(licence);

    root.appendChild(info);

    // Right column: dialog-action buttons. Edit mode → Cancel + Save;
    // display mode → OK. Same slot in both states so the footer layout
    // stays consistent.
    const actionCol = document.createElement('div');
    actionCol.className = 'about-mpx-action';
    if (this.editing) {
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn--ghost';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => this._resolve(null));
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'btn btn--primary';
      saveBtn.textContent = 'Save';
      saveBtn.addEventListener('click', () => {
        this._resolve({
          splash: this._normaliseDraft(),
          theme:  this._normaliseTheme(),
        });
      });
      actionCol.append(cancelBtn, saveBtn);
    } else {
      const okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.className = 'btn btn--primary';
      okBtn.textContent = 'OK';
      okBtn.addEventListener('click', () => this._resolve(null));
      actionCol.appendChild(okBtn);
    }
    root.appendChild(actionCol);

    return root;
  }

  // ─── helpers ────────────────────────────────────────────────────────────

  private _labelled(label: string, control: HTMLElement): HTMLElement {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.flexDirection = 'column';
    row.style.gap = '4px';
    const lab = document.createElement('span');
    lab.className = 'about-edit-label';
    lab.textContent = label;
    row.append(lab, control);
    return row;
  }

  private _normaliseDraft(): SplashConfig {
    const out: SplashConfig = {};
    const t = (this.draft.title ?? '').trim();
    if (t) out.title = t;
    // Body: write sanitised HTML; only persist if there's meaningful content.
    const html  = sanitizeSplashHtml((this.draft.bodyHtml ?? '').trim());
    const plain = stripTags(html).trim();
    if (plain.length > 0) out.bodyHtml = html;
    if (this.draft.imageDataUrl) {
      out.imageDataUrl = this.draft.imageDataUrl;
      // Only persist a non-default crop position so the on-disk shape stays
      // small for the common "centre is fine" case.
      if (this.draft.imagePosition && this.draft.imagePosition !== '50% 50%') {
        out.imagePosition = this.draft.imagePosition;
      }
    }
    const links = (this.draft.links ?? [])
      .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
      .filter((l) => l.label.length > 0 && l.url.length > 0);
    if (links.length > 0) out.links = links;
    return out;
  }

  private _normaliseTheme(): ThemeConfig {
    const out: ThemeConfig = {};
    if (this.themeDraft.mode === 'light') out.mode = 'light';
    if (this.themeDraft.accent && this.themeDraft.accent !== '#0d9adb') {
      out.accent = this.themeDraft.accent;
    }
    return out;
  }

  private _defaultBody(): string {
    return (
      '<p><strong>Hi, I’m Alex.</strong></p>' +
      '<p>I wanted VTT features for the table I actually game at — players around real wood, a screen showing the map. I kept cobbling together half a dozen tools, and prep was eating most of my evening before anyone arrived. I wanted <em>one</em> thing: fast to set up, easy to use without breaking the flow of play.</p>' +
      '<p>So Mappadux:</p>' +
      '<ul>' +
      '<li>Setup any map with tokens, filters, scaling &amp; audio in <strong>minutes</strong>, not hours.</li>' +
      '<li>Shows maps on a second screen for players, or projects at true 1″ / 25 mm scale onto an under-table screen.</li>' +
      '<li>Handles fog of war, markers, motion trackers, atmospheric audio, and visual filters — without hunting through menus mid-scene.</li>' +
      '</ul>' +
      '<p><span style="color: #e0a040;"><strong>Tip:</strong> A PC is recommended for the GM side — your players can use mobile devices just fine.</span></p>' +
      '<p>It tries to feel <em>immersive</em>: parchment, hand-drawn, and CRT-phosphor filters; smooth map transitions; positional and motion-tracker audio.</p>' +
      '<p>And it’s built to <strong>share</strong>. Whole packs — maps, audio, splash, theme — travel in a single <code>.mappadux</code> file, so a session you built can reach your players, your Patreon, or the wider community as easily as forwarding an email.</p>' +
      '<p>One ask: <strong>credit the creators</strong> whose work you use. Every map and sound in Mappadux carries its licence, source, and creator; the asset library has a <em>Copy attributions</em> action that produces a ready-to-paste credits block. The community that supplies free, high-quality assets only keeps going if we keep acknowledging &amp; supporting it.</p>' +
      '<p>Open <em>Customise pack…</em> from the menu to make this &lsquo;About&rsquo; box your own.</p>'
    );
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function stripTags(html: string): string {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent ?? '';
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload  = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error ?? new Error('Could not read image'));
    fr.readAsDataURL(file);
  });
}
