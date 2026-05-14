// Starfield — adapted from "StarField practice" by Deadtotem (2020-08-13)
//   https://www.shadertoy.com/view/tllfRX
//   Used under Shadertoy default licence (CC-BY-NC-SA 3.0) — see
//   ACKNOWLEDGEMENTS.md.
//
// Adaptation notes:
//   • iTime → time; iResolution → uAspect; iMouse → not used.
//   • The original's mouse-driven view offset is replaced with the
//     auto-rotation (cos/sin of time * 0.22) that the demo had as a
//     secondary effect — keeps the stars gently drifting.
//   • Per-poly plane: each vUv pixel maps to a starfield coordinate
//     centred on the polygon. The CanvasView constant (was 20) is
//     scaled by uScale so the GM picks star density.
//   • The 8 parallax layers create a "flying through stars" warp;
//     uSpeed scales the warp rate, original Velocity = 0.025.
//   • Star colour: the original hard-coded a violet/lilac palette via
//     `color * vec3(.9,.59,.9+size)`. Replaced with a more neutral
//     per-star hue variance that's then multiplied by uColor — the
//     GM picks the palette. The kind's default colour is set to a
//     purple in the registry so the unmodified look is the original
//     violet vibe.
//   • Output uses additive blending — stars add light on top of
//     whatever the map shows beneath, so painting a starfield over
//     dark map regions reads as "sky" and over lit regions just
//     adds sparkles.

uniform sampler2D uMask;
uniform float     time;
uniform float     uAspect;
uniform vec3      uColor;
uniform float     uIntensity;
uniform float     uScale;
uniform float     uSpeed;

varying vec2 vUv;

#define NUM_LAYERS 8
#define TAU 6.28318
#define STAR_GLOW 0.025
#define CANVAS_VIEW 20.0

float Star(vec2 uv, float flare) {
  float d = length(uv);
  float m = sin(STAR_GLOW * 1.2) / d;
  float rays = max(0.0, 0.5 - abs(uv.x * uv.y * 1000.0));
  m += (rays * flare) * 2.0;
  m *= smoothstep(1.0, 0.1, d);
  return m;
}

float Hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec3 StarLayer(vec2 uv) {
  vec3 col = vec3(0.0);
  vec2 gv = fract(uv);
  vec2 id = floor(uv);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offs = vec2(float(x), float(y));
      float n  = Hash21(id + offs);
      float size = fract(n);
      float star = Star(gv - offs - vec2(n, fract(n * 34.0)) + 0.5, smoothstep(0.1, 0.9, size) * 0.46);
      // Per-star hue variance — kept narrow so the GM's uColor pick
      // dominates the overall palette. The original used a stronger
      // hard-coded violet mix; we leave that decision to the GM.
      vec3 baseColor = sin(vec3(0.5, 0.6, 0.7) * fract(n * 2345.2) * TAU) * 0.25 + 0.75;
      baseColor *= vec3(0.95, 0.9, 0.95 + size * 0.1);
      vec3 color = baseColor * uColor;
      // Per-star twinkle.
      star *= sin(time * 0.6 + n * TAU) * 0.5 + 0.5;
      col += star * size * color;
    }
  }
  return col;
}

void main() {
  float maskAlpha = texture2D(uMask, vUv).r;
  if (maskAlpha < 0.01) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // Centered UV with aspect correction so circles look round and
  // the parallax warp doesn't squash on non-square polygons.
  vec2 uv = (vUv - 0.5);
  uv.x *= uAspect;

  // Auto-rotation offset — slow circular drift, same shape as the
  // original demo. Replaces the mouse-driven view offset.
  vec2 M = vec2(sin(time * 0.22), -cos(time * 0.22)) * 0.3;

  // Warp travel rate. Original Velocity = 0.025 (≈ 40s per full
  // depth cycle). uSpeed scales it for "drifting nebula" up to
  // "starship at warp" feel.
  float t = time * uSpeed * 0.025;

  vec3 col = vec3(0.0);
  for (int li = 0; li < NUM_LAYERS; li++) {
    float i = float(li) / float(NUM_LAYERS);
    float depth = fract(i + t);
    float scale = mix(CANVAS_VIEW / max(uScale, 0.01), 0.5, depth);
    float fade = depth * smoothstep(1.0, 0.9, depth);
    col += StarLayer(uv * scale + i * 453.2 - time * 0.05 + M) * fade;
  }

  // Additive blend on the material: stars add over the map.
  // Pre-multiply by maskAlpha so polygon coverage modulates the
  // additive contribution naturally.
  gl_FragColor = vec4(col * uIntensity * maskAlpha, maskAlpha);
}
