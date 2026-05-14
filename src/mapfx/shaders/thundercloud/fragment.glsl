// Thundercloud — adapted from "thundercloud" by mahalis (2019-11-02)
//   https://www.shadertoy.com/view/3dcXWS
//   Used under CC BY-NC 4.0 (https://creativecommons.org/licenses/by-nc/4.0/)
//   See ACKNOWLEDGEMENTS.md.
//
// The 3D noise primitive credits inigo quilez (MIT) at
//   https://www.shadertoy.com/view/Xsl3Dl
// The hash11 / hash31 helpers credit David Hoskins (CC BY-SA 4.0) at
//   https://www.shadertoy.com/view/4djSRW
// Both kept intact.
//
// Adaptation notes:
//
//   The original is a fully 3D volumetric ray-march through a sphere
//   of dense noise, lit by a directional sun + a randomly-positioned
//   inner point light that flashes briefly (the lightning). For a
//   top-down battlemap polygon we don't need the sphere: the polygon
//   mask defines the cloud's footprint and we render the "inside the
//   cloud" view directly per pixel. That's much cheaper than the
//   ray-march and lets the cloud follow any shape the GM paints
//   instead of forcing a circle.
//
//   • iTime → time; iResolution → uAspect.
//   • Camera + sphere intersection + main ray-march all dropped.
//   • Density: 2D-position + scrolling z = animated noise. Smoothstep
//     gives a "cloud body vs gaps in the cloud" feel.
//   • Lightning: mahalis's per-cycle random flash kept (80% of cycles
//     empty, the rest a sin-enveloped flash at a random 3D point).
//     2D distance from each pixel to the flash position modulates the
//     brightness; the cloud density at the pixel further attenuates
//     the flash, so lightning lights the cloud particles in its
//     neighbourhood rather than the empty air around them.
//   • Tint by uColor: cloud body + flash both multiplied. Default
//     stormy blue-grey in the registry; white swatch gives near-
//     original moody look. Magical-green / blood-red / sci-fi-amber
//     all work by changing the swatch.
//   • Output uses normal alpha blending — a real thundercloud
//     obscures what's beneath, modulated by per-pixel density.
//
//   Per-poly sliders:
//     • Intensity — output multiplier.
//     • Scale     — cloud feature size (bigger = lazier swells).
//     • Speed     — noise drift + flash cadence rate.
//     • Lightning — flash brightness (0 disables; >1 = magical storm).

uniform sampler2D uMask;
uniform float     time;
uniform float     uAspect;
uniform vec3      uColor;
uniform float     uIntensity;
uniform float     uScale;
uniform float     uSpeed;
uniform float     uLightning;

varying vec2 vUv;

// 3D noise by iq, MIT
vec3 hash(vec3 p) {
  p = vec3(
    dot(p, vec3(127.1, 311.7,  74.7)),
    dot(p, vec3(269.5, 183.3, 246.1)),
    dot(p, vec3(113.5, 271.9, 124.6))
  );
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float noise(in vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(
      mix(dot(hash(i + vec3(0.0, 0.0, 0.0)), f - vec3(0.0, 0.0, 0.0)),
          dot(hash(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0)), u.x),
      mix(dot(hash(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0)),
          dot(hash(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0)), u.x),
      u.y
    ),
    mix(
      mix(dot(hash(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0)),
          dot(hash(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0)), u.x),
      mix(dot(hash(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0)),
          dot(hash(i + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0)), u.x),
      u.y
    ),
    u.z
  );
}

// hash helpers by David Hoskins, CC BY-SA 4.0
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

vec3 hash31(float p) {
  vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}

// Two-octave noise — same recipe as mahalis's, with the time signal
// driven by our uSpeed-scaled clock so flashes + drift speed together.
float octavedNoise(vec3 position) {
  float clock = time * uSpeed;
  vec3 samplePosition = position * 2.0;
  float noiseAmount = noise(samplePosition + clock * vec3(0.0, 0.2, 0.0));
  samplePosition *= 1.99;
  noiseAmount += noise(samplePosition + clock * vec3(0.05, -0.37, 0.02)) * 0.51;
  noiseAmount /= 1.51;
  return noiseAmount;
}

// Random lightning flash. Returns vec4(xyz position, intensity).
// Intensity = 0 means no flash this moment. Adapted directly from
// mahalis's logic.
vec4 lightningFlash() {
  float scaledTime = time * uSpeed * 6.1;
  float hashInput  = floor(scaledTime) * 0.1;
  if (hash11(hashInput) < 0.8) return vec4(0.0); // 80% of cycles silent

  vec3  h = hash31(hashInput);
  float theta = h.x * 6.283;
  float z = h.y * 2.0 - 1.0;
  float sinPhi = sin(acos(z));
  vec3 pos = vec3(sinPhi * cos(theta), sinPhi * sin(theta), z) * (0.6 + h.z * 0.2);
  float intensity = sin(fract(scaledTime) * 3.142);
  return vec4(pos, intensity);
}

void main() {
  float maskAlpha = texture2D(uMask, vUv).r;
  if (maskAlpha < 0.01) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // Polygon-local position: centred, aspect-corrected, uScale tunes
  // cloud feature size. 2.0 is the base "two unit-cells across the
  // polygon at scale 1".
  vec2 p = (vUv - 0.5) * (2.0 / max(uScale, 0.01));
  p.x *= uAspect;

  // Sample density using 3D noise — z drifts with time so the cloud
  // evolves rather than freezing.
  vec3 npos = vec3(p, time * uSpeed * 0.15);
  float n = octavedNoise(npos);
  // Density: smoothstep gives soft cloud-body vs gap regions. The
  // -0.2..0.5 range was tuned by eye against the noise output.
  float dens = smoothstep(-0.2, 0.5, n);

  // Cloud body colour — tinted by uColor. The 0.45 multiplier keeps
  // it darker than the flash so lightning is visibly brighter when
  // it strikes.
  vec3 bodyColor = uColor * 0.45 * dens;

  // Lightning. The flash has a 3D position; we compute a 2D distance
  // (ignoring the flash's z) plus a depth penalty so deeper flashes
  // are dimmer. Density at this pixel attenuates further — empty air
  // doesn't light up.
  vec4 flash = lightningFlash();
  float flashAmt = 0.0;
  if (flash.w > 0.0) {
    float distPlane = length(p - flash.xy);
    float depthPenalty = 1.0 / (1.0 + abs(flash.z) * 2.0);
    flashAmt = flash.w * depthPenalty / (distPlane * distPlane * 1.8 + 0.04);
    flashAmt *= dens * uLightning;
  }
  // Flash colour: brighter, slightly cooled toward white so the
  // contrast against the (potentially saturated) body colour reads
  // as "intense light through cloud".
  vec3 flashColor = mix(vec3(1.0), uColor, 0.6) * flashAmt;

  vec3 col = (bodyColor + flashColor) * uIntensity;

  // Density-driven alpha — wisps fade out, body obscures the map.
  float alpha = clamp(dens * 1.1, 0.0, 1.0) * maskAlpha;

  // Normal-blend on the material (set in the registry / renderer);
  // output non-premultiplied colour with the per-pixel cloud alpha.
  gl_FragColor = vec4(col, alpha);
}
