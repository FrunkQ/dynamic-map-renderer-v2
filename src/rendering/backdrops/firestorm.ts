/**
 * Firestorm backdrop — volumetric fire/smoke clouds rising through
 * the bars. Ported from PrzemyslawZaworski's "GPU hacks #07 -
 * DirectX 12" Shadertoy entry (2019-06-07,
 * https://www.shadertoy.com/view/wtB3RG). The original is a 128-step
 * raymarch; we reduce to 48 steps for browser-friendly cost while
 * keeping the look. GM can dial the fire / smoke tints + intensity.
 *
 * Cost note: this is the heaviest backdrop. Each pixel does 48 ray
 * steps with two trig + a 5-octave FBM inside each. Fine on a 1080p
 * GM canvas; mind it on a 4K projector or low-end mobile player.
 *
 * Uniforms used:
 *   • time, vUv, uSpeed, uResolution (built-ins)
 *   • uFire  (hot core colour for low-altitude bright cells)
 *   • uSmoke (cooler smoke colour for rising columns above)
 *   • uIntensity (overall brightness multiplier)
 */

import type { BackdropEntry } from './backdropRegistry.ts';

// Slight tilt so the rising columns lean toward the camera, matching
// the original entry's view direction.
const HELPERS = /* glsl */`
  const mat3 _fs_rot = mat3(1.0, 0.0, 0.0,
                            0.0, 0.47, -0.88,
                            0.0, 0.88, 0.47);
  float _fs_hash(float p) {
    return fract(sin(p) * 43758.5453);
  }
  float _fs_noise(vec3 x) {
    vec3 p = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    float n = p.x + p.y * 57.0 + 113.0 * p.z;
    return mix(
      mix(mix(_fs_hash(n +   0.0), _fs_hash(n +   1.0), f.x),
          mix(_fs_hash(n +  57.0), _fs_hash(n +  58.0), f.x), f.y),
      mix(mix(_fs_hash(n + 113.0), _fs_hash(n + 114.0), f.x),
          mix(_fs_hash(n + 170.0), _fs_hash(n + 171.0), f.x), f.y),
      f.z
    );
  }
  vec4 _fs_map(vec3 p, float t, vec3 fire, vec3 smoke) {
    float d = 0.2 - p.y;
    vec3 q = p - vec3(0.0, 1.0, 0.0) * t;
    float f  = 0.5000  * _fs_noise(q); q = q * 2.02 - vec3(0.0, 1.0, 0.0) * t;
    f += 0.2500  * _fs_noise(q);       q = q * 2.03 - vec3(0.0, 1.0, 0.0) * t;
    f += 0.1250  * _fs_noise(q);       q = q * 2.01 - vec3(0.0, 1.0, 0.0) * t;
    f += 0.0625  * _fs_noise(q);       q = q * 2.02 - vec3(0.0, 1.0, 0.0) * t;
    f += 0.03125 * _fs_noise(q);
    d = clamp(d + 4.5 * f, 0.0, 1.0);
    // Colour ramp: bright core near the base fades to smoke up top.
    vec3 col = mix(fire * 0.9 + vec3(0.1), smoke, d) + 0.05 * sin(p);
    return vec4(col, d);
  }
`;

const FRAGMENT = /* glsl */`
  {
    vec3 _ro = vec3(0.0, 4.9, -40.0);
    vec2 _frag = vUv * uResolution.xy;
    vec3 _rd = normalize(vec3(
      (2.0 * _frag - uResolution.xy) / max(uResolution.y, 1.0),
      2.0
    )) * _fs_rot;
    float _t = time * uSpeed;
    vec4 _s = vec4(0.0);
    float _step = 0.0;
    // 48 steps trades a small amount of the original's depth detail
    // for ~2.5x faster fragment work. Cutoff at alpha 0.99 still
    // lets near-opaque columns terminate the loop early.
    for (int _i = 0; _i < 48; _i++) {
      if (_s.a > 0.99) break;
      vec3 _p = _ro + _step * _rd;
      vec4 _k = _fs_map(_p, _t, uFire, uSmoke);
      // Vertical falloff modulates the hot core down low to cool
      // smoke up high — the colour grade that sells "fire underneath,
      // smoke above" without two passes.
      _k.rgb *= mix(uFire * 3.0, vec3(0.5), clamp((_p.y - 0.2) / 2.0, 0.0, 1.0));
      _k.a *= 0.5;
      _k.rgb *= _k.a;
      _s = _s + _k * (1.0 - _s.a);
      _step += 0.13; // larger step to compensate for fewer iterations
    }
    vec3 _vol = clamp(_s.xyz, 0.0, 1.0);
    _vol = _vol * 0.5 + 0.5 * _vol * _vol * (3.0 - 2.0 * _vol);
    gl_FragColor = vec4(_vol * uIntensity, 1.0);
  }
`;

export const FIRESTORM_BACKDROP: BackdropEntry = {
  id:       'firestorm',
  label:    'Firestorm (heavy)',
  fragment: FRAGMENT,
  helpers:  HELPERS,
  params: [
    // Defaults reproduce the original ember-red fire fading to dark
    // smoke. Swap fire for blue/green for soulfire storms; swap
    // smoke for a sickly tint for plague clouds.
    { id: 'fire',      label: 'Fire Core',  type: 'color', default: '#ffa64d' },
    { id: 'smoke',     label: 'Smoke',      type: 'color', default: '#1a0a08' },
    { id: 'intensity', label: 'Intensity',                 min: 0.2, max: 2.0, step: 0.05, default: 1.0 },
    // Column rise rate. The raymarch already uses time * uSpeed in
    // the volume offset; 0 freezes the columns mid-burn, 1 is the
    // original pace, 3 reads as a column whipping skyward.
    { id: 'speed',     label: 'Speed',                     min: 0.0, max: 3.0, step: 0.05, default: 1.0 },
  ],
};
