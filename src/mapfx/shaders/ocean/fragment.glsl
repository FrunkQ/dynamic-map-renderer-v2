// Ocean — adapted from afl_ext (2017-2024) under MIT — see
// ACKNOWLEDGEMENTS.md. Top-down water surface with procedural sky
// reflection + sun glints. Self-contained (no helper textures).
//
// One source for MapFX (polygon-masked ocean / lake region) and
// Backdrop (full-bars seascape — ideal for ship-floorplan maps
// where the deck is the map and the surrounding water is the bars).

// === BEGIN backdrop-shareable ===
uniform float time;
uniform float uAspect;
uniform vec3  uColor;
uniform float uIntensity;
uniform float uScale;
uniform float uSpeed;
uniform float uWaveHeight;

#define _OCEAN_DRAG_MULT 0.38
#define _OCEAN_WATER_DEPTH 1.0
#define _OCEAN_ITERATIONS_NORMAL 20

vec2 _ocean_wavedx(vec2 position, vec2 direction, float frequency, float timeshift) {
  float x = dot(direction, position) * frequency + timeshift;
  float wave = exp(sin(x) - 1.0);
  float dx = wave * cos(x);
  return vec2(wave, -dx);
}

float _ocean_getwaves(vec2 position) {
  float wavePhaseShift = length(position) * 0.1;
  float iter = 0.0;
  float frequency = 1.0;
  float timeMultiplier = 2.0;
  float weight = 1.0;
  float sumOfValues = 0.0;
  float sumOfWeights = 0.0;
  for (int i = 0; i < _OCEAN_ITERATIONS_NORMAL; i++) {
    vec2 p = vec2(sin(iter), cos(iter));
    vec2 res = _ocean_wavedx(position, p, frequency, time * uSpeed * timeMultiplier + wavePhaseShift);
    position += p * res.y * weight * _OCEAN_DRAG_MULT;
    sumOfValues  += res.x * weight;
    sumOfWeights += weight;
    weight = mix(weight, 0.0, 0.2);
    frequency *= 1.18;
    timeMultiplier *= 1.07;
    iter += 1232.399963;
  }
  return sumOfValues / sumOfWeights;
}

vec3 _ocean_normal(vec2 pos, float e, float depth) {
  vec2 ex = vec2(e, 0.0);
  float H = _ocean_getwaves(pos.xy) * depth;
  vec3 a = vec3(pos.x, H, pos.y);
  return normalize(
    cross(
      a - vec3(pos.x - e, _ocean_getwaves(pos.xy - ex.xy) * depth, pos.y),
      a - vec3(pos.x, _ocean_getwaves(pos.xy + ex.yx) * depth, pos.y + e)
    )
  );
}

vec3 _ocean_atmosphere(vec3 raydir, vec3 sundir) {
  float special_trick  = 1.0 / (raydir.y * 1.0 + 0.1);
  float special_trick2 = 1.0 / (sundir.y * 11.0 + 1.0);
  float raysundt = pow(abs(dot(sundir, raydir)), 2.0);
  vec3 suncolor = mix(vec3(1.0), max(vec3(0.0), vec3(1.0) - vec3(5.5, 13.0, 22.4) / 22.4), special_trick2);
  vec3 bluesky  = vec3(5.5, 13.0, 22.4) / 22.4 * suncolor;
  vec3 bluesky2 = max(vec3(0.0), bluesky - vec3(5.5, 13.0, 22.4) * 0.002 * (special_trick + -6.0 * sundir.y * sundir.y));
  bluesky2 *= special_trick * (0.24 + raysundt * 0.24);
  return bluesky2 * (1.0 + 1.0 * pow(1.0 - raydir.y, 3.0));
}

vec3 _ocean_sunDir() {
  return normalize(vec3(-0.08, 0.62, 0.58));
}

vec3 _ocean_aces(vec3 color) {
  mat3 m1 = mat3(
    0.59719, 0.07600, 0.02840,
    0.35458, 0.90834, 0.13383,
    0.04823, 0.01566, 0.83777
  );
  mat3 m2 = mat3(
     1.60475, -0.10208, -0.00327,
    -0.53108,  1.10813, -0.07276,
    -0.07367, -0.00605,  1.07602
  );
  vec3 v = m1 * color;
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(m2 * (a / b), 0.0, 1.0);
}

vec4 fxEffect(vec2 uv) {
  // Wave-space position. uScale tunes feature density — small uScale
  // gives fine ripples covering a large region; big uScale gives
  // lazy swells.
  vec2 pos = (uv - 0.5) * (8.0 / max(uScale, 0.01));

  // Wave height scales the depth used inside the normal calc.
  // 0 = mirror calm, 1 = default, 2 = stormy.
  vec3 N = _ocean_normal(pos, 0.01, _OCEAN_WATER_DEPTH * uWaveHeight);

  // Top-down view with slight tilt so sun glints catch wave crests.
  vec3 ray = normalize(vec3(0.05, -1.0, 0.05));
  float fresnel = 0.04 + 0.96 * pow(1.0 - max(0.0, dot(-N, ray)), 5.0);

  // Reflect view dir off surface; force bounce up so we sample sky.
  vec3 R = normalize(reflect(ray, N));
  R.y = abs(R.y);

  vec3 sundir = _ocean_sunDir();
  vec3 reflection = _ocean_atmosphere(R, sundir) * 0.5 + pow(max(0.0, dot(R, sundir)), 720.0) * 210.0;

  // Scattering — uColor drives the water body hue.
  vec3 scattering = uColor * 0.2;

  vec3 C = fresnel * reflection + scattering;
  vec3 finalCol = _ocean_aces(C * 2.0);
  return vec4(finalCol, uIntensity);
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
  // Normal blend on the material; alpha = uIntensity gates how
  // opaque the water reads, polygon coverage modulates further at
  // the edges.
  gl_FragColor = vec4(c.rgb, c.a * maskAlpha);
}
