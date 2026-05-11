/**
 * Copy a string to the clipboard, preferring the modern async API but
 * falling back to the deprecated `execCommand('copy')` route on devices
 * where the secure-context-only Clipboard API is unavailable.
 *
 * The fallback covers the common Mappadux test scenario: the user opens
 * the dev server from a LAN IP (`http://192.168.x.x:5173`) on a phone
 * or tablet — that's an HTTP origin, so `navigator.clipboard` is
 * undefined and would otherwise throw a "clipboard access blocked" error.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the textarea-selection fallback.
    }
  }
  // execCommand fallback. The textarea has to be in the DOM and have a
  // current selection for execCommand('copy') to work; we hide it offscreen.
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.left = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
