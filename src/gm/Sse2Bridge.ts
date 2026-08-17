/**
 * Sse2Bridge.ts — v2.18 StarMap map kind.
 *
 * GM-side client for Star System Explorer's discovery contract. It mounts SSE's
 * `/bridge` route as a HIDDEN iframe: BroadcastChannel is origin-scoped, so that
 * frame shares a channel with the GM's SSE tab in this browser and can ask it
 * "who is here" using SSE's own plumbing — Mappadux never speaks the SSE wire
 * protocol. Everything crosses the frame boundary over postMessage with strict
 * origin checks in both directions.
 *
 * THIS IS THE REUSABLE SHIM. The three verbs here — discover (hello/announce),
 * ensure-remote, and "here is the player-view URL for a preset" — are exactly
 * the contract a Foundry module or an Owlbear extension would use; only the
 * host-side plumbing around them differs. What is Mappadux-only (because we own
 * both ends) is layered in GMApp on top of this: opening the SSE tab for the GM,
 * connection-aware dialogs, warm-iframe preset switching on viewers.
 *
 * Protocol (SSE side: docs/dev/vtt-integration-design.md 9.2), all frames
 * `{ns:'sse2-bridge', v:1, ...}`:
 *   -> bridge: {cmd:'hello', requestId} | {cmd:'ensureRemote', sessionId, requestId}
 *   <- bridge: {event:'ready'} | {event:'announce', requestId?, payload}
 *              | {event:'gone', requestId} | {event:'ok', requestId} | {event:'error', ...}
 * Unsolicited announces (no requestId) arrive when the GM loads/renames a map or
 * adds a Player View AFTER our hello — that is how "Open SSE, then auto-resume"
 * completes without polling.
 */

export interface SseAnnounce {
  sessionId: string;
  starmapId: string;
  starmapName: string;
  presets: { id: string; name: string }[];
  appVersion: string;
}

const NS = 'sse2-bridge';
export const DEFAULT_SSE_ORIGIN = 'https://starsystemx.com';
/** The oldest SSE build that speaks this contract (1B-1D + /bridge). */
export const MIN_SSE_VERSION = '2.1.722';

type Pending = { resolve: (a: SseAnnounce | null) => void; timer: ReturnType<typeof setTimeout> };

export class Sse2Bridge {
  private frames = new Map<string, HTMLIFrameElement>();
  private ready = new Map<string, Promise<void>>();
  private pending = new Map<string, Pending>();
  private announceListeners = new Set<(a: SseAnnounce, origin: string) => void>();
  private seq = 0;
  private bound = false;

  /** Normalise + validate an SSE origin string the GM typed or a pack carried. */
  static normaliseOrigin(input: string | undefined | null): string {
    const raw = (input ?? '').trim() || DEFAULT_SSE_ORIGIN;
    try { return new URL(raw).origin; } catch { return DEFAULT_SSE_ORIGIN; }
  }

  /** Player-view URL for a session + preset. `embed` hides SSE's device chrome
   *  and enables the parent command set (setPreset/ping) — always on for a
   *  framed view, off for a URL the GM hands out directly. */
  static playerViewUrl(origin: string, sessionId: string, presetId?: string | null, embed = true): string {
    const u = new URL('/catalogue', Sse2Bridge.normaliseOrigin(origin));
    u.searchParams.set('sid', sessionId);
    if (presetId) u.searchParams.set('preset', presetId);
    if (embed) u.searchParams.set('embed', '1');
    return u.toString();
  }

  /** "2.1.722-beta" >= "2.1.722" style compare on the numeric triple. */
  static versionAtLeast(v: string | undefined, min: string): boolean {
    const t = (x: string) => (x.match(/^(\d+)\.(\d+)\.(\d+)/) ?? []).slice(1, 4).map(Number);
    const a = t(v ?? ''), b = t(min);
    if (a.length < 3) return false;
    for (let i = 0; i < 3; i++) { if (a[i]! !== b[i]!) return a[i]! > b[i]!; }
    return true;
  }

  /** Mount (once per origin) the hidden bridge frame. Resolves when the frame
   *  has loaded; the first hello establishes trust on the SSE side. */
  ensure(originInput: string): Promise<void> {
    const origin = Sse2Bridge.normaliseOrigin(originInput);
    const existing = this.ready.get(origin);
    if (existing) return existing;
    this._bind();
    const iframe = document.createElement('iframe');
    iframe.src = `${origin}/bridge`;
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none;';
    const p = new Promise<void>((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      iframe.addEventListener('load', finish, { once: true });
      // A blocked/failed load must not hang callers: hello() has its own timeout.
      setTimeout(finish, 4000);
    });
    document.body.appendChild(iframe);
    this.frames.set(origin, iframe);
    this.ready.set(origin, p);
    return p;
  }

  /** Ask "who is here?"; null when no SSE GM tab in this browser answered. */
  async hello(originInput: string, timeoutMs = 3000): Promise<SseAnnounce | null> {
    const origin = Sse2Bridge.normaliseOrigin(originInput);
    await this.ensure(origin);
    const frame = this.frames.get(origin);
    if (!frame?.contentWindow) return null;
    const requestId = `h${++this.seq}`;
    return new Promise<SseAnnounce | null>((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); resolve(null); }, timeoutMs);
      this.pending.set(requestId, { resolve, timer });
      frame.contentWindow!.postMessage({ ns: NS, v: 1, cmd: 'hello', requestId }, origin);
    });
  }

  /** Ask the SSE GM tab to start hosting on the PeerJS broker so REMOTE viewers
   *  can dial in (SSE shows a notice on its side; never silent). */
  async ensureRemote(originInput: string, sessionId: string): Promise<void> {
    const origin = Sse2Bridge.normaliseOrigin(originInput);
    await this.ensure(origin);
    const frame = this.frames.get(origin);
    frame?.contentWindow?.postMessage({ ns: NS, v: 1, cmd: 'ensureRemote', sessionId, requestId: `r${++this.seq}` }, origin);
  }

  /** Unsolicited announces — the SSE tab opened/loaded/renamed after our hello. */
  onAnnounce(cb: (a: SseAnnounce, origin: string) => void): () => void {
    this._bind();
    this.announceListeners.add(cb);
    return () => this.announceListeners.delete(cb);
  }

  /** Mappadux-only convenience (we own the GM's browser): open SSE for the GM. */
  openSse(originInput: string): void {
    const origin = Sse2Bridge.normaliseOrigin(originInput);
    window.open(origin + '/', 'StarSystemExplorer');
  }

  destroy(): void {
    for (const f of this.frames.values()) f.remove();
    this.frames.clear(); this.ready.clear();
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.resolve(null); }
    this.pending.clear();
    if (this.bound) { window.removeEventListener('message', this._onMessage); this.bound = false; }
  }

  private _bind() {
    if (this.bound) return;
    window.addEventListener('message', this._onMessage);
    this.bound = true;
  }

  private _onMessage = (e: MessageEvent) => {
    // Only frames WE mounted, and only from the origin we mounted them at.
    let origin: string | null = null;
    for (const [o, f] of this.frames) { if (e.source === f.contentWindow) { origin = o; break; } }
    if (!origin || e.origin !== origin) return;
    const d = e.data;
    if (!d || d.ns !== NS || d.v !== 1 || typeof d.event !== 'string') return;
    if (d.event === 'announce' && d.payload && typeof d.payload.sessionId === 'string') {
      const a = d.payload as SseAnnounce;
      const rid = typeof d.requestId === 'string' ? d.requestId : null;
      if (rid && this.pending.has(rid)) {
        const p = this.pending.get(rid)!;
        clearTimeout(p.timer); this.pending.delete(rid); p.resolve(a);
      }
      // Solicited or not, an announce is news: listeners keep dialogs current.
      for (const cb of this.announceListeners) { try { cb(a, origin); } catch { /* listener bug must not break the bridge */ } }
    } else if (d.event === 'gone' && typeof d.requestId === 'string') {
      const p = this.pending.get(d.requestId);
      if (p) { clearTimeout(p.timer); this.pending.delete(d.requestId); p.resolve(null); }
    }
    // 'ready' / 'ok' / 'error' need no action here.
  };
}

/** Process-wide instance: one hidden frame per origin for the whole GM session. */
export const sse2Bridge = new Sse2Bridge();
