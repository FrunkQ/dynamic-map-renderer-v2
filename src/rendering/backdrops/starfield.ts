/**
 * Starfield backdrop — adapted from "StarField practice" by Deadtotem
 * (2020-08-13) — https://www.shadertoy.com/view/tllfRX
 *
 * Used under Shadertoy default licence (CC-BY-NC-SA 3.0) — see
 * ACKNOWLEDGEMENTS.md.
 *
 * Differences from the MapFX `starfield` kind (src/mapfx/shaders/starfield):
 *   • No polygon mask — fills the entire pillarbox / letterbox area.
 *   • No uColor — uses the original violet/lilac star palette so the
 *     backdrop reads as a neutral "deep space" hue against any pack
 *     accent. Different MapFX starfield polygons can still recolour
 *     individually; the backdrop is intentionally pack-wide flavour.
 *   • Fixed CANVAS_VIEW (20) — backdrop scale is not GM-tunable in v1;
 *     the slider only exposes `speed`. Density looks reasonable across
 *     a wide range of bar widths.
 *
 * Snippet inlined into the clip-pass fragment shader. Uniforms used:
 *   time        — seconds since renderer start (animation clock).
 *   uSpeed      — GM-tuned warp rate; 0 freezes the starfield,
 *                 default 1.0 is the original Velocity = 0.025 pace,
 *                 up to 10 reads as proper warp speed.
 *   uDirection  — 0..π sweep. cos drives the forward/recede component
 *                 (depth-warp rate); sin drives lateral horizontal
 *                 scroll. 0 = stars approach head-on, π/2 = pure
 *                 sideways flight, π = stars recede. Same convention
 *                 as the MapFX starfield kind.
 *   uGlow       — 0..1 dial. 0 = sharp pinpoint stars (no cross-flares,
 *                 tight radial falloff); 1 = full haloed orbs with rays
 *                 (the original look). Default 1.0 reproduces the
 *                 registered Shadertoy entry.
 *   vUv         — full-canvas 0..1 (clip-pass varying).
 *
 * Output: opaque RGBA over uBgColor so the bars never go transparent.
 */

const FRAGMENT = /* glsl */`
  // ── starfield helpers ─────────────────────────────────────────────
  // Use a function-local scope (do { ... } while (false);) so symbol
  // names cannot collide with the clip-pass main() if another snippet
  // ever defines the same identifiers.
  vec3 _bg = uBgColor;
  {
    #define _SF_LAYERS 6
    #define _SF_TAU 6.28318
    #define _SF_GLOW 0.025
    #define _SF_CANVAS 20.0

    // hash + star + layer — inlined as expressions so the fragment
    // remains a single GLSL compilation unit (no function decls inside
    // main()). Trade some readability for snippet portability.

    vec2 _bgUv = vUv - 0.5;
    // Aspect-correct so stars stay round across wide canvases.
    _bgUv.x *= max(1.0, uResolution.x / max(uResolution.y, 1.0));

    // Direction sweep — same compass-style 0..π convention as the
    // MapFX starfield kind. cos drives the forward depth-warp rate
    // (positive at 0 = approaching, negative at π = receding); sin
    // drives a horizontal lateral scroll (peaks at π/2 = pure
    // sideways drift, no convergence).
    float _forward = cos(uDirection);
    float _lateral = sin(uDirection);
    float _t = time * uSpeed * 0.025 * _forward;
    vec2 _lateralOffset = vec2(_lateral * time * uSpeed * 0.8, 0.0);
    vec3  _col = vec3(0.0);

    for (int _li = 0; _li < _SF_LAYERS; _li++) {
      float _i = float(_li) / float(_SF_LAYERS);
      float _depth = fract(_i + _t);
      float _scale = mix(_SF_CANVAS, 0.5, _depth);
      float _fade  = _depth * smoothstep(1.0, 0.9, _depth);

      vec2 _uv = _bgUv * _scale + _i * 453.2 - time * 0.05 + _lateralOffset;
      vec2 _gv = fract(_uv);
      vec2 _id = floor(_uv);
      vec3 _layer = vec3(0.0);
      for (int _y = -1; _y <= 1; _y++) {
        for (int _x = -1; _x <= 1; _x++) {
          vec2 _offs = vec2(float(_x), float(_y));
          vec2 _p = fract((_id + _offs) * vec2(123.34, 456.21));
          _p += dot(_p, _p + 45.32);
          float _n = fract(_p.x * _p.y);
          float _size = fract(_n);
          vec2 _sp = _gv - _offs - vec2(_n, fract(_n * 34.0)) + 0.5;
          float _d = length(_sp);
          float _flare = smoothstep(0.1, 0.9, _size) * 0.46;
          // Glow control: the original combined a soft radial halo
          // (1/_d) with cross-shaped rays (the _rays * _flare
          // term). At uGlow=0 we want crisp pinpoints, so the
          // radial halo collapses to a near-sharp falloff via
          // smoothstep and the rays drop out entirely. At uGlow=1
          // we keep the original look. Intermediate values cross-
          // fade so the slider feels continuous.
          float _halo = mix(
            smoothstep(0.08, 0.0, _d),         // pinpoint at glow=0
            sin(_SF_GLOW * 1.2) / max(_d, 1e-4), // haloed at glow=1
            uGlow
          );
          float _rays = max(0.0, 0.5 - abs(_sp.x * _sp.y * 1000.0));
          float _m = _halo + (_rays * _flare) * 2.0 * uGlow;
          _m *= smoothstep(1.0, 0.1, _d);
          // Per-star hue variance — keep the classic violet vibe.
          vec3 _base = sin(vec3(0.5, 0.6, 0.7) * fract(_n * 2345.2) * _SF_TAU) * 0.25 + 0.75;
          _base *= vec3(0.95, 0.9, 0.95 + _size * 0.1);
          // Slight twinkle.
          _m *= sin(time * 0.6 + _n * _SF_TAU) * 0.5 + 0.5;
          _layer += _m * _size * _base;
        }
      }
      _col += _layer * _fade;
    }

    // Composite stars over the pack's background colour so a non-black
    // bg still reads through faintly. Stars add light additively.
    vec3 _out = _bg + _col;
    gl_FragColor = vec4(_out, 1.0);
  }
`;

import type { BackdropEntry } from './backdropRegistry.ts';

export const STARFIELD_BACKDROP: BackdropEntry = {
  id:       'starfield',
  label:    'Starfield',
  fragment: FRAGMENT,
  params: [
    // 1.0 reproduces the original haloed-orb look; 0.0 gives crisp
    // pinpoints — useful for a "night sky behind a window" reading
    // rather than the dramatic-space-vista default.
    { id: 'glow',      label: 'Glow',                min: 0.0, max: 1.0,       step: 0.05,     default: 1.0 },
    // Warp travel rate. 0 = static starfield (no motion); 1 = the
    // original Velocity = 0.025 pace; 10 = proper warp-speed feel.
    // Range matches the MapFX kind so behaviour is consistent.
    { id: 'speed',     label: 'Speed',               min: 0.0, max: 10.0,      step: 0.1,      default: 1.0 },
    // 0..π sweep — 0 stars approach head-on, π/2 sideways drift,
    // π stars recede. Same convention as the MapFX starfield.
    { id: 'direction', label: 'Direction',           min: 0.0, max: 3.1415927, step: 0.087266, default: 0.0 },
  ],
};
