// Firestorm — adapted from "GPU hacks #07 - DirectX 12" by
// PrzemyslawZaworski (2019-06-07) — https://www.shadertoy.com/view/wtB3RG
// Used under Shadertoy default licence (CC-BY-NC-SA 3.0). The original
// is a 128-step volumetric raymarch; we reduce to 48 steps with a
// wider step length so the per-pixel cost fits a browser budget.
// Only the GLSL fragment portion was ported — the large block of
// HLSL / DirectX 12 reference code in the original is irrelevant.
//
// Treatment as a MapFX kind: each polygon is a "window onto a
// firestorm vista" — the raymarch fills wherever the GM paints,
// otherwise transparent. Output uses normal alpha so dense smoke
// columns obscure the map beneath; sparser regions let it show
// through. Performance note: this is the heaviest MapFX shader
// available — a polygon covering most of the map will measurably
// dent frame rate on integrated GPUs. Pair with a smaller polygon
// for a "fire pit" reading rather than carpeting the whole battlemap.

uniform sampler2D uMask;
uniform float     time;
uniform float     uAspect;
uniform vec3      uColor;       // per-poly tint — multiplies the fire core
uniform vec3      uSmoke;       // smoke colour (cooler upper region)
uniform float     uIntensity;

varying vec2 vUv;

// Slight camera tilt so columns lean toward the viewer, matching
// the original entry's view direction.
const mat3 rotationMatrix = mat3(
  1.0, 0.0, 0.0,
  0.0, 0.47, -0.88,
  0.0, 0.88, 0.47
);

float hash1(float p) { return fract(sin(p) * 43758.5453); }

float noise3(vec3 x) {
  vec3 p = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n = p.x + p.y * 57.0 + 113.0 * p.z;
  return mix(
    mix(mix(hash1(n +   0.0), hash1(n +   1.0), f.x),
        mix(hash1(n +  57.0), hash1(n +  58.0), f.x), f.y),
    mix(mix(hash1(n + 113.0), hash1(n + 114.0), f.x),
        mix(hash1(n + 170.0), hash1(n + 171.0), f.x), f.y),
    f.z
  );
}

vec4 vol(vec3 p, float t) {
  float d = 0.2 - p.y;
  vec3 q = p - vec3(0.0, 1.0, 0.0) * t;
  float f  = 0.5000  * noise3(q); q = q * 2.02 - vec3(0.0, 1.0, 0.0) * t;
  f += 0.2500  * noise3(q);       q = q * 2.03 - vec3(0.0, 1.0, 0.0) * t;
  f += 0.1250  * noise3(q);       q = q * 2.01 - vec3(0.0, 1.0, 0.0) * t;
  f += 0.0625  * noise3(q);       q = q * 2.02 - vec3(0.0, 1.0, 0.0) * t;
  f += 0.03125 * noise3(q);
  d = clamp(d + 4.5 * f, 0.0, 1.0);
  vec3 col = mix(uColor * 0.9 + vec3(0.1), uSmoke, d) + 0.05 * sin(p);
  return vec4(col, d);
}

void main() {
  float maskAlpha = texture2D(uMask, vUv).a;
  if (maskAlpha < 0.01) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // Map the polygon's UV onto the same camera plane the original
  // entry used. Aspect-correct so a wide rectangular polygon doesn't
  // squash the columns horizontally.
  vec2 ndc = (vUv - 0.5) * 2.0;
  ndc.x *= uAspect;
  vec3 ro = vec3(0.0, 4.9, -40.0);
  vec3 rd = normalize(vec3(ndc, 2.0)) * rotationMatrix;
  float t = time;

  // 48 steps with a wider step (0.13) — see header note. Cutoff at
  // alpha 0.99 lets near-opaque columns terminate the loop early.
  vec4 s = vec4(0.0);
  float step = 0.0;
  for (int i = 0; i < 48; i++) {
    if (s.a > 0.99) break;
    vec3 p = ro + step * rd;
    vec4 k = vol(p, t);
    // Vertical falloff modulates hot core down low to cool smoke up
    // top — the colour grade that sells "fire underneath, smoke
    // above" without two passes.
    k.rgb *= mix(uColor * 3.0, vec3(0.5), clamp((p.y - 0.2) / 2.0, 0.0, 1.0));
    k.a *= 0.5;
    k.rgb *= k.a;
    s = s + k * (1.0 - s.a);
    step += 0.13;
  }
  vec3 col = clamp(s.xyz, 0.0, 1.0);
  // Smoothstep finish — pushes mids slightly so the volume reads
  // saturated rather than washed out.
  col = col * 0.5 + 0.5 * col * col * (3.0 - 2.0 * col);
  col *= uIntensity;

  // Normal blend with the alpha controlled by the accumulated
  // raymarch opacity; lets sparse smoke regions show the map
  // through and dense columns obscure it.
  float alpha = s.a * maskAlpha;
  gl_FragColor = vec4(col, alpha);
}
