/**
 * Generate a unique-ish ID string. Prefers `crypto.randomUUID()` (RFC 4122
 * UUID v4) when available; falls back to a timestamp + random base-36 string
 * for non-secure contexts (e.g. LAN IP over HTTP, file:// URLs) where
 * `crypto.randomUUID` is not exposed.
 *
 * The fallback isn't cryptographically random but collision risk is
 * negligible for our scale (single-user app generating IDs at human pace).
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
