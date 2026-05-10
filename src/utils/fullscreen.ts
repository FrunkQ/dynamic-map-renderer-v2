/**
 * Thin wrappers around the Fullscreen API. Browsers only honour
 * requestFullscreen() inside a user gesture handler (click, keypress,
 * pointerdown, etc.) — calling it from anywhere else silently rejects.
 *
 * The promise rejections that come back when the user hits ESC, when the
 * browser blocks the request, or when the API isn't supported are caught
 * here so callers don't have to handle them.
 */

export function isFullscreen(): boolean {
  return !!document.fullscreenElement;
}

export async function requestFullscreen(el: Element = document.documentElement): Promise<void> {
  if (!el.requestFullscreen) return;
  try { await el.requestFullscreen({ navigationUI: 'hide' }); } catch { /* user denied / unsupported */ }
}

export async function exitFullscreen(): Promise<void> {
  if (!document.exitFullscreen || !document.fullscreenElement) return;
  try { await document.exitFullscreen(); } catch { /* shrug */ }
}

export async function toggleFullscreen(el: Element = document.documentElement): Promise<void> {
  return isFullscreen() ? exitFullscreen() : requestFullscreen(el);
}

/**
 * Subscribe to fullscreen changes. Returns an unsubscribe fn. Useful for
 * keeping a button label in sync ("⛶ Fullscreen" ↔ "⛶ Exit Fullscreen").
 */
export function onFullscreenChange(handler: () => void): () => void {
  document.addEventListener('fullscreenchange', handler);
  return () => document.removeEventListener('fullscreenchange', handler);
}

/**
 * One-shot "I see your fullscreen button" flag. The button shows its full
 * label until the user clicks it once on this device, then collapses to
 * just the ⛶ icon (full text moves to the tooltip) so it stays out of the
 * way during play. Persistent — set once per device, never resurfaces.
 */
const FS_BTN_SEEN_KEY = 'dmr_fs_btn_seen';
export function isFullscreenBtnMinimised(): boolean {
  return localStorage.getItem(FS_BTN_SEEN_KEY) === '1';
}
export function markFullscreenBtnSeen(): void {
  localStorage.setItem(FS_BTN_SEEN_KEY, '1');
}

/**
 * Wire a fullscreen toggle button: handles the click, keeps the label /
 * tooltip in sync with the actual fullscreen state, and minimises to just
 * the icon after the first interaction. Returns an unsubscribe fn.
 *
 * `forceMinimised` collapses the button to the icon regardless of the
 * localStorage flag — useful for monitor / secondary windows where the
 * full label is just clutter.
 */
export function bindFullscreenButton(btn: HTMLElement, opts?: { forceMinimised?: boolean }): () => void {
  const update = () => {
    const mini = opts?.forceMinimised || isFullscreenBtnMinimised();
    const fs   = isFullscreen();
    btn.textContent = mini ? '⛶' : (fs ? '⛶ Exit fullscreen' : '⛶ Fullscreen');
    btn.title       = fs ? 'Exit fullscreen' : 'Toggle fullscreen';
  };
  const onClick = () => {
    markFullscreenBtnSeen();
    void toggleFullscreen();
  };
  btn.addEventListener('click', onClick);
  const unsubFs = onFullscreenChange(update);
  update();
  return () => {
    btn.removeEventListener('click', onClick);
    unsubFs();
  };
}
