// Mist / Smoke — adapted from deusnovus's "Smooth Fog Shader" (2021),
// itself a remix of pontino's Fog Shader. Used under CC-BY-NC-SA 3.0
// — see ACKNOWLEDGEMENTS.md.
//
// One source for MapFX (polygon-masked, paint mist regions on the
// map) and Backdrop (full-bars; smoke obscures the bg via alpha
// composition). The same shader was previously duplicated as a
// separate 'smooth_fog' backdrop with hardcoded colours — the
// 'smooth_fog' id is now an alias for 'mist' in backdropById so
// saved packs still resolve.

// === BEGIN backdrop-shareable ===
uniform float time;
uniform float uAspect;
uniform vec3  uColor;        // mist hue
uniform float uIntensity;
uniform float uScale;
uniform float uSpeed;
uniform float uDirection;    // radians, compass (0 = north)

vec2 _mist_random2(vec2 st) {
  st = vec2(dot(st, vec2(127.1, 311.7)), dot(st, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(st) * 7.0);
}

float _mist_noise(vec2 st) {
  vec2 i = floor(st);
  vec2 f = fract(st);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(dot(_mist_random2(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)),
        dot(_mist_random2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
    mix(dot(_mist_random2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
        dot(_mist_random2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x),
    u.y
  );
}

// 5 octaves (deusnovus original used 4) — the extra fine detail
// breaks up mid-frequency flatness so dense regions read as proper
// "wisps" rather than haze.
float _mist_fbm(vec2 coord) {
  float value = 0.0;
  float scale = 0.25;
  for (int i = 0; i < 5; i++) {
    value += _mist_noise(coord) * scale;
    coord *= 2.0;
    scale *= 0.5;
  }
  return value + 0.25;
}

vec4 fxEffect(vec2 uv) {
  // Aspect-corrected, scaled to the original sampling space.
  vec2 st = vec2(uv.x * uAspect, uv.y);
  vec2 pos = st * (3.0 / max(uScale, 0.01));

  // First FBM produces a drifting motion vector; the original used
  // a fixed diagonal (-0.5, -0.3). We expose direction as a slider
  // (compass convention: 0 = north).
  float t = time * uSpeed;
  vec2 d = vec2(sin(uDirection), cos(uDirection));
  vec2 motion = vec2(_mist_fbm(pos + d * t * 0.5));

  // Second FBM at the warped position is the final density. The
  // original baked INTENSITY=2; we keep that as a base and let
  // uIntensity scale further.
  float density = _mist_fbm(pos + motion) * 2.0 * uIntensity;
  // Soft S-curve so wisp edges read as shape rather than a straight
  // gradient.
  density = smoothstep(0.05, 1.0, density);

  return vec4(uColor, density);
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
  // Normal blend: rgb is the mist hue, alpha is the density gated
  // by polygon coverage at the edges.
  gl_FragColor = vec4(c.rgb, c.a * maskAlpha);
}
