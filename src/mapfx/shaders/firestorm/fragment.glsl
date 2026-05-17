// Firestorm — adapted from "GPU hacks #07 - DirectX 12" by
// PrzemyslawZaworski (2019). Used under CC-BY-NC-SA 3.0 — see
// ACKNOWLEDGEMENTS.md. The original is a 128-step volumetric
// raymarch; we reduce to 48 steps with a wider step length so the
// per-pixel cost fits a browser budget. Only the GLSL portion was
// ported — the surrounding HLSL/D3D12 scaffolding is irrelevant.
//
// One source for MapFX (polygon-masked, "fire pit on the map") and
// Backdrop (volumetric fire in the bars). Performance: this is the
// heaviest shader in the registry; a polygon carpeting most of the
// canvas will dent frame rate on integrated GPUs.

// === BEGIN backdrop-shareable ===
uniform float time;
uniform float uAspect;
uniform vec3  uColor;       // fire core tint
uniform vec3  uSmoke;       // cooler smoke colour (upper region)
uniform float uIntensity;
uniform float uSpeed;       // animation rate; 1.0 = original pace
uniform float uScale;       // column density / intensity multiplier; >1 = more aggressive
                            //   structure, denser smoke, taller flames. 1.0 = original
                            //   look; 3.0 = inferno.

// Slight camera tilt so columns lean toward the viewer, matching
// the original entry's view direction.
const mat3 _fs_rot = mat3(
  1.0, 0.0, 0.0,
  0.0, 0.47, -0.88,
  0.0, 0.88, 0.47
);

float _fs_hash1(float p) { return fract(sin(p) * 43758.5453); }

float _fs_noise3(vec3 x) {
  vec3 p = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n = p.x + p.y * 57.0 + 113.0 * p.z;
  return mix(
    mix(mix(_fs_hash1(n +   0.0), _fs_hash1(n +   1.0), f.x),
        mix(_fs_hash1(n +  57.0), _fs_hash1(n +  58.0), f.x), f.y),
    mix(mix(_fs_hash1(n + 113.0), _fs_hash1(n + 114.0), f.x),
        mix(_fs_hash1(n + 170.0), _fs_hash1(n + 171.0), f.x), f.y),
    f.z
  );
}

vec4 _fs_vol(vec3 p, float t) {
  float d = 0.2 - p.y;
  vec3 q = p - vec3(0.0, 1.0, 0.0) * t;
  float f  = 0.5000  * _fs_noise3(q); q = q * 2.02 - vec3(0.0, 1.0, 0.0) * t;
  f += 0.2500  * _fs_noise3(q);       q = q * 2.03 - vec3(0.0, 1.0, 0.0) * t;
  f += 0.1250  * _fs_noise3(q);       q = q * 2.01 - vec3(0.0, 1.0, 0.0) * t;
  f += 0.0625  * _fs_noise3(q);       q = q * 2.02 - vec3(0.0, 1.0, 0.0) * t;
  f += 0.03125 * _fs_noise3(q);
  // uScale amplifies the noise-driven column structure. 1.0 = the
  // original 4.5 multiplier; 3.0 pushes the noise contribution to
  // ~13.5, which after clamping pegs the density at the max across
  // most of the volume — proper inferno.
  d = clamp(d + 4.5 * uScale * f, 0.0, 1.0);
  vec3 col = mix(uColor * 0.9 + vec3(0.1), uSmoke, d) + 0.05 * sin(p);
  return vec4(col, d);
}

vec4 fxEffect(vec2 uv) {
  // Map the region's UV onto the camera plane the original entry
  // used. Aspect-correct so wide rectangular regions don't squash
  // the columns horizontally.
  vec2 ndc = (uv - 0.5) * 2.0;
  ndc.x *= uAspect;
  vec3 ro = vec3(0.0, 4.9, -40.0);
  vec3 rd = normalize(vec3(ndc, 2.0)) * _fs_rot;
  float t = time * uSpeed;

  // 48 raymarch steps with a wider step length. Cutoff at alpha
  // 0.99 lets near-opaque columns terminate the loop early.
  vec4 s = vec4(0.0);
  float step = 0.0;
  for (int i = 0; i < 48; i++) {
    if (s.a > 0.99) break;
    vec3 p = ro + step * rd;
    vec4 k = _fs_vol(p, t);
    // Vertical falloff modulates hot core down low to cool smoke
    // up top — the colour grade that sells "fire underneath, smoke
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
  return vec4(col * uIntensity, s.a);
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
  // Normal blend; alpha from the accumulated raymarch opacity gates
  // how much smoke obscures the map underneath. Polygon coverage
  // modulates that further at the edges.
  gl_FragColor = vec4(c.rgb, c.a * maskAlpha);
}
