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

## 5. What this does NOT fix

The reporting is now honest on every browser. **The connection still failed**,
and that is a separate question with a separate answer.

Unless the GM has configured a custom relay, both apps fall back to
`DEFAULT_ICE`: one STUN, and one **UDP-only** shared community TURN
(`turn:eu-0/us-0.turn.peerjs.com:3478`). Chrome found a path; Firefox did not.
Unverified hypotheses, most likely first:

1. **IPv6-only mobile network.** Android carriers commonly run IPv6-only with
   NAT64/DNS64. Chrome synthesises IPv6 addresses so it can still reach an
   IPv4-only STUN/TURN server; Firefox's handling is weaker. This fits "same
   device, same network, only the browser changed" better than anything else.
2. **Firefox privacy settings** — `resistFingerprinting`, strict ETP or private
   browsing restrict candidate gathering, which can leave no viable pair.
3. **The shared free relay was unavailable to that client** at that moment.

To settle it: `about:webrtc` on Firefox Android lists every candidate pair and
whether a relay candidate was gathered at all.

The real cure for all three is the same, and it is already built in both apps: a
`turns:host:443` relay supplied by the GM. That is what the `?ice=` parameter and
the Connections settings exist for. Firefox simply falls off a free UDP-only
relay sooner than Chrome does.

## 6. Verifying

`iceVerdict` is pure, so the browser divergence is pinned by unit tests rather
than by hoping — see `test/unit/iceConfig.test.ts` ("reads the verdict from
EITHER state machine"). The Firefox-specific case is the one that would have
caught this: `{ connectionState: 'disconnected', iceConnectionState: 'failed' }`
must return `'ice-failed'`.

Nobody has reproduced the original failure on Firefox Android. What is verified
is the logic; what is not is that a real Firefox client now shows the honest
message instead of the raw one.
