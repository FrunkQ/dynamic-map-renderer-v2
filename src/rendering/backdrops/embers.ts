/**
 * Embers backdrop — warm sparks rising slowly through the bars. Good
 * companion to fire-themed maps. Each "ember" is a hashed point in
 * a tiled cell grid that drifts upward over time; the loop runs 8
 * layers at different speeds + offsets to give parallax depth
 * without breaking out a real particle system.
 *
 * Inline construction — hash + cell math all unrolled so no
 * top-level GLSL function defs leak into the clip-pass template.
 *
 * Uniforms used: time, uSpeed, vUv, uBgColor, uResolution.
 */

const FRAGMENT = /* glsl */`
  {
    vec2 _uv = vUv;
    // Aspect-correct so embers stay roughly circular and the layer
    // density is consistent across wide letterbox vs tall pillarbox.
    _uv.x *= max(1.0, uResolution.x / max(uResolution.y, 1.0));
    float _t = time * uSpeed;
    vec3 _col = vec3(0.0);
    // 8 parallax layers — each tile grid is offset and scrolling at
    // a slightly different rate so the eye picks up depth.
    for (int _li = 0; _li < 8; _li++) {
      float _fi = float(_li);
      float _scale = 6.0 + _fi * 1.5;
      float _speed = 0.04 + _fi * 0.015;
      // Cells move upward (negative y) over time. Layer index seeds
      // an x offset so the layers don't all line up.
      vec2 _cell = vec2(
        _uv.x * _scale + _fi * 7.13,
        _uv.y * _scale * 0.6 - _t * _speed
      );
      vec2 _gv = fract(_cell);
      vec2 _id = floor(_cell);
      // 2-step hash → stable per-cell position + size.
      vec2 _p = fract(_id * vec2(123.34, 456.21) + _fi * 17.0);
      _p += dot(_p, _p + 45.32);
      float _h = fract(_p.x * _p.y);
      // Per-cell ember position + brightness + flicker.
      vec2 _pos = vec2(_h, fract(_h * 7.0));
      float _d = distance(_gv, _pos);
      float _r = 0.05 + fract(_h * 13.0) * 0.04;
      float _ember = smoothstep(_r, 0.0, _d);
      _ember *= 0.6 + sin(_t * 3.0 + _h * 31.4) * 0.4;
      // Warm gradient — red-hot core fading to orange edges.
      vec3 _heat = vec3(1.0, 0.55 - _h * 0.25, 0.12);
      // Far layers dimmer than near ones to sell the parallax.
      float _layerFade = 1.0 - _fi * 0.08;
      _col += _ember * _heat * 0.18 * _layerFade;
    }
    gl_FragColor = vec4(uBgColor + _col, 1.0);
  }
`;

export const EMBERS_BACKDROP = {
  id:       'embers',
  label:    'Embers',
  fragment: FRAGMENT,
};
