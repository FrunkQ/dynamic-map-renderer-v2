/**
 * StarMapLayer — the viewer-side mount rules for a live Star System Explorer view.
 *
 * @vitest-environment-options { "settings": { "disableIframePageLoading": true } }
 * (happy-dom otherwise tries to NAVIGATE the frame, i.e. fetch the SSE origin from a unit test.)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { StarMapLayer } from '../../src/rendering/StarMapLayer.ts';

const ORIGIN = 'https://sse.example'; // never a real address: this frame must not be fetched
const SID = 'sid-abc';

function frameSrc(root: HTMLElement): URL {
  const f = root.querySelector('iframe');
  expect(f).not.toBeNull();
  return new URL(f!.src);
}

describe('StarMapLayer preset targeting', () => {
  let root: HTMLElement;
  beforeEach(() => {
    // Deliberately DETACHED from the document: happy-dom only tries to navigate an iframe once it
    // is connected, and this layer's behaviour is all in the element it builds, not in layout.
    root = document.createElement('div');
  });

  it('prewarms without a preset (SSE then shows its own fallback view)', () => {
    const layer = new StarMapLayer(root, 'viewer');
    layer.preload({ origin: ORIGIN, sessionId: SID });
    const u = frameSrc(root);
    expect(u.pathname).toBe('/catalogue');
    expect(u.searchParams.get('sid')).toBe(SID);
    expect(u.searchParams.get('embed')).toBe('1');
    expect(u.searchParams.get('preset')).toBeNull();
    layer.destroy();
  });

  // v2.18.10 regression: a reloaded viewer got prewarm + show in ONE tick, and the setPreset
  // message aimed at the still-booting frame was dropped — leaving players on SSE's fallback
  // view ("The Guide") while the GM saw the right one. A frame that has not answered us must be
  // remounted with the preset in its URL.
  it('remounts with the preset when showing over a prewarmed frame that has not answered', () => {
    const layer = new StarMapLayer(root, 'viewer');
    layer.preload({ origin: ORIGIN, sessionId: SID });
    layer.show({ origin: ORIGIN, sessionId: SID, presetId: 'holo-table' });
    expect(frameSrc(root).searchParams.get('preset')).toBe('holo-table');
    expect(root.querySelectorAll('iframe')).toHaveLength(1); // the presetless frame is gone
    expect(layer.isVisible).toBe(true);
    layer.destroy();
  });

  it('mounts a cold show with the preset in the URL', () => {
    const layer = new StarMapLayer(root, 'viewer');
    layer.show({ origin: ORIGIN, sessionId: SID, presetId: 'deck-plan' });
    expect(frameSrc(root).searchParams.get('preset')).toBe('deck-plan');
    layer.destroy();
  });

  it('reloads for a different session, and hide() keeps the frame warm', () => {
    const layer = new StarMapLayer(root, 'viewer');
    layer.show({ origin: ORIGIN, sessionId: SID, presetId: 'holo-table' });
    layer.hide();
    expect(root.querySelectorAll('iframe')).toHaveLength(1);
    expect(layer.isVisible).toBe(false);
    layer.show({ origin: ORIGIN, sessionId: 'other-sid', presetId: 'holo-table' });
    const u = frameSrc(root);
    expect(u.searchParams.get('sid')).toBe('other-sid');
    expect(root.querySelectorAll('iframe')).toHaveLength(1);
    layer.destroy();
    expect(root.querySelector('iframe')).toBeNull();
  });
});
