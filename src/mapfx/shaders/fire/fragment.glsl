// Fire — adapted from "Promethean" by nimitz (twitter @stormoid)
//   https://www.shadertoy.com/view/4tB3zV
//   Licensed CC BY-NC-SA 3.0 — see ACKNOWLEDGEMENTS.md.
//
// Adaptation notes:
//   • iTime / iResolution / iChannel0 / iMouse → our standard uniforms.
//   • Mouse-controlled camera replaced with a slow auto-rotation so the
//     fire keeps moving without user input.
//   • Per-polygon plane: each shader-driven polygon owns a plane sized to
//     its bbox; the orb sits at vUv (0.5, 0.5) which now corresponds to
//     the polygon's bbox centre on the map. uMask is the per-polygon
//     alpha mask in bbox-local UV (no offset/scale needed).
//   • uAspect: plane width / height in world units. Used in place of
//     resolution.x/resolution.y so the orb projection doesn't squash on
//     non-square polygons.
//   • uColor (vec3): the polygon's chosen tint, passed as a uniform
//     rather than encoded in the mask. Red fire by default, blue
//     soulfire, etc.
//   • uIntensity (0.05..1.5): output multiplier — full glow down to
//     barely-there ember haze.
//   • uScale (~0.25..4): pre-scales the procedural volume so flame
//     features can be tuned to roughly match the polygon size on the
//     map.

uniform sampler2D uMask;       // per-polygon alpha mask, plane-local
uniform sampler2D uNoise;      // grayscale noise texture, repeat-wrapped
uniform float     time;
uniform float     uAspect;     // plane width / height in world units
uniform vec3      uColor;      // polygon tint colour
uniform float     uIntensity;  // 0.05..1.5 — output multiplier
uniform float     uScale;      // 0.25..4   — procedural feature scale

varying vec2 vUv;

#define STEPS 60
#define ALPHA_WEIGHT 0.033
#define BASE_STEP 0.083

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
  // Mild warm shaping so highlights still feel flame-like before the
  // polygon tint multiplies in.
  col.rgb *= grd * vec3(0.9, 1.0, 0.65) + vec3(0.05, 0.1, 0.0);
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
  // Hot inner glow — warm bias so the natural fire base colour reads
  // even before uColor multiplies in.
  rz.rgb += vec3(1.2, 0.2, 0.0) * rz.w;
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

  // Plane-local screen coords in [-1, 1], aspect-corrected by the plane's
  // own aspect (not the screen aspect) so the orb doesn't squash on a
  // tall narrow polygon. Then divide by uScale so the GM can tune the
  // apparent feature size on the polygon.
  vec2 p = vUv * 2.0 - 1.0;
  p.x *= uAspect * 0.95;
  p /= max(uScale, 0.01);

  vec3 ro  = 4.0 * normalize(vec3(cos(2.75 - 3.0 * mo.x), sin(time * 0.22) * 0.2, sin(2.75 - 3.0 * mo.x)));
  vec3 eye = normalize(vec3(0) - ro);
  vec3 rgt = normalize(cross(vec3(0, 1, 0), eye));
  vec3 up  = cross(eye, rgt);
  vec3 rd  = normalize(p.x * rgt + p.y * up + 2.3 * eye);

  vec4 col = vmarch(ro, rd);

  // Tint by polygon colour. Multiplicative recolour preserves the
  // fire's internal contrast (bright centre, dimmer edges) while
  // shifting the hue to whatever the GM picked.
  col.rgb *= uColor;

  // Mask cuts the orb down to the polygon's actual shape inside the
  // bbox; uIntensity scales the whole thing 0..1.5. RGB stays
  // pre-multiplied so the additive blend reads as glowing fire of the
  // chosen hue.
  gl_FragColor = vec4(
    col.rgb * maskAlpha * uIntensity,
    maskAlpha * min(1.0, col.a + 0.2) * uIntensity
  );
}
