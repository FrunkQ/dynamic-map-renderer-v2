// Mist — drifting low-frequency noise blanket. Soft, slow, painterly.
// Uses 4-octave value-noise fbm with a slow horizontal drift so the mist
// flows across the map. Vertical bias optionally pools mist at the bottom
// of the frame (ground fog) rather than spreading uniformly.

uniform sampler2D tDiffuse;
uniform vec2      resolution;
uniform float     time;
uniform float     uIntensity;
uniform float     uScale;
uniform float     uSpeed;
uniform float     uGroundPool;
uniform vec3      uMistColor;
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

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec4 color = texture2D(tDiffuse, vUv);

  // Aspect-correct so swirls aren't stretched on widescreen displays.
  vec2 aUv = vUv * vec2(resolution.x / resolution.y, 1.0);
  // Drift: horizontal scroll + slow vertical wobble so the field doesn't look
  // like a side-scrolling band.
  vec2 p = aUv * uScale + vec2(time * uSpeed * 0.10, sin(time * uSpeed * 0.07) * 0.4);

  float n = fbm(p);
  // Stretch contrast so flat-grey mid-tones become genuinely murky vs. clear.
  n = smoothstep(0.30, 0.85, n);

  // Vertical gradient — when groundPool > 0 the mist concentrates near the
  // bottom of the frame. groundPool = 0 means uniform.
  float vGrad = mix(1.0, smoothstep(-0.1, 0.9, vUv.y), clamp(uGroundPool, 0.0, 1.0));

  float mistAmount = clamp(n * vGrad * uIntensity, 0.0, 1.0);
  color.rgb = mix(color.rgb, uMistColor, mistAmount);

  gl_FragColor = color;
}
