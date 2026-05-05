import { describe, it, expect } from 'vitest';
import { defaultSessionState, STATE_VERSION } from '../../src/types.ts';

describe('defaultSessionState', () => {
  it('returns correct version', () => {
    const s = defaultSessionState();
    expect(s.version).toBe(STATE_VERSION);
  });

  it('has default view at center showing full map', () => {
    const s = defaultSessionState();
    expect(s.view.centerX).toBe(0.5);
    expect(s.view.centerY).toBe(0.5);
    expect(s.view.viewNW).toBe(1.0);
    expect(s.view.viewNH).toBe(1.0);
  });

  it('starts with no map', () => {
    const s = defaultSessionState();
    expect(s.map).toBeNull();
  });

  it('starts with no fog polygons', () => {
    const s = defaultSessionState();
    expect(s.fog.polygons).toHaveLength(0);
  });

  it('starts with filter none', () => {
    const s = defaultSessionState();
    expect(s.filter.filterId).toBe('none');
  });

  it('markers and audio stubs are present', () => {
    const s = defaultSessionState();
    expect(Array.isArray(s.markers)).toBe(true);
    expect(s.audio).toBeDefined();
    expect(s.audio.motionTracker).toBeNull();
  });
});

describe('GMMessage types', () => {
  it('full_state message shape is valid', async () => {
    const { defaultSessionState: ds } = await import('../../src/types.ts');
    const msg = { type: 'full_state' as const, payload: ds() };
    expect(msg.type).toBe('full_state');
    expect(msg.payload.version).toBe(STATE_VERSION);
  });
});
