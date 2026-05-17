// Magic Portal — adapted from "Magic Portal" by Delincoter (2021).
// Used under CC-BY-NC-SA 3.0 — see ACKNOWLEDGEMENTS.md. The noise
// primitive (hash33 + simplex noise) is from
// https://www.shadertoy.com/view/4sc3z2.
//
// One source for MapFX (polygon-masked) and Backdrop (full-bars).

// === BEGIN backdrop-shareable ===
uniform float time;
uniform float uAspect;
uniform vec3  uColor;
uniform float uIntensity;
uniform float uScale;
uniform float uSpeed;

vec3 _pt_hash33(vec3 p3) {
  vec3 MOD3 = vec3(0.1031, 0.11369, 0.13787);
  p3 = fract(p3 * MOD3);
  p3 += dot(p3, p3.yxz + 19.19);
  return -1.0 + 2.0 * fract(vec3(
    (p3.x + p3.y) * p3.z,
    (p3.x + p3.z) * p3.y,
    (p3.y + p3.z) * p3.x
  ));
}

float _pt_simplex(vec3 p) {
  const float K1 = 0.333333333;
  const float K2 = 0.166666667;
  vec3 i = floor(p + (p.x + p.y + p.z) * K1);
  vec3 d0 = p - (i - (i.x + i.y + i.z) * K2);
  vec3 e = step(vec3(0.0), d0 - d0.yzx);
  vec3 i1 = e * (1.0 - e.zxy);
  vec3 i2 = 1.0 - e.zxy * (1.0 - e);
  vec3 d1 = d0 - (i1 - 1.0 * K2);
  vec3 d2 = d0 - (i2 - 2.0 * K2);
  vec3 d3 = d0 - (1.0 - 3.0 * K2);
  vec4 h = max(0.6 - vec4(dot(d0, d0), dot(d1, d1), dot(d2, d2), dot(d3, d3)), 0.0);
  vec4 n = h * h * h * h * vec4(
    dot(d0, _pt_hash33(i)),
    dot(d1, _pt_hash33(i + i1)),
    dot(d2, _pt_hash33(i + i2)),
    dot(d3, _pt_hash33(i + 1.0))
  );
  return dot(vec4(31.316), n);
}

float _pt_render(vec2 uv, float t) {
  float side   = smoothstep(0.5, 0.3, length(uv));
  float center = smoothstep(0.1, 0.0, length(uv));
  vec3 rd = vec3(uv, 0.0);
  float n2 = _pt_simplex((rd * t + t) * (1.0 / max(0.0001, length(rd * t + rd))) + t * 0.3);
  float flare = smoothstep(0.0, 1.0, 0.002 / max(0.0001, length(rd * length(rd) * n2))) * side;
  flare = flare - center * 5.0;
  return flare;
}

vec4 fxEffect(vec2 uv) {
  // Centred + aspect-corrected, divided by uScale so the portal disc
  // tunes to the region. At uScale=1 the natural ~0.5 radius sits
  // inside a typical polygon; bigger uScale grows the portal beyond
  // the polygon edges (mask clips). Same maths for backdrop, just
  // applied over the bars.
  vec2 p = (uv - 0.5) / max(uScale, 0.01);
  p.x *= uAspect;

  // Continuous animation — linear time, not the original's iTime^5
  // opening buildup. +5 offset gets us past the original's "still
  // opening" early frames into a stable look.
  float t = 5.0 + time * uSpeed * 1.5;

  float flare = _pt_render(p, t);
  vec3 col = uColor * 2.0 * flare;
  return vec4(col * uIntensity, 1.0);
}
// === END backdrop-shareable ===

uniform sampler2D uMask;
varying vec2 vUv;

void main() {
  float maskAlpha = texture2D(uMask, vUv).a;
  if (maskAlpha < 0.01) {
    gl_FragColor = vec4(0.0);
    return;
  }
  vec4 c = fxEffect(vUv);
  // Additive blend; pre-multiply by maskAlpha so polygon coverage
  // modulates the contribution naturally at the edges.
  gl_FragColor = vec4(c.rgb * maskAlpha, maskAlpha);
}
