/**
 * Message-of-the-Day modal. One-off popup shown the first time a user
 * launches Mappadux after a version bump (see `src/motd/motd.ts`).
 * Borrows the confirmDialog visual structure for consistency — same
 * overlay class, same modal-dialog shell.
 *
 * Single "Got it" affirmative; ESC, × button, and backdrop click all
 * resolve identically (the only action available is "dismiss"). The
 * caller is responsible for marking the MOTD version as seen — this
 * component just renders + resolves.
 */

import type { MotdEntry } from '../motd/motd.ts';

export interface MotdDialogOptions {
  /** Visual variant. 'info' (default) is the neutral release-note look;
   *  'warn' adds a yellow warning bar — used for the beta-channel MOTD
   *  so the "features may appear and disappear" message reads as a
   *  caution, not a celebration. */
  variant?: 'info' | 'warn';
}

export function showMotdDialog(entry: MotdEntry, opts: MotdDialogOptions = {}): Promise<void> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay confirm-overlay motd-overlay';

    const dialog = document.createElement('div');
    const variantClass = opts.variant === 'warn' ? ' motd-dialog--warn' : '';
    dialog.className = `modal-dialog modal-dialog--sm confirm-dialog motd-dialog${variantClass}`;
    overlay.appendChild(dialog);

    // Header — title + close ×.
    const header = document.createElement('div');
    header.className = 'modal-header confirm-header';
    const titleEl = document.createElement('span');
    titleEl.className = 'modal-title';
    titleEl.textContent = entry.title;
    header.appendChild(titleEl);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Dismiss');
    closeBtn.textContent = '×';
    header.appendChild(closeBtn);
    dialog.appendChild(header);

    // Body — one paragraph per entry. textContent only; no HTML
    // interpretation so a future MOTD can't accidentally inject
    // markup via a paste error.
    const body = document.createElement('div');
    body.className = 'confirm-body motd-body';
    for (const para of entry.body) {
      const p = document.createElement('p');
      p.textContent = para;
      body.appendChild(p);
    }
    dialog.appendChild(body);

    // Footer — single "Got it" button.
    const footer = document.createElement('div');
    footer.className = 'confirm-footer';
    const okBtn = document.createElement('button');
    okBtn.className = 'btn btn--sm btn--primary';
    okBtn.type = 'button';
    okBtn.textContent = 'Got it';
    footer.appendChild(okBtn);
    dialog.appendChild(footer);

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') finish();
    };
    closeBtn.addEventListener('click', finish);
    okBtn.addEventListener('click', finish);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(); });
    document.addEventListener('keydown', onKey);

    document.body.appendChild(overlay);
    okBtn.focus();
  });
}
