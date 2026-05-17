/**
 * Aurora backdrop — drifting horizontal bands of light, concentrated
 * around the mid-height of the viewport with soft falloff toward the
 * top and bottom edges. Slow enough to read as ambient, fast enough
 * that the player notices it's alive.
 *
 * Inline trigonometric construction — no FBM helpers, so the snippet
 * lives entirely inside its own block scope and doesn't need any
 * top-level function definitions in the clip-pass template.
 *
 * Uniforms used:
 *   • time, uSpeed, vUv, uBgColor (built-in clip-pass uniforms)
 *   • uColorA, uColorB (curtain colours; auto-injected from params)
 *   • uIntensity (overall brightness multiplier; auto-injected)
 */

import type { BackdropEntry } from './backdropRegistry.ts';

const FRAGMENT = /* glsl */`
  {
    vec2 _uv = vUv - 0.5;
    float _t = time * uSpeed * 0.1;
    // Two stacked horizontal wave systems give the "curtain folding"
    // motion that's characteristic of an aurora rather than a flat
    // gradient. The inner sin terms modulate phase by horizontal
    // position so the bands ripple rather than translate uniformly.
    float _band1 = sin(_uv.y * 8.0 + _t * 0.5 + sin(_uv.x * 3.0 + _t * 0.3) * 0.5) * 0.5 + 0.5;
    float _band2 = sin(_uv.y * 4.0 - _t * 0.4 + cos(_uv.x * 2.0 - _t * 0.2) * 0.4) * 0.5 + 0.5;
    float _band  = _band1 * _band2;
    // Soft falloff toward the top + bottom edges of the viewport so
    // the aurora "hangs" in the upper-middle band area instead of
    // smearing across the whole screen.
    float _falloff = 1.0 - smoothstep(0.25, 0.5, abs(_uv.y));
    // Slow hue drift between the two curtain colours across the
    // horizontal axis + time. Defaults match the original
    // aurora-green / aurora-violet pair.
    vec3 _hue = mix(uColorA, uColorB, sin(_uv.x * 2.0 + _t) * 0.5 + 0.5);
    vec3 _col = _hue * _band * _falloff * 0.55 * uIntensity;
    // Composite over the pack's chosen bg colour so a non-black bg
    // still tints through the aurora.
    gl_FragColor = vec4(uBgColor + _col, 1.0);
  }
`;

export const AURORA_BACKDROP: BackdropEntry = {
  id:       'aurora',
  label:    'Aurora',
  fragment: FRAGMENT,
  // Defaults reproduce the original look: green↔violet, full
  // intensity. GM can swap them for fire-red ribbons over a swamp,
  // ice-blue over an arctic map, etc.
  params: [
    { id: 'colorA',    label: 'Curtain Colour',       type: 'color',  default: '#33bf73' },
    { id: 'colorB',    label: 'Secondary Colour',     type: 'color',  default: '#7340cc' },
    { id: 'intensity', label: 'Intensity',                            min: 0.2, max: 2.0, step: 0.05, default: 1.0 },
    // Curtain drift rate. 0 freezes the bands; 1 is the original
    // calm wash; 3 reads as a magical storm front. The aurora GLSL
    // already scales time by uSpeed * 0.1 — slider just exposes it.
    { id: 'speed',     label: 'Speed',                                min: 0.0, max: 3.0, step: 0.05, default: 1.0 },
  ],
};
