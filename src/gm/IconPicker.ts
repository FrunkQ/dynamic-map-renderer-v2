import { saveAsset, getAllAssets, deleteAsset } from '../storage/db.ts';

const PRESET_ICONS = [
  '◆','◇','●','○','■','□','▲','△','▼','▽',
  '★','☆','✦','✧','❖','♦','♠','♥','♣','♟',
  '✚','✖','✗','✘','✓','✔','🔊',
  '①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩',
  '⑪','⑫','⑬','⑭','⑮','⑯','⑰','⑱','⑲','⑳',
];

/**
 * IconPicker — popover for selecting marker icons.
 *
 * Supports preset Unicode symbols and custom uploaded images (stored as assets
 * in IndexedDB). Custom icons use 'asset:<uuid>' as their key in iconCache and
 * in the marker.icon field.
 */
export class IconPicker {
  private readonly _el: HTMLElement;
  private readonly _fileInput: HTMLInputElement;
  private _onSelect:    ((icon: string) => void) | null = null;
  private _deleteMode = false;
  private _currentIcon = '◆';
  readonly iconCache    = new Map<string, ImageBitmap>();
  /** data URLs keyed by 'asset:uuid' — used when broadcasting markers over P2P */
  readonly iconDataUrls = new Map<string, string>();

  constructor() {
    // Build the popover element
    this._el = document.createElement('div');
    this._el.className = 'icon-picker';
    this._el.hidden = true;
    document.body.appendChild(this._el);

    // Hidden file input for icon uploads
    this._fileInput = document.createElement('input');
    this._fileInput.type = 'file';
    this._fileInput.accept = 'image/*';
    this._fileInput.hidden = true;
    document.body.appendChild(this._fileInput);

    this._bindClose();
    this._bindUpload();
  }

  /** Load custom icons from IndexedDB and pre-decode to ImageBitmap + data URL. */
  async load(): Promise<void> {
    const assets = await getAllAssets('icon');
    await Promise.all(assets.map(async (a) => {
      const key = 'asset:' + a.id;
      if (!this.iconCache.has(key)) {
        const [bmp, dataUrl] = await Promise.all([
          createImageBitmap(a.blob),
          IconPicker._blobToDataUrl(a.blob),
        ]);
        this.iconCache.set(key, bmp);
        this.iconDataUrls.set(key, dataUrl);
      }
    }));
  }

  /** Drop the in-memory cache and reload from IDB — call after the asset library is wiped. */
  async reload(): Promise<void> {
    this.iconCache.clear();
    this.iconDataUrls.clear();
    await this.load();
  }

  private static _blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  /** Open the picker anchored below `anchor`. `currentIcon` is highlighted. */
  open(anchor: HTMLElement, currentIcon: string, onSelect: (icon: string) => void): void {
    this._onSelect    = onSelect;
    this._currentIcon = currentIcon;
    this._deleteMode  = false;
    void this._rebuild(currentIcon);
    const rect = anchor.getBoundingClientRect();
    this._el.style.left = `${Math.min(rect.left, window.innerWidth - 270)}px`;
    this._el.style.top  = `${rect.bottom + 4}px`;
    this._el.hidden = false;
  }

  close(): void {
    this._el.hidden  = true;
    this._onSelect   = null;
    this._deleteMode = false;
  }

  private async _rebuild(current: string): Promise<void> {
    this._el.innerHTML = '';

    // ── Preset section ──────────────────────────────────────────────────────
    const presetLabel = document.createElement('div');
    presetLabel.className = 'icon-picker-section-label';
    presetLabel.textContent = 'Preset';
    this._el.appendChild(presetLabel);

    const presetGrid = document.createElement('div');
    presetGrid.className = 'icon-picker-grid';
    for (const icon of PRESET_ICONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'icon-picker-btn' + (current === icon ? ' icon-picker-btn--active' : '');
      btn.textContent = icon;
      btn.addEventListener('click', () => {
        this._onSelect?.(icon);
        this.close();
      });
      presetGrid.appendChild(btn);
    }
    this._el.appendChild(presetGrid);

    // ── Custom icons section ─────────────────────────────────────────────────
    const assets = await getAllAssets('icon');
    if (assets.length > 0) {
      const sep = document.createElement('div');
      sep.className = 'icon-picker-sep';
      this._el.appendChild(sep);

      const customLabel = document.createElement('div');
      customLabel.className = 'icon-picker-section-label';
      customLabel.textContent = this._deleteMode ? 'Custom — click to delete' : 'Custom';
      if (this._deleteMode) customLabel.style.color = 'var(--danger, #e05)';
      this._el.appendChild(customLabel);

      const customGrid = document.createElement('div');
      customGrid.className = 'icon-picker-grid';
      for (const asset of assets) {
        const assetKey = 'asset:' + asset.id;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'icon-picker-btn'
          + (current === assetKey ? ' icon-picker-btn--active' : '')
          + (this._deleteMode ? ' icon-picker-btn--danger' : '');

        const img = document.createElement('img');
        img.src = URL.createObjectURL(asset.blob);
        img.onload = () => URL.revokeObjectURL(img.src);
        btn.appendChild(img);

        btn.addEventListener('click', () => {
          if (this._deleteMode) {
            void deleteAsset(asset.id).then(async () => {
              this.iconCache.delete(assetKey);
              this.iconDataUrls.delete(assetKey);
              const remaining = await getAllAssets('icon');
              if (remaining.length === 0) this._deleteMode = false;
              void this._rebuild(this._currentIcon);
            });
          } else {
            this._onSelect?.(assetKey);
            this.close();
          }
        });
        customGrid.appendChild(btn);
      }
      this._el.appendChild(customGrid);
    }

    // ── Upload / delete buttons ───────────────────────────────────────────────
    const sep2 = document.createElement('div');
    sep2.className = 'icon-picker-sep';
    this._el.appendChild(sep2);

    const uploadBtn = document.createElement('button');
    uploadBtn.type = 'button';
    uploadBtn.className = 'icon-picker-upload';
    uploadBtn.textContent = '+ Upload custom icon';
    uploadBtn.addEventListener('click', () => {
      this._fileInput.click();
    });
    this._el.appendChild(uploadBtn);

    if (assets.length > 0) {
      const deleteToggleBtn = document.createElement('button');
      deleteToggleBtn.type = 'button';
      deleteToggleBtn.className = 'icon-picker-upload icon-picker-upload--danger';
      deleteToggleBtn.textContent = this._deleteMode ? '← Cancel delete' : '✕ Delete custom icon';
      deleteToggleBtn.addEventListener('click', () => {
        this._deleteMode = !this._deleteMode;
        void this._rebuild(this._currentIcon);
      });
      this._el.appendChild(deleteToggleBtn);
    }
  }

  private _bindClose(): void {
    document.addEventListener('pointerdown', (e) => {
      if (!this._el.hidden && !this._el.contains(e.target as Node)) {
        this.close();
      }
    }, { capture: true });
  }

  private _bindUpload(): void {
    this._fileInput.addEventListener('change', async () => {
      const file = this._fileInput.files?.[0];
      if (!file) return;
      this._fileInput.value = '';

      const blob = await this._resize(file, 64);
      const id   = crypto.randomUUID();
      await saveAsset({ id, name: file.name, type: 'icon', blob, addedAt: Date.now() });

      const [bmp, dataUrl] = await Promise.all([
        createImageBitmap(blob),
        IconPicker._blobToDataUrl(blob),
      ]);
      const iconKey = 'asset:' + id;
      this.iconCache.set(iconKey, bmp);
      this.iconDataUrls.set(iconKey, dataUrl);

      this._onSelect?.(iconKey);
      this.close();
    });
  }

  private async _resize(file: File, size: number): Promise<Blob> {
    const bmp = await createImageBitmap(file);
    const cv  = document.createElement('canvas');
    cv.width  = size;
    cv.height = size;
    cv.getContext('2d')!.drawImage(bmp, 0, 0, size, size);
    bmp.close();
    return new Promise<Blob>((resolve) =>
      cv.toBlob((b) => resolve(b!), 'image/png')
    );
  }
}
