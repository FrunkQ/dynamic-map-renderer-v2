/**
 * Prompt shown on startup when the URL has `?bundle=<url>` AND the user's
 * IndexedDB already has content. Lets them save their current pack first,
 * discard it, or cancel the URL load and keep what they have.
 *
 * Resolves with the choice the user made, or 'cancel' on Escape / outside-
 * click / X.
 */
export type BundleUrlChoice = 'save-then-load' | 'discard-and-load' | 'cancel';

export class BundleUrlPromptDialog {
  private overlay: HTMLElement | null = null;
  private resolver: ((value: BundleUrlChoice) => void) | null = null;
  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this._resolve('cancel');
  };

  open(bundleUrl: string): Promise<BundleUrlChoice> {
    this.overlay = this._build(bundleUrl);
    document.body.appendChild(this.overlay);
    document.addEventListener('keydown', this.onKey);
    return new Promise((resolve) => { this.resolver = resolve; });
  }

  private _resolve(value: BundleUrlChoice): void {
    if (this.overlay) this.overlay.remove();
    this.overlay = null;
    document.removeEventListener('keydown', this.onKey);
    this.resolver?.(value);
    this.resolver = null;
  }

  private _build(bundleUrl: string): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this._resolve('cancel');
    });

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog modal-dialog--sm';
    overlay.appendChild(dialog);

    const header = document.createElement('div');
    header.className = 'modal-header';
    const title = document.createElement('span');
    title.className = 'modal-title';
    title.textContent = 'Load Map Pack from URL';
    header.appendChild(title);
    const closeX = document.createElement('button');
    closeX.type = 'button';
    closeX.className = 'modal-close';
    closeX.textContent = '×';
    closeX.addEventListener('click', () => this._resolve('cancel'));
    header.appendChild(closeX);
    dialog.appendChild(header);

    const body = document.createElement('div');
    body.style.padding = 'var(--space-md)';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.gap = 'var(--space-sm)';

    const intro = document.createElement('p');
    intro.style.color = 'var(--text-secondary)';
    intro.style.margin = '0';
    intro.innerHTML =
      'A Map Pack is being loaded from this URL:';
    body.appendChild(intro);

    const urlBox = document.createElement('code');
    urlBox.style.background = 'var(--code-bg)';
    urlBox.style.color = 'var(--code-text)';
    urlBox.style.padding = '6px 10px';
    urlBox.style.borderRadius = 'var(--radius-sm)';
    urlBox.style.fontSize = '0.78rem';
    urlBox.style.wordBreak = 'break-all';
    urlBox.textContent = bundleUrl;
    body.appendChild(urlBox);

    const warn = document.createElement('p');
    warn.style.color = '#ff8a8a';
    warn.style.margin = 'var(--space-sm) 0 0';
    warn.innerHTML =
      '<strong>Loading this pack will replace your current workspace</strong> ' +
      '— all maps, sounds, custom icons, and settings. Save your current pack first if you want to keep it.';
    body.appendChild(warn);

    dialog.appendChild(body);

    const footer = document.createElement('div');
    footer.style.padding = 'var(--space-md)';
    footer.style.borderTop = '1px solid var(--border)';
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = 'var(--space-sm)';
    footer.style.flexWrap = 'wrap';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn--ghost';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => this._resolve('cancel'));

    const discardBtn = document.createElement('button');
    discardBtn.type = 'button';
    discardBtn.className = 'btn btn--danger';
    discardBtn.textContent = 'Discard and load';
    discardBtn.addEventListener('click', () => this._resolve('discard-and-load'));

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn btn--primary';
    saveBtn.textContent = 'Save current, then load';
    saveBtn.addEventListener('click', () => this._resolve('save-then-load'));

    footer.append(cancelBtn, discardBtn, saveBtn);
    dialog.appendChild(footer);

    return overlay;
  }
}
