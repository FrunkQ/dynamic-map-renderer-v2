import { getConnectorCacheEntry, putConnectorCacheEntry } from '../../storage/db.ts';

/**
 * Cached + throttled SVG fetcher used by the asset connectors (game-icons,
 * lucide). Solves two problems that bite when a grid of 60+ tiles fires
 * fetches in parallel:
 *
 *   1. Stale manifest entries return 404 — without caching we keep retrying
 *      them every time the modal opens. The connector cache remembers 404s
 *      across sessions so a dead path costs one fetch ever, not one per visit.
 *
 *   2. Free CDNs (jsdelivr in our case) rate-limit bursty clients and start
 *      returning 503/CORS errors. A small in-flight cap keeps the fan-out
 *      polite — under the limit at any moment, queue behind it otherwise.
 *
 * Success results live in IndexedDB so the second time the user opens the
 * library their bandwidth bill is zero. The in-memory mirror short-circuits
 * the IDB roundtrip on hot reads (e.g. rapid scrolling through the grid).
 */

const MAX_IN_FLIGHT = 4;
const memCache = new Map<string, { svg?: string; status: 'ok' | 'not-found' }>();

let inFlight = 0;
const queue: (() => void)[] = [];

function acquireSlot(): Promise<void> {
  if (inFlight < MAX_IN_FLIGHT) {
    inFlight++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    queue.push(() => { inFlight++; resolve(); });
  });
}

function releaseSlot(): void {
  inFlight--;
  const next = queue.shift();
  if (next) next();
}

/**
 * Fetch an SVG by URL, hitting cache first. Throws on cached or fresh 404.
 * Does NOT cache transient failures (5xx, network errors) so the next
 * attempt has a chance to succeed once the rate limit clears or the user
 * reconnects.
 */
export async function fetchSvgCached(url: string): Promise<string> {
  const mem = memCache.get(url);
  if (mem) {
    if (mem.status === 'ok' && mem.svg) return mem.svg;
    throw new Error(`Cached miss: ${url} (404)`);
  }

  const persisted = await getConnectorCacheEntry(url);
  if (persisted) {
    memCache.set(
      url,
      persisted.svg !== undefined
        ? { svg: persisted.svg, status: persisted.status }
        : { status: persisted.status },
    );
    if (persisted.status === 'ok' && persisted.svg) return persisted.svg;
    throw new Error(`Cached miss: ${url} (404)`);
  }

  await acquireSlot();
  try {
    const res = await fetch(url);
    if (res.status === 404) {
      // Permanent — cache so we don't keep hammering a dead path.
      const entry = { url, status: 'not-found' as const, fetchedAt: Date.now() };
      memCache.set(url, { status: 'not-found' });
      await putConnectorCacheEntry(entry);
      throw new Error(`Fetch failed: HTTP 404`);
    }
    if (!res.ok) {
      // Transient (5xx, rate limit, CORS-on-503) — don't cache, let the
      // next visit try again.
      throw new Error(`Fetch failed: HTTP ${res.status}`);
    }
    const svg = await res.text();
    const entry = { url, svg, status: 'ok' as const, fetchedAt: Date.now() };
    memCache.set(url, { svg, status: 'ok' });
    await putConnectorCacheEntry(entry);
    return svg;
  } finally {
    releaseSlot();
  }
}
