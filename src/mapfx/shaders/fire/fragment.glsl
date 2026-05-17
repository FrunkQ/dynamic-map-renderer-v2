// Coloured Flames — adapted from "Promethean" by nimitz (@stormoid).
// Used under CC BY-NC-SA 3.0 — see ACKNOWLEDGEMENTS.md. One source
// for MapFX (polygon-masked fire orb) and Backdrop (volumetric
// flames in the bars). uNoise sampler is the shared grayscale
// noise texture (mapfx/shaders/fire/noise.png) — wired into both
// subsystems via the shaderRegistry texture pool.

// === BEGIN backdrop-shareable ===
uniform sampler2D uNoise;
uniform float     time;
uniform float     uAspect;
uniform vec3      uColor;
uniform float     uIntensity;
uniform float     uScale;

#define _FIRE_STEPS 60
#define _FIRE_ALPHA_WEIGHT 0.033
#define _FIRE_BASE_STEP 0.083

vec2 _fire_rot(in vec2 p, in float a) {
  float c = cos(a), s = sin(a);
  return p * mat2(c, s, -s, c);
}

float _fire_hash21(in vec2 n) {
  return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);
}

float _fire_noise(in vec3 p) {
  vec3 ip = floor(p), fp = fract(p);
  fp = fp * fp * (3.0 - 2.0 * fp);
  vec2 tap = (ip.xy + vec2(37.0, 17.0) * ip.z) + fp.xy;
  vec2 rz = texture2D(uNoise, (tap + 0.5) / 256.0).yx;
  return mix(rz.x, rz.y, fp.z);
}

// mo.y was constant in the original (0.6) — fbm only ever read
// mo.y * 2.0 → 1.2. Inlining lets us drop the global var so fxEffect
// is the only entry point.
float _fire_fbm(in vec3 p) {
  p *= 3.7;
  float rz = 0.0, z = 1.0;
  for (int i = 0; i < 4; i++) {
    float n = _fire_noise(p + time * 0.5);
    rz += (sin(n * 4.3) * 1.0 - 0.45) * z;
    z  *= 0.47;
    p  *= 3.0;
  }
  return rz;
}

float _fire_dsph(in vec3 p) {
  float r = dot(p, p);
  vec2 sph = vec2(acos(p.y / r), atan(p.x, p.z));
  r += sin(sph.y * 2.0 + sin(sph.x * 2.0) * 5.0) * 0.8;
  return r;
}

vec4 _fire_mapVol(in vec3 p) {
  float dtp = _fire_dsph(p);
  p = 0.7 * p / (dtp + 0.1);
  p.xz = _fire_rot(p.xz, p.y * 2.0);
  p = 6.0 * p / (dtp - 5.4);
  p = 7.0 * p / (dtp + 6.0);
  float r = clamp(_fire_fbm(p) * 1.5 - exp2(dtp * 0.7 - 2.75), 0.0, 1.0);
  vec4 col = vec4(1.0) * r;
  vec3 lv = mix(p, vec3(0.25), 1.25);
  float grd = clamp((col.w - _fire_fbm(p + lv * 0.045)) * 4.5, 0.01, 2.0);
  col.rgb *= grd * vec3(0.9, 1.0, 0.65) + vec3(0.05, 0.1, 0.0);
  col.a   *= clamp(dtp * 0.5 - 0.14, 0.0, 1.0) * 0.7 + 0.3;
  return col;
}

vec4 _fire_vmarch(in vec3 ro, in vec3 rd) {
  vec4 rz = vec4(0);
  float t = 2.4;
  t += 0.03 * _fire_hash21(gl_FragCoord.xy);
  for (int i = 0; i < _FIRE_STEPS; i++) {
    if (rz.a > 0.99 || t > 6.0) break;
    vec3 pos = ro + t * rd;
    vec4 col = _fire_mapVol(pos);
    float den = col.a;
    col.a *= _FIRE_ALPHA_WEIGHT;
    col.rgb *= col.a * 1.4;
    rz = rz + col * (1.0 - rz.a);
    t  += _FIRE_BASE_STEP - den * _FIRE_BASE_STEP;
  }
  // Hot inner glow — warm bias so the natural fire colour reads even
  // before uColor multiplies in.
  rz.rgb += vec3(1.2, 0.2, 0.0) * rz.w;
  return rz;
}

vec4 fxEffect(vec2 uv) {
  // Region-local screen coords in [-1, 1], aspect-corrected so the
  // orb doesn't squash on a tall narrow region. uScale tunes the
  // apparent feature size.
  vec2 p = uv * 2.0 - 1.0;
  p.x *= uAspect * 0.95;
  p /= max(uScale, 0.01);

  // Camera position: slow auto-rotation around the orb. The
  // original sampled mo.x = 0.5 + time * 0.01 from a global; we
  // inline here so the function is the single entry point.
  float mox = 0.5 + time * 0.01;
  vec3 ro  = 4.0 * normalize(vec3(cos(2.75 - 3.0 * mox), sin(time * 0.22) * 0.2, sin(2.75 - 3.0 * mox)));
  vec3 eye = normalize(vec3(0) - ro);
  vec3 rgt = normalize(cross(vec3(0, 1, 0), eye));
  vec3 up  = cross(eye, rgt);
  vec3 rd  = normalize(p.x * rgt + p.y * up + 2.3 * eye);

  vec4 col = _fire_vmarch(ro, rd);
  // Tint by polygon / backdrop colour. Multiplicative recolour
  // preserves the fire's internal contrast while shifting hue.
  col.rgb *= uColor;
  return vec4(col.rgb * uIntensity, min(1.0, col.a + 0.2) * uIntensity);
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
  // Additive blend on the material; pre-multiplied colour + per-
  // polygon coverage alpha gives the glowing-fire reading.
  gl_FragColor = vec4(c.rgb * maskAlpha, maskAlpha * c.a);
}
