/**
 * Message of the Day — one-off popup shown the first time a user
 * launches Mappadux after a version bump. Bump the `version` field
 * whenever you want the message to re-show for everyone; edit the
 * `title` + `body` lines to whatever you want to surface that release
 * (new feature highlight, breaking change, ask for feedback, etc.).
 *
 * Suppression rules (enforced in GMApp):
 *   • Suppressed entirely on first install — the auto-About dialog is
 *     the welcome message in that case.
 *   • Deferred to the next session if the About dialog happens to be
 *     open at startup time (a fresh user mid-exploration shouldn't be
 *     stacked-up with two popups).
 *   • Marked seen on dismiss — won't reappear until the version field
 *     here changes again.
 *
 * Versioning convention:
 *   • Use the app version the message is "about" (e.g. '2.12.0').
 *   • Bumping the patch number on a non-MOTD release is fine — leave
 *     `version` alone unless you actually want to talk to users.
 *   • Setting `version` to an empty string disables the MOTD globally.
 */

export interface MotdEntry {
  /** Trigger key. Re-shows whenever this value differs from the
   *  user's stored 'last seen' value. Empty string disables. */
  version: string;
  /** Headline shown in the modal's title bar. */
  title:   string;
  /** Paragraphs of plain-text body. Each entry becomes its own <p>;
   *  no HTML interpretation (textContent only) — keeps the popup
   *  safe to render even if a future build accidentally pastes
   *  unescaped content here. */
  body:    string[];
}

export const CURRENT_MOTD: MotdEntry = {
  // Empty version disables the MOTD popup entirely — the system stays
  // wired up and ready to fire whenever a future release wants to
  // surface a message. To activate: set `version` to the app version
  // the message is about (e.g. '2.13.0') and fill in title + body.
  version: '',
  title:   '',
  body:    [],
};

/** v2.14.2 — beta-channel welcome / warning. Shown ONCE per browser
 *  on a beta host (see `isBetaHost` + `isBetaMotdDismissed` in
 *  localSettings). Stays static across beta releases — the message
 *  is the same regardless of which patch they happen to land on.
 *  Independent of `CURRENT_MOTD` so production release-note MOTDs
 *  don't suppress this and vice versa. */
export const BETA_MOTD: MotdEntry = {
  version: 'beta',
  title:   'Welcome to Mappadux beta',
  body:    [
    'You are running the beta channel. Feel free to try things out — you can import your existing maps and they should load just fine.',
    'Bear in mind features may appear and disappear at random as ideas get tried out. Maps should stay compatible across builds, but no guarantees — that is the nature of beta.',
    'The stable release lives at www.mappadux.com if you want a quieter ride.',
  ],
};
