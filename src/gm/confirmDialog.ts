/**
 * Styled confirm dialog — replaces `window.confirm()` calls so
 * destructive actions get a Mappadux-themed prompt instead of the
 * browser's native chrome. Mirrors the modal-overlay / modal-dialog
 * structure used by the asset library and other in-app modals.
 *
 * Usage:
 *   const ok = await confirmDialog({
 *     title: 'Delete all 3 Coloured Flames polygons?',
 *     body: "This can't be undone.",
 *     confirmLabel: 'Delete',
 *     confirmTone: 'danger',
 *   });
 *
 * Resolves true if the GM picks the confirm button, false if they
 * pick Cancel, close via the × button, click the backdrop, or
 * press Escape.
 */

export interface ConfirmDialogOptions {
  /** Headline question. Required. */
  title: string;
  /** Optional supporting paragraph beneath the title. */
  body?: string;
  /** Label for the confirm button. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Label for the cancel button. Defaults to "Cancel". */
  cancelLabel?: string;
  /**
   * Visual tone of the confirm button.
   *  - 'danger' — red, for destructive actions (delete, clear).
   *  - 'primary' — accent, for affirmative non-destructive actions.
   *  Defaults to 'primary'.
   */
  confirmTone?: 'danger' | 'primary';
}

/** Show the dialog and resolve when the GM picks an option. */
export function confirmDialog(opts: ConfirmDialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay confirm-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog modal-dialog--sm confirm-dialog';
    overlay.appendChild(dialog);

    // Header — title + close × on the right.
    const header = document.createElement('div');
    header.className = 'modal-header confirm-header';
    const titleEl = document.createElement('span');
    titleEl.className = 'modal-title';
    titleEl.textContent = opts.title;
    header.appendChild(titleEl);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Cancel');
    closeBtn.textContent = '×';
    header.appendChild(closeBtn);
    dialog.appendChild(header);

    // Body — optional paragraph.
    if (opts.body) {
      const body = document.createElement('div');
      body.className = 'confirm-body';
      const p = document.createElement('p');
      p.textContent = opts.body;
      body.appendChild(p);
      dialog.appendChild(body);
    }

    // Footer — Cancel + Confirm side by side. Cancel sits left so
    // hitting Tab from the title lands on Cancel first, then
    // Confirm — Enter naturally lands on Confirm, which is the
    // expected affordance.
    const footer = document.createElement('div');
    footer.className = 'confirm-footer';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn--sm btn--ghost';
    cancelBtn.type = 'button';
    cancelBtn.textContent = opts.cancelLabel ?? 'Cancel';
    const confirmBtn = document.createElement('button');
    const tone = opts.confirmTone ?? 'primary';
    confirmBtn.className = tone === 'danger'
      ? 'btn btn--sm btn--danger'
      : 'btn btn--sm btn--primary';
    confirmBtn.type = 'button';
    confirmBtn.textContent = opts.confirmLabel ?? 'Confirm';
    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);
    dialog.appendChild(footer);

    // Cleanup + resolve helpers.
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(result);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      else if (e.key === 'Enter') {
        // Only intercept Enter when no input/textarea is focused
        // inside the dialog (this confirm has none, but defensive).
        const t = e.target as HTMLElement | null;
        if (!t || (t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA')) {
          e.preventDefault(); finish(true);
        }
      }
    };

    closeBtn.addEventListener('click', () => finish(false));
    cancelBtn.addEventListener('click', () => finish(false));
    confirmBtn.addEventListener('click', () => finish(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(false);
    });
    document.addEventListener('keydown', onKey);

    document.body.appendChild(overlay);
    confirmBtn.focus();
  });
}
