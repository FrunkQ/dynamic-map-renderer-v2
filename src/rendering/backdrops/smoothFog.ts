/**
 * Smooth Fog backdrop — slowly-drifting fog made of two-layer FBM
 * noise. Ported from deusnovus's "Smooth Fog Shader" on Shadertoy
 * (2021-11-14, https://www.shadertoy.com/view/7ldGWf), itself a remix
 * of pontino's Fog Shader (https://www.shadertoy.com/view/tst3zr).
 * Re-used with attribution.
 *
 * The look reads as drifting low cloud / battlefield smoke / mage's
 * fog depending on the colour choice. Same algorithm already powers
 * the MapFX 'mist' kind (per-polygon), so picking this backdrop and a
 * matching tint on a mist polygon gives consistent atmosphere both in
 * the bars and over chosen map regions.
 *
 * Uniforms used:
 *   • time, uSpeed, vUv, uResolution, uBgColor (built-ins)
 *   • uColor (fog colour; default reproduces the original grey)
 *   • uIntensity (fog density; the original INTENSITY constant
 *     lifted out of the snippet so the GM can dial calm haze through
 *     pea-souper)
 *
 * The deep background that bleeds through the gaps in the fog is the
 * pack-level Background Colour (`uBgColor`) — same convention as the
 * starfield backdrop, so picking a different bg colour propagates
 * consistently across both backdrop kinds without duplicating the
 * setting.
 */

import type { BackdropEntry } from './backdropRegistry.ts';

const HELPERS = /* glsl */`
  float _fog_random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9818, 79.279))) * 43758.5453123);
  }
  vec2 _fog_random2(vec2 st) {
    st = vec2(dot(st, vec2(127.1, 311.7)), dot(st, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(st) * 7.0);
  }
  float _fog_noise(vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(dot(_fog_random2(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)),
          dot(_fog_random2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
      mix(dot(_fog_random2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
          dot(_fog_random2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  float _fog_fbm(vec2 coord) {
    float value = 0.0;
    float scale = 0.2;
    for (int i = 0; i < 4; i++) {
      value += _fog_noise(coord) * scale;
      coord *= 2.0;
      scale *= 0.5;
    }
    return value + 0.2;
  }
`;

const FRAGMENT = /* glsl */`
  {
    // Aspect-correct the UV so fog cells don't squash on wide/tall bars.
    vec2 _st = vUv * (uResolution.xy / max(uResolution.y, 1.0));
    float _zoom = 3.0;
    vec2 _pos = _st * _zoom;
    float _t = time * uSpeed;
    vec2 _motion = vec2(_fog_fbm(_pos + vec2(_t * -0.5, _t * -0.3)));
    float _final = _fog_fbm(_pos + _motion) * 2.0 * uIntensity;
    gl_FragColor = vec4(mix(uBgColor, uColor, _final), 1.0);
  }
`;

export const SMOOTH_FOG_BACKDROP: BackdropEntry = {
  id:       'smooth_fog',
  label:    'Smooth Fog',
  fragment: FRAGMENT,
  helpers:  HELPERS,
  // Defaults match deusnovus's original look: pale grey fog. Tint to
  // brown for sandstorm, sickly green for poison marsh, deep blue for
  // night-time sea fret, etc. The "background" the fog fades into is
  // the pack-level Background Colour — picked once in the Map panel
  // and shared across every backdrop, so changing it ripples through.
  params: [
    { id: 'color',     label: 'Fog Colour', type: 'color', default: '#6b6678' },
    { id: 'intensity', label: 'Density',                   min: 0.2, max: 2.0, step: 0.05, default: 1.0 },
    // Wisp drift rate. The GLSL already uses time * uSpeed for the
    // domain-warp offset; 0 freezes the fog, 1 is the original
    // gentle drift, 3 reads as wind-driven sea fret.
    { id: 'speed',     label: 'Speed',                     min: 0.0, max: 3.0, step: 0.05, default: 1.0 },
  ],
};
