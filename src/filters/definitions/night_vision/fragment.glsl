// Night Vision — image-intensifier scope look. Luminance is mapped to
// monochrome green, then layered with horizontal scanlines, animated grain,
// and a heavy edge vignette to sell the "through a scope" feel.

uniform sampler2D tDiffuse;
uniform vec2      resolution;
uniform float     time;
uniform float     greenStrength;
uniform float     scanlines;
uniform float     grain;
uniform float     vignetteAmt;
varying vec2      vUv;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 78.233);
  return fract(p.x * p.y);
}

void main() {
  vec4 color = texture2D(tDiffuse, vUv);

  // Luma → green channel only. Boosting low-end so detail in shadows pops
  // (intensifier behaviour — gain is highest in the dark).
  float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  luma = pow(luma, 0.7);
  vec3 nv = vec3(0.08, luma * 1.15 + 0.10, 0.05);
  color.rgb = mix(color.rgb, nv, greenStrength);

  // Horizontal scanlines — devicePixelRatio-aware so they read crisp.
  if (scanlines > 0.001) {
    float lineY = vUv.y * resolution.y;
    float band  = sin(lineY * 3.14159) * 0.5 + 0.5;
    color.rgb *= 1.0 - (1.0 - band) * 0.40 * scanlines;
  }

  // Animated white-noise grain (time-shifted hash).
  if (grain > 0.001) {
    float g = hash21(vUv * resolution + time * 60.0) - 0.5;
    color.rgb += vec3(g * 0.18 * grain);
  }

  // Aspect-correct vignette — a tighter circle than Dawn/Dusk's, since the
  // scope-tube feel wants near-black edges.
  vec2 d = (vUv - 0.5) * vec2(resolution.x / resolution.y, 1.0);
  float vig = smoothstep(0.30, 0.65, length(d));
  color.rgb *= 1.0 - vig * 0.90 * vignetteAmt;

  gl_FragColor = color;
}
