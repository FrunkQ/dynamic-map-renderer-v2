import {
  getStoredApiKeys,
  deleteAllApiKeys,
  isVideoCap1080Enabled,
  setVideoCap1080Enabled,
  type StoredApiKey,
} from '../storage/localSettings.ts';

/**
 * Settings dialog. Houses:
 *   • Storage — IndexedDB usage / quota readout, persistence request.
 *   • API Keys — list of stored browser credentials with bulk delete.
 *   • Danger Zone — Delete DB (keep settings) / Delete All Data (wipe).
 *
 * Reads everything live each time it opens — there's nothing persisted by
 * the dialog itself. Destructive actions are handled by the caller via the
 * callbacks; the dialog just confirms intent.
 */
export interface SettingsDialogCallbacks {
  onDeleteDb:        () => Promise<void> | void;
  onDeleteAllData:   () => Promise<void> | void;
}

export class SettingsDialog {
  private overlay: HTMLElement | null = null;
  private resolver: (() => void) | null = null;
  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this._resolve();
  };

  open(cb: SettingsDialogCallbacks): Promise<void> {
    this.overlay = this._build(cb);
    document.body.appendChild(this.overlay);
    document.addEventListener('keydown', this.onKey);
    return new Promise((resolve) => { this.resolver = resolve; });
  }

  private _resolve(): void {
    if (this.overlay) this.overlay.remove();
    this.overlay = null;
    document.removeEventListener('keydown', this.onKey);
    this.resolver?.();
    this.resolver = null;
  }

  private _build(cb: SettingsDialogCallbacks): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    // Click-outside-to-dismiss intentionally disabled — use Close / × / Escape.

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog';
    dialog.style.width = '560px';
    overlay.appendChild(dialog);

    const header = document.createElement('div');
    header.className = 'modal-header';
    const title = document.createElement('span');
    title.className = 'modal-title';
    title.textContent = 'Settings';
    header.appendChild(title);
    const closeX = document.createElement('button');
    closeX.type = 'button';
    closeX.className = 'modal-close';
    closeX.textContent = '×';
    closeX.addEventListener('click', () => this._resolve());
    header.appendChild(closeX);
    dialog.appendChild(header);

    const body = document.createElement('div');
    body.className = 'settings-body';
    dialog.appendChild(body);

    // ── Storage section ──────────────────────────────────────────────────
    body.appendChild(this._buildStorageSection());
    // ── Performance section ──────────────────────────────────────────────
    body.appendChild(this._buildPerformanceSection());
    // ── API Keys section ─────────────────────────────────────────────────
    body.appendChild(this._buildApiKeysSection());
    // ── Danger Zone ──────────────────────────────────────────────────────
    body.appendChild(this._buildDangerZone(cb));

    // Footer — single Close button
    const footer = document.createElement('div');
    footer.className = 'about-actions';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn--ghost';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => this._resolve());
    footer.appendChild(closeBtn);
    dialog.appendChild(footer);

    return overlay;
  }

  // ─── Storage ────────────────────────────────────────────────────────────

  private _buildStorageSection(): HTMLElement {
    const sec = mkSection('Storage', 'How much of your browser’s allowance Mappadux is using. The quota is set by the browser — you can’t override it, but you can ask for persistence so the browser doesn’t evict your data under pressure.');

    const usageLine = document.createElement('div');
    usageLine.className = 'settings-stat';
    usageLine.textContent = 'Reading…';
    sec.appendChild(usageLine);

    const persistLine = document.createElement('div');
    persistLine.className = 'settings-stat';
    persistLine.textContent = 'Persistence: …';
    sec.appendChild(persistLine);

    const btnRow = document.createElement('div');
    btnRow.className = 'settings-btn-row';
    const persistBtn = document.createElement('button');
    persistBtn.type = 'button';
    persistBtn.className = 'btn btn--ghost btn--sm';
    persistBtn.textContent = 'Request persistent storage';
    persistBtn.addEventListener('click', async () => {
      if (!navigator.storage?.persist) {
        persistLine.textContent = 'Persistence: not supported in this browser.';
        return;
      }
      const ok = await navigator.storage.persist();
      persistLine.textContent = ok
        ? 'Persistence: enabled. Mappadux data is protected from eviction.'
        : 'Persistence: not granted. Try again after user activity, or rely on the standard quota.';
      persistBtn.hidden = ok;
    });
    btnRow.appendChild(persistBtn);
    sec.appendChild(btnRow);

    // Populate async — estimate + persisted are both Promises.
    void this._refreshStorageStats(usageLine, persistLine, persistBtn);

    return sec;
  }

  private async _refreshStorageStats(
    usageLine: HTMLElement,
    persistLine: HTMLElement,
    persistBtn: HTMLButtonElement,
  ): Promise<void> {
    if (navigator.storage?.estimate) {
      try {
        const est = await navigator.storage.estimate();
        const usage = est.usage ?? 0;
        const quota = est.quota ?? 0;
        const pct   = quota > 0 ? (usage / quota * 100).toFixed(1) : '?';
        usageLine.innerHTML = `Using <strong>${formatBytes(usage)}</strong> of <strong>${formatBytes(quota)}</strong> (${pct}%)`;
      } catch {
        usageLine.textContent = 'Storage usage unavailable in this browser.';
      }
    } else {
      usageLine.textContent = 'Storage usage unavailable in this browser.';
    }

    if (navigator.storage?.persisted) {
      try {
        const persisted = await navigator.storage.persisted();
        persistLine.textContent = persisted
          ? 'Persistence: enabled. Mappadux data is protected from eviction.'
          : 'Persistence: not granted. The browser may evict data if it runs low on space.';
        persistBtn.hidden = persisted;
      } catch {
        persistLine.textContent = 'Persistence: status unavailable.';
      }
    } else {
      persistLine.textContent = 'Persistence: not supported in this browser.';
      persistBtn.hidden = true;
    }
  }

  // ─── API Keys ───────────────────────────────────────────────────────────

  private _buildApiKeysSection(): HTMLElement {
    const sec = mkSection('API Keys (this browser only)', 'Credentials stored locally for external services. These never leave this browser — not even inside Map Pack exports.');

    const keys = getStoredApiKeys();
    if (keys.length === 0) {
      const none = document.createElement('div');
      none.className = 'settings-stat';
      none.style.fontStyle = 'italic';
      none.textContent = 'No API keys stored.';
      sec.appendChild(none);
    } else {
      const list = document.createElement('ul');
      list.className = 'settings-key-list';
      for (const k of keys) {
        const li = document.createElement('li');
        const label = document.createElement('span');
        label.textContent = k.label;
        const preview = document.createElement('span');
        preview.className = 'settings-key-preview';
        preview.textContent = k.preview;
        li.append(label, preview);
        list.appendChild(li);
      }
      sec.appendChild(list);

      const btnRow = document.createElement('div');
      btnRow.className = 'settings-btn-row';
      const deleteAll = document.createElement('button');
      deleteAll.type = 'button';
      deleteAll.className = 'btn btn--danger btn--sm';
      deleteAll.textContent = `Delete ${keys.length === 1 ? 'this key' : 'all API keys'}`;
      deleteAll.addEventListener('click', () => {
        const ok = confirm(
          `Delete ${keys.length === 1 ? 'this API key' : 'all stored API keys'}?\n\n` +
          `External services using these credentials will stop working until you re-enter them.`,
        );
        if (!ok) return;
        deleteAllApiKeys();
        // Re-render this section in place.
        const next = this._buildApiKeysSection();
        sec.replaceWith(next);
      });
      btnRow.appendChild(deleteAll);
      sec.appendChild(btnRow);
    }

    return sec;
  }

  // ─── Performance ────────────────────────────────────────────────────────

  private _buildPerformanceSection(): HTMLElement {
    const sec = mkSection(
      'Performance',
      'Settings that trade visual fidelity for smoother playback. Useful on lower-end GPUs or when running many windows at once.',
    );

    const row = document.createElement('div');
    row.className = 'settings-danger-row';

    const label = document.createElement('div');
    label.innerHTML =
      '<strong>Cap animated maps at 1080p</strong><br>' +
      '<span class="settings-stat-sub">Animated map textures render at the size of the player / projector window by default — so a 4K source on a 4K display uploads 4K every frame. ' +
      'On lower-end GPUs that can saturate the upload budget and the playback stalls. Tick this to cap the texture at 1920 px on the longest side regardless of window size — looks slightly softer when zoomed in, plays smoothly everywhere.</span>';

    const toggle = document.createElement('label');
    toggle.className = 'toggle-switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = isVideoCap1080Enabled();
    input.addEventListener('change', () => {
      setVideoCap1080Enabled(input.checked);
    });
    const slider = document.createElement('span');
    slider.className = 'toggle-slider';
    toggle.append(input, slider);

    row.append(label, toggle);
    sec.appendChild(row);
    return sec;
  }

  // ─── Danger Zone ────────────────────────────────────────────────────────

  private _buildDangerZone(cb: SettingsDialogCallbacks): HTMLElement {
    const sec = mkSection('Danger Zone', 'Destructive actions. Make sure you have a Map Pack saved first if you want to keep anything.');
    sec.classList.add('settings-danger');

    const row1 = document.createElement('div');
    row1.className = 'settings-danger-row';
    const row1Text = document.createElement('div');
    row1Text.innerHTML =
      '<strong>Delete database</strong><br>' +
      '<span class="settings-stat-sub">Wipes maps, audio, icons, and all pack settings. Keeps API keys, projector calibration, and other browser preferences.</span>';
    const row1Btn = document.createElement('button');
    row1Btn.type = 'button';
    row1Btn.className = 'btn btn--danger btn--sm';
    row1Btn.textContent = 'Delete DB';
    row1Btn.addEventListener('click', async () => {
      const ok = confirm(
        'Delete database?\n\n' +
        'This wipes ALL maps, sounds, custom icons, and pack settings. ' +
        'Your API keys and projector calibration stay. The page will reload into an empty workspace.',
      );
      if (!ok) return;
      await cb.onDeleteDb();
    });
    row1.append(row1Text, row1Btn);
    sec.appendChild(row1);

    const row2 = document.createElement('div');
    row2.className = 'settings-danger-row';
    const row2Text = document.createElement('div');
    row2Text.innerHTML =
      '<strong>Delete everything</strong><br>' +
      '<span class="settings-stat-sub">Wipes the database AND all local browser settings, including API keys and projector calibration. Acts like a fresh install.</span>';
    const row2Btn = document.createElement('button');
    row2Btn.type = 'button';
    row2Btn.className = 'btn btn--danger btn--sm';
    row2Btn.textContent = 'Delete All Data';
    row2Btn.addEventListener('click', async () => {
      const ok = confirm(
        'Delete EVERYTHING?\n\n' +
        'This wipes the database AND every local setting Mappadux has stored ' +
        '(API keys, projector calibration, UI preferences). The page will reload as if freshly installed.\n\n' +
        'This cannot be undone.',
      );
      if (!ok) return;
      await cb.onDeleteAllData();
    });
    row2.append(row2Text, row2Btn);
    sec.appendChild(row2);

    return sec;
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────

function mkSection(title: string, intro: string): HTMLElement {
  const sec = document.createElement('section');
  sec.className = 'settings-section';

  const h = document.createElement('div');
  h.className = 'settings-section-heading';
  h.textContent = title;
  sec.appendChild(h);

  const p = document.createElement('p');
  p.className = 'settings-section-intro';
  p.textContent = intro;
  sec.appendChild(p);

  return sec;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

// Re-export for callers that want to enumerate keys without importing the
// settings module directly.
export type { StoredApiKey };
