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

/** Known API key entries kept in localStorage. Used by Settings to list +
 *  delete credentials separately from other local state. */
export const API_KEY_ENTRIES: Array<{ key: string; label: string }> = [
  { key: 'dmr_freesound_api_key', label: 'Freesound API key' },
];

/** All localStorage entries Mappadux owns. Anything starting with `dmr_` is
 *  reasonably assumed to be ours. Anything else added in future should be
 *  enumerated here so deletions stay precise. */
export function listOwnedKeys(): string[] {
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('dmr_')) out.push(k);
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
