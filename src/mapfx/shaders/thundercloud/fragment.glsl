// Thundercloud — adapted from "thundercloud" by mahalis (2019).
// Used under CC BY-NC 4.0 — see ACKNOWLEDGEMENTS.md. The 3D noise
// primitive credits inigo quilez (MIT); hash helpers credit David
// Hoskins (CC BY-SA 4.0). One source for MapFX (polygon-masked
// storm patch) and Backdrop (storm filling the bars).

// === BEGIN backdrop-shareable ===
uniform float time;
uniform float uAspect;
uniform vec3  uColor;       // lightning hue (cloud body is fixed slate)
uniform float uIntensity;
uniform float uScale;
uniform float uSpeed;
uniform float uLightning;

vec3 _tc_hash3(vec3 p) {
  p = vec3(
    dot(p, vec3(127.1, 311.7,  74.7)),
    dot(p, vec3(269.5, 183.3, 246.1)),
    dot(p, vec3(113.5, 271.9, 124.6))
  );
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float _tc_noise(in vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(
      mix(dot(_tc_hash3(i + vec3(0.0, 0.0, 0.0)), f - vec3(0.0, 0.0, 0.0)),
          dot(_tc_hash3(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0)), u.x),
      mix(dot(_tc_hash3(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0)),
          dot(_tc_hash3(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0)), u.x),
      u.y
    ),
    mix(
      mix(dot(_tc_hash3(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0)),
          dot(_tc_hash3(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0)), u.x),
      mix(dot(_tc_hash3(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0)),
          dot(_tc_hash3(i + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0)), u.x),
      u.y
    ),
    u.z
  );
}

float _tc_hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

vec3 _tc_hash31(float p) {
  vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}

float _tc_octaved(vec3 position) {
  float clock = time * uSpeed;
  vec3 samplePosition = position * 2.0;
  float noiseAmount = _tc_noise(samplePosition + clock * vec3(0.0, 0.2, 0.0));
  samplePosition *= 1.99;
  noiseAmount += _tc_noise(samplePosition + clock * vec3(0.05, -0.37, 0.02)) * 0.51;
  noiseAmount /= 1.51;
  return noiseAmount;
}

vec4 _tc_lightning() {
  float scaledTime = time * uSpeed * 6.1;
  float hashInput  = floor(scaledTime) * 0.1;
  if (_tc_hash11(hashInput) < 0.8) return vec4(0.0);
  vec3  h = _tc_hash31(hashInput);
  float theta = h.x * 6.283;
  float z = h.y * 2.0 - 1.0;
  float sinPhi = sin(acos(z));
  vec3 pos = vec3(sinPhi * cos(theta), sinPhi * sin(theta), z) * (0.6 + h.z * 0.2);
  float intensity = sin(fract(scaledTime) * 3.142);
  return vec4(pos, intensity);
}

vec4 fxEffect(vec2 uv) {
  // Polygon-/canvas-local position. uScale tunes cloud feature size.
  vec2 p = (uv - 0.5) * (2.0 / max(uScale, 0.01));
  p.x *= uAspect;

  vec3 npos = vec3(p, time * uSpeed * 0.15);
  float n = _tc_octaved(npos);
  float dens = smoothstep(-0.2, 0.5, n);

  // Cloud body — fixed cool slate grey for consistent storm look.
  const vec3 CLOUD_BODY = vec3(0.40, 0.42, 0.48);
  vec3 bodyColor = CLOUD_BODY * dens;

  // Lightning — flash position + intensity per cycle.
  vec4 flash = _tc_lightning();
  float flashAmt = 0.0;
  if (flash.w > 0.0) {
    float distPlane = length(p - flash.xy);
    float depthPenalty = 1.0 / (1.0 + abs(flash.z) * 2.0);
    flashAmt = flash.w * depthPenalty / (distPlane * distPlane * 1.8 + 0.04);
    flashAmt *= dens * uLightning;
  }
  // uColor drives the flash hue; small white mix so the brightest
  // bits read as overexposed (which lightning reliably does).
  vec3 flashColor = mix(uColor, vec3(1.0), 0.25) * flashAmt;

  vec3 col = (bodyColor + flashColor) * uIntensity;
  float alpha = clamp(dens * 1.1, 0.0, 1.0);
  return vec4(col, alpha);
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
  // Normal-blend on the material; polygon coverage gates the alpha
  // at the polygon edges.
  gl_FragColor = vec4(c.rgb, c.a * maskAlpha);
}
