# relay-ice — the fallback relay's front door

A Cloudflare Worker that hands a browser short-lived TURN credentials. Both
Mappadux and Star System Explorer call it at startup; if it is missing, slow or
broken, both apps carry on exactly as they did before it existed.

Why it has to exist at all: Cloudflare's TURN key is a long-term secret that
must never reach a browser. What a browser may safely hold is a credential
minted from that key which expires in a couple of hours. Something server-side
has to do the minting, and this is the smallest thing that can.

Read `docs/connectivity-that-just-works.md` in the Mappadux repo for the design
and the reasoning — what a relay can and cannot see, what it costs, and why it
is the last route tried rather than the first.

---

**Deployed 2026-09-08:** `https://relay-ice.orange-tree-847c.workers.dev`
— live, rate-limited and origin-gated, and returning 503 until the secrets in
step 2 are set. Neither app calls it yet.

## Setting it up

Steps 1 and 2 are yours: they involve an account and a secret, and nothing
automated should be handling either.

### 1. Create a TURN key

Cloudflare dashboard → **Realtime** → **TURN Server** → **Create** (top right).
The list is empty until you do; there is no key by default. Name it anything.

It then shows a **TURN Key ID** and a **TURN Key API Token**. Copy the token
before leaving the page — it is displayed once and cannot be retrieved later,
only replaced.

### 2. Deploy, and give it the secret

From this directory:

```bash
npx wrangler deploy
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_KEY_API_TOKEN
```

Each `secret put` prompts for the value and stores it encrypted on Cloudflare.
It is never written to a file here, and it must never be pasted into a commit,
an issue, or a chat window.

### 3. Point a hostname at it

The Worker gets a `*.workers.dev` URL immediately, which is enough to test.
For real use give it a custom domain (Workers → the service → Settings →
Domains & Routes), the same way `explorers.starsystemx.com` is set up.

### 4. Tell the apps where it is

Set `MANAGED_ICE_URL` in **both** repos and deploy them:

- Mappadux: `src/p2p/iceConfig.ts`
- SSE: `src/lib/iceConfig.ts`

Until that constant is set, the apps do not call this Worker at all.

---

## Checking it works

**From a terminal** — an allowed origin must be sent, because the allowlist is
the gate:

```bash
curl -s -H "Origin: https://mappadux.com" https://<your-worker-url>/ice
```

A working answer is a JSON body with `iceServers` (a STUN entry and a TURN
entry carrying `username` and `credential`) and `ttl`. A 503 means the secrets
are not set yet; a 403 means the Origin header was missing or not on the list.

**From the app** — open Settings → Connections and press **Test these
servers**. "Relay working" means the credentials were accepted and a relay
candidate came back, which is the only proof that matters.

**Before it is live**, any browser can point at a test endpoint without a
deploy:

```js
localStorage.setItem('mappadux:managed_relay_url', 'https://<your-worker-url>/ice')
```

(SSE uses the key `sse-managed-relay-url`.) Remove the key to go back to the
shipped behaviour.

---

## What it records, and what it refuses to

Two counters, written to an Analytics Engine dataset: **which app asked** and
**what happened** (issued, rate-limited, unconfigured, upstream error). Summing
a group gives a request count.

It does not record IP addresses, countries, or anything per-visitor. The
caller's address is used for one thing — the rate limiter — and is passed
straight to it.

The number actually worth having is what fraction of players need a relay, and
it does not require collecting anything more: Cloudflare's own TURN analytics
give GB relayed and session counts, and the ratio against these request counts
answers it.

## Adding a new host

New deployment origins go in `ALLOWED_ORIGINS` in `src/index.js`. Vercel
preview URLs are matched by pattern and need no change.
