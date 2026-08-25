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
export const MIN_SSE_VERSION = '2.1.753'; // opener pairing needs 3.0.34; the paste path still works below that

type Pending = { resolve: (a: SseAnnounce | null) => void; timer: ReturnType<typeof setTimeout>; origin: string };

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
    // A probe WITHOUT a session id can only ever succeed same-site (the frame and the SSE tab
    // share a BroadcastChannel). Cross-site it is a foregone conclusion, so keep it short and
    // single-shot: the dialog shows the real actions immediately and this just resolves a line
    // of status behind them. WITH a sid we are dialling the broker and that deserves patience.
    const wait = timeoutMs ?? (sid ? 14000 : 2000);
    // Two attempts: the first can race the frame's hydration on a slow load
    // even after `ready` (or after the fallback timer). Cheap and honest.
    const key = this._key(origin, sid);
    const attempts = sid ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const requestId = `h${++this.seq}`;
      const a = await new Promise<SseAnnounce | null>((resolve) => {
        const timer = setTimeout(() => { this.pending.delete(requestId); resolve(null); }, wait);
        this.pending.set(requestId, { resolve, timer, origin });
        frame.contentWindow!.postMessage({ ns: NS, v: 1, cmd: 'hello', requestId }, origin);
      });
      if (a) { this.lastFailure = null; return a; }
    }
    // The frame answered `gone` (spoke) => SSE reachable, nobody hosting/announcing.
    // The frame never spoke at all => the route is missing or blocked at that address — OR a stale
    // service worker / cold edge served a 404 once. Remount the frame ONCE and try again before
    // declaring it unreachable; the second load is usually fine.
    // The remount-once exists for a frame served a stale 404 by an old service worker. That is
    // worth a second chance on a RECONNECT (we know the sid, the GM is not watching a dialog);
    // during first pairing it just doubles a wait the GM does not have to sit through.
    if (sid && !this.spoken.has(key) && !this.remounted.has(key)) {
      this.remounted.add(key);
      this.frames.get(key)?.remove();
      this.frames.delete(key); this.ready.delete(key); this.readyResolvers.delete(key);
      await new Promise((r) => setTimeout(r, 1500));
      return this.hello(originInput, sid, timeoutMs);
    }
    this.lastFailure = this.spoken.has(key) ? 'no-session' : 'unreachable';
    return null;
  }
  private remounted = new Set<string>();

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

  /** Open SSE for the GM — and PAIR with the tab we opened.
   *
   *  v2.18.5: this is the zero-paste first pairing. Cross-site discovery cannot use the
   *  same-machine channel (Chrome partitions BroadcastChannel inside our hidden /bridge frame), so
   *  a campaign we have never seen has no session id to dial. The one channel partitioning does not
   *  touch is the OPENER relationship: the tab we open can postMessage straight back to us. So we
   *  deliberately do NOT pass `noopener` here, name the window so a second click reuses that tab,
   *  and poke it until it answers with its ANNOUNCE (SSE also volunteers one unprompted).
   *
   *  The cost of dropping `noopener` is that the opened page holds a handle on this window and
   *  could navigate it. We only ever open the SSE origin the GM configured, and we only ACT on a
   *  message whose source is that window AND whose origin matches — but a GM who types a hostile
   *  address into "Other address" is trusting it with that much. Noted, accepted, deliberate. */
  openSse(originInput: string): void {
    const origin = Sse2Bridge.normaliseOrigin(originInput);
    this._bind();
    const w = window.open(origin + '/', 'SseIntegration');
    if (!w) return; // popup blocked — the paste path still works
    this.opened.set(w, origin);
    // SSE answers on load, but the GM may still have to pick a starmap: keep asking for a while.
    let tries = 0;
    const poke = setInterval(() => {
      if (++tries > 20 || w.closed || this.answered.has(w)) { clearInterval(poke); return; }
      try { w.postMessage({ ns: NS, v: 1, cmd: 'hello' }, origin); } catch { /* not loaded yet */ }
    }, 1200);
  }
  /** Windows we opened, and the origin we opened them at. */
  private opened = new Map<Window, string>();
  /** Opened windows that have announced at least once — stops the poke, keeps the listener. */
  private answered = new Set<Window>();

  destroy(): void {
    this.opened.clear(); this.answered.clear();
    for (const f of this.frames.values()) f.remove();
    this.frames.clear(); this.ready.clear();
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.resolve(null); }
    this.pending.clear();
    if (this.bound) { window.removeEventListener('message', this._onMessage); this.bound = false; }
  }

  /** Resolve whatever is waiting on this announce and tell every listener. Both the frame path and
   *  the opened-tab path land here, so a dialog cannot tell (or care) which one found SSE. */
  private _deliverAnnounce(a: SseAnnounce, origin: string, requestId: string | null): void {
    if (requestId && this.pending.has(requestId)) {
      const p = this.pending.get(requestId)!;
      clearTimeout(p.timer); this.pending.delete(requestId); p.resolve(a);
    } else if (!requestId) {
      // An unsolicited announce answers any hello still outstanding FOR THE SAME ORIGIN — that is
      // the whole point when the GM clicks "Open Star System Explorer" from a searching dialog. A
      // hello waiting on a different address must not be answered by it.
      for (const [rid, p] of [...this.pending]) {
        if (p.origin !== origin) continue;
        clearTimeout(p.timer); this.pending.delete(rid); p.resolve(a);
      }
    }
    for (const cb of this.announceListeners) { try { cb(a, origin); } catch { /* listener bug must not break the bridge */ } }
  }

  private _bind() {
    if (this.bound) return;
    window.addEventListener('message', this._onMessage);
    this.bound = true;
  }

  private _onMessage = (e: MessageEvent) => {
    // A TAB WE OPENED announcing itself (the zero-paste pairing — see openSse). Same shape as the
    // frame protocol, so it feeds the same listeners and the open dialog updates itself.
    for (const [w, o] of this.opened) {
      if (e.source !== w) continue;
      if (e.origin !== o) return;
      const d = e.data;
      if (!d || d.ns !== NS || d.v !== 1 || d.event !== 'announce' || typeof d.payload?.sessionId !== 'string') return;
      this.answered.add(w);
      this.spoken.add(this._key(o, null));
      this.lastFailure = null;
      this._deliverAnnounce(d.payload as SseAnnounce, o, null);
      return;
    }
    // Only frames WE mounted, and only from the origin we mounted them at.
    let origin: string | null = null; let key: string | null = null;
    for (const [k, f] of this.frames) { if (e.source === f.contentWindow) { origin = this.frameOrigin.get(f) ?? null; key = k; break; } }
    if (!origin || !key || e.origin !== origin) return;
    const d = e.data;
    if (!d || d.ns !== NS || d.v !== 1 || typeof d.event !== 'string') return;
    this.spoken.add(key);
    if (d.event === 'announce' && d.payload && typeof d.payload.sessionId === 'string') {
      this._deliverAnnounce(d.payload as SseAnnounce, origin, typeof d.requestId === 'string' ? d.requestId : null);
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
