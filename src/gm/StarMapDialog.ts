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
import { getSseOrigin } from '../storage/localSettings.ts';

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
    // A map keeps the address it was made with; a NEW one starts from Settings > Connections.
    this.origin = Sse2Bridge.normaliseOrigin(seed?.origin ?? getSseOrigin());
    this.knownSid = seed?.sessionId ?? null;
  }

  open(): Promise<StarMapDialogResult | null> {
    this.overlay = this._build();
    document.body.appendChild(this.overlay);
    document.addEventListener('keydown', this.onKey);
    // Any announce (solicited or not) while we are open keeps the dialog current —
    // this is the "Open SSE, come back, it just works" path.
    this.unsub = sse2Bridge.onAnnounce((a, origin) => {
      if (origin !== this.origin) return;
      // Re-render only when the ANNOUNCED IDENTITY changed (SSE re-announces
      // whenever its own state ticks); a redraw on every announce would wipe
      // the GM's ticks mid-selection.
      const key = (x: SseAnnounce) => `${x.starmapId}|${x.sessionId}|${x.starmapName}|${x.presets.map((p) => p.id + ':' + p.name).join(',')}|${x.appVersion}`;
      const changed = !this.announce || key(this.announce) !== key(a);
      this.announce = a;
      if (changed) this._renderFound();
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

  /** The sid we can discover with: an existing map's, or one the GM pasted. With it the
   *  bridge dials SSE over PeerJS (works across sites); without it only a same-site SSE
   *  can be found (Chrome partitions the same-machine channel in third-party frames). */
  private knownSid: string | null = null;
  private pastedPreset: string | null = null;

  private async _search(): Promise<void> {
    // Actions go up FIRST; the probe resolves a line of status behind them. A GM who already knows
    // they will open SSE (or paste a link) should never wait on a check to be allowed to do it.
    this._renderPairing('Checking whether anything on this machine can see a session…');
    const a = await sse2Bridge.hello(this.origin, this.knownSid);
    if (!this.overlay) return;
    if (a) { this.announce = a; this._renderFound(); return; }
    if (sse2Bridge.lastFailure === 'unreachable') { this._renderUnreachable(); return; }
    this._setStatus(this.knownSid
      ? '<strong>The saved session is not answering.</strong> Open Star System Explorer and load this starmap — this dialog picks it up by itself.'
      : '<strong>Nothing visible from here.</strong> Browsers keep separate sites apart, so Mappadux cannot spot a session it has never met. Open Star System Explorer below and the tab it opens introduces itself — or paste a player link from one you already have open.');
  }

  /** The address answered nothing at all: /bridge is missing there (an SSE build older than the
   *  integration) or a firewall/challenge page is blocking third-party frames (a Vercel Security
   *  Checkpoint returns 403 to an embedded frame that cannot solve it). Neither is "SSE not open". */
  private _renderUnreachable(): void {
    const b = this._clear();
    b.append(this._intro(), this._originRow());
    const p = document.createElement('p');
    p.style.cssText = 'margin:0;color:#ff8a8a;';
    p.innerHTML = '<strong>Star System Explorer at this address cannot be reached for integration.</strong><br>' +
      'Most often this is a stale copy of Star System Explorer in this browser: open <code>' + this.origin + '</code> in a tab, ' +
      'hard-reload it once (Ctrl+Shift+R) so it picks up the current version, then Retry. ' +
      'Otherwise that site is older than the integration (needs Star System Explorer ' + MIN_SSE_VERSION + ' or later), ' +
      'or a firewall / security challenge is blocking embedded frames there (allow <code>/bridge</code> and <code>/catalogue</code>).';
    b.append(p, this._actions(
      this._btn('Cancel', 'btn--ghost', () => this._resolve(null)),
      this._btn('Retry', 'btn--primary', () => void this._search()),
    ));
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
    const note = document.createElement('span');
    note.style.cssText = 'display:block;margin-top:6px;font-size:12px;opacity:0.7;';
    note.textContent = 'Beta feature — in testing. Needs Star System Explorer ' + MIN_SSE_VERSION + ' or later at the chosen address.';
    p.append(note);
    return p;
  }

  private static KNOWN_ORIGINS: { label: string; origin: string }[] = [
    { label: 'Star System Explorer (production) — starsystemx.com', origin: 'https://starsystemx.com' },
    { label: 'Beta — beta.starsystemx.com', origin: 'https://beta.starsystemx.com' },
  ];

  private _originRow(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
    const label = document.createElement('span');
    label.className = 'about-edit-label';
    label.textContent = 'Star System Explorer address';
    const select = document.createElement('select');
    select.className = 'select-full';
    const known = StarMapDialog.KNOWN_ORIGINS;
    for (const k of known) {
      const o = document.createElement('option'); o.value = k.origin; o.textContent = k.label; select.append(o);
    }
    const custom = document.createElement('option'); custom.value = '__custom'; custom.textContent = 'Other address (local dev, self-hosted)…'; select.append(custom);
    const isKnown = known.some((k) => k.origin === this.origin);
    select.value = isKnown ? this.origin : '__custom';
    const input = document.createElement('input');
    input.type = 'url';
    input.className = 'select-full';
    input.placeholder = 'http://localhost:5173';
    input.value = isKnown ? '' : this.origin;
    input.hidden = isKnown;
    input.addEventListener('change', () => {
      this.origin = Sse2Bridge.normaliseOrigin(input.value);
      input.value = this.origin;
      void this._search();
    });
    select.addEventListener('change', () => {
      if (select.value === '__custom') { input.hidden = false; input.focus(); return; }
      input.hidden = true;
      this.origin = select.value;
      void this._search();
    });
    wrap.append(label, select, input);
    return wrap;
  }

  /** First pairing without same-site discovery: paste the share link from SSE's
   *  Player Views modal. Gives us origin + sid (+ preset) — then PeerJS discovery
   *  confirms the campaign name and lists ALL its views. */
  private _pasteRow(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
    const label = document.createElement('span');
    label.className = 'about-edit-label';
    label.textContent = 'Or paste a player link from Star System Explorer (Player Views… → Copy link)';
    const input = document.createElement('input');
    input.type = 'url';
    input.className = 'select-full';
    input.placeholder = 'https://…/catalogue?sid=…&preset=…';
    const apply = () => {
      const parsed = Sse2Bridge.parseShareLink(input.value);
      if (!parsed) return;
      this.origin = Sse2Bridge.normaliseOrigin(parsed.origin);
      this.knownSid = parsed.sessionId;
      this.pastedPreset = parsed.presetId;
      void this._search();
    };
    input.addEventListener('change', apply);
    input.addEventListener('paste', () => setTimeout(apply, 0));
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

  /** The one first-pairing view: a status line on top, and BOTH ways in underneath, available from
   *  the first frame. Re-rendering would wipe a half-typed paste, so the status mutates in place. */
  private statusEl: HTMLElement | null = null;
  private _renderPairing(statusHtml: string): void {
    const b = this._clear();
    b.append(this._intro(), this._originRow());
    const p = document.createElement('p');
    p.style.cssText = 'margin:0;min-height:2.4em;';
    p.innerHTML = statusHtml;
    this.statusEl = p;
    b.append(p);
    if (!this.knownSid) b.append(this._pasteRow());
    b.append(this._actions(
      this._btn('Cancel', 'btn--ghost', () => this._resolve(null)),
      this._btn('Retry', 'btn--ghost', () => void this._search()),
      this._btn('Open Star System Explorer', 'btn--primary', () => {
        sse2Bridge.openSse(this.origin);
        this._setStatus('<strong>Star System Explorer is opening…</strong> Load the starmap you want in that tab and this fills itself in — leave it open. (If the tab was blocked, allow pop-ups for Mappadux, or paste a player link.)');
      }),
    ));
  }
  private _setStatus(html: string): void {
    if (this.statusEl) this.statusEl.innerHTML = html;
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
      if (!this.seed && this.pastedPreset && p.id === this.pastedPreset) input.checked = true;
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
