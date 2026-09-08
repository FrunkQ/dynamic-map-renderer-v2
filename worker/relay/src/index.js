/**
 * relay-ice — hands a browser short-lived TURN credentials, and nothing else.
 *
 * Mappadux and Star System Explorer both connect players peer-to-peer. When
 * the two networks will not carry a direct connection, the browser needs a
 * relay to fall back to — and until now there was none, because the free one
 * both apps inherited from PeerJS stopped existing (measured 2026-09-08).
 *
 * This is that relay's front door. It exists because Cloudflare's TURN key is
 * a LONG-TERM SECRET that must never reach a browser; what a browser may have
 * is a credential minted from it that expires in hours. So: the key lives here
 * as a Worker secret, and the browser gets the short-lived answer.
 *
 * ── What this is not ───────────────────────────────────────────────────────
 *
 * Not a pipe every game flows through. ICE ranks candidates by type and RELAY
 * IS LAST — below the LAN address, below the direct path STUN finds. A browser
 * offered a relay still connects directly whenever it can, and the relay
 * carries only the players who could not connect without it.
 *
 * Not a way to know who is playing. The request carries no room code, no
 * session id, no cookie and no body — the client sends a bare GET, and that is
 * asserted by a test in the app repo. What reaches this Worker is an IP and a
 * timestamp, which is what any web request gives any server. NOTHING HERE MAY
 * EVER LOG OR STORE THAT IP. The analytics below are deliberately coarse for
 * exactly this reason: counts by app and outcome, never rows about people.
 *
 * Not load-bearing. Every failure path returns something the app treats as
 * "no relay", and "no relay" is where both apps were yesterday. If this Worker
 * is down, games still connect exactly as they did.
 */

/** Who may ask. An origin not on this list gets no CORS header and the
 *  browser discards the answer — so the allowlist is the real gate, not the
 *  politeness. Add a host here when a new deployment needs it. */
const ALLOWED_ORIGINS = new Set([
  'https://mappadux.com',
  'https://www.mappadux.com',
  'https://beta.mappadux.com',
  'https://starsystemx.com',
  'https://www.starsystemx.com',
  'https://beta.starsystemx.com',
  // Local development, both apps' dev servers.
  'http://localhost:5173',
  'http://localhost:5180',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5180',
]);

/**
 * How long a credential lasts. Two hours: comfortably longer than the gap
 * between opening the app and joining a game, and short enough that a
 * credential found in a browser cache is worthless by the time anyone looks.
 * Cloudflare's own maximum is 48 hours; there is no reason to go near it.
 */
const TTL_SECONDS = 2 * 60 * 60;

/** Vercel preview deployments, which change hostname on every push. */
function isPreviewOrigin(origin) {
  return /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin);
}

function corsHeaders(origin) {
  const allowed = origin && (ALLOWED_ORIGINS.has(origin) || isPreviewOrigin(origin));
  return allowed
    ? {
        'Access-Control-Allow-Origin': origin,
        'Vary': 'Origin',
        // No credentials, ever: this endpoint has no notion of a user and must
        // not grow one by accident.
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Max-Age': '86400',
      }
    : null;
}

/**
 * Which app asked, for counting only. Derived from the origin we already have
 * to look at for CORS — nothing extra is collected to obtain it.
 */
function appLabel(origin) {
  if (!origin) return 'unknown';
  if (origin.includes('mappadux')) return origin.includes('beta') ? 'mappadux-beta' : 'mappadux';
  if (origin.includes('starsystemx')) return origin.includes('beta') ? 'sse-beta' : 'sse';
  if (origin.includes('localhost') || origin.includes('127.0.0.1')) return 'dev';
  if (origin.includes('vercel.app')) return 'preview';
  return 'other';
}

/**
 * Count what happened. Blobs are the dimensions to group by; the double is
 * always 1 so the sum of a group is its request count.
 *
 * Deliberately NOT recorded: the IP, the country, anything per-visitor. The
 * numbers worth having are "how many asked" and "how many GB were relayed" —
 * and the second one comes free from Cloudflare's own TURN analytics. The
 * ratio between them is the answer to "what fraction of players need this",
 * which is the only question anyone actually has.
 */
function count(env, app, outcome) {
  try {
    env.RELAY_ANALYTICS?.writeDataPoint({
      blobs: [app, outcome],
      doubles: [1],
      indexes: [app],
    });
  } catch {
    /* analytics must never break the answer */
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin);
    const app = appLabel(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors ?? {} });
    }
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers: cors ?? {} });
    }
    if (!cors) {
      // Unknown origin. Refused plainly, with no CORS header, so a browser
      // would discard it anyway.
      count(env, app, 'origin-refused');
      return new Response('Not allowed', { status: 403 });
    }

    // Rate limit on the caller's address. This is the one place the IP is
    // touched, it is passed straight to the limiter, and it is not stored or
    // logged here. Without this the endpoint is a free TURN relay for anyone
    // who finds it, and TURN relays get found.
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (env.RELAY_LIMIT) {
      const { success } = await env.RELAY_LIMIT.limit({ key: ip });
      if (!success) {
        count(env, app, 'rate-limited');
        return json({ error: 'rate limited' }, 429, cors);
      }
    }

    if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) {
      // Not configured yet. Say so honestly; the app reads any failure as
      // "no relay" and carries on.
      count(env, app, 'unconfigured');
      return json({ error: 'relay not configured' }, 503, cors);
    }

    try {
      const res = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ttl: TTL_SECONDS }),
        },
      );
      if (!res.ok) {
        count(env, app, `upstream-${res.status}`);
        return json({ error: 'could not mint credentials' }, 502, cors);
      }
      const body = await res.json();
      count(env, app, 'issued');
      // Cloudflare's body already has the shape the apps parse; ttl is added
      // so the client knows how long to cache it rather than guessing.
      return json({ iceServers: body.iceServers, ttl: TTL_SECONDS }, 200, cors);
    } catch {
      count(env, app, 'upstream-error');
      return json({ error: 'could not mint credentials' }, 502, cors);
    }
  },
};

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      'Content-Type': 'application/json',
      // A credential is short-lived and personal to one browser's session:
      // nothing between here and there may hold on to it.
      'Cache-Control': 'no-store',
    },
  });
}
