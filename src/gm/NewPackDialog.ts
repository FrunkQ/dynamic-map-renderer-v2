/**
 * "New Map Pack…" dialog — clears the current workspace and starts an empty
 * pack with a fresh name. Destructive; pairs with a strong warning and a
 * red action button.
 *
 * Resolves with { packName } on confirm, null on cancel.
 */
export interface NewPackResult {
  packName: string;
}

export class NewPackDialog {
  private overlay: HTMLElement | null = null;
  private resolver: ((value: NewPackResult | null) => void) | null = null;
  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this._resolve(null);
  };

  open(): Promise<NewPackResult | null> {
    this.overlay = this._build();
    document.body.appendChild(this.overlay);
    document.addEventListener('keydown', this.onKey);
    return new Promise((resolve) => { this.resolver = resolve; });
  }

  private _resolve(value: NewPackResult | null): void {
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
    dialog.className = 'modal-dialog modal-dialog--sm';
    overlay.appendChild(dialog);

    // Header
    const header = document.createElement('div');
    header.className = 'modal-header';
    const title = document.createElement('span');
    title.className = 'modal-title';
    title.textContent = 'New Map Pack';
    header.appendChild(title);
    const closeX = document.createElement('button');
    closeX.type = 'button';
    closeX.className = 'modal-close';
    closeX.textContent = '×';
    closeX.addEventListener('click', () => this._resolve(null));
    header.appendChild(closeX);
    dialog.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.style.padding = 'var(--space-md)';
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.gap = 'var(--space-md)';
    dialog.appendChild(body);

    const warn = document.createElement('p');
    warn.style.color = '#ff8a8a';
    warn.style.margin = '0';
    warn.innerHTML =
      '<strong>This deletes everything.</strong> ' +
      'All maps, sounds, custom icons, fog, markers, splash content, and theme will be wiped. ' +
      'The new pack starts completely empty — even the Getting Started maps are removed. ' +
      'Save your current pack first if you want to keep it.';
    body.appendChild(warn);

    const nameLabel = document.createElement('span');
    nameLabel.className = 'about-edit-label';
    nameLabel.textContent = 'Pack name';
    body.appendChild(nameLabel);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'select-full';
    nameInput.placeholder = 'My New Pack';
    body.appendChild(nameInput);
    setTimeout(() => nameInput.focus(), 0);

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
    cancelBtn.addEventListener('click', () => this._resolve(null));

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'btn btn--danger';
    confirmBtn.textContent = 'Wipe and Start New Pack';
    confirmBtn.addEventListener('click', () => {
      const name = nameInput.value.trim();
      this._resolve({ packName: name });
    });
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); confirmBtn.click(); }
    });

    footer.append(cancelBtn, confirmBtn);
    dialog.appendChild(footer);

    return overlay;
  }
}
