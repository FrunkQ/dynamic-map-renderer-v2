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
export const MIN_SSE_VERSION = '2.1.753';

type Pending = { resolve: (a: SseAnnounce | null) => void; timer: ReturnType<typeof setTimeout> };

export class Sse2Bridge {
  private frames = new Map<string, HTMLIFrameElement>();
  private ready = new Map<string, Promise<void>>();
  private pending = new Map<string, Pending>();
  private readyResolvers = new Map<string, () => void>();
  /** Keys whose frame has spoken to us at least once (`ready`/`announce`/`gone`). A frame that
   *  never speaks is unreachable: 404 (SSE too old for /bridge), a firewall challenge (Vercel
   *  Security Checkpoint returns 403 to a third-party frame that cannot solve it), or blocked. */
  private spoken = new Set<string>();
  /** Why the last hello for an origin failed — lets the dialog say the RIGHT thing. */
  lastFailure: 'unreachable' | 'no-session' | null = null;
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

  /** Mount (once per origin+sid) the hidden bridge frame. Resolves when the
   *  frame reports ready; the first hello establishes trust on the SSE side.
   *
   *  CROSS-SITE NOTE: Chrome partitions BroadcastChannel in a third-party
   *  iframe, so a frame at starsystemx.com embedded here cannot hear the SSE
   *  GM tab over the same-machine channel (that only works when host and SSE
   *  are the same SITE, e.g. localhost dev). Given a `sid` the frame instead
   *  dials the GM over PeerJS (`/bridge?sid=`), which is not partitioned. Every
   *  StarMap map and every share link carries a sid; only a first pairing has
   *  none, and that path pastes a share link (see StarMapDialog). */
  ensure(originInput: string, sid?: string | null): Promise<void> {
    const origin = Sse2Bridge.normaliseOrigin(originInput);
    const key = this._key(origin, sid);
    const existing = this.ready.get(key);
    if (existing) return existing;
    this._bind();
    const iframe = document.createElement('iframe');
    iframe.src = `${origin}/bridge${sid ? `?sid=${encodeURIComponent(sid)}` : ''}`;
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none;';
    // Resolve on the bridge's own `ready` handshake, NOT the iframe load event:
    // the route is a SvelteKit page whose message listener only exists after
    // hydration, and `load` fires on the HTML well before that — a hello sent
    // in between is silently dropped. Fallback timer so a blocked/failed load
    // never hangs callers (hello() then times out honestly).
    const p = new Promise<void>((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      this.readyResolvers.set(key, finish);
      setTimeout(finish, 6000);
    });
    document.body.appendChild(iframe);
    this.frames.set(key, iframe);
    this.frameOrigin.set(iframe, origin);
    this.ready.set(key, p);
    return p;
  }
  private _key(origin: string, sid?: string | null): string { return sid ? `${origin}#${sid}` : origin; }
  private frameOrigin = new WeakMap<HTMLIFrameElement, string>();

  /** Ask "who is here?"; null when no SSE GM answered. With a `sid` the frame
   *  discovers over PeerJS (works cross-site); without one it can only use the
   *  same-site local channel. Peer discovery needs the longer timeout. */
  async hello(originInput: string, sid?: string | null, timeoutMs?: number): Promise<SseAnnounce | null> {
    const origin = Sse2Bridge.normaliseOrigin(originInput);
    await this.ensure(origin, sid);
    const frame = this.frames.get(this._key(origin, sid));
    if (!frame?.contentWindow) return null;
    const wait = timeoutMs ?? (sid ? 14000 : 3000);
    // Two attempts: the first can race the frame's hydration on a slow load
    // even after `ready` (or after the fallback timer). Cheap and honest.
    const key = this._key(origin, sid);
    for (let attempt = 0; attempt < 2; attempt++) {
      const requestId = `h${++this.seq}`;
      const a = await new Promise<SseAnnounce | null>((resolve) => {
        const timer = setTimeout(() => { this.pending.delete(requestId); resolve(null); }, wait);
        this.pending.set(requestId, { resolve, timer });
        frame.contentWindow!.postMessage({ ns: NS, v: 1, cmd: 'hello', requestId }, origin);
      });
      if (a) { this.lastFailure = null; return a; }
    }
    // The frame answered `gone` (spoke) => SSE reachable, nobody hosting/announcing.
    // The frame never spoke at all => the route is missing or blocked at that address.
    this.lastFailure = this.spoken.has(key) ? 'no-session' : 'unreachable';
    return null;
  }

  /** Ask the SSE GM tab to start hosting on the PeerJS broker so REMOTE viewers
   *  can dial in (SSE shows a notice on its side; never silent). */
  async ensureRemote(originInput: string, sessionId: string): Promise<void> {
    const origin = Sse2Bridge.normaliseOrigin(originInput);
    await this.ensure(origin, sessionId);
    const frame = this.frames.get(this._key(origin, sessionId));
    frame?.contentWindow?.postMessage({ ns: NS, v: 1, cmd: 'ensureRemote', sessionId, requestId: `r${++this.seq}` }, origin);
  }

  /** Parse an SSE share link (`.../catalogue?sid=…&preset=…`) the GM pasted —
   *  the first-pairing path when same-site discovery is unavailable. */
  static parseShareLink(text: string): { origin: string; sessionId: string; presetId: string | null } | null {
    try {
      const u = new URL(text.trim());
      const sid = u.searchParams.get('sid');
      if (!sid) return null;
      return { origin: u.origin, sessionId: sid, presetId: u.searchParams.get('preset') };
    } catch { return null; }
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
    // _blank + noopener: never navigate the GM's own tab, and give SSE no handle
    // back to us (the bridge is the only sanctioned channel).
    window.open(origin + '/', '_blank', 'noopener');
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
    let origin: string | null = null; let key: string | null = null;
    for (const [k, f] of this.frames) { if (e.source === f.contentWindow) { origin = this.frameOrigin.get(f) ?? null; key = k; break; } }
    if (!origin || !key || e.origin !== origin) return;
    const d = e.data;
    if (!d || d.ns !== NS || d.v !== 1 || typeof d.event !== 'string') return;
    this.spoken.add(key);
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
    else if (d.event === 'ready') {
      this.readyResolvers.get(key)?.();
      this.readyResolvers.delete(key);
    }
    // 'ok' / 'error' need no action here.
  };
}

/** Process-wide instance: one hidden frame per origin for the whole GM session. */
export const sse2Bridge = new Sse2Bridge();
