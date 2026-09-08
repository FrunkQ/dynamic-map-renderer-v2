# ICE failure detection is browser-dependent — cross-repo fix note

**Status:** fixed in Mappadux at v2.19.13. **NOT yet fixed in SSE** — the same
code runs there and needs the same change. This file is the brief for that.

Origin: a user report, 2026-09-08.

> "Quick follow-up on the remote connection: it works fine on Chrome (Android).
> Just tried Firefox (Android) as well and got a P2P negotiation error there."

---

## 1. What "P2P negotiation error" actually is

It is PeerJS's `negotiation-failed`, and it is raised from exactly one place in
peerjs@1.5.5:

```js
peerConnection.oniceconnectionstatechange = () => {
  switch (peerConnection.iceConnectionState) {
    case "failed":
      this.connection.emitError(NegotiationFailed,
        "Negotiation of connection to " + peerId + " failed.");
      this.connection.close();
```

So despite the name it is **never** an SDP/offer-answer incompatibility. It is
`iceConnectionState === 'failed'`: no working network path was found. Anyone
reading the message will assume a protocol mismatch and go looking in the wrong
place — that assumption is the first thing to correct.

## 2. The bug in OUR code

Both apps watched the WRONG state machine.

A `RTCPeerConnection` has two:

| Property | Covers |
|---|---|
| `connectionState` | the aggregate — ICE **and** DTLS |
| `iceConnectionState` | ICE alone |

Chrome drives them together, so watching either one works there. **Firefox does
not**: it can sit on `iceConnectionState: 'failed'` while `connectionState`
reports `'disconnected'` or lags behind.

Both apps watched only `connectionState`. On Firefox the failure therefore never
reached our own handler, so the honest "your network is blocking this, ask your
GM for a relay" path never ran — while PeerJS, which watches
`iceConnectionState`, raised its raw error at the player instead. Chrome hid the
bug completely.

This is a REPORTING fault, not a connectivity one. It made a network problem
look like a browser incompatibility.

## 3. The fix

A shared helper in `iceConfig.ts` — deliberately, because that file is already
kept byte-identical between the two repos, so the fix travels with something
that is already synchronised.

```ts
export function iceVerdict(pc: {
  connectionState?: string;
  iceConnectionState?: string;
} | null | undefined): 'ice-failed' | 'connected' | null {
  if (!pc) return null;
  if (pc.connectionState === 'failed' || pc.iceConnectionState === 'failed') return 'ice-failed';
  if (pc.connectionState === 'connected'
    || pc.iceConnectionState === 'connected'
    || pc.iceConnectionState === 'completed') return 'connected';
  // 'disconnected' is NOT a verdict: it is a wobble that routinely recovers,
  // and calling it a failure would tell a player their game had died mid-scene.
  return null;
}
```

Three rules it encodes, all of which cost something to rediscover:

1. **Either machine reaching `failed` is final.** Do not pick one.
2. **`completed` is ICE's own success terminal** and never appears on
   `connectionState`. Miss it and a working connection is reported as unknown.
3. **`disconnected` is not failure.** It recovers on its own constantly.

## 4. What SSE must change

The guest-side transport is `src/lib/broadcast.ts`. There is no host-side
equivalent in either app — this is one site per repo.

**4a. Copy the updated `iceConfig.ts`** (the twin). It gains `iceVerdict` and
nothing else changes, so the files stay byte-identical.

**4b. `broadcast.ts` around line 403** — currently:

```ts
const watchIce = () => {
  const pc: RTCPeerConnection | undefined = conn.peerConnection;
  if (!pc) { setTimeout(watchIce, 250); return; }
  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'failed') this.onPeerFailed?.('ice-failed');
    if (pc.connectionState === 'connected') this.onPeerFailed?.(null);
  });
};
```

becomes:

```ts
const watchIce = () => {
  const pc: RTCPeerConnection | undefined = conn.peerConnection;
  if (!pc) { setTimeout(watchIce, 250); return; }
  const report = () => {
    const verdict = iceVerdict(pc);
    if (verdict === 'ice-failed') this.onPeerFailed?.('ice-failed');
    else if (verdict === 'connected') this.onPeerFailed?.(null);
  };
  pc.addEventListener('connectionstatechange', report);
  pc.addEventListener('iceconnectionstatechange', report);
  report();   // it may have settled before we got the handle
};
```

**4c. `broadcast.ts` line 425 — SSE is WORSE than Mappadux here.** It swallows
connection errors outright:

```ts
conn.on('error', () => { /* ignore; local channel may still serve */ });
```

So an SSE player on Firefox sees nothing at all: no message, no raw error, just
a viewer that never loads. Add the backstop:

```ts
conn.on('error', (err: any) => {
  // 'negotiation-failed' is an ICE verdict wearing a misleading name (section
  // 1). Treat it as one, for any browser where neither state event reached us.
  if (err?.type === 'negotiation-failed') this.onPeerFailed?.('ice-failed');
  /* otherwise ignore; local channel may still serve */
});
```

There is a second `conn.on('error')` at line 348 (host side of the same file) —
check whether it wants the same treatment when you are in there.

## 4d. SSE needs the rest of this too

Everything in sections 5-7 applies to SSE unchanged: the dead default relay, the
host-side blocked-joiner notice, the relay self-test. `testIceServers` and
`blockedJoinerAdvice` are in the twin `iceConfig.ts`, so they arrive with the
file copy; the wiring is one call site each.

## 5. The default relay is DEAD — measured 2026-09-08

The reporting is now honest on every browser. **The connection still failed**,
and that is a separate question with a separate answer.

Chasing the Firefox report turned up something bigger, and it is not a
hypothesis — it is measured:

```
nslookup -type=A eu-0.turn.peerjs.com.   8.8.8.8   -> NOERROR, no address
nslookup -type=A eu-0.turn.peerjs.com.   1.1.1.1   -> NOERROR, no address
nslookup -type=A us-0.turn.peerjs.com.   8.8.8.8   -> NOERROR, no address
nslookup -type=A stun.l.google.com.      8.8.8.8   -> 74.125.250.129   (fine)
```

**The community TURN relays that peerjs ships as defaults no longer resolve.**
Google STUN resolves normally from the same machine and the same resolvers, so
this is not a local DNS fault. `testIceServers` on the default list confirms it
from the browser side: candidate types gathered are `host` and `srflx` only, with
`701 TURN host lookup received error` for both relay addresses.

Note the trailing dot in those queries. Without it a machine with a DNS search
suffix (and a wildcard record on that domain) will silently answer for
`eu-0.turn.peerjs.com.<suffix>` instead, which looks like a working answer and is
not. That cost a few minutes here; use FQDNs when checking this.

### What it means

Out of the box, BOTH APPS HAVE NO RELAY — only STUN. A direct path when the NATs
cooperate, and nothing at all when they do not. Every "it works for some players
and not others" report is explained by this, and the Firefox case was never
really about Firefox: Chrome found a direct route, Firefox did not, and there was
no relay underneath either of them to catch the fall.

The entries are left in `DEFAULT_ICE` because peerjs still ships them and
removing them changes nothing — they are inert either way. What changed is the
copy that claimed they worked, and it should change in SSE too if SSE says
anything similar.

## 6. The cure, for both apps

A `turns:host:443` relay supplied by the GM. Both apps already carry one in the
share link (`?ice=`) and both have the settings UI for it — that machinery was
built for locked-down workplaces, and it turns out to be the answer for remote
play generally now that the free fallback is gone.

`testIceServers()` makes that checkable in five seconds instead of mid-session,
and the GM-side blocked-joiner notice makes the need visible to the one person
who can act on it. Neither existed before this.

## 7. Verifying

`iceVerdict` is pure, so the browser divergence is pinned by unit tests rather
than by hoping — see `test/unit/iceConfig.test.ts` ("reads the verdict from
EITHER state machine"). The Firefox-specific case is the one that would have
caught this: `{ connectionState: 'disconnected', iceConnectionState: 'failed' }`
must return `'ice-failed'`.

Nobody has reproduced the original failure on Firefox Android. What is verified
is the logic; what is not is that a real Firefox client now shows the honest
message instead of the raw one.
