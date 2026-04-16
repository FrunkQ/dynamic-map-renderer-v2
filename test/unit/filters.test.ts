import { describe, it, expect } from 'vitest';
import { paramToUniform } from '../../src/rendering/ShaderMaterial.ts';
import type { FilterParam } from '../../src/filters/schema.ts';

describe('paramToUniform', () => {
  it('capitalises the first letter and prepends u', () => {
    expect(paramToUniform('brightness')).toBe('uBrightness');
    expect(paramToUniform('scanlineIntensity')).toBe('uScanlineIntensity');
    expect(paramToUniform('crtWarp')).toBe('uCrtWarp');
  });

  it('handles single character ids', () => {
    expect(paramToUniform('x')).toBe('uX');
  });
});

describe('FilterParam schema shape', () => {
  it('slider has required numeric fields', () => {
    const p: FilterParam = {
      type: 'slider', id: 'test', label: 'Test',
      min: 0, max: 1, step: 0.1, default: 0.5,
    };
    expect(p.type).toBe('slider');
    expect(p.default).toBeGreaterThanOrEqual(p.min);
    expect(p.default).toBeLessThanOrEqual(p.max);
  });

  it('toggle default is boolean', () => {
    const p: FilterParam = { type: 'toggle', id: 'inv', label: 'Invert', default: false };
    expect(typeof p.default).toBe('boolean');
  });

  it('select has at least one option', () => {
    const p: FilterParam = {
      type: 'select', id: 'mode', label: 'Mode',
      options: [{ value: 0, label: 'None' }, { value: 1, label: 'Full' }],
      default: 0,
    };
    expect(p.options.length).toBeGreaterThan(0);
  });
});
