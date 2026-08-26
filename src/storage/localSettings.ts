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

import { isValidFormula } from '../dice/roll.ts';
import { chooseDieStyle, type DieStyle, type DieStylePreference } from '../rendering/dieShapes.ts';
import {
  DEFAULT_DICE_POLICY, normalisePolicy, asDetail,
  type DicePolicy, type DiceDetail,
} from '../dice/dicePolicy.ts';

/** Suppress the default-bundle seed on next startup. Used by the "Delete DB
 *  (keep settings)" action so the user lands on an empty workspace rather
 *  than being re-seeded with the Getting Started pack. Cleared by the
 *  startup code that honours it. */
export const SUPPRESS_DEFAULT_SEED_KEY = 'dmr_suppress_default_seed';

/** v2.17.3 — set once the Getting Started bundle has been seeded (genuine
 *  first run), or once the user takes control of their own workspace (the
 *  DB already has maps, or they pick "New Map Pack…"). Makes the default
 *  seed a TRUE one-time event: an empty DB stays empty instead of
 *  re-seeding Getting Started every time it has no maps. Wiped by Delete
 *  All Data, so a genuine fresh install still seeds. */
export const DEFAULT_SEED_DONE_KEY = 'dmr_default_seed_done';

/** v2.17.19 — Welcome (Getting Started) pack content version last seeded into
 *  this browser. Compared against WELCOME_PACK_VERSION (src/storage/seedMaps.ts)
 *  to offer a refresh when a newer tour ships. Absent on installs seeded before
 *  versioning began — callers treat "seeded-but-unversioned" as version 1. */
export const WELCOME_PACK_SEEDED_VERSION_KEY = 'dmr_welcome_pack_version';
export function getWelcomePackSeededVersion(): number | null {
  try {
    const v = localStorage.getItem(WELCOME_PACK_SEEDED_VERSION_KEY);
    return v === null ? null : (Number(v) || 0);
  } catch { return null; }
}
export function setWelcomePackSeededVersion(v: number): void {
  try { localStorage.setItem(WELCOME_PACK_SEEDED_VERSION_KEY, String(v)); } catch { /* private mode */ }
}

/** v2.17.19 — Welcome-pack-refresh version the user declined with "Not now".
 *  Suppresses re-offering the same tour update until a newer one ships. */
export const WELCOME_PACK_OFFER_DISMISSED_KEY = 'dmr_welcome_pack_offer_dismissed';
export function getWelcomePackOfferDismissedVersion(): number {
  try { return Number(localStorage.getItem(WELCOME_PACK_OFFER_DISMISSED_KEY)) || 0; }
  catch { return 0; }
}
export function setWelcomePackOfferDismissedVersion(v: number): void {
  try { localStorage.setItem(WELCOME_PACK_OFFER_DISMISSED_KEY, String(v)); } catch { /* private mode */ }
}

/** v2.17.19 — One-shot flag set just before reloading after a welcome-pack
 *  refresh; read + cleared on the next startup to show the confirmation toast. */
export const WELCOME_PACK_REFRESHED_KEY = 'dmr_welcome_pack_refreshed';
export function setWelcomePackRefreshedFlag(): void {
  try { localStorage.setItem(WELCOME_PACK_REFRESHED_KEY, '1'); } catch { /* private mode */ }
}
export function consumeWelcomePackRefreshedFlag(): boolean {
  try {
    if (localStorage.getItem(WELCOME_PACK_REFRESHED_KEY) === '1') {
      localStorage.removeItem(WELCOME_PACK_REFRESHED_KEY);
      return true;
    }
  } catch { /* private mode */ }
  return false;
}

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

/** v2.14.16 — Scaled View transitions opt-in. The Scaled View
 *  defaults to cut-to-frame (instant map / handout reveal) because
 *  the table screen feels too jarring when animations play on it.
 *  Set this flag to opt the Scaled View back into full transitions
 *  (matching the Player view). Applied at ProjectorApp init time —
 *  the user must reopen the Scaled View window for the change to
 *  take effect. Default off. */
// v2.18 — default Star System Explorer origin for new StarMap maps (prod / beta / dev).
// Per-map origins still travel with each map; this only seeds the Add StarMap dialog.
export const SSE_ORIGIN_KEY = 'mappadux:sse_origin';
export const SSE_ORIGIN_DEFAULT = 'https://starsystemx.com';
export function getSseOrigin(): string {
  try { return localStorage.getItem(SSE_ORIGIN_KEY) || SSE_ORIGIN_DEFAULT; } catch { return SSE_ORIGIN_DEFAULT; }
}
export function setSseOrigin(origin: string | null): void {
  try {
    const o = (origin ?? '').trim();
    if (!o || o === SSE_ORIGIN_DEFAULT) localStorage.removeItem(SSE_ORIGIN_KEY);
    else localStorage.setItem(SSE_ORIGIN_KEY, o);
  } catch { /* private mode etc. */ }
}

export const SCALED_VIEW_TRANSITIONS_KEY = 'mappadux:scaled_view_transitions';

export function isScaledViewTransitionsEnabled(): boolean {
  try { return localStorage.getItem(SCALED_VIEW_TRANSITIONS_KEY) === '1'; }
  catch { return false; }
}

export function setScaledViewTransitionsEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(SCALED_VIEW_TRANSITIONS_KEY, '1');
    else         localStorage.removeItem(SCALED_VIEW_TRANSITIONS_KEY);
  } catch { /* private mode etc. — no-op */ }
}

/** v2.16.65 — Initiative sort direction. One-shot GM preference; default
 *  High → Low (D&D / Pathfinder / most d20). Low → High suits roll-under
 *  systems (Cyberpunk Red, Call of Cthulhu, etc.). Manual mode is still
 *  reachable via drag-reorder regardless of this setting. */
export const INITIATIVE_SORT_DIRECTION_KEY = 'mappadux:initiative_sort_direction';

export function getInitiativeSortDirection(): 'high-to-low' | 'low-to-high' {
  try {
    const v = localStorage.getItem(INITIATIVE_SORT_DIRECTION_KEY);
    return v === 'low-to-high' ? 'low-to-high' : 'high-to-low';
  } catch { return 'high-to-low'; }
}

export function setInitiativeSortDirection(dir: 'high-to-low' | 'low-to-high'): void {
  try { localStorage.setItem(INITIATIVE_SORT_DIRECTION_KEY, dir); }
  catch { /* private mode etc. — no-op */ }
}

/** v2.17.21 — Initiative anonymisation. On (default) the player rail hides
 *  which enemy is which: every opposition card shows a uniform "!" tab and the
 *  threat letter is stripped from the broadcast entirely. Off: players see the
 *  same A/B/C letters the GM does — handy for systems / tables that track named
 *  or numbered enemies openly. Stored as '0' when DISABLED so the common
 *  (anonymised) case needs no key. Travels with the pack. */
export const INITIATIVE_ANONYMISE_KEY = 'mappadux:initiative_anonymise';

export function isInitiativeAnonymised(): boolean {
  try { return localStorage.getItem(INITIATIVE_ANONYMISE_KEY) !== '0'; }
  catch { return true; }
}

export function setInitiativeAnonymised(on: boolean): void {
  try { localStorage.setItem(INITIATIVE_ANONYMISE_KEY, on ? '1' : '0'); }
  catch { /* private mode etc. — no-op */ }
}

/** v2.17.9 — Distance unit for the "Measure from here" map tool. A square
 *  on the grid is worth `value` of `suffix` (e.g. 5 + "'" → 5' per square,
 *  3 + "m" → 3m per square). `value` is the number the measurement maths
 *  multiplies the square-count by; `suffix` is a free-form tag appended to
 *  the result. Default 5' (D&D / Pathfinder). GM-set in Settings → Scaled
 *  View; same-browser player views share this via localStorage. */
export const MEASURE_UNIT_VALUE_KEY  = 'mappadux:measure_unit_value';
export const MEASURE_UNIT_SUFFIX_KEY = 'mappadux:measure_unit_suffix';

export function getMeasureUnitValue(): number {
  try {
    const v = parseFloat(localStorage.getItem(MEASURE_UNIT_VALUE_KEY) ?? '');
    return Number.isFinite(v) && v > 0 ? v : 5;
  } catch { return 5; }
}

export function setMeasureUnitValue(value: number): void {
  try {
    if (Number.isFinite(value) && value > 0) localStorage.setItem(MEASURE_UNIT_VALUE_KEY, String(value));
  } catch { /* private mode etc. — no-op */ }
}

export function getMeasureUnitSuffix(): string {
  try {
    const s = localStorage.getItem(MEASURE_UNIT_SUFFIX_KEY);
    return s === null ? "'" : s;
  } catch { return "'"; }
}

export function setMeasureUnitSuffix(suffix: string): void {
  try { localStorage.setItem(MEASURE_UNIT_SUFFIX_KEY, suffix); }
  catch { /* private mode etc. — no-op */ }
}

/** v2.17.11 — Bundle-portable GM/system preferences. These are the
 *  campaign/ruleset constants that define how a pack plays, as opposed to
 *  device settings (UI scale, projector calibration), secrets (API keys,
 *  tokens — never exported), or one-shot flags. They travel inside the
 *  `.mappadux` bundle so a pack carries its own measurement scale, initiative
 *  direction, and player-permission rules. Deliberately EXCLUDES: LLM /
 *  Spotify / Freesound credentials, Stagecraft connection endpoints,
 *  display/device prefs, and soundtrack configs (which already travel via
 *  their own bundle field). */
export interface BundledGmPreferences {
  measureUnitValue?:        number;
  measureUnitSuffix?:       string;
  initiativeSortDirection?: 'high-to-low' | 'low-to-high';
  initiativeAnonymise?:     boolean;
  playerPingsEnabled?:      boolean;
  playerMessagingEnabled?:  boolean;
  playerMarkersMovable?:    boolean;
  /** v2.19 — dice belong to the game: the set the GM authored, the house rules
   *  about who sees what, and whether players may roll at all. The VIEWER's own
   *  detail preference is deliberately absent — that is theirs, per device. */
  playerDiceEnabled?:       boolean;
  diceSet?:                 import('../types.ts').DiceButton[];
  dicePolicy?:              DicePolicy;
}

/** Snapshot the bundle-portable preferences for an export. */
export function collectBundledPreferences(): BundledGmPreferences {
  return {
    measureUnitValue:        getMeasureUnitValue(),
    measureUnitSuffix:       getMeasureUnitSuffix(),
    initiativeSortDirection: getInitiativeSortDirection(),
    initiativeAnonymise:     isInitiativeAnonymised(),
    playerPingsEnabled:      arePingsEnabled(),
    playerMessagingEnabled:  isMessagingEnabled(),
    playerMarkersMovable:    arePlayerMarkersMovable(),
    playerDiceEnabled:       areDiceEnabled(),
    diceSet:                 getDiceSet(),
    dicePolicy:              getDicePolicy(),
  };
}

/** Apply bundle-portable preferences on import. Each field is optional —
 *  absent fields (older bundles) leave the current value untouched. */
export function applyBundledPreferences(p: BundledGmPreferences | undefined): void {
  if (!p) return;
  if (typeof p.measureUnitValue === 'number')  setMeasureUnitValue(p.measureUnitValue);
  if (typeof p.measureUnitSuffix === 'string') setMeasureUnitSuffix(p.measureUnitSuffix);
  if (p.initiativeSortDirection === 'high-to-low' || p.initiativeSortDirection === 'low-to-high') {
    setInitiativeSortDirection(p.initiativeSortDirection);
  }
  if (typeof p.initiativeAnonymise === 'boolean')    setInitiativeAnonymised(p.initiativeAnonymise);
  if (typeof p.playerPingsEnabled === 'boolean')     setPingsEnabled(p.playerPingsEnabled);
  if (typeof p.playerMessagingEnabled === 'boolean') setMessagingEnabled(p.playerMessagingEnabled);
  if (typeof p.playerMarkersMovable === 'boolean')   setPlayerMarkersMovable(p.playerMarkersMovable);
  if (typeof p.playerDiceEnabled === 'boolean')      setDiceEnabled(p.playerDiceEnabled);
  // A pack with no dice must not wipe the set the GM already has: absent means
  // "unchanged", the same rule every other field here follows.
  if (Array.isArray(p.diceSet) && p.diceSet.length > 0) setDiceSet(p.diceSet);
  if (p.dicePolicy) setDicePolicy(normalisePolicy(p.dicePolicy));
}

/** v2.16.76 — Annotate mute. When set, clocks + whiteboard + notes are
 *  hidden on ALL surfaces (GM, player, projector) without deleting the
 *  per-map data. v2.16.80 — default SHOWN (Alex 2026-06-02) — unlike the
 *  other bypass toggles' inverse, annotations are on by default. '1'
 *  muted, '0'/absent = shown. */
export const ANNOTATE_MUTED_KEY = 'mappadux:annotate_muted';

export function isAnnotateMuted(): boolean {
  try { return localStorage.getItem(ANNOTATE_MUTED_KEY) === '1'; }
  catch { return false; }
}

export function setAnnotateMuted(muted: boolean): void {
  try { localStorage.setItem(ANNOTATE_MUTED_KEY, muted ? '1' : '0'); }
  catch { /* private mode — no-op */ }
}

/** v2.17 Player Voice — GM toggle for player pings. Enabled by default; the
 *  GM can switch it off if they don't want players highlighting the map.
 *  Stored as '0' when DISABLED (absence = enabled) so the common case needs
 *  no key. */
export const PLAYER_PINGS_DISABLED_KEY = 'mappadux:player_pings_disabled';

export function arePingsEnabled(): boolean {
  try { return localStorage.getItem(PLAYER_PINGS_DISABLED_KEY) !== '1'; }
  catch { return true; }
}

export function setPingsEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(PLAYER_PINGS_DISABLED_KEY);
    else         localStorage.setItem(PLAYER_PINGS_DISABLED_KEY, '1');
  } catch { /* private mode etc. — no-op */ }
}

/**
 * v2.19 Dice — GM toggle for player dice. Same shape as pings: stored as '0'
 * when DISABLED so the common case needs no key. The GM's OWN dice keep working
 * when this is off; rolling for the table is still useful when players may not.
 */
export const PLAYER_DICE_DISABLED_KEY = 'mappadux:player_dice_disabled';

export function areDiceEnabled(): boolean {
  try { return localStorage.getItem(PLAYER_DICE_DISABLED_KEY) !== '1'; }
  catch { return true; }
}

export function setDiceEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(PLAYER_DICE_DISABLED_KEY);
    else         localStorage.setItem(PLAYER_DICE_DISABLED_KEY, '1');
  } catch { /* private mode etc. — no-op */ }
}

/**
 * v2.19 Dice — the SET the GM authored: named formulas players tap. Travels in
 * the pack (a set belongs to the game, not to a person), so it lives in the
 * bundled preferences too. Entries are validated on the way in, so nothing
 * unrollable can reach a player's tray.
 */
export const DICE_SET_KEY = 'mappadux:dice_set';

export function getDiceSet(): import('../types.ts').DiceButton[] {
  try {
    const raw = localStorage.getItem(DICE_SET_KEY);
    if (!raw) return [];
    return normaliseDiceSet(JSON.parse(raw));
  } catch { return []; }
}

export function setDiceSet(set: import('../types.ts').DiceButton[]): void {
  try {
    const clean = normaliseDiceSet(set);
    if (clean.length === 0) localStorage.removeItem(DICE_SET_KEY);
    else localStorage.setItem(DICE_SET_KEY, JSON.stringify(clean));
  } catch { /* quota / disabled — ignore */ }
}

/** Drop anything malformed or unrollable — a pack from another build, a hand-
 *  edited localStorage, a formula the grammar no longer accepts. */
export function normaliseDiceSet(raw: unknown): import('../types.ts').DiceButton[] {
  if (!Array.isArray(raw)) return [];
  const out: import('../types.ts').DiceButton[] = [];
  for (const entry of raw.slice(0, 24)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const label = typeof e.label === 'string' ? e.label.trim().slice(0, 24) : '';
    const formula = typeof e.formula === 'string' ? e.formula.trim().slice(0, 40) : '';
    if (!label || !isValidFormula(formula)) continue;
    out.push({
      id: typeof e.id === 'string' && e.id ? e.id : `dice-${out.length}-${formula}`,
      label, formula,
      ...(e.public === true ? { public: true as const } : {}),
    });
  }
  return out;
}

/** v2.19 Dice — the pack's house rules about who sees what. */
export const DICE_POLICY_KEY = 'mappadux:dice_policy';

export function getDicePolicy(): DicePolicy {
  try { return normalisePolicy(JSON.parse(localStorage.getItem(DICE_POLICY_KEY) ?? 'null')); }
  catch { return { ...DEFAULT_DICE_POLICY }; }
}

export function setDicePolicy(policy: DicePolicy): void {
  try { localStorage.setItem(DICE_POLICY_KEY, JSON.stringify(normalisePolicy(policy))); }
  catch { /* quota / disabled — ignore */ }
}

/**
 * v2.19 Dice — THIS DEVICE's own appetite for dice. A pack sets the ceiling; a
 * viewer may always turn spectacle down (and a phone that cannot cope says so
 * for itself). Deliberately NOT in the bundle: importing a pack must never
 * overwrite what someone chose for their own screen.
 */
export const DICE_DETAIL_KEY = 'mappadux:dice_detail';

export function getDiceDetailPreference(): DiceDetail {
  try { return asDetail(localStorage.getItem(DICE_DETAIL_KEY), 'full'); }
  catch { return 'full'; }
}

export function setDiceDetailPreference(d: DiceDetail): void {
  try {
    if (d === 'full') localStorage.removeItem(DICE_DETAIL_KEY); // the default needs no key
    else localStorage.setItem(DICE_DETAIL_KEY, d);
  } catch { /* private mode etc. */ }
}

/**
 * v2.19.3 Dice — what dice LOOK like on this screen: shaped and shaded, or
 * plain numbered tiles. Separate axis from how MUCH you see (full / line /
 * none): this is fidelity and taste, that is attention. Per device and never
 * bundled — a pack cannot tell someone's phone how hard to work.
 */
export const DICE_RENDER_KEY = 'mappadux:dice_render';

export function getDiceRenderPreference(): DieStylePreference {
  try {
    const v = localStorage.getItem(DICE_RENDER_KEY);
    return v === 'shaped' || v === 'plain' ? v : 'auto';
  } catch { return 'auto'; }
}

export function setDiceRenderPreference(v: DieStylePreference): void {
  try {
    if (v === 'auto') localStorage.removeItem(DICE_RENDER_KEY); // the default needs no key
    else localStorage.setItem(DICE_RENDER_KEY, v);
  } catch { /* private mode etc. */ }
}

/** What this device will actually draw, asking the device only when nobody
 *  has chosen. Read at every roll, so a change needs no reload. */
export function resolveDiceRender(): DieStyle {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }) : undefined;
  let reducedMotion = false;
  try { reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* old browser */ }
  return chooseDieStyle(getDiceRenderPreference(), {
    reducedMotion,
    ...(typeof nav?.deviceMemory === 'number' ? { deviceMemory: nav.deviceMemory } : {}),
    ...(typeof nav?.hardwareConcurrency === 'number' ? { cores: nav.hardwareConcurrency } : {}),
  });
}

/** v2.17 Player Voice — GM toggle for player messaging (player↔GM and
 *  player↔player). Enabled by default; '0' stored when disabled. */
export const PLAYER_MESSAGING_DISABLED_KEY = 'mappadux:player_messaging_disabled';

export function isMessagingEnabled(): boolean {
  try { return localStorage.getItem(PLAYER_MESSAGING_DISABLED_KEY) !== '1'; }
  catch { return true; }
}

export function setMessagingEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(PLAYER_MESSAGING_DISABLED_KEY);
    else         localStorage.setItem(PLAYER_MESSAGING_DISABLED_KEY, '1');
  } catch { /* private mode etc. — no-op */ }
}

/** v2.17 Player Voice — show the full player chrome in the GM's "Open Player
 *  Window" preview popup. Default off: the preview popup hides identity pill,
 *  message toasts, action menu, identity prompts, and the initiative roll
 *  prompt because the GM isn't a player. Useful to flip on during testing
 *  when you want the preview to behave exactly like a real player view.
 *  Detection is the ?gmPreview=1 URL flag the launcher appends — phones /
 *  laptops connecting via QR never carry it, so real players always show the
 *  full UI regardless of this setting. */
export const SHOW_FULL_PLAYER_UI_IN_PREVIEW_KEY = 'mappadux:show_full_player_ui_in_preview';

export function showFullPlayerUiInPreview(): boolean {
  try { return localStorage.getItem(SHOW_FULL_PLAYER_UI_IN_PREVIEW_KEY) === '1'; }
  catch { return false; }
}

export function setShowFullPlayerUiInPreview(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(SHOW_FULL_PLAYER_UI_IN_PREVIEW_KEY, '1');
    else         localStorage.removeItem(SHOW_FULL_PLAYER_UI_IN_PREVIEW_KEY);
  } catch { /* private mode etc. — no-op */ }
}

/** v2.17 Player Voice — GM toggle for letting players drag their own token.
 *  Enabled by default; '0' stored when disabled. */
export const PLAYER_MOVABLE_MARKERS_DISABLED_KEY = 'mappadux:player_movable_markers_disabled';

export function arePlayerMarkersMovable(): boolean {
  try { return localStorage.getItem(PLAYER_MOVABLE_MARKERS_DISABLED_KEY) !== '1'; }
  catch { return true; }
}

export function setPlayerMarkersMovable(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(PLAYER_MOVABLE_MARKERS_DISABLED_KEY);
    else         localStorage.setItem(PLAYER_MOVABLE_MARKERS_DISABLED_KEY, '1');
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

// ─── LLM reply assistant (v2.17 Player Voice) ────────────────────────────────

export const LLM_API_KEY            = 'mappadux:llm_api_key';
const LLM_ENABLED_KEY               = 'mappadux:llm_enabled';
const LLM_BASE_URL_KEY              = 'mappadux:llm_base_url';
const LLM_MODEL_KEY                 = 'mappadux:llm_model';
const LLM_SYSTEM_PROMPT_KEY         = 'mappadux:llm_system_prompt';

/** The default GM-assistant system prompt. Editable in Settings; "Reset to
 *  default" restores this. v2.16.51 — rewritten to emit plain prose the
 *  GM can send verbatim: no category labels, no quote-wrapping around
 *  the skill ask, no markdown emphasis inside the option body. */
export const DEFAULT_GM_ASSISTANT_PROMPT =
`You are a compact, precise GM Assistant for a Tabletop RPG.
Analyze the incoming player note and produce 4 distinct, short response options the GM will send to the player verbatim.
Never speak to the player directly. Never roleplay as the characters.

Each option is a single short paragraph of plain prose: a brief narrative beat followed by the skill ask. NO category labels, NO headings, NO quotation marks around the skill ask, NO bold or italic formatting inside the option body.

The 4 options should cover, in order:
1. Positive outcome — the player gets what they want.
2. Complication — yes, but with a twist.
3. Hard stop or warning — they can't, or there's an immediate consequence.
4. Dramatically interesting GM choice — escalation, twist, or surprise.

Format your output EXACTLY like this (numbered list, one option per line):

1. <narrative beat.> <skill ask.>
2. <narrative beat.> <skill ask.>
3. <narrative beat.> <skill ask.>
4. <narrative beat.> <skill ask.>`;

export interface LLMSettings {
  enabled:      boolean;
  baseUrl:      string;  // OpenAI-compatible base, e.g. http://localhost:1234/v1 (LM Studio) or https://openrouter.ai/api/v1
  model:        string;  // e.g. "local-model" or "anthropic/claude-3.5-sonnet"
  systemPrompt: string;
}

export function getLLMSettings(): LLMSettings {
  const read = (k: string, fallback: string): string => {
    try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; }
  };
  let enabled = false;
  try { enabled = localStorage.getItem(LLM_ENABLED_KEY) === '1'; } catch { /* no-op */ }
  return {
    enabled,
    baseUrl:      read(LLM_BASE_URL_KEY, 'http://localhost:1234/v1'),
    model:        read(LLM_MODEL_KEY, ''),
    systemPrompt: read(LLM_SYSTEM_PROMPT_KEY, DEFAULT_GM_ASSISTANT_PROMPT),
  };
}

export function setLLMSettings(s: LLMSettings): void {
  try {
    if (s.enabled) localStorage.setItem(LLM_ENABLED_KEY, '1');
    else           localStorage.removeItem(LLM_ENABLED_KEY);
    localStorage.setItem(LLM_BASE_URL_KEY, s.baseUrl.trim());
    localStorage.setItem(LLM_MODEL_KEY, s.model.trim());
    // Store the prompt only when it differs from the default, so "reset"
    // (removing the key) naturally falls back to the canonical prompt.
    if (s.systemPrompt.trim() && s.systemPrompt.trim() !== DEFAULT_GM_ASSISTANT_PROMPT.trim()) {
      localStorage.setItem(LLM_SYSTEM_PROMPT_KEY, s.systemPrompt);
    } else {
      localStorage.removeItem(LLM_SYSTEM_PROMPT_KEY);
    }
  } catch { /* private mode etc. — no-op */ }
}

export function getLLMApiKey(): string {
  try { return localStorage.getItem(LLM_API_KEY) ?? ''; } catch { return ''; }
}

export function setLLMApiKey(key: string): void {
  try {
    if (key.trim()) localStorage.setItem(LLM_API_KEY, key.trim());
    else            localStorage.removeItem(LLM_API_KEY);
  } catch { /* private mode etc. — no-op */ }
}

/** Known API key entries kept in localStorage. Used by Settings to list +
 *  delete credentials separately from other local state. */
export const API_KEY_ENTRIES: Array<{ key: string; label: string }> = [
  { key: 'dmr_freesound_api_key', label: 'Freesound API key' },
  // v2.15.51 — Spotify Client ID surfaces in the API Keys list so a
  // GM doing housekeeping can see it alongside other service creds.
  // The OAuth tokens (access / refresh) deliberately don't appear
  // here — those are session credentials, not config; they're
  // managed via the Soundtracks Connect / Disconnect flow.
  { key: 'mappadux:spotify_client_id', label: 'Spotify Client ID' },
  // v2.17 Player Voice — optional LLM key for the GM reply assistant
  // (OpenRouter etc.). LM Studio runs locally and needs no key.
  { key: LLM_API_KEY, label: 'LLM API key (OpenRouter etc.)' },
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
