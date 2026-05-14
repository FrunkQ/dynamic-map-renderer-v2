// Mist — adapted from "Smooth Fog Shader" by deusnovus (2021-11-14)
//   https://www.shadertoy.com/view/7ldGWf
//   A remix of pontino's Fog Shader (https://www.shadertoy.com/view/tst3zr).
//   Used under Shadertoy default licence (CC-BY-NC-SA 3.0) — see
//   ACKNOWLEDGEMENTS.md.
//
// Adaptation notes:
//   • iTime → time; iResolution → uAspect.
//   • Already a clean 2D shader — straight port to plane-local UV.
//     The original's two-FBM domain-warp recipe is kept intact: one
//     FBM produces a per-pixel motion vector, the second FBM samples
//     the (position + motion) for the final density. Gives that
//     drifting, "wispy" mist character.
//   • uScale tunes the ZOOM constant (default 3.0); higher uScale
//     gives lazier / bigger wisps, lower uScale gives finer ripple
//     detail. Useful for everything from a small graveyard fog patch
//     to a horizon-spanning sea-mist.
//   • uSpeed scales the time multipliers (original used -0.5, -0.3).
//     0 freezes the mist; 4 gives a wind-driven storm-front feel.
//   • uColor replaces the hard-coded grey-purple `vec3(0.42, 0.40,
//     0.47)`. The background colour stays at vec3(0.0) so the mist
//     fades transparently rather than blending toward a fixed bg.
//   • Output uses normal alpha blending — wisps fade out gracefully
//     where the FBM is dark, fully obscure the map where it's bright.

uniform sampler2D uMask;
uniform float     time;
uniform float     uAspect;
uniform vec3      uColor;
uniform float     uIntensity;
uniform float     uScale;
uniform float     uSpeed;

varying vec2 vUv;

vec2 random2(vec2 st) {
  st = vec2(dot(st, vec2(127.1, 311.7)), dot(st, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(st) * 7.0);
}

float noise(vec2 st) {
  vec2 i = floor(st);
  vec2 f = fract(st);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(dot(random2(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)),
        dot(random2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
    mix(dot(random2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
        dot(random2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 coord) {
  float value = 0.0;
  float scale = 0.2;
  for (int i = 0; i < 4; i++) {
    value += noise(coord) * scale;
    coord *= 2.0;
    scale *= 0.5;
  }
  return value + 0.2;
}

void main() {
  float maskAlpha = texture2D(uMask, vUv).r;
  if (maskAlpha < 0.01) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // Plane-local position, aspect-corrected. ZOOM=3 was the original
  // sampling scale; we divide by uScale so bigger uScale = bigger
  // wisp features (matches the convention used across the other
  // shaders).
  vec2 st = vec2(vUv.x * uAspect, vUv.y);
  vec2 pos = st * (3.0 / max(uScale, 0.01));

  // First FBM produces a drifting motion vector. Time signs match
  // the original — gives the wisps a consistent diagonal drift.
  float t = time * uSpeed;
  vec2 motion = vec2(fbm(pos + vec2(t * -0.5, t * -0.3)));

  // Second FBM, sampled at the warped position, is the final mist
  // density. INTENSITY = 2 in the original; absorbed into uIntensity.
  float final = fbm(pos + motion);

  vec3 col = uColor * final * uIntensity;
  float alpha = clamp(final * uIntensity, 0.0, 1.0) * maskAlpha;

  gl_FragColor = vec4(col, alpha);
}
