/**
 * Generic sparkle-button popover. Used by:
 *   • the Backdrop FX button (right of the Map panel's Background
 *     Colour picker — picks an animated backdrop + tunes its params)
 *   • the MapFX FX button (right of the FoW panel's colour swatch —
 *     opens the active kind's shader params + edge fade)
 *
 * Caller passes an anchor button + a populate callback that fills
 * the popover root. The component handles: DOM creation, anchoring
 * under the button, off-click / Escape dismissal, and the
 * aria-expanded toggle on the anchor. Returns a handle so the
 * caller can programmatically refresh the contents (e.g. after a
 * state change while the popover is open) or close it.
 *
 * Visual style matches the existing `.fx-popover` CSS rules so both
 * call sites look identical. No new CSS hooks needed.
 */

export interface FxPopoverOptions {
  /** Button element the popover anchors under. */
  anchor:   HTMLButtonElement;
  /** Caller fills the popover root with whatever content it needs.
   *  Called once on open and again on every `refresh()` from the
   *  returned handle. */
  populate: (root: HTMLElement) => void;
  /** Optional close callback (fires after the DOM is removed). */
  onClose?: () => void;
  /** Optional extra CSS class on the popover root (e.g. for
   *  per-call-site sizing tweaks). */
  className?: string;
}

export interface FxPopoverHandle {
  /** Close the popover and run cleanup + onClose. Idempotent. */
  close:   () => void;
  /** Re-run the populate callback against the same root. Useful
   *  when state changes while the popover is open (active kind
   *  swapped, polygon selected, etc.). */
  refresh: () => void;
}

export function openFxPopover(opts: FxPopoverOptions): FxPopoverHandle {
  const pop = document.createElement('div');
  pop.className = 'fx-popover' + (opts.className ? ` ${opts.className}` : '');
  pop.setAttribute('role', 'menu');

  opts.populate(pop);

  // Anchor under the trigger button in document coords so panel
  // scroll doesn't peel the popover off-screen. Clamp horizontally
  // to keep it on-screen even when the button is near the right edge.
  document.body.appendChild(pop);
  const rect = opts.anchor.getBoundingClientRect();
  const left = Math.min(window.innerWidth - pop.offsetWidth - 8, rect.left);
  pop.style.left = `${Math.max(8, left)}px`;
  pop.style.top  = `${rect.bottom + 4}px`;

  opts.anchor.setAttribute('aria-expanded', 'true');

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('mousedown', onDocClick);
    document.removeEventListener('keydown', onKey);
    pop.remove();
    opts.anchor.setAttribute('aria-expanded', 'false');
    opts.onClose?.();
  };
  const onDocClick = (ev: MouseEvent) => {
    if (pop.contains(ev.target as Node)) return;
    if (opts.anchor.contains(ev.target as Node)) return;
    close();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') close();
  };
  // Defer one tick so the same click that opened the popover
  // doesn't immediately close it via the off-click handler.
  setTimeout(() => {
    if (closed) return;
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
  }, 0);

  const refresh = () => {
    if (closed) return;
    pop.innerHTML = '';
    opts.populate(pop);
  };

  return { close, refresh };
}
