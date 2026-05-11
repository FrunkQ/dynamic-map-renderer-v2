import type { ImageSourceConnector, ConnectorManifestEntry } from './types.ts';

/**
 * Game Icons (game-icons.net) — CC-BY 3.0 fantasy / sci-fi / abstract SVG
 * icons by Lorc, Delapouite, Skoll, Quoting, and other contributors. ~4,000
 * icons total; v2.11 ships a curated starter manifest of ~30 entries
 * spanning the most common TTRPG use cases. Users import individual icons
 * into their library; the manifest doesn't pre-populate anything.
 *
 * Future versions can grow the bundled manifest, fetch a fuller manifest at
 * runtime, or expose a search field that hits a manifest-search endpoint.
 *
 * SVGs are served via jsDelivr from the project's GitHub repo. All entries
 * have a `<path fill="#000">` baseline that we rewrite to currentColor at
 * render time so consumers can tint freely.
 */

const SVG_BASE = 'https://cdn.jsdelivr.net/gh/game-icons/icons@master';

const STARTER_MANIFEST: ConnectorManifestEntry[] = [
  // ── Weapons & combat (fantasy) ─────────────────────────────────────────
  { slug: 'lorc/broadsword',      name: 'Broadsword',      author: 'Lorc',       tags: ['weapon','sword','melee','fantasy'] },
  { slug: 'lorc/crossed-axes',    name: 'Crossed Axes',    author: 'Lorc',       tags: ['weapon','axe','melee','dual','fantasy'] },
  { slug: 'lorc/bow-arrow',       name: 'Bow & Arrow',     author: 'Lorc',       tags: ['weapon','bow','ranged','archer','fantasy'] },
  { slug: 'lorc/spear-hook',      name: 'Spear',           author: 'Lorc',       tags: ['weapon','spear','melee','polearm'] },
  // ── Magic & power ──────────────────────────────────────────────────────
  { slug: 'lorc/fire-spell-cast', name: 'Fire Spell',      author: 'Lorc',       tags: ['magic','fire','spell','elemental'] },
  { slug: 'lorc/ice-spell-cast',  name: 'Ice Spell',       author: 'Lorc',       tags: ['magic','ice','frost','spell','elemental'] },
  { slug: 'lorc/lightning-trio',  name: 'Lightning',       author: 'Lorc',       tags: ['magic','lightning','storm','elemental'] },
  { slug: 'lorc/magic-swirl',     name: 'Magic Swirl',     author: 'Lorc',       tags: ['magic','spell','arcane','aura'] },
  // ── Creatures ─────────────────────────────────────────────────────────
  { slug: 'lorc/dragon-head',     name: 'Dragon Head',     author: 'Lorc',       tags: ['creature','dragon','monster','fantasy'] },
  { slug: 'lorc/wolf-head',       name: 'Wolf Head',       author: 'Lorc',       tags: ['creature','wolf','beast','animal'] },
  { slug: 'lorc/spider',          name: 'Spider',          author: 'Lorc',       tags: ['creature','spider','vermin','swarm'] },
  { slug: 'delapouite/skull-bolt',name: 'Lich Skull',      author: 'Delapouite', tags: ['creature','undead','skull','death','lich'] },
  // ── Items & gear ──────────────────────────────────────────────────────
  { slug: 'lorc/round-shield',    name: 'Round Shield',    author: 'Lorc',       tags: ['gear','shield','defence','armour'] },
  { slug: 'lorc/health-potion',   name: 'Health Potion',   author: 'Lorc',       tags: ['item','potion','health','consumable'] },
  { slug: 'lorc/locked-chest',    name: 'Treasure Chest',  author: 'Lorc',       tags: ['item','chest','loot','treasure'] },
  { slug: 'lorc/key',             name: 'Key',             author: 'Lorc',       tags: ['item','key','door','unlock'] },
  // ── Places & dungeon features ─────────────────────────────────────────
  { slug: 'lorc/portal',          name: 'Portal',          author: 'Lorc',       tags: ['place','portal','gate','arcane'] },
  { slug: 'delapouite/wooden-door',name:'Wooden Door',     author: 'Delapouite', tags: ['feature','door','dungeon'] },
  { slug: 'lorc/spiked-trunk',    name: 'Trap',            author: 'Lorc',       tags: ['feature','trap','spike','hazard'] },
  { slug: 'lorc/cauldron',        name: 'Cauldron',        author: 'Lorc',       tags: ['feature','cauldron','witch','alchemy'] },
  // ── Sci-fi ─────────────────────────────────────────────────────────────
  { slug: 'lorc/spaceship',       name: 'Spaceship',       author: 'Lorc',       tags: ['scifi','ship','space','vehicle'] },
  { slug: 'lorc/ray-gun',         name: 'Ray Gun',         author: 'Lorc',       tags: ['scifi','weapon','blaster','ranged'] },
  { slug: 'lorc/robot-antennas',  name: 'Robot',           author: 'Lorc',       tags: ['scifi','robot','machine','automaton'] },
  { slug: 'lorc/processor',       name: 'Processor',       author: 'Lorc',       tags: ['scifi','tech','cpu','machine'] },
  // ── Abstract / status markers ─────────────────────────────────────────
  { slug: 'lorc/eye-target',      name: 'Eye / Spot',      author: 'Lorc',       tags: ['abstract','eye','spot','vision'] },
  { slug: 'lorc/footprint',       name: 'Footprint',       author: 'Lorc',       tags: ['abstract','footprint','track','trail'] },
  { slug: 'lorc/heart-plus',      name: 'Healing',         author: 'Lorc',       tags: ['abstract','heart','heal','health'] },
  { slug: 'lorc/death-skull',     name: 'Death',           author: 'Lorc',       tags: ['abstract','skull','dead','danger'] },
  { slug: 'lorc/two-shadows',     name: 'Hidden / Stealth',author: 'Lorc',       tags: ['abstract','stealth','shadow','hidden'] },
  { slug: 'lorc/flag',            name: 'Flag',            author: 'Lorc',       tags: ['abstract','flag','marker','objective'] },
];

export const gameIconsConnector: ImageSourceConnector = {
  id:          'game-icons',
  displayName: 'Game Icons',
  license:     'CC-BY 3.0',
  licenseUrl:  'https://creativecommons.org/licenses/by/3.0/',
  sourceUrl:   'https://game-icons.net/',
  tintable:    true,

  async loadManifest(): Promise<ConnectorManifestEntry[]> {
    return STARTER_MANIFEST;
  },

  buildUrl(entry: ConnectorManifestEntry): string {
    return `${SVG_BASE}/${entry.slug}.svg`;
  },

  attributionFor(entry: ConnectorManifestEntry): string {
    const who = entry.author ? ` by ${entry.author}` : '';
    return `Icon: "${entry.name}"${who} — CC-BY 3.0 via game-icons.net`;
  },

  async fetchSvg(entry: ConnectorManifestEntry): Promise<string> {
    const res = await fetch(gameIconsConnector.buildUrl(entry));
    if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`);
    return await res.text();
  },
};
