// River — adapted from "A river" by Pierco
//   https://www.shadertoy.com/view/MsSGWK  (forked variant)
//   Used under Shadertoy default licence (CC-BY-NC-SA 3.0) — see
//   ACKNOWLEDGEMENTS.md.
//
// Adaptation notes:
//   • The original is a 3/4 perspective close-up of a river plane with a
//     mouse-rotated camera and cubemap sky reflections. Mappadux is
//     top-down at high altitude, so the camera is reduced to a fixed
//     near-overhead view per pixel — vUv directly drives the wave
//     surface coordinate, no ray-marching needed.
//   • iChannel0 (cubemap reflections) → procedural sky tint. From a
//     near-top-down view there's no horizon worth simulating.
//   • iChannel1 (riverbed texture) → uBed, the original Shadertoy
//     bed.jpg (gem-pebbles look) loaded from the river folder. The
//     earlier attempt sampled uMap (the GM's painted art under the
//     polygon) but the result didn't read well — likely a UV / Y-flip
//     issue we'll come back to. uMap support stays in the registry
//     for future use; for now this shader uses the original texture
//     so we can confirm the wave / refraction math reads correctly.
//   • iChannel2 (wave noise) → uNoise (copied from the original
//     Shadertoy asset — softer organic blobs that give proper rolling
//     wavelets instead of the angular ripples our other shaders' noise
//     would produce).
//   • Per-poly uniforms: uColor (water hue tint), uIntensity (output
//     multiplier), uScale (wave feature density), uSpeed (flow rate),
//     uDirection (compass-radians, 0 = north). Per-poly mask: uMask.

uniform sampler2D uMask;      // per-polygon alpha mask, plane-local
uniform sampler2D uNoise;     // wave surface noise (organic, see file note above)
uniform sampler2D uBed;       // refraction "bed" — original Pierco gem-pebble texture
uniform float     time;
uniform float     uAspect;
uniform vec3      uColor;
uniform float     uIntensity; // 0.05..1.5
uniform float     uScale;     // 0.25..4   — wave feature scale
uniform float     uSpeed;     // 0..2      — flow rate
uniform float     uDirection; // radians (0 = compass north → up the map)

varying vec2 vUv;

// Compass-direction vector in plane-local UV space. 0 rad = north
// → +vUv.y direction (up the map after our world-y → map-norm flip).
vec2 flowDir() {
  // angle measured clockwise from north; +x = east, +y = south in
  // map-norm space — but our vUv has y inverted (vUv.y=1 at top of
  // plane = top of map), so the y component is unflipped here.
  float a = uDirection;
  return vec2(sin(a), cos(a));
}

// Surface noise sum at a UV point. Three samples offset and combined,
// scrolled along the flow direction — same recipe as Pierco's original
// but in plane-local coords so wave feature size is meaningful per-poly.
//
// Base time coefficient is 0.08 (not Pierco's 0.33). Our noise period
// is ~5× denser per visible area than the original close-up view, so
// the same scroll rate visually reads ~5× faster. 0.08 × uSpeed=1 gives
// a gentle stream; uSpeed=2 a brisk river; uSpeed=4 proper rapids.
float waveAt(vec2 uv) {
  vec2 d = flowDir();
  float t = time * 0.08 * uSpeed;
  // Three samples scrolled in the flow direction at different rates +
  // phase offsets. The sum produces the soft rolling wave look.
  vec3 c1 = texture2D(uNoise, uv + d * (t * 2.0  ) + vec2(0.07, 0.07)).rgb;
  vec3 c2 = texture2D(uNoise, uv + d * (t * 2.52 ) + vec2(0.16, 0.84)).rgb;
  vec3 c3 = texture2D(uNoise, uv + d * (t * 3.32 ) + vec2(0.43, 0.31)).rgb;
  vec3 sum = c1 + c2 - c3;
  return (sum.x + sum.y + sum.z) / 12.0;
}

// Surface normal via forward differences on the wave height field.
vec3 surfaceNormal(vec2 uv) {
  // Step in plane-local UV space; tuned so the normal reads as a soft
  // ripple, not a jaggy displacement map.
  const float e = 0.004;
  float h  = waveAt(uv);
  float hx = waveAt(uv + vec2(e, 0.0));
  float hy = waveAt(uv + vec2(0.0, e));
  // y axis is "up" in the world the wave function imagines; for
  // visualisation we treat the surface as roughly flat and the normal
  // points mostly up with small xz tilts from the wave gradient.
  return normalize(vec3(-(hx - h), e * 4.0, -(hy - h)));
}

void main() {
  float maskAlpha = texture2D(uMask, vUv).r;
  if (maskAlpha < 0.01) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // Density scales with uScale: lower scale = bigger uv ratio = more
  // wave samples per polygon = finer wavelets. 5.0 is the base "about
  // five rollers across the polygon at scale 1.0" tuning.
  vec2 wuv = vUv * (5.0 / max(uScale, 0.01));

  // Wave normal at this pixel.
  vec3 n = surfaceNormal(wuv);

  // Top-down view direction (camera looking straight down at the map).
  vec3 viewDir = vec3(0.0, -1.0, 0.0);

  // Refraction: tilt the downward view by Snell, then offset the bed
  // sample by the refracted ray's xz. Same shape as Pierco's original
  // but sampling our preloaded gem-pebble texture in plane-local
  // wave-scale coords so the bed pattern tiles at the same density
  // as the surface waves.
  float eta = 1.003 / 1.3; // air → water
  vec3 rfd = refract(viewDir, n, eta);
  // Plane-local UV at wave scale + refraction offset. The 0.4 factor
  // is a strong distortion — visible wobble in the bed pattern.
  vec2 bedUv = wuv * 0.2 + rfd.xz * 0.4;
  vec3 bed = texture2D(uBed, bedUv).rgb;

  // Tint the refracted bed sample by uColor as a gentle hue shift.
  // Original Pierco shader does no tinting; we mix in only a small
  // amount so the GM's chosen colour reads as a "hint of blue / green
  // / etc." rather than recolouring the whole bed. Set uColor to white
  // for the original look.
  vec3 rfa = mix(bed, bed * uColor * 1.4, 0.15);

  // Water depth attenuation — pretend the deeper parts of the wave
  // crests attenuate the bed visibility. Cheap fake of the original
  // exp2(-depth) extinction.
  float wave = waveAt(wuv);
  rfa *= exp2(-1.2 * max(0.0, 0.5 - wave));

  // Procedural sky reflection — soft cool light from above, modulated
  // by surface tilt so wave crests catch the "sky" colour. No
  // cubemap involved. Kept fairly dim so the bed colour dominates.
  vec3 skyTop  = vec3(0.62, 0.78, 1.0);
  vec3 ref = skyTop * (0.25 + 0.55 * max(0.0, n.y));
  // Mix the reflection toward white at high wave gradients for a
  // glinting feel. Small factor — runaway gradients on wave crests
  // were blowing the whole river out to white before this was tamed.
  float gradient = length(n.xz);
  ref = mix(ref, vec3(1.0), gradient * 0.25);
  // Tint sky reflection slightly by uColor so blue water gets blue
  // sky, green water gets green sky — keeps the look coherent across
  // GM colour choices.
  ref = mix(ref, ref * uColor * 1.2, 0.25);
  ref *= 0.3;

  // Specular highlight from a fixed overhead-side sun. Tilted off
  // vertical so we actually see specs on wave crests (a straight-down
  // sun would just light flat regions). Halved so it reads as a
  // glint, not a flashlight.
  vec3 sun = normalize(vec3(0.4, 1.0, 0.3));
  float spc = pow(max(0.0, dot(reflect(sun, n), viewDir)), 30.0) * 0.5;

  vec3 col = rfa + ref + spc;

  // Normal alpha blend (set on the material) — output non-premultiplied
  // colour with alpha = polygon coverage * intensity. The map texture
  // beneath gets replaced by `col` where alpha is high.
  gl_FragColor = vec4(col, maskAlpha * uIntensity);
}
