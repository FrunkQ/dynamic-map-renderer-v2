/**
 * StarMapLayer (v2.18) — the full-bleed Star System Explorer player view for a
 * StarMap map, on the player and projector surfaces.
 *
 * NOT on the GM canvas: since v2.18.11 the GM sees a notice strip and an enlarged Player View
 * window instead, because a GM-side copy meant a SECOND live SSE session on the same machine.
 *
 * Follows TextMapVideoLayer's lifecycle discipline (a managed cross-origin
 * iframe in a dedicated overlay slot, rebuilt on fullscreen because browsers
 * drop a cross-origin iframe's compositing surface when an ancestor toggles
 * fullscreen), but there is exactly ONE iframe and no map-geometry
 * projection: the SSE app fills the surface and owns its own pan/zoom.
 *
 * WARM SWITCHING (design section 6): the iframe is kept alive when hidden and
 * pre-loaded at session start when the pack contains a StarMap, so activating
 * one is a show/hide, not a cold boot (SvelteKit + three.js chunk + starmap
 * handshake, 1-3 s). Different StarMap maps on the same SSE session share the
 * iframe: a preset change is a `setPreset` postMessage into the warm frame.
 *
 * Both modes are INTERACTIVE — the preset's own followGM/interactive flags
 * govern what players may do inside SSE. That is deliberate and unlike the
 * video layer's inert viewer mode.
 */

export interface StarMapTarget {
  origin: string;      // SSE origin
  sessionId: string;   // SSE broadcastId
  presetId?: string;   // Player View; absent on prewarm
}

const EMBED_NS = 'sse2-embed';

export class StarMapLayer {
  private iframe: HTMLIFrameElement | null = null;
  private loaded: { origin: string; sessionId: string } | null = null;
  private currentPreset: string | null = null;
  private visible = false;
  /** The frame has answered us at least once, so it IS listening (see _setPreset). */
  private alive = false;
  private pendingPreset: string | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private onFs = () => { if (this.visible) this.refresh(); };

  constructor(private root: HTMLElement, mode: 'gm' | 'viewer') {
    this.root.classList.add('starmap-layer', `starmap-layer--${mode}`);
    this.root.hidden = true;
    document.addEventListener('fullscreenchange', this.onFs);
    window.addEventListener('message', this.onMsg);
  }

  get isVisible(): boolean { return this.visible; }

  /** Mount (hidden) the SSE view for a session so a later show() is instant. */
  preload(t: { origin: string; sessionId: string }): void {
    if (this.loaded && this.loaded.origin === t.origin && this.loaded.sessionId === t.sessionId) return;
    this._mount(t.origin, t.sessionId, null);
  }

  /** Show the SSE view for a session + preset. Reuses the warm iframe when it
   *  matches origin+session (preset via postMessage); (re)loads otherwise. */
  show(t: StarMapTarget): void {
    const same = this.loaded && this.loaded.origin === t.origin && this.loaded.sessionId === t.sessionId;
    // v2.18.10 — a PREWARMED frame carries no preset, so SSE is showing its fallback view ("The
    // Guide"). Whether we can correct that over postMessage depends on whether the frame is
    // LISTENING yet: SSE's embed listener exists only after its route hydrates, and a command sent
    // before that is dropped silently — which is why a reloaded player sat on the wrong view while
    // the GM saw the right one. A prewarm that has answered a ping keeps its warm boot and takes
    // the preset by message; one that has not is remounted with the preset in the URL (correct on
    // the first paint, and the frame we discard had not finished loading anyway).
    const prewarmed = same && this.currentPreset === null && !!t.presetId && !this.alive;
    if (!same || !this.iframe || prewarmed) {
      this._mount(t.origin, t.sessionId, t.presetId ?? null);
    } else if (t.presetId && t.presetId !== this.currentPreset) {
      this._setPreset(t.presetId);
    }
    this.root.hidden = false;
    this.visible = true;
  }

  /** Hide but KEEP the iframe alive and connected (warm for the cut back). */
  hide(): void {
    this.root.hidden = true;
    this.visible = false;
  }

  /** Tear down and rebuild the iframe (fullscreen-blank workaround). */
  refresh(): void {
    if (!this.loaded) return;
    const { origin, sessionId } = this.loaded;
    this._mount(origin, sessionId, this.currentPreset);
  }

  destroy(): void {
    document.removeEventListener('fullscreenchange', this.onFs);
    window.removeEventListener('message', this.onMsg);
    this._stopPing();
    this.iframe?.remove();
    this.iframe = null; this.loaded = null; this.currentPreset = null;
    this.pendingPreset = null; this.alive = false;
    this.root.hidden = true; this.visible = false;
  }

  private _url(origin: string, sessionId: string, presetId: string | null): string {
    const u = new URL('/catalogue', origin);
    u.searchParams.set('sid', sessionId);
    if (presetId) u.searchParams.set('preset', presetId);
    u.searchParams.set('embed', '1');
    return u.toString();
  }

  private _mount(origin: string, sessionId: string, presetId: string | null): void {
    this.iframe?.remove();
    const f = document.createElement('iframe');
    f.className = 'starmap-frame';
    f.setAttribute('allow', 'autoplay; fullscreen');
    f.setAttribute('title', 'Star System Explorer');
    f.src = this._url(origin, sessionId, presetId);
    this.root.appendChild(f);
    this.iframe = f;
    this.loaded = { origin, sessionId };
    this.currentPreset = presetId;
    // A new frame has not spoken yet, and anything queued was meant for the old one. A PREWARM
    // (no preset) starts pinging straight away: knowing it is listening is what lets a later
    // show() switch presets on the warm frame instead of paying for a reload.
    this.alive = false; this.pendingPreset = null; this._stopPing();
    if (!presetId) this._startPing();
  }

  /** Switch the warm frame to another Player View. postMessage has no delivery guarantee and SSE's
   *  embed listener only exists once its route hydrates, so a command aimed at a frame that has
   *  never answered us is QUEUED and flushed the moment it does (ping -> pong). */
  private _setPreset(presetId: string): void {
    if (!this.iframe?.contentWindow || !this.loaded) return;
    this.currentPreset = presetId;
    if (this.alive) { this._post({ cmd: 'setPreset', presetId }); return; }
    this.pendingPreset = presetId;
    this._startPing();
  }

  /** Origin-targeted: SSE's embed listener only honours allowlisted parents, and we only ever
   *  talk to the origin we loaded. */
  private _post(frame: Record<string, unknown>): void {
    if (!this.iframe?.contentWindow || !this.loaded) return;
    this.iframe.contentWindow.postMessage({ ns: EMBED_NS, v: 1, ...frame }, this.loaded.origin);
  }

  /** Poke the frame until it answers, so a queued preset lands as soon as SSE is listening. Gives
   *  up after ~12s: a frame that never answers is blocked or too old to speak the embed protocol,
   *  and what it shows is then SSE's own business. */
  private _startPing(): void {
    this._stopPing();
    let tries = 0;
    this._post({ cmd: 'ping', requestId: 'sm0' });
    this.pingTimer = setInterval(() => {
      if (this.alive || ++tries > 30) { this._stopPing(); return; }
      this._post({ cmd: 'ping', requestId: `sm${tries}` });
    }, 400);
  }
  private _stopPing(): void {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }

  /** SSE's `pong` is the only proof the frame is listening — that is what makes it worth sending. */
  private onMsg = (e: MessageEvent) => {
    if (!this.iframe || !this.loaded) return;
    if (e.source !== this.iframe.contentWindow || e.origin !== this.loaded.origin) return;
    const d = e.data;
    if (!d || d.ns !== EMBED_NS || d.v !== 1 || d.event !== 'pong') return;
    this.alive = true;
    this._stopPing();
    const queued = this.pendingPreset;
    this.pendingPreset = null;
    if (queued) this._post({ cmd: 'setPreset', presetId: queued });
  };
}
