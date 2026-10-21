/**
 * Stagecraft storage — pack-level connection details (WLED endpoints,
 * Home Assistant URL+token, future Spotify/YouTube credentials) live
 * here. Per-machine, never traverses .mappadux exports — same pattern
 * as projector calibrations ([[project_dmr_storage_map]]).
 *
 * Per-map preset assignments DO travel — they live on the MapAsset
 * itself under `MapAsset.stagecraft` so they bundle alongside the
 * map they're attached to. That's a separate file (in types.ts).
 *
 * This module is the localStorage facade only.
 */

const WLED_ENDPOINTS_KEY = 'mappadux:stagecraft_wled_endpoints';
const HA_CONFIG_KEY      = 'mappadux:stagecraft_ha';
const QLC_CONFIG_KEY     = 'mappadux:stagecraft_qlc';
const SOUNDTRACK_YT_KEY  = 'mappadux:stagecraft_soundtracks_youtube';
const SOUNDTRACK_SP_KEY  = 'mappadux:stagecraft_soundtracks_spotify';
const SOUNDTRACK_LOCAL_KEY = 'mappadux:stagecraft_soundtracks_local';

export interface WledEndpoint {
  /** Stable id (generated when the endpoint is first added). Used to
   *  cross-reference per-map preset assignments. */
  id: string;
  /** Friendly label set by the user (e.g. "Table strip", "Ceiling"). */
  label: string;
  /** Base URL — http://192.168.1.42, http://wled-table.local, etc.
   *  Normalised via wledClient.normaliseEndpoint on save. */
  url: string;
}

export interface HaConfig {
  url: string;
  /** Long-lived access token. Never travels in bundles. */
  token: string;
}

export interface QlcConfig {
  /** WebSocket-bearing URL, e.g. `ws://192.168.1.50:9999/qlcplusWS`.
   *  Stored normalised; users can type just the host and Mappadux
   *  fills in the default port + path. */
  url: string;
}

// ─── WLED endpoints ────────────────────────────────────────────────────

export function getWledEndpoints(): WledEndpoint[] {
  try {
    const raw = localStorage.getItem(WLED_ENDPOINTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(_isWledEndpoint);
  } catch { return []; }
}

export function setWledEndpoints(endpoints: WledEndpoint[]): void {
  try {
    localStorage.setItem(WLED_ENDPOINTS_KEY, JSON.stringify(endpoints));
  } catch { /* private mode etc. — no-op */ }
}

export function addWledEndpoint(endpoint: WledEndpoint): void {
  const list = getWledEndpoints();
  const i = list.findIndex((e) => e.id === endpoint.id);
  if (i >= 0) list[i] = endpoint; else list.push(endpoint);
  setWledEndpoints(list);
}

export function removeWledEndpoint(id: string): void {
  setWledEndpoints(getWledEndpoints().filter((e) => e.id !== id));
}

function _isWledEndpoint(v: unknown): v is WledEndpoint {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r['id'] === 'string'
      && typeof r['label'] === 'string'
      && typeof r['url'] === 'string';
}

// ─── Home Assistant ────────────────────────────────────────────────────

export function getHaConfig(): HaConfig | null {
  try {
    const raw = localStorage.getItem(HA_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const r = parsed as Record<string, unknown>;
    if (typeof r['url'] !== 'string' || typeof r['token'] !== 'string') return null;
    return { url: r['url'], token: r['token'] };
  } catch { return null; }
}

export function setHaConfig(cfg: HaConfig | null): void {
  try {
    if (cfg) localStorage.setItem(HA_CONFIG_KEY, JSON.stringify(cfg));
    else     localStorage.removeItem(HA_CONFIG_KEY);
  } catch { /* private mode etc. — no-op */ }
}

// ─── QLC+ (DMX lighting) ───────────────────────────────────────────────

export function getQlcConfig(): QlcConfig | null {
  try {
    const raw = localStorage.getItem(QLC_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const r = parsed as Record<string, unknown>;
    if (typeof r['url'] !== 'string') return null;
    return { url: r['url'] };
  } catch { return null; }
}

export function setQlcConfig(cfg: QlcConfig | null): void {
  try {
    if (cfg) localStorage.setItem(QLC_CONFIG_KEY, JSON.stringify(cfg));
    else     localStorage.removeItem(QLC_CONFIG_KEY);
  } catch { /* private mode etc. — no-op */ }
}

// ─── Soundtracks — per-provider enable ─────────────────────────────────

/** YouTube doesn't need OAuth — the "enable" is an explicit user
 *  opt-in (mirrors how WLED / HA / QLC+ each connect via Settings)
 *  that says "I want the Soundtracks panel to appear and accept
 *  YouTube URLs". */
export function isYoutubeEnabled(): boolean {
  try { return localStorage.getItem(SOUNDTRACK_YT_KEY) === '1'; }
  catch { return false; }
}
export function setYoutubeEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(SOUNDTRACK_YT_KEY, '1');
    else         localStorage.removeItem(SOUNDTRACK_YT_KEY);
  } catch { /* private mode etc. — no-op */ }
}

/** Spotify (embed path — no Developer App, no OAuth, ~30s previews
 *  for non-signed-in users; full tracks when the user already has
 *  Spotify open in another tab + signed in). Future Web Playback
 *  SDK integration with full track playback regardless of session
 *  will hang off this same enable flag plus a token-config slot. */
export function isSpotifyEnabled(): boolean {
  try { return localStorage.getItem(SOUNDTRACK_SP_KEY) === '1'; }
  catch { return false; }
}
export function setSpotifyEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(SOUNDTRACK_SP_KEY, '1');
    else         localStorage.removeItem(SOUNDTRACK_SP_KEY);
  } catch { /* private mode etc. — no-op */ }
}

/** Local songs (your own files, played by the Vamper engine). Needs
 *  no account, so unlike the streaming providers it is ON unless the
 *  GM turns it off: the key stores '0' for off. */
export function isLocalSongsEnabled(): boolean {
  try { return localStorage.getItem(SOUNDTRACK_LOCAL_KEY) !== '0'; }
  catch { return true; }
}
export function setLocalSongsEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(SOUNDTRACK_LOCAL_KEY);
    else         localStorage.setItem(SOUNDTRACK_LOCAL_KEY, '0');
  } catch { /* private mode etc. — no-op */ }
}

/** Any source enabled → the Soundtracks panel appears. */
export function isSoundtracksEnabled(): boolean {
  return isYoutubeEnabled() || isSpotifyEnabled() || isLocalSongsEnabled();
}

// ─── Convenience: are any Stagecraft connections configured? ──────────

/** True if at least one WLED endpoint, HA config, or QLC+ config
 *  exists. Drives the Lighting/Automation panel's visibility — the
 *  Soundtracks panel is independently gated by isSoundtracksEnabled. */
export function hasAnyStagecraftConnection(): boolean {
  return getWledEndpoints().length > 0
      || getHaConfig()  !== null
      || getQlcConfig() !== null;
}
