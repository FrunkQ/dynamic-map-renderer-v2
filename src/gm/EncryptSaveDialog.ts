/**
 * "Save Encrypted Pack…" dialog — single-purpose password collector that
 * runs before the native save picker on the encrypted-save path.
 *
 * Resolves with:
 *   - { password }   — proceed to save
 *   - null           — user cancelled
 */
export interface EncryptSaveResult {
  password: string;
}

export class EncryptSaveDialog {
  private overlay: HTMLElement | null = null;
  private resolver: ((value: EncryptSaveResult | null) => void) | null = null;
  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this._resolve(null);
  };

  open(): Promise<EncryptSaveResult | null> {
    this.overlay = this._build();
    document.body.appendChild(this.overlay);
    document.addEventListener('keydown', this.onKey);
    return new Promise((resolve) => { this.resolver = resolve; });
  }

  private _resolve(value: EncryptSaveResult | null): void {
    if (this.overlay) this.overlay.remove();
    this.overlay = null;
    document.removeEventListener('keydown', this.onKey);
    this.resolver?.(value);
    this.resolver = null;
  }

  private _build(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    // Click-outside-to-dismiss intentionally disabled — use Cancel / × / Escape.

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog modal-dialog--sm';
    overlay.appendChild(dialog);

    // Header
    const header = document.createElement('div');
    header.className = 'modal-header';
    const title = document.createElement('span');
    title.className = 'modal-title';
    title.textContent = 'Save Encrypted Pack';
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

    const intro = document.createElement('p');
    intro.style.color = 'var(--text-secondary)';
    intro.style.margin = '0';
    intro.textContent =
      'Choose a password. The pack will be encrypted with AES-GCM before the save dialog opens; recipients will need this password to load it.';
    body.appendChild(intro);

    const pw1 = document.createElement('input');
    pw1.type = 'password';
    pw1.placeholder = 'Password';
    pw1.className = 'select-full';
    pw1.autocomplete = 'new-password';
    body.appendChild(pw1);

    const pw2 = document.createElement('input');
    pw2.type = 'password';
    pw2.placeholder = 'Confirm password';
    pw2.className = 'select-full';
    pw2.autocomplete = 'new-password';
    body.appendChild(pw2);

    const warn = document.createElement('p');
    warn.style.color = '#ff8a8a';
    warn.style.fontSize = 'var(--font-size-sm)';
    warn.style.margin = '0';
    warn.textContent =
      'If you forget this password, the pack cannot be recovered. Mappadux has no recovery.';
    body.appendChild(warn);

    const err = document.createElement('p');
    err.style.color = '#ff8a8a';
    err.style.fontSize = 'var(--font-size-sm)';
    err.style.margin = '0';
    err.style.minHeight = '1.2em';
    body.appendChild(err);

    setTimeout(() => pw1.focus(), 0);

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

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn btn--primary';
    saveBtn.textContent = 'Continue…';
    saveBtn.addEventListener('click', () => {
      const a = pw1.value;
      const b = pw2.value;
      if (a.length === 0) {
        err.textContent = 'Please enter a password.';
        pw1.focus();
        return;
      }
      if (a !== b) {
        err.textContent = 'Passwords do not match.';
        pw2.focus();
        return;
      }
      this._resolve({ password: a });
    });

    for (const input of [pw1, pw2]) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          saveBtn.click();
        }
      });
    }

    footer.append(cancelBtn, saveBtn);
    dialog.appendChild(footer);

    return overlay;
  }
}
