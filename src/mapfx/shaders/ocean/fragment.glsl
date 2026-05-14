// Ocean — adapted from afl_ext 2017-2024 (MIT licence)
//   https://www.shadertoy.com/ -- see ACKNOWLEDGEMENTS.md
//
// Adaptation notes:
//   • Original is a 3D scene with mouse-rotated camera, ray-marched
//     water plane, procedural sky + sun, ACES tone-mapping. Self-
//     contained — no external textures.
//   • Top-down adaptation: each shader plane pixel maps directly to a
//     point on the water surface via vUv. No raymarch needed; we sample
//     the wave height + normal directly at that point.
//   • Sky / sun / atmosphere logic kept — the reflection ray off the
//     wave normal samples a procedural sky that matches the original
//     look. Sun direction animates slowly with time so the glints
//     migrate, same as the original.
//   • ACES tone-mapping kept, but the final pow(.., 1/2.2) sRGB
//     encoding step is removed — our EffectComposer OutputPass does
//     sRGB encoding for the whole scene and keeping it here would
//     double-encode.
//   • Per-poly uniforms: uColor (gentle hue tint), uIntensity (output
//     multiplier), uScale (wave feature size — supports painting a
//     small puddle through to a horizon-spanning ocean), uSpeed
//     (animation rate, 0 = mirror-still through 4 = stormy).
//   • Iteration count dropped from the original's 36 to 16 in the
//     wave-sum loop — top-down at altitude doesn't need micro-detail
//     and the perf cost otherwise scales with polygon area. 16 still
//     gives layered, complex-looking swells.

uniform sampler2D uMask;
uniform float     time;
uniform float     uAspect;
uniform vec3      uColor;
uniform float     uIntensity;
uniform float     uScale;
uniform float     uSpeed;
uniform float     uWaveHeight; // 0 = mirror calm, 1 = default, 2 = stormy

varying vec2 vUv;

#define DRAG_MULT 0.38
#define WATER_DEPTH 1.0
// Octave count for the wave sum. Each iteration adds another wave
// direction; higher counts hide the underlying directional regularity
// at extreme zoom-out (uScale near 0.02). 20 is the trade-off between
// "smooth, varied surface" and per-pixel cost (each normal calc runs
// the wave sum 3 times). Original Shadertoy used 36 for a static
// close-up; we don't need that much.
#define ITERATIONS_NORMAL 20

// Single wave sample + derivative at the given position along the
// given direction at given frequency, time-shifted.
vec2 wavedx(vec2 position, vec2 direction, float frequency, float timeshift) {
  float x = dot(direction, position) * frequency + timeshift;
  float wave = exp(sin(x) - 1.0);
  float dx = wave * cos(x);
  return vec2(wave, -dx);
}

// Sum of wave octaves to produce a complex water surface height.
// Direction of each octave is procedurally varied so the result
// doesn't have a single repeating pattern. Each octave's frequency,
// weight, and time-multiplier shift independently.
float getwaves(vec2 position) {
  float wavePhaseShift = length(position) * 0.1;
  float iter = 0.0;
  float frequency = 1.0;
  float timeMultiplier = 2.0;
  float weight = 1.0;
  float sumOfValues = 0.0;
  float sumOfWeights = 0.0;
  for (int i = 0; i < ITERATIONS_NORMAL; i++) {
    vec2 p = vec2(sin(iter), cos(iter));
    vec2 res = wavedx(position, p, frequency, time * uSpeed * timeMultiplier + wavePhaseShift);
    position += p * res.y * weight * DRAG_MULT;
    sumOfValues  += res.x * weight;
    sumOfWeights += weight;
    weight = mix(weight, 0.0, 0.2);
    frequency *= 1.18;
    timeMultiplier *= 1.07;
    iter += 1232.399963;
  }
  return sumOfValues / sumOfWeights;
}

// Surface normal at pos via cross-product of two finite-difference
// height vectors. Same shape as afl_ext's original.
vec3 normal(vec2 pos, float e, float depth) {
  vec2 ex = vec2(e, 0.0);
  float H = getwaves(pos.xy) * depth;
  vec3 a = vec3(pos.x, H, pos.y);
  return normalize(
    cross(
      a - vec3(pos.x - e, getwaves(pos.xy - ex.xy) * depth, pos.y),
      a - vec3(pos.x, getwaves(pos.xy + ex.yx) * depth, pos.y + e)
    )
  );
}

// Procedural atmosphere — fakes sky scattering for a given view +
// sun direction. Cheap and looks plausibly like daytime sky.
vec3 extra_cheap_atmosphere(vec3 raydir, vec3 sundir) {
  float special_trick  = 1.0 / (raydir.y * 1.0 + 0.1);
  float special_trick2 = 1.0 / (sundir.y * 11.0 + 1.0);
  float raysundt = pow(abs(dot(sundir, raydir)), 2.0);
  vec3 suncolor = mix(vec3(1.0), max(vec3(0.0), vec3(1.0) - vec3(5.5, 13.0, 22.4) / 22.4), special_trick2);
  vec3 bluesky  = vec3(5.5, 13.0, 22.4) / 22.4 * suncolor;
  vec3 bluesky2 = max(vec3(0.0), bluesky - vec3(5.5, 13.0, 22.4) * 0.002 * (special_trick + -6.0 * sundir.y * sundir.y));
  bluesky2 *= special_trick * (0.24 + raysundt * 0.24);
  return bluesky2 * (1.0 + 1.0 * pow(1.0 - raydir.y, 3.0));
}

// Sun direction — locked to a fixed midday angle. afl_ext's original
// arced the sun across the sky over ~31 seconds via `sin(time * 0.2)`;
// that was a nice flourish for a static demo but in a battlemap
// context it makes the ocean appear to cycle through rough / calm
// phases as the lighting changes. Locking the sun keeps the ambience
// constant — wave roughness now comes from uWaveHeight alone, fully
// under GM control.
vec3 getSunDirection() {
  return normalize(vec3(-0.08, 0.62, 0.58));
}

vec3 getAtmosphere(vec3 dir) {
  return extra_cheap_atmosphere(dir, getSunDirection()) * 0.5;
}

// Tight sun glint — pow(720) gives a small, intense disk.
float getSun(vec3 dir) {
  return pow(max(0.0, dot(dir, getSunDirection())), 720.0) * 210.0;
}

// ACES filmic tone-map matrix. Same as afl_ext's; produces an HDR-to-
// LDR mapping that keeps highlights from blowing out. The original
// finishes with pow(.., 1/2.2) for sRGB encoding; we skip that step
// because our render pipeline's OutputPass does sRGB encoding for
// the whole composited scene.
vec3 aces_tonemap(vec3 color) {
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

void main() {
  float maskAlpha = texture2D(uMask, vUv).r;
  if (maskAlpha < 0.01) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // Wave-space position. 8.0 is the base unit-count across the
  // polygon at uScale=1; uScale tunes feature density:
  //   • uScale 0.25 → ~32 wavelets across a polygon (fine ripples,
  //     reads as ocean texture on a huge polygon).
  //   • uScale 4    → ~2 wavelets across (lazy swells, reads as
  //     proper deep-ocean on a small or medium polygon).
  vec2 pos = (vUv - 0.5) * (8.0 / max(uScale, 0.01));

  // Wave height multiplies the depth-scale used inside the normal
  // calculation — uWaveHeight = 0 yields a perfectly flat surface
  // (mirror reflection), 1 is the default look, 2 exaggerates wave
  // peaks for a stormy sea. Independent of uScale so the GM can keep
  // wave size fixed while changing how rough the ocean feels.
  vec3 N = normal(pos, 0.01, WATER_DEPTH * uWaveHeight);

  // Top-down view with a slight tilt so sun glints actually catch on
  // wave crests. A perfectly straight-down ray would give a fixed
  // reflection direction and no specular variance across the surface.
  vec3 ray = normalize(vec3(0.05, -1.0, 0.05));

  // Fresnel: how much we see reflection (sky) vs body of water
  // (subsurface scatter).
  float fresnel = 0.04 + 0.96 * pow(1.0 - max(0.0, dot(-N, ray)), 5.0);

  // Reflect view direction off the surface, force the reflected ray
  // to bounce up (so we always sample the sky, not back down).
  vec3 R = normalize(reflect(ray, N));
  R.y = abs(R.y);

  // Sky + sun reflection. Stays natural (sky-blue) regardless of
  // uColor — even a blood-red ocean reflects the real sky.
  vec3 reflection = getAtmosphere(R) + getSun(R);

  // Subsurface scattering — the body colour of the water. Originally
  // afl_ext hardcoded a deep blue here (`vec3(0.0293, 0.0698, 0.1717)
  // * 0.3`); we replace that with uColor so the GM's pick *is* the
  // water body. Blood-red, void-purple, toxic-green, etc. all read
  // properly. White uColor gives a neutral grey body that the sky
  // reflection turns blue — closest to the unmodified afl_ext look.
  vec3 scattering = uColor * 0.2;

  vec3 C = fresnel * reflection + scattering;
  vec3 finalCol = aces_tonemap(C * 2.0);

  // Normal alpha blend on the material — opaque-ish ocean surface.
  gl_FragColor = vec4(finalCol, maskAlpha * uIntensity);
}
