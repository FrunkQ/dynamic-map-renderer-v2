import {
  decryptBundleEnvelopeToBytes,
  type EncryptedBundleEnvelope,
} from '../storage/bundleCrypto.ts';

/**
 * "Encrypted Map Pack" dialog — opens when the user tries to load a bundle
 * file that turned out to be encrypted. Prompts for the password and
 * attempts decryption inline; bad passwords show an error and let the user
 * try again without closing the dialog.
 *
 * Resolves with the raw plaintext bytes on success (caller decides whether
 * to gunzip per the envelope's `compressed` flag), or `null` on cancel.
 */
export class PasswordPromptDialog {
  private overlay: HTMLElement | null = null;
  private resolver: ((plain: Uint8Array | null) => void) | null = null;
  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this._resolve(null);
  };

  open(envelope: EncryptedBundleEnvelope): Promise<Uint8Array | null> {
    this.overlay = this._build(envelope);
    document.body.appendChild(this.overlay);
    document.addEventListener('keydown', this.onKey);
    return new Promise((resolve) => { this.resolver = resolve; });
  }

  private _resolve(value: Uint8Array | null): void {
    if (this.overlay) this.overlay.remove();
    this.overlay = null;
    document.removeEventListener('keydown', this.onKey);
    this.resolver?.(value);
    this.resolver = null;
  }

  private _build(envelope: EncryptedBundleEnvelope): HTMLElement {
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
    title.textContent = 'Encrypted Map Pack';
    header.appendChild(title);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'modal-close';
    close.textContent = '×';
    close.addEventListener('click', () => this._resolve(null));
    header.appendChild(close);
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
    intro.textContent = 'This pack is password-protected. Enter the password to open it.';
    body.appendChild(intro);

    const pw = document.createElement('input');
    pw.type = 'password';
    pw.placeholder = 'Password';
    pw.className = 'select-full';
    pw.autocomplete = 'current-password';
    body.appendChild(pw);
    setTimeout(() => pw.focus(), 0);

    const err = document.createElement('p');
    err.style.color = '#ff8a8a';
    err.style.fontSize = 'var(--font-size-sm)';
    err.style.margin = '0';
    err.style.minHeight = '1.2em';
    body.appendChild(err);

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

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'btn btn--primary';
    openBtn.textContent = 'Open';

    const tryDecrypt = async () => {
      err.textContent = '';
      const password = pw.value;
      if (password.length === 0) {
        err.textContent = 'Please enter the password.';
        return;
      }
      openBtn.disabled = true;
      cancelBtn.disabled = true;
      try {
        const bytes = await decryptBundleEnvelopeToBytes(envelope, password);
        this._resolve(bytes);
      } catch {
        err.textContent = 'Wrong password or corrupt file.';
        pw.select();
      } finally {
        openBtn.disabled = false;
        cancelBtn.disabled = false;
      }
    };

    openBtn.addEventListener('click', () => { void tryDecrypt(); });
    pw.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void tryDecrypt();
      }
    });

    footer.append(cancelBtn, openBtn);
    dialog.appendChild(footer);

    return overlay;
  }
}
