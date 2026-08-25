/**
 * PlayerPip LARGE mode — the GM's preview when a StarMap map is up (v2.18.11). Mappadux draws no
 * copy of the players' view on the GM canvas any more, so this window IS the GM's view of the
 * table: it must fill the canvas, clear the notice strip, and give the GM back exactly what they
 * had when the StarMap ends.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { PlayerPip } from '../../src/gm/PlayerPip.ts';

const WRAP_W = 1200, WRAP_H = 800;

function makeWrapper(): HTMLElement {
  // Detached on purpose: happy-dom would otherwise try to navigate the player iframe.
  const wrap = document.createElement('div');
  wrap.getBoundingClientRect = () => ({
    x: 0, y: 0, top: 0, left: 0, right: WRAP_W, bottom: WRAP_H,
    width: WRAP_W, height: WRAP_H, toJSON: () => ({}),
  }) as DOMRect;
  return wrap;
}
const frameOf = (w: HTMLElement) => w.querySelector<HTMLElement>('.player-pip-frame');

describe('PlayerPip large mode', () => {
  beforeEach(() => {
    localStorage.clear();
    if (!('ResizeObserver' in globalThis)) {
      (globalThis as any).ResizeObserver = class { observe() {} disconnect() {} };
    }
  });

  it('fills the canvas below the StarMap notice strip, 16:9 and centred', () => {
    const wrap = makeWrapper();
    const pip = new PlayerPip({ canvasWrapper: wrap, getPlayerUrl: () => 'https://gm.example/player.html?room=abc' });
    pip.setLargeMode(true);
    const frame = frameOf(wrap)!;
    // height is the binding constraint here: (800 - 112 top - 12 margin) * 16/9 > 1200 - 24
    const expected = Math.round(Math.min(WRAP_W - 24, (WRAP_H - 112 - 12) * (16 / 9)));
    expect(parseFloat(frame.style.width)).toBe(expected);
    expect(parseFloat(frame.style.top)).toBe(112);              // clears the strip
    expect(parseFloat(frame.style.left)).toBe((WRAP_W - expected) / 2);
    expect(frame.style.bottom).toBe('');
    expect(frame.classList.contains('player-pip-frame--large')).toBe(true);
  });

  it('restores the GM size and position WITHOUT reloading the player frame', () => {
    localStorage.setItem('dmr_pip_width', '420');
    localStorage.setItem('dmr_pip_position', JSON.stringify({ x: 30, y: 40 }));
    const wrap = makeWrapper();
    const pip = new PlayerPip({ canvasWrapper: wrap, getPlayerUrl: () => 'https://gm.example/player.html?room=abc' });
    const iframeBefore = wrap.querySelector('iframe');
    pip.setLargeMode(true);
    pip.setLargeMode(false);
    const frame = frameOf(wrap)!;
    expect(frame.style.width).toBe('420px');
    expect(frame.style.left).toBe('30%');
    expect(frame.style.top).toBe('40%');
    expect(frame.classList.contains('player-pip-frame--large')).toBe(false);
    // Same element: a rebuild would reload player.html and, inside it, the whole SSE session.
    expect(wrap.querySelector('iframe')).toBe(iframeBefore);
  });

  it('opens a minimised preview for the StarMap and minimises it again after, without changing the saved preference', () => {
    localStorage.setItem('dmr_pip_visible', '0');
    const wrap = makeWrapper();
    const pip = new PlayerPip({ canvasWrapper: wrap, getPlayerUrl: () => 'https://gm.example/player.html?room=abc' });
    expect(frameOf(wrap)).toBeNull();
    pip.setLargeMode(true);
    expect(frameOf(wrap)).not.toBeNull();
    pip.setLargeMode(false);
    expect(frameOf(wrap)).toBeNull();
    expect(localStorage.getItem('dmr_pip_visible')).toBe('0'); // their choice, untouched
  });

  it('comes back large when re-opened from the pill during a StarMap', () => {
    const wrap = makeWrapper();
    const pip = new PlayerPip({ canvasWrapper: wrap, getPlayerUrl: () => 'https://gm.example/player.html?room=abc' });
    pip.setLargeMode(true);
    pip.hide();   // the GM minimises mid-StarMap
    pip.show();   // ...and brings it back from the pill
    const frame = frameOf(wrap)!;
    expect(frame.classList.contains('player-pip-frame--large')).toBe(true);
    expect(parseFloat(frame.style.top)).toBe(112);
  });

  it('never persists the large size over the size the GM chose', async () => {
    localStorage.setItem('dmr_pip_width', '420');
    let notifyResize: (() => void) | null = null;
    (globalThis as any).ResizeObserver = class {
      // Keep the FIRST one only: that is the frame observer, the one that persists a width.
      constructor(cb: () => void) { notifyResize ??= cb; }
      observe() {} disconnect() {}
    };
    const wrap = makeWrapper();
    const pip = new PlayerPip({ canvasWrapper: wrap, getPlayerUrl: () => 'https://gm.example/player.html?room=abc' });
    Object.defineProperty(frameOf(wrap)!, 'offsetWidth', { value: 999, configurable: true });

    pip.setLargeMode(true);
    notifyResize!();                                        // the browser reporting OUR size
    await new Promise((r) => setTimeout(r, 300));           // past the 250ms save debounce
    expect(localStorage.getItem('dmr_pip_width')).toBe('420');

    pip.setLargeMode(false);
    notifyResize!();                                        // a size the GM chose: this one sticks
    await new Promise((r) => setTimeout(r, 300));
    expect(localStorage.getItem('dmr_pip_width')).toBe('999');
  });
});
