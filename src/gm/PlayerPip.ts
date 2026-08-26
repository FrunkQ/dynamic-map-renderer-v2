/**
 * PlayerPip — inline Picture-in-Picture preview of the player view, overlaid
 * on the GM canvas.
 *
 * Lifecycle states:
 *   • Hidden ("Show Player View" pill button at bottom-left of the canvas).
 *   • Visible (iframe + chrome at last-remembered position, 33% wide, 16:9).
 *
 * Header chrome:
 *   • Drag area — anywhere on the header. Position persists across reloads
 *     (`dmr_pip_position`).
 *   • Minimise → hides the frame, brings back the pill button.
 *   • Pop-out → opens the same URL as a standalone popup window AND closes
 *     the inline frame. The pill button comes back, so the GM can open a
 *     second inline preview if they want to compare what's on screen vs
 *     what a real popped-out window shows. The Open Player Window button
 *     in the Player Views panel is retired in favour of this flow.
 *
 * Iframe content: standard player URL with `?gmPreview=1` so the
 * player-only chrome (mute toggle, identity pill, ping mode, etc.) is
 * suppressed — this is a preview, not a participating player.
 *
 * Connection: same-machine via BroadcastChannel (instant). The iframe is
 * same-origin so BC works out of the box; no PeerJS broker hop needed
 * unless the iframe is later moved cross-origin.
 */

/** Large mode (StarMap maps): clearance for the notice strip, and the canvas margin. */
const LARGE_TOP = 112;
const LARGE_MARGIN = 12;
/**
 * Coming OUT of large mode the map matters again, so the preview goes back to
 * being a preview: never wider than this share of the canvas, whatever it was
 * before. A GM who had it at a third of the screen keeps that; one who had
 * dragged it huge does not get it back over their map.
 */
const RESTORE_MAX_FRACTION = 0.3;

const STORAGE_POSITION = 'dmr_pip_position';
const STORAGE_VISIBLE  = 'dmr_pip_visible';
const STORAGE_WIDTH    = 'dmr_pip_width';

interface PersistedPosition { x: number; y: number }

export interface PlayerPipOptions {
  /** Container the PiP overlays — typically `#canvas-wrapper`. */
  canvasWrapper: HTMLElement;
  /** Resolver for the player URL to load in the iframe / popup. Called on
   *  every show / pop-out, so the result tracks live state (room code,
   *  instance, etc.). */
  getPlayerUrl: () => string;
}

export class PlayerPip {
  private wrapper: HTMLElement;
  private getPlayerUrl: () => string;

  private pipFrame: HTMLElement | null = null;
  private showButton: HTMLElement | null = null;
  /** Tracks the user-resized width so we can persist on debounced
   *  changes from the CSS-native bottom-right resize handle. */
  private _resizeObserver: ResizeObserver | null = null;
  private _resizeSaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: PlayerPipOptions) {
    this.wrapper = opts.canvasWrapper;
    this.getPlayerUrl = opts.getPlayerUrl;

    // Initial state from persisted visibility. Default ON — the
    // onboarding intent is "GM sees what players see right away".
    const persisted = localStorage.getItem(STORAGE_VISIBLE);
    const startOpen = persisted === null ? true : persisted === '1';
    if (startOpen) this.show();
    else this._buildShowButton();
  }

  /** Open the inline PiP. No-op if already open. `persist` false for an open WE forced (large
   *  mode on a StarMap): the GM's own show/hide preference must survive it. */
  show(persist = true): void {
    if (this.pipFrame) return;
    this._removeShowButton();
    this._buildPipFrame();
    if (persist) localStorage.setItem(STORAGE_VISIBLE, '1');
  }

  /** Close the inline PiP. The pill button reappears at bottom-left. */
  hide(persist = true): void {
    this._removePipFrame();
    this._buildShowButton();
    if (persist) localStorage.setItem(STORAGE_VISIBLE, '0');
  }

  /** v2.18.11 — LARGE mode, for a StarMap map: Mappadux draws nothing on the GM canvas there
   *  (Star System Explorer is drawing the players' view), so this preview stops being a
   *  picture-in-picture and becomes the GM's view of the table. It fills the canvas below the
   *  StarMap notice strip, opens itself if the GM had it minimised, and restores exactly what was
   *  there before on the way out — including their remembered size, which large mode never saves
   *  over. Restoring is a geometry change, never a rebuild: rebuilding would reload the player
   *  frame and, with it, the Star System Explorer session inside it. */
  setLargeMode(on: boolean): void {
    if (on === this.largeMode) return;
    this.largeMode = on;
    if (on) {
      this.wasHiddenBeforeLarge = !this.pipFrame;
      this.show(false);
      this.pipFrame?.classList.add('player-pip-frame--large');
      this._applyLargeGeometry();
      // Watch the CANVAS, not the window: collapsing the sidebar or opening a panel resizes the
      // canvas without a window resize event, and a stale large geometry would hang off the edge.
      this.largeObserver = new ResizeObserver(() => this._applyLargeGeometry());
      this.largeObserver.observe(this.wrapper);
      return;
    }
    this.largeObserver?.disconnect();
    this.largeObserver = null;
    if (this.wasHiddenBeforeLarge) { this.hide(false); return; }
    this._restoreSmall();
  }

  /** Back to a corner preview: the GM's map is the thing again. */
  private _restoreSmall(): void {
    const frame = this.pipFrame;
    if (!frame) return;
    frame.classList.remove('player-pip-frame--large');

    const wrapWidth = this.wrapper.getBoundingClientRect().width;
    const cap = wrapWidth > 0 ? Math.round(wrapWidth * RESTORE_MAX_FRACTION) : 0;
    const saved = this._loadWidth();
    // Cap whatever we are restoring TO — a GM who left it big before the
    // StarMap should not have it handed back covering the map they just opened.
    const width = saved !== null && cap > 0 ? Math.min(saved, cap) : saved;
    frame.style.width = width !== null ? `${width}px` : '';

    const pos = this._loadPosition();
    if (pos) { frame.style.left = `${pos.x}%`; frame.style.top = `${pos.y}%`; frame.style.bottom = ''; }
    else { frame.style.left = '12px'; frame.style.top = ''; frame.style.bottom = '12px'; }
  }
  private largeMode = false;
  private wasHiddenBeforeLarge = false;
  private largeObserver: ResizeObserver | null = null;

  /** As wide as the canvas allows while staying 16:9 and clearing the notice strip at the top. */
  private _applyLargeGeometry(): void {
    const frame = this.pipFrame;
    if (!frame) return;
    const wrap = this.wrapper.getBoundingClientRect();
    if (wrap.width <= 0 || wrap.height <= 0) return; // not laid out yet
    const availW = Math.max(240, wrap.width - LARGE_MARGIN * 2);
    const availH = Math.max(180, wrap.height - LARGE_TOP - LARGE_MARGIN);
    const w = Math.round(Math.min(availW, availH * (16 / 9)));
    frame.style.width = `${w}px`;
    frame.style.left = `${Math.round((wrap.width - w) / 2)}px`;
    frame.style.top = `${LARGE_TOP}px`;
    frame.style.bottom = ''; frame.style.right = '';
  }

  /** Pop the inline PiP out into a standalone window. The inline frame
   *  closes; the pill button comes back so the GM can spawn another
   *  inline preview alongside the popped-out one. */
  popOut(): void {
    const raw = this.getPlayerUrl();
    if (!raw) return;
    // v2.16.107 — a pop-out is still the GM's OWN preview window, just on a
    // second screen — so KEEP gmPreview: it must not register as a phantom
    // player (that preview gating is correct for GM-local windows; real
    // participants register by scanning the clean QR / opening the LAN URL,
    // neither of which carries gmPreview). But DROP pip — that flag is only
    // for the tiny inline PiP (it nulls the fullscreen button + mutes), and a
    // standalone window wants the fullscreen button + sound.
    let url = raw;
    try { const u = new URL(raw); u.searchParams.delete('pip'); url = u.toString(); }
    catch { /* malformed URL — fall back to the raw string */ }
    window.open(url, '_blank', 'noopener,popup,width=1280,height=720');
    // Match the existing Hide behaviour: persist intent + show pill.
    this.hide();
  }

  /** Re-resolve the player URL and re-load the iframe. Used when the
   *  room code becomes available after the PiP has already mounted
   *  (host.onReady fires asynchronously after init). No-op when the
   *  inline frame is hidden — pop-out / show always reads fresh. */
  refresh(): void {
    if (!this.pipFrame) return;
    const iframe = this.pipFrame.querySelector<HTMLIFrameElement>('iframe.player-pip-iframe');
    const url = this.getPlayerUrl();
    if (iframe && url) {
      const u = new URL(url);
      u.searchParams.set('pip', '1');
      iframe.src = u.toString();
    }
  }

  // ─── Build / teardown ────────────────────────────────────────────────────

  private _buildShowButton(): void {
    if (this.showButton) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'player-pip-show-btn';
    btn.title = 'Show inline preview of what players see. Drag to move; use the pop-out button on the preview to send it to a standalone window.';
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<rect x="2" y="4" width="20" height="14" rx="2"/>' +
        '<line x1="8" y1="20" x2="16" y2="20"/>' +
        '<line x1="12" y1="18" x2="12" y2="20"/>' +
      '</svg>' +
      '<span>Show Player View</span>';
    btn.addEventListener('click', () => this.show());
    // Same propagation-stop as the frame so clicking the pill doesn't
    // also trigger a workspace pan-start on the canvas underneath.
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    btn.addEventListener('pointerup',   (e) => e.stopPropagation());
    this.wrapper.appendChild(btn);
    this.showButton = btn;
  }

  private _removeShowButton(): void {
    this.showButton?.remove();
    this.showButton = null;
  }

  private _buildPipFrame(): void {
    const frame = document.createElement('div');
    frame.className = 'player-pip-frame';

    // Header — drag handle + min / pop-out buttons.
    const header = document.createElement('div');
    header.className = 'player-pip-header';
    const title = document.createElement('span');
    title.className = 'player-pip-title';
    title.textContent = 'Player View';
    const minBtn = document.createElement('button');
    minBtn.type = 'button';
    minBtn.className = 'player-pip-chrome-btn';
    minBtn.title = 'Minimise to the Show Player View button';
    minBtn.setAttribute('aria-label', 'Minimise');
    minBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<line x1="5" y1="19" x2="19" y2="19"/>' +
      '</svg>';
    minBtn.addEventListener('click', () => this.hide());
    const popBtn = document.createElement('button');
    popBtn.type = 'button';
    popBtn.className = 'player-pip-chrome-btn';
    popBtn.title = 'Pop out to a standalone window. The Show Player View button will reappear so you can spawn another inline preview.';
    popBtn.setAttribute('aria-label', 'Pop out');
    popBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>' +
      '</svg>';
    popBtn.addEventListener('click', () => this.popOut());
    header.appendChild(title);
    header.appendChild(minBtn);
    header.appendChild(popBtn);
    frame.appendChild(header);

    // Iframe body. v2.16.42 — append `pip=1` to the URL so the inner
    // PlayerApp skips the mute indicator and stays silently muted (no
    // audio needed for an inline preview; the giant "tap to start
    // audio" prompt would dwarf the small frame anyway). Pop-out
    // windows use the raw URL (no pip flag) so they get sound.
    const iframe = document.createElement('iframe');
    iframe.className = 'player-pip-iframe';
    const rawUrl = this.getPlayerUrl();
    if (rawUrl) {
      const u = new URL(rawUrl);
      u.searchParams.set('pip', '1');
      iframe.src = u.toString();
    }
    iframe.title = 'Player view preview';
    iframe.setAttribute('allow', 'autoplay; fullscreen');
    frame.appendChild(iframe);

    // Position from persisted store, falling back to bottom-left.
    const pos = this._loadPosition();
    if (pos) {
      // Stored as container percentages (see the drag handler) so the PiP keeps
      // its relative spot across viewport resizes / zoom.
      frame.style.left = `${pos.x}%`;
      frame.style.top  = `${pos.y}%`;
    } else {
      frame.style.left   = '12px';
      frame.style.bottom = '12px';
    }
    // Restore user-resized width if present. Height auto-computes from
    // the CSS aspect-ratio so we only need to track width.
    const w = this._loadWidth();
    if (w !== null) frame.style.width = `${w}px`;

    this.wrapper.appendChild(frame);
    this.pipFrame = frame;

    // Watch for CSS-native resize from the bottom-right handle; persist
    // the new width on a short debounce so we don't hammer localStorage
    // during the drag.
    this._resizeObserver = new ResizeObserver(() => {
      if (this.largeMode) return; // large mode is ours, not a size the GM chose — never persist it
      if (this._resizeSaveTimer !== null) clearTimeout(this._resizeSaveTimer);
      this._resizeSaveTimer = setTimeout(() => {
        if (this.pipFrame) this._saveWidth(this.pipFrame.offsetWidth);
        this._resizeSaveTimer = null;
      }, 250);
    });
    this._resizeObserver.observe(frame);

    // v2.16.43 — stop pointer/wheel/click events on the PiP frame from
    // bubbling up to the canvas-wrapper's pan/zoom + workspace gesture
    // handlers. Otherwise clicking the header to drag the PiP also
    // pans the GM camera underneath, and scrolling on the iframe area
    // zooms the GM. The iframe itself is its own document so events
    // inside it never bubble here — only chrome interactions matter.
    const stop = (e: Event) => e.stopPropagation();
    frame.addEventListener('pointerdown', stop);
    frame.addEventListener('pointerup', stop);
    frame.addEventListener('wheel', stop, { passive: true });
    frame.addEventListener('click', stop);
    frame.addEventListener('dblclick', stop);
    frame.addEventListener('contextmenu', stop);

    this._bindDrag(header, frame);

    // Minimised and re-opened WHILE a StarMap is up (the pill is still there in large mode):
    // the frame comes back large, because the canvas behind it is still empty.
    if (this.largeMode) {
      frame.classList.add('player-pip-frame--large');
      this._applyLargeGeometry();
    }
  }

  private _removePipFrame(): void {
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    if (this._resizeSaveTimer !== null) {
      clearTimeout(this._resizeSaveTimer);
      this._resizeSaveTimer = null;
    }
    this.pipFrame?.remove();
    this.pipFrame = null;
  }

  // ─── Drag ────────────────────────────────────────────────────────────────

  private _bindDrag(handle: HTMLElement, frame: HTMLElement): void {
    let dragging = false;
    let startMouseX = 0;
    let startMouseY = 0;
    let startLeft   = 0;
    let startTop    = 0;

    handle.addEventListener('pointerdown', (e) => {
      // Skip clicks on the chrome buttons.
      const target = e.target as HTMLElement;
      if (target.closest('button')) return;
      dragging = true;
      handle.setPointerCapture(e.pointerId);
      startMouseX = e.clientX;
      startMouseY = e.clientY;
      const wrapRect = this.wrapper.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      startLeft = frameRect.left - wrapRect.left;
      startTop  = frameRect.top  - wrapRect.top;
      // Switch to top/left positioning so dragging works regardless of
      // whether we started with a bottom/right anchor.
      frame.style.left   = `${startLeft}px`;
      frame.style.top    = `${startTop}px`;
      frame.style.bottom = '';
      frame.style.right  = '';
      e.preventDefault();
    });

    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startMouseX;
      const dy = e.clientY - startMouseY;
      // Clamp within wrapper so the user can't lose it off-screen.
      const wrapRect = this.wrapper.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      const maxLeft = wrapRect.width  - frameRect.width;
      const maxTop  = wrapRect.height - frameRect.height;
      const nextLeft = Math.max(0, Math.min(maxLeft, startLeft + dx));
      const nextTop  = Math.max(0, Math.min(maxTop,  startTop  + dy));
      // Store as a percentage of the container, not absolute pixels, so the PiP
      // keeps its relative position (and stays on-screen) when the viewport is
      // resized or zoomed — pixels could leave it outside the visible area.
      frame.style.left = `${this._pxToContainerPercent(wrapRect.width, nextLeft)}%`;
      frame.style.top  = `${this._pxToContainerPercent(wrapRect.height, nextTop)}%`;
    });


    handle.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      try { handle.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      const left = parseFloat(frame.style.left || '0');
      const top  = parseFloat(frame.style.top  || '0');
      this._savePosition({ x: left, y: top });
    });
    handle.addEventListener('pointercancel', () => { dragging = false; });
  }

  /** Express a pixel offset as a percentage of the container dimension.
   *  Returns 0 for a zero/negative container so callers never emit an
   *  invalid "undefined%" CSS value. */
  private _pxToContainerPercent(trueMax: number, pxMeasure: number): number {
    if (trueMax <= 0) return 0;
    return (pxMeasure / trueMax) * 100;
  }

  // ─── Storage ─────────────────────────────────────────────────────────────

  private _loadPosition(): PersistedPosition | null {
    try {
      const raw = localStorage.getItem(STORAGE_POSITION);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PersistedPosition;
      if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return null;
      // Positions are stored as container percentages (0–100). Reject anything
      // out of range — including legacy pixel-based saves from before this
      // format — so the PiP defaults to its corner instead of rendering
      // off-screen.
      if (parsed.x < 0 || parsed.x > 100 || parsed.y < 0 || parsed.y > 100) return null;
      return parsed;
    } catch { return null; }
  }

  private _savePosition(pos: PersistedPosition): void {
    try { localStorage.setItem(STORAGE_POSITION, JSON.stringify(pos)); }
    catch { /* quota / disabled — ignore */ }
  }

  private _loadWidth(): number | null {
    try {
      const raw = localStorage.getItem(STORAGE_WIDTH);
      if (!raw) return null;
      const n = parseFloat(raw);
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch { return null; }
  }

  private _saveWidth(w: number): void {
    if (!Number.isFinite(w) || w <= 0) return;
    try { localStorage.setItem(STORAGE_WIDTH, String(w)); }
    catch { /* quota / disabled — ignore */ }
  }
}
