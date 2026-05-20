/**
 * Local browser-only settings — anything Mappadux stores in localStorage that
 * lives outside the IndexedDB workspace. Centralised so the Settings dialog
 * can enumerate, surface, and selectively wipe these without grepping the
 * codebase on every change.
 *
 * Categories:
 *   • API keys      — credentials user provided. Sensitive; explicit delete.
 *   • Settings      — UI preferences (button hint dismissals, broadcast
 *                     toggle, etc.) — wiped on Delete All Data, kept on Delete DB.
 *   • Calibration   — projector setups (hardware-specific; kept on Delete DB).
 *   • Internal flags— migration / one-shot flags Mappadux uses itself.
 */

/** Suppress the default-bundle seed on next startup. Used by the "Delete DB
 *  (keep settings)" action so the user lands on an empty workspace rather
 *  than being re-seeded with the Getting Started pack. Cleared by the
 *  startup code that honours it. */
export const SUPPRESS_DEFAULT_SEED_KEY = 'dmr_suppress_default_seed';

/** Animated map performance cap (v2.12.x). When set, the renderer caps
 *  video-map texture uploads at 1920 px on the longest side regardless
 *  of canvas size — useful on lower-end GPUs where a 4K canvas + 4K
 *  source causes texImage2D to saturate the rAF budget. Default off
 *  (no cap) — canvas size drives the texture. */
export const VIDEO_CAP_1080_KEY = 'dmr_video_cap_1080';

export function isVideoCap1080Enabled(): boolean {
  try { return localStorage.getItem(VIDEO_CAP_1080_KEY) === '1'; }
  catch { return false; }
}

export function setVideoCap1080Enabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(VIDEO_CAP_1080_KEY, '1');
    else         localStorage.removeItem(VIDEO_CAP_1080_KEY);
  } catch { /* private mode etc. — no-op */ }
}

/** Same-machine player static-only mode (v2.12.x). When set, the GM
 *  suppresses the video_bundle broadcast on the LocalChannel
 *  (BroadcastChannel) path — same-browser peers see only the first
 *  frame, never the animated playback. Saves Chrome's per-window
 *  decoder budget from being fought over by the GM + popup. Default
 *  off — the GM ships the full animation everywhere unless the user
 *  explicitly opts in. Projector keeps trying to animate regardless;
 *  it's never a "local player" in this sense. */
export const LOCAL_PLAYER_STATIC_ONLY_KEY = 'dmr_local_player_static_only';

export function isLocalPlayerStaticOnly(): boolean {
  try { return localStorage.getItem(LOCAL_PLAYER_STATIC_ONLY_KEY) === '1'; }
  catch { return false; }
}

export function setLocalPlayerStaticOnly(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(LOCAL_PLAYER_STATIC_ONLY_KEY, '1');
    else         localStorage.removeItem(LOCAL_PLAYER_STATIC_ONLY_KEY);
  } catch { /* private mode etc. — no-op */ }
}

/** UI scale for the left sidebar. Stored as a number (1.0 = 100%);
 *  values outside MIN/MAX clamp on read. Applied via CSS `zoom` so the
 *  whole box model scales uniformly — fonts, padding, borders, icon
 *  SVGs, popovers anchored to the sidebar, everything stays in
 *  proportion. The map canvas + overlay are untouched; only the
 *  sidebar shrinks/grows. Read once at startup and re-applied
 *  whenever the slider moves. */
export const UI_SCALE_KEY = 'dmr_ui_scale';
export const UI_SCALE_MIN = 0.5;
export const UI_SCALE_MAX = 1.5;
export const UI_SCALE_DEFAULT = 1.0;

export function getUiScale(): number {
  try {
    const raw = localStorage.getItem(UI_SCALE_KEY);
    if (raw === null) return UI_SCALE_DEFAULT;
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) return UI_SCALE_DEFAULT;
    return Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, n));
  } catch { return UI_SCALE_DEFAULT; }
}

export function setUiScale(scale: number): void {
  try {
    const clamped = Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, scale));
    if (clamped === UI_SCALE_DEFAULT) localStorage.removeItem(UI_SCALE_KEY);
    else                              localStorage.setItem(UI_SCALE_KEY, String(clamped));
  } catch { /* private mode etc. — no-op */ }
}

/** Push the stored scale into the DOM. Idempotent; safe to call on
 *  startup AND on every slider change.
 *
 *  Two parts:
 *    • CSS `zoom` on #sidebar — visually scales the contents
 *      (fonts, padding, icons, popovers) uniformly. Non-standard
 *      but supported in Chromium + WebKit; Firefox no-ops, which
 *      is fine because scale 1.0 is the default everywhere.
 *    • `--ui-scale` CSS variable on :root — the grid column width
 *      multiplies by this in main.css. Without this the column
 *      would stay 280 px wide while the contents shrank inside,
 *      leaving empty space on the right of a downscaled panel
 *      (or clipping a upscaled one). */
export function applyUiScale(scale: number = getUiScale()): void {
  document.documentElement.style.setProperty('--ui-scale', String(scale));
  const sidebar = document.getElementById('sidebar');
  if (sidebar) (sidebar.style as CSSStyleDeclaration & { zoom?: string }).zoom = String(scale);
}

/** Last MOTD version the user dismissed. Compared against
 *  CURRENT_MOTD.version on startup — when they differ (and the dialog
 *  isn't suppressed for first-install / About-open reasons) the MOTD
 *  popup fires once and the new version is recorded here. Cleared by
 *  Delete All Data, which means the next session shows the current
 *  MOTD again. */
export const MOTD_SEEN_VERSION_KEY = 'dmr_motd_seen_version';

export function getLastSeenMotdVersion(): string | null {
  try { return localStorage.getItem(MOTD_SEEN_VERSION_KEY); }
  catch { return null; }
}

export function setLastSeenMotdVersion(version: string): void {
  try { localStorage.setItem(MOTD_SEEN_VERSION_KEY, version); }
  catch { /* private mode etc. — no-op */ }
}

/** v2.14.2 — beta MOTD acknowledgement. Independent of the production
 *  MOTD-seen version so a release-cycle MOTD on www doesn't accidentally
 *  suppress the beta warning (or vice versa). Beta MOTD is content-stable
 *  ("welcome, beta is volatile, maps stay compatible-ish"), so a single
 *  boolean dismissed-flag is enough — we don't version it per-release. */
export const BETA_MOTD_DISMISSED_KEY = 'mappadux:beta_motd_dismissed';

export function isBetaMotdDismissed(): boolean {
  try { return localStorage.getItem(BETA_MOTD_DISMISSED_KEY) === '1'; }
  catch { return false; }
}

export function setBetaMotdDismissed(): void {
  try { localStorage.setItem(BETA_MOTD_DISMISSED_KEY, '1'); }
  catch { /* private mode etc. — no-op */ }
}

/** Heuristic — are we running on the beta channel (Vercel preview /
 *  beta branch) rather than production (www.mappadux.com) or local
 *  dev? Production hostnames are the canonical site; localhost / file:
 *  are dev. Everything else (Vercel preview URLs, branch deploys, any
 *  custom subdomain) is treated as beta. Used by the beta MOTD only —
 *  don't reach for this for product behaviour. */
export function isBetaHost(): boolean {
  try {
    const h = (typeof location !== 'undefined' ? location.hostname : '').toLowerCase();
    if (!h) return false;
    if (h === 'www.mappadux.com' || h === 'mappadux.com') return false;
    if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1') return false;
    return true;
  } catch { return false; }
}

/** Known API key entries kept in localStorage. Used by Settings to list +
 *  delete credentials separately from other local state. */
export const API_KEY_ENTRIES: Array<{ key: string; label: string }> = [
  { key: 'dmr_freesound_api_key', label: 'Freesound API key' },
];

/** All localStorage entries Mappadux owns. Two prefix conventions
 *  built up over the project's lifetime:
 *    • `dmr_*`        — the original prefix from the v1/v2 days.
 *    • `mappadux:*`   — used by features added after the rename
 *                       (projector calibrations, drawing mode pref,
 *                       fullscreen-button-seen flag, etc.).
 *    • `mappadux_*`   — handful of older keys with an underscore
 *                       instead of a colon (remote_audio toggle,
 *                       debug_video flag).
 *  Delete All Data wipes every key matching any of these prefixes —
 *  earlier only `dmr_*` was covered, so projector calibrations +
 *  drawing-mode preference + a few perf flags survived a "fresh
 *  install" reset, contradicting the Settings copy. Caught in the
 *  2026-05-17 storage audit. */
const OWNED_PREFIXES = ['dmr_', 'mappadux:', 'mappadux_'] as const;
export function listOwnedKeys(): string[] {
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && OWNED_PREFIXES.some((p) => k.startsWith(p))) out.push(k);
  }
  return out;
}

export interface StoredApiKey {
  key:   string;
  label: string;
  /** First 6 / last 4 of the value, redacted in the middle. */
  preview: string;
}

/** Enumerate any API key entries currently present. */
export function getStoredApiKeys(): StoredApiKey[] {
  const out: StoredApiKey[] = [];
  for (const entry of API_KEY_ENTRIES) {
    const value = localStorage.getItem(entry.key);
    if (!value) continue;
    out.push({ key: entry.key, label: entry.label, preview: redact(value) });
  }
  return out;
}

/** Remove a single API key. */
export function deleteApiKey(key: string): void {
  localStorage.removeItem(key);
}

/** Remove ALL known API keys. */
export function deleteAllApiKeys(): void {
  for (const entry of API_KEY_ENTRIES) localStorage.removeItem(entry.key);
}

/** Remove every Mappadux-owned localStorage entry (API keys, settings,
 *  calibration setups, internal flags). Used by Delete All Data. */
export function clearAllLocalSettings(): void {
  for (const k of listOwnedKeys()) localStorage.removeItem(k);
}

function redact(s: string): string {
  if (s.length <= 12) return '••••';
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}
