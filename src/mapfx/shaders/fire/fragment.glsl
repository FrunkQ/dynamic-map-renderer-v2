// Fire — adapted from "Promethean" by nimitz (twitter @stormoid)
//   https://www.shadertoy.com/view/4tB3zV
//   Licensed CC BY-NC-SA 3.0 — see ACKNOWLEDGEMENTS.md.
//
// Adaptation notes:
//   • iTime / iResolution / iChannel0 / iMouse → our standard uniforms.
//   • Mouse-controlled camera replaced with a slow auto-rotation so the
//     fire keeps moving without user input. The orb sits at world origin
//     and the camera arcs gently around it.
//   • Final colour multiplied by the kind mask alpha — fire only renders
//     inside the user's painted polygons.
//   • Premultiplied-style output: rgb already weighted by alpha so the
//     additive blend over the map reads as glowing fire, not opaque colour.

uniform sampler2D uMask;       // kind mask (white where any fire polygon is)
uniform sampler2D uNoise;      // grayscale noise texture, repeat-wrapped
uniform vec2      resolution;
uniform float     time;

varying vec2 vUv;

#define STEPS 60
#define ALPHA_WEIGHT 0.033
#define BASE_STEP 0.083
#define PALETTE vec3(1.2, 0.0, 0.0)

vec2 mo;

vec2 rot(in vec2 p, in float a) {
  float c = cos(a), s = sin(a);
  return p * mat2(c, s, -s, c);
}

float hash21(in vec2 n) {
  return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);
}

float noise(in vec3 p) {
  vec3 ip = floor(p), fp = fract(p);
  fp = fp * fp * (3.0 - 2.0 * fp);
  vec2 tap = (ip.xy + vec2(37.0, 17.0) * ip.z) + fp.xy;
  vec2 rz = texture2D(uNoise, (tap + 0.5) / 256.0).yx;
  return mix(rz.x, rz.y, fp.z);
}

float fbm(in vec3 p) {
  p *= 2.5 + mo.y * 2.0;
  float rz = 0.0, z = 1.0;
  for (int i = 0; i < 4; i++) {
    float n = noise(p + time * 0.5);
    rz += (sin(n * 4.3) * 1.0 - 0.45) * z;
    z  *= 0.47;
    p  *= 3.0;
  }
  return rz;
}

float dsph(in vec3 p) {
  float r = dot(p, p);
  vec2 sph = vec2(acos(p.y / r), atan(p.x, p.z));
  r += sin(sph.y * 2.0 + sin(sph.x * 2.0) * 5.0) * 0.8;
  return r;
}

vec4 mapVol(in vec3 p) {
  float dtp = dsph(p);
  p = 0.7 * p / (dtp + 0.1);
  p.xz = rot(p.xz, p.y * 2.0);
  p = 6.0 * p / (dtp - 5.4);
  p = 7.0 * p / (dtp + 6.0);
  float r = clamp(fbm(p) * 1.5 - exp2(dtp * 0.7 - 2.75), 0.0, 1.0);
  vec4 col = vec4(1.0) * r;
  vec3 lv = mix(p, vec3(0.25), 1.25);
  float grd = clamp((col.w - fbm(p + lv * 0.045)) * 4.5, 0.01, 2.0);
  col.rgb *= grd * vec3(0.9, 1.0, 0.43) + vec3(0.05, 0.1, 0.0);
  col.a   *= clamp(dtp * 0.5 - 0.14, 0.0, 1.0) * 0.7 + 0.3;
  return col;
}

vec4 vmarch(in vec3 ro, in vec3 rd) {
  vec4 rz = vec4(0);
  float t = 2.4;
  t += 0.03 * hash21(gl_FragCoord.xy);
  for (int i = 0; i < STEPS; i++) {
    if (rz.a > 0.99 || t > 6.0) break;
    vec3 pos = ro + t * rd;
    vec4 col = mapVol(pos);
    float den = col.a;
    col.a *= ALPHA_WEIGHT;
    col.rgb *= col.a * 1.4;
    rz = rz + col * (1.0 - rz.a);
    t  += BASE_STEP - den * BASE_STEP;
  }
  rz.rgb += PALETTE * rz.w;
  return rz;
}

void main() {
  float maskAlpha = texture2D(uMask, vUv).r;
  if (maskAlpha < 0.01) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // Slow auto-rotation around the orb — replaces nimitz's iMouse input.
  mo = vec2(0.5 + time * 0.01, 0.6);

  // Aspect-corrected screen UV mapped to [-1, 1] like the original.
  vec2 p = vUv * 2.0 - 1.0;
  p.x *= resolution.x / resolution.y * 0.95;

  vec3 ro  = 4.0 * normalize(vec3(cos(2.75 - 3.0 * mo.x), sin(time * 0.22) * 0.2, sin(2.75 - 3.0 * mo.x)));
  vec3 eye = normalize(vec3(0) - ro);
  vec3 rgt = normalize(cross(vec3(0, 1, 0), eye));
  vec3 up  = cross(eye, rgt);
  vec3 rd  = normalize(p.x * rgt + p.y * up + 2.3 * eye);

  vec4 col = vmarch(ro, rd);
  // Mask cuts the orb down to just where fire polygons exist. RGB already
  // pre-multiplied by alpha inside vmarch; multiply by the mask so the
  // edges of painted polygons fade off cleanly.
  gl_FragColor = vec4(col.rgb * maskAlpha, maskAlpha * min(1.0, col.a + 0.2));
}
