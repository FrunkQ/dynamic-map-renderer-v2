// Heat Haze — desert / asphalt-shimmer wobble. Two-octave value-noise drives
// a vertical UV displacement that's WEIGHTED toward the bottom of the frame
// (heat rises from the ground), so the upper sky is calm and the lower
// foreground writhes. Warm wash + slight bleach on highlights sells the
// "things are HOT here" feel without obliterating the map.

uniform sampler2D tDiffuse;
uniform vec2      resolution;
uniform float     time;
uniform float     uShimmer;
uniform float     uSpeed;
uniform float     uHeight;
uniform float     uWarmth;
varying vec2      vUv;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 78.233);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  // Vertical weighting — strong shimmer near the bottom, zero near the top.
  // Height slider controls how far up the haze rises (0.2 = thin band along
  // the bottom; 1.0 = full-frame shimmer).
  float vWeight = 1.0 - smoothstep(0.0, max(uHeight, 0.05), vUv.y);
  vWeight = pow(vWeight, 1.5);

  // Two-octave noise drifting upward + sideways — gives a rolling heat-
  // column feel rather than just a flat wobble.
  vec2 nUv = vec2(vUv.x * 6.0, vUv.y * 4.0) + vec2(time * uSpeed * 0.3, -time * uSpeed * 0.7);
  float n  = vnoise(nUv) * 0.6 + vnoise(nUv * 2.3) * 0.4;
  // Centre on zero so positive + negative both contribute.
  n = (n - 0.5) * 2.0;

  // Mostly vertical displacement — that's how real heat-haze reads (objects
  // wobble up-down, not side-to-side). Tiny x component keeps it from
  // looking like a vertical shutter.
  vec2 displace = vec2(n * 0.003, n * 0.012) * uShimmer * vWeight;

  vec4 color = texture2D(tDiffuse, vUv + displace);

  // Warm wash + slight highlight bleach. Multiplicative warm tint, then a
  // bloom-cheap brighten on already-bright pixels so the hottest patches
  // shimmer toward white.
  vec3 warm = vec3(1.10, 0.96, 0.82);
  color.rgb = mix(color.rgb, color.rgb * warm, uWarmth);
  float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  color.rgb += vec3(0.10) * smoothstep(0.7, 1.0, luma) * uWarmth;

  gl_FragColor = color;
}
