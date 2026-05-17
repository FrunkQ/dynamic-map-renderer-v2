/**
 * Aurora backdrop — drifting horizontal bands of green/purple light,
 * concentrated around the mid-height of the viewport with soft falloff
 * toward the top and bottom edges. Slow enough to read as ambient,
 * fast enough that the player notices it's alive.
 *
 * Inline trigonometric construction — no FBM helpers, so the snippet
 * lives entirely inside its own block scope and doesn't need any
 * top-level function definitions in the clip-pass template.
 *
 * Uniforms used: time, uSpeed, vUv, uBgColor.
 */

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
    // Slow hue drift between aurora-green and aurora-violet across
    // the horizontal axis + time.
    vec3 _green  = vec3(0.20, 0.75, 0.45);
    vec3 _violet = vec3(0.45, 0.25, 0.80);
    vec3 _hue = mix(_green, _violet, sin(_uv.x * 2.0 + _t) * 0.5 + 0.5);
    vec3 _col = _hue * _band * _falloff * 0.55;
    // Composite over the pack's chosen bg colour so a non-black bg
    // still tints through the aurora.
    gl_FragColor = vec4(uBgColor + _col, 1.0);
  }
`;

export const AURORA_BACKDROP = {
  id:       'aurora',
  label:    'Aurora',
  fragment: FRAGMENT,
};
