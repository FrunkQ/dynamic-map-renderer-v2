/**
 * StarMapLayer (v2.18) — the full-bleed Star System Explorer player view for a
 * StarMap map, on GM canvas, player and projector alike.
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
  private onFs = () => { if (this.visible) this.refresh(); };

  constructor(private root: HTMLElement, mode: 'gm' | 'viewer') {
    this.root.classList.add('starmap-layer', `starmap-layer--${mode}`);
    this.root.hidden = true;
    document.addEventListener('fullscreenchange', this.onFs);
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
    if (!same || !this.iframe) {
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
    this.iframe?.remove();
    this.iframe = null; this.loaded = null; this.currentPreset = null;
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
  }

  private _setPreset(presetId: string): void {
    if (!this.iframe?.contentWindow || !this.loaded) return;
    this.currentPreset = presetId;
    // Origin-targeted: SSE's embed listener only honours allowlisted parents,
    // and we only ever talk to the origin we loaded.
    this.iframe.contentWindow.postMessage({ ns: EMBED_NS, v: 1, cmd: 'setPreset', presetId }, this.loaded.origin);
  }
}
