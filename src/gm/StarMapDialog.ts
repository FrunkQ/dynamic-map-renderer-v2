/**
 * StarMapDialog — v2.18 "Add / Edit StarMap" (docs/starmap-map-kind-design.md 4.2).
 *
 * Connection-aware in every state (decision Q2 of the integration design):
 *   searching  → spinner while the bridge asks the SSE tab "who is here?"
 *   found      → "Connected: <starmap>" + tick the Player Views to add
 *   not found  → says so, offers "Open Star System Explorer" and Retry, and
 *                auto-advances to `found` the moment an SSE tab announces
 *                itself (no polling — the bridge relays unsolicited announces)
 * Also gates on SSE's app version: an SSE too old to speak the discovery
 * contract is reported as "needs updating", not as "not running".
 *
 * Resolves with the chosen presets (one StarMap map is minted per tick by the
 * caller) or null on cancel. In edit mode (`seed` given) it re-picks ONE preset
 * and refreshes names for an existing asset.
 */
import { sse2Bridge, Sse2Bridge, MIN_SSE_VERSION, type SseAnnounce } from './Sse2Bridge.ts';
import type { StarMapConfig } from '../types.ts';

export interface StarMapDialogResult {
  origin: string;
  announce: SseAnnounce;
  presets: { id: string; name: string }[];
}

export class StarMapDialog {
  private overlay: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private resolver: ((v: StarMapDialogResult | null) => void) | null = null;
  private origin: string;
  private announce: SseAnnounce | null = null;
  private unsub: (() => void) | null = null;
  private onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') this._resolve(null); };

  constructor(private seed?: StarMapConfig) {
    this.origin = Sse2Bridge.normaliseOrigin(seed?.origin);
  }

  open(): Promise<StarMapDialogResult | null> {
    this.overlay = this._build();
    document.body.appendChild(this.overlay);
    document.addEventListener('keydown', this.onKey);
    // Any announce (solicited or not) while we are open keeps the dialog current —
    // this is the "Open SSE, come back, it just works" path.
    this.unsub = sse2Bridge.onAnnounce((a, origin) => {
      if (origin !== this.origin) return;
      this.announce = a;
      this._renderFound();
    });
    void this._search();
    return new Promise((resolve) => { this.resolver = resolve; });
  }

  private _resolve(v: StarMapDialogResult | null): void {
    this.unsub?.(); this.unsub = null;
    this.overlay?.remove(); this.overlay = null;
    document.removeEventListener('keydown', this.onKey);
    this.resolver?.(v); this.resolver = null;
  }

  private async _search(): Promise<void> {
    this._renderSearching();
    const a = await sse2Bridge.hello(this.origin);
    if (!this.overlay) return;
    if (a) { this.announce = a; this._renderFound(); }
    else this._renderNotFound();
  }

  // ─── Build ────────────────────────────────────────────────────────────────

  private _build(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog modal-dialog--sm';
    overlay.appendChild(dialog);

    const header = document.createElement('div');
    header.className = 'modal-header';
    const title = document.createElement('span');
    title.className = 'modal-title';
    title.textContent = this.seed ? 'Edit StarMap' : 'Add StarMap';
    header.appendChild(title);
    const closeX = document.createElement('button');
    closeX.type = 'button'; closeX.className = 'modal-close'; closeX.textContent = '×';
    closeX.addEventListener('click', () => this._resolve(null));
    header.appendChild(closeX);
    dialog.appendChild(header);

    const body = document.createElement('div');
    body.style.cssText = 'padding:var(--space-md);display:flex;flex-direction:column;gap:var(--space-md);';
    dialog.appendChild(body);
    this.body = body;
    return overlay;
  }

  private _intro(): HTMLElement {
    const p = document.createElement('p');
    p.style.margin = '0';
    p.style.opacity = '0.85';
    p.textContent = 'A StarMap shows players a live Star System Explorer view — the full 3D app, driven by you from the SSE tab. Mappadux frames it; the star map data never passes through Mappadux.';
    return p;
  }

  private _originRow(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
    const label = document.createElement('span');
    label.className = 'about-edit-label';
    label.textContent = 'Star System Explorer address';
    const input = document.createElement('input');
    input.type = 'url';
    input.className = 'select-full';
    input.value = this.origin;
    input.title = 'Normally https://starsystemx.com — change only for the beta site or local development.';
    input.addEventListener('change', () => {
      this.origin = Sse2Bridge.normaliseOrigin(input.value);
      input.value = this.origin;
      void this._search();
    });
    wrap.append(label, input);
    return wrap;
  }

  private _actions(...buttons: HTMLElement[]): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:var(--space-sm);justify-content:flex-end;flex-wrap:wrap;';
    row.append(...buttons);
    return row;
  }
  private _btn(label: string, cls: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button'; b.className = `btn ${cls}`; b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  // ─── States ───────────────────────────────────────────────────────────────

  private _clear(): HTMLElement { const b = this.body!; b.replaceChildren(); return b; }

  private _renderSearching(): void {
    const b = this._clear();
    b.append(this._intro(), this._originRow());
    const p = document.createElement('p');
    p.style.margin = '0';
    p.textContent = 'Looking for a running Star System Explorer in this browser…';
    b.append(p, this._actions(this._btn('Cancel', 'btn--ghost', () => this._resolve(null))));
  }

  private _renderNotFound(): void {
    const b = this._clear();
    b.append(this._intro(), this._originRow());
    const p = document.createElement('p');
    p.style.cssText = 'margin:0;color:#ffcc80;';
    p.innerHTML = '<strong>No Star System Explorer session found in this browser.</strong><br>' +
      'Open it (same browser profile), load your starmap, and this dialog will pick it up automatically.';
    b.append(p, this._actions(
      this._btn('Cancel', 'btn--ghost', () => this._resolve(null)),
      this._btn('Retry', 'btn--ghost', () => void this._search()),
      this._btn('Open Star System Explorer', 'btn--primary', () => sse2Bridge.openSse(this.origin)),
    ));
  }

  private _renderFound(): void {
    const a = this.announce!;
    const b = this._clear();
    b.append(this._intro(), this._originRow());

    if (!Sse2Bridge.versionAtLeast(a.appVersion, MIN_SSE_VERSION)) {
      const p = document.createElement('p');
      p.style.cssText = 'margin:0;color:#ffcc80;';
      p.textContent = `Star System Explorer ${a.appVersion} needs updating to support integration (needs ${MIN_SSE_VERSION} or later). Reload it, then Retry.`;
      b.append(p, this._actions(
        this._btn('Cancel', 'btn--ghost', () => this._resolve(null)),
        this._btn('Retry', 'btn--primary', () => void this._search()),
      ));
      return;
    }

    const found = document.createElement('p');
    found.style.margin = '0';
    found.innerHTML = `Connected: <strong></strong>`;
    found.querySelector('strong')!.textContent = a.starmapName || '(unnamed starmap)';
    b.append(found);

    if (this.seed && this.seed.starmapId !== a.starmapId) {
      const warn = document.createElement('p');
      warn.style.cssText = 'margin:0;color:#ffcc80;';
      warn.textContent = `This StarMap was made for "${this.seed.starmapName}", but "${a.starmapName}" is loaded. Saving will re-point it at the loaded starmap.`;
      b.append(warn);
    }

    const label = document.createElement('span');
    label.className = 'about-edit-label';
    label.textContent = this.seed ? 'Player View to show' : 'Player Views to add (one map each)';
    b.append(label);

    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:6px;max-height:40vh;overflow:auto;';
    const inputs: { id: string; name: string; el: HTMLInputElement }[] = [];
    if (a.presets.length === 0) {
      const none = document.createElement('p');
      none.style.cssText = 'margin:0;opacity:0.8;';
      none.textContent = 'This starmap has no Player Views yet — create one in Star System Explorer (Player Views…) and it will appear here.';
      list.append(none);
    }
    for (const p of a.presets) {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;';
      const input = document.createElement('input');
      input.type = this.seed ? 'radio' : 'checkbox';
      input.name = 'starmap-preset';
      input.value = p.id;
      if (this.seed && p.id === this.seed.presetId) input.checked = true;
      const span = document.createElement('span');
      span.textContent = p.name;
      row.append(input, span);
      list.append(row);
      inputs.push({ id: p.id, name: p.name, el: input });
    }
    b.append(list);

    const ok = this._btn(this.seed ? 'Save' : 'Add', 'btn--primary', () => {
      const chosen = inputs.filter((i) => i.el.checked).map((i) => ({ id: i.id, name: i.name }));
      if (chosen.length === 0) return;
      this._resolve({ origin: this.origin, announce: a, presets: chosen });
    });
    b.append(this._actions(this._btn('Cancel', 'btn--ghost', () => this._resolve(null)), ok));
  }
}
