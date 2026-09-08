# Making remote play "just work" — what it costs, and what it gives away

Written 2026-09-08, after the community TURN relays turned out to be gone
(see `p2p-ice-verdict-crossrepo.md` section 5). Applies to Mappadux and SSE
equally; the transport is the same code.

The question this answers: **can a relay be made invisible — nobody configures
anything, it simply always connects — and what does that cost in money and in
privacy?**

Short answer: yes, it is cheap, and the privacy story is better than it sounds
— but the real cost is neither of those. It is that a relay needs a small piece
of always-on infrastructure with a secret in it, and that is a thing to own.

---

## 1. The reassurance first: a relay is not a pipe everyone flows through

This is the part that sounds alarming and is not. WebRTC does not "use the
relay". It gathers every route it can find and tries them in priority order:

| Candidate | What it is | When it wins |
|---|---|---|
| `host` | the device's own LAN address | same room, same wi-fi |
| `srflx` | the public address STUN found | the common case — a direct path across the internet |
| `relay` | a route via the TURN server | **only when nothing above worked** |

Relay candidates carry the lowest priority in the spec, deliberately. So adding
a relay does not move anybody's traffic onto it. It catches the ones that fall,
and everybody else connects exactly as they do today, machine to machine, with
nothing in between.

The industry figure usually quoted is that well under a fifth of connections
end up relayed. We have no measurement of our own and should not pretend to —
but the shape is right: a relay is a safety net, not a road.

## 2. What a relay can see

A TURN server forwards packets. It does not open them.

- **The contents are encrypted end to end between the two browsers.** WebRTC
  data channels are DTLS-secured, peer to peer, and the relay holds no key.
  Map images, tokens, fog, dice rolls, notes, chat — none of it is readable by
  the relay, and that is a property of the protocol, not a promise from a
  supplier. Cloudflare says the same thing in its own words: it processes "IP
  addresses of the TURN clients, port numbers, and session timing information",
  and media stays end-to-end encrypted between participants.
- **What it does see is metadata**: which two addresses talked, when, for how
  long, and how many bytes. That is real information and should be named
  honestly rather than waved away.

Two things put that in proportion:

1. **We are already on Cloudflare.** The DNS for these domains is on Cloudflare
   and the traffic passes through it. Cloudflare knowing that an address
   fetched the app and then relayed to another address is a small addition to
   what it necessarily knows already. Handing the relay to a *third* company
   would be the change worth thinking about, not this.
2. **A relay is a privacy IMPROVEMENT for the players.** Today, a direct P2P
   connection means the GM's home IP address and each player's home IP address
   are known to each other. That is inherent to WebRTC and it is already true
   of every session anyone has ever run. When a connection is relayed, each end
   sees the relay's address instead. So the players a relay rescues are also
   the only players whose addresses stay private.

Nothing here changes the standing rule that we hold no accounts and no server
copies of anyone's campaign.

## 3. What it costs — real numbers

Cloudflare Realtime TURN, checked 2026-09-08:

- **$0.05 per GB**, measured as egress from Cloudflare to the client.
- **1,000 GB free per month** before any charge starts (shared with the SFU
  product, which we do not use).
- TURN over TLS on **443/tcp** and 5349/tcp, TCP on 3478 and 80, UDP on 3478
  and 53. Port 443 is the one that matters: it is what crosses a network that
  only lets web traffic out.
- Anycast, so a player reaches the nearest edge; everywhere except China.

Now the workload. Nothing streams — the wire carries one state snapshot at join
plus small deltas and heartbeats. The only thing big enough to notice is a map
image or a soundboard asset going out to a player.

A generous estimate: 50 MB for a player who joins, pulls a large map pack, and
plays for four hours. Four players, all four relayed (which will not happen —
see section 1) is 200 MB for the session.

**1,000 GB free is therefore around five thousand such sessions a month**, and
that is with every player relayed and every map pack fat. The realistic figure
is a small fraction of that. Money is not the constraint here; it is worth
saying plainly so it stops being a worry.

The one thing to watch is a pathological case: someone pushing very large
images repeatedly to many relayed players. Worth a usage alert, not worth a
design change.

## 4. The actual cost: it needs a server, and the server holds a secret

This is the real answer to "what does invisible cost".

Cloudflare's TURN keys are long-term secrets that mint short-lived credentials
through an API. Their documentation is explicit: **keep the key server-side,
never ship it to the browser.** So "it just works" requires:

- **A small endpoint** — a Cloudflare Worker calling
  `POST /v1/turn/keys/{id}/credentials/generate-ice-servers`, returning an
  `iceServers` block with a TTL. Perhaps thirty lines.
- **A secret to hold and rotate**, which neither app has ever needed. Both are
  static sites today with no server side at all. That is not nothing: it is the
  first piece of the estate that can be leaked rather than merely broken.
- **An availability dependency at join time.** If the Worker is down, joining
  must fall back silently to what happens today rather than failing. Easy to
  write, easy to forget.
- **Abuse control.** An open credentials endpoint is a free TURN relay for
  anyone who finds it, and TURN relays get found. Rate limiting by IP, a short
  TTL, and a usage alarm are the minimum. This is the part that takes the real
  thought.

### The wrinkle in the existing design

Both apps deliver ICE configuration **pre-connection**, in the share link and
QR code, because a player who cannot connect cannot be told anything over the
channel. That was the right call and it stays right for a GM's own relay.

It does **not** work for short-lived credentials: a link shared on Tuesday for
Friday's game would carry an expired one. So a managed relay has to be fetched
by the app at startup, not baked into the link. Two paths, and they coexist
happily:

- **Managed (invisible):** the app asks the Worker for credentials when it
  loads. Nobody configures anything.
- **Bring your own (existing):** a GM pastes their own relay in Settings and it
  rides the link exactly as now. Unchanged, and still the right answer for
  anyone who wants nothing to do with our infrastructure.

## 5. Recommendation

**Phase 1 — shipped 2026-09-08 (v2.19.13/14, SSE v3.1.9).** Honest failure
detection on every browser, the GM told when someone is blocked and which fix
applies, a five-second relay test in Settings, and the documentation to walk a
GM through it. Zero infrastructure. A GM who pastes a relay is fully covered
today.

**Phase 2 — the invisible one, recommended.** A Worker on the existing
Cloudflare account minting short-lived Cloudflare TURN credentials; both apps
fetch at startup and fall back silently to today's behaviour on any failure.
The GM never learns the word "relay". Estimated: a day, most of it on the abuse
control rather than the feature.

**Guardrails to build in from the start, not after:**

- Keep it fallback-only. ICE priority already does this; do not force
  `iceTransportPolicy: 'relay'` for anyone, ever, except as a debug switch.
- Short TTL — hours, not the 48-hour maximum.
- Rate limit the endpoint, and alarm on GB used rather than discovering it on
  a bill.
- Say what it does in the About text, in the same plain words used for
  analytics: the relay carries the connection when a direct one fails, it
  cannot read anything it carries, and it hides both ends' addresses from each
  other. Users who feel watched are usually reacting to silence, not to relays.

**And the lesson that prompted all of this:** the fallback that vanished was
somebody else's free relay, with no SLA and no notice given when it stopped.
Running this on an account we control is the point. It is not about the five
cents.

---

## Sources

- Cloudflare Realtime TURN service and pricing —
  https://developers.cloudflare.com/realtime/turn/
- Cloudflare Realtime TURN FAQ (what it can see, credential lifetime, free
  tier) — https://developers.cloudflare.com/realtime/turn/faq/
- Generating credentials (server-side requirement) —
  https://developers.cloudflare.com/realtime/turn/generate-credentials/
