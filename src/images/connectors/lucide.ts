import type { ImageSourceConnector, ConnectorManifestEntry } from './types.ts';

/**
 * Lucide (lucide.dev) — MIT-licensed contemporary line icons. Pure stroke
 * SVGs that use stroke="currentColor", so they tint via CSS color naturally.
 * Excellent for UI / interface / utility markers (clock, key, marker pin,
 * compass, info badge, etc).
 *
 * SVGs are served via jsDelivr from the lucide-static npm package. On first
 * browse the connector fetches `tags.json` from the same CDN — Lucide
 * publishes a complete name→tags index there (~1,500 entries). The starter
 * manifest below is a fallback for when the network fetch fails and a hint
 * of what to expect; once tags.json loads, search runs across the entire
 * catalog.
 */

const SVG_BASE      = 'https://cdn.jsdelivr.net/npm/lucide-static@latest/icons';
const TAGS_INDEX_URL = 'https://cdn.jsdelivr.net/npm/lucide-static@latest/tags.json';

// In-memory cache so repeated tab switches don't re-fetch the index.
let cachedManifest: ConnectorManifestEntry[] | null = null;

const STARTER_MANIFEST: ConnectorManifestEntry[] = [
  // ── Navigation / location ─────────────────────────────────────────────
  { slug: 'map-pin',         name: 'Map Pin',         tags: ['nav','location','pin','marker'] },
  { slug: 'compass',         name: 'Compass',         tags: ['nav','compass','direction'] },
  { slug: 'flag',            name: 'Flag',            tags: ['nav','flag','objective','marker'] },
  { slug: 'crosshair',       name: 'Crosshair',       tags: ['nav','target','aim','crosshair'] },
  { slug: 'navigation',      name: 'Heading',         tags: ['nav','arrow','direction'] },
  // ── Utility & status ──────────────────────────────────────────────────
  { slug: 'info',            name: 'Info',            tags: ['util','info','note','i'] },
  { slug: 'alert-triangle',  name: 'Alert',           tags: ['util','warn','alert','danger'] },
  { slug: 'check-circle',    name: 'Check',           tags: ['util','ok','done','tick'] },
  { slug: 'x-circle',        name: 'Cross',           tags: ['util','no','fail','cross'] },
  { slug: 'help-circle',     name: 'Question',        tags: ['util','help','question'] },
  // ── Tools & objects ──────────────────────────────────────────────────
  { slug: 'key',             name: 'Key',             tags: ['tool','key','door','unlock'] },
  { slug: 'wrench',          name: 'Wrench',          tags: ['tool','wrench','repair'] },
  { slug: 'hammer',          name: 'Hammer',          tags: ['tool','hammer','craft','melee'] },
  { slug: 'lock',            name: 'Lock',            tags: ['tool','lock','locked','secure'] },
  { slug: 'unlock',          name: 'Unlock',          tags: ['tool','unlock','open'] },
  // ── Time & state ──────────────────────────────────────────────────────
  { slug: 'clock',           name: 'Clock',           tags: ['time','clock','hour','wait'] },
  { slug: 'hourglass',       name: 'Hourglass',       tags: ['time','hourglass','timer'] },
  { slug: 'zap',             name: 'Lightning',       tags: ['energy','lightning','quick'] },
  { slug: 'flame',           name: 'Flame',           tags: ['energy','fire','flame'] },
  { slug: 'droplets',        name: 'Droplets',        tags: ['element','water','droplet'] },
  // ── Living things ─────────────────────────────────────────────────────
  { slug: 'user',            name: 'Person',          tags: ['npc','character','person'] },
  { slug: 'users',           name: 'Crowd',           tags: ['npc','group','crowd'] },
  { slug: 'cat',             name: 'Cat',             tags: ['animal','cat'] },
  { slug: 'dog',             name: 'Dog',             tags: ['animal','dog'] },
  { slug: 'bird',            name: 'Bird',            tags: ['animal','bird'] },
  // ── Places & travel ──────────────────────────────────────────────────
  { slug: 'home',            name: 'Home',            tags: ['place','home','house'] },
  { slug: 'castle',          name: 'Castle',          tags: ['place','castle','tower','keep'] },
  { slug: 'mountain',        name: 'Mountain',        tags: ['place','mountain','peak'] },
  { slug: 'tree-pine',       name: 'Pine Tree',       tags: ['place','tree','forest','wilderness'] },
  { slug: 'anchor',          name: 'Anchor',          tags: ['place','anchor','dock','ship'] },
];

export const lucideConnector: ImageSourceConnector = {
  id:          'lucide',
  displayName: 'Lucide',
  license:     'MIT',
  licenseUrl:  'https://lucide.dev/license',
  sourceUrl:   'https://lucide.dev/',
  tintable:    true,

  async loadManifest(): Promise<ConnectorManifestEntry[]> {
    if (cachedManifest) return cachedManifest;
    // Try the full upstream index first. Lucide ships tags.json with the
    // shape { "icon-slug": ["tag1","tag2",...], ... } — perfect for our
    // search-by-tag flow.
    try {
      const res = await fetch(TAGS_INDEX_URL);
      if (res.ok) {
        const data = await res.json() as Record<string, unknown>;
        const entries: ConnectorManifestEntry[] = [];
        for (const [slug, raw] of Object.entries(data)) {
          if (!slug) continue;
          const tags = Array.isArray(raw) ? raw.filter((t): t is string => typeof t === 'string') : [];
          entries.push({
            slug,
            name: humaniseSlug(slug),
            tags,
          });
        }
        if (entries.length > 0) {
          cachedManifest = entries.sort((a, b) => a.name.localeCompare(b.name));
          return cachedManifest;
        }
      }
    } catch (err) {
      console.warn('[Lucide] tags.json fetch failed; falling back to bundled starter manifest:', err);
    }
    // Network failed or response was empty — surface the curated subset so
    // browsing still works offline / behind aggressive firewalls.
    cachedManifest = STARTER_MANIFEST.slice();
    return cachedManifest;
  },

  buildUrl(entry: ConnectorManifestEntry): string {
    return `${SVG_BASE}/${entry.slug}.svg`;
  },

  attributionFor(entry: ConnectorManifestEntry): string {
    return `Icon: "${entry.name}" — MIT via lucide.dev`;
  },

  async fetchSvg(entry: ConnectorManifestEntry): Promise<string> {
    const res = await fetch(lucideConnector.buildUrl(entry));
    if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`);
    return await res.text();
  },
};

/** Turn 'arrow-up-right' into 'Arrow Up Right' for display. */
function humaniseSlug(slug: string): string {
  return slug
    .split('-')
    .map((part) => part.length === 0 ? '' : part[0]!.toUpperCase() + part.slice(1))
    .join(' ');
}
