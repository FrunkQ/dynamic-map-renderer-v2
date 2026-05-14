// Magic Portal — adapted from "Magic Portal" by Delincoter (2021-08-10)
//   https://www.shadertoy.com/view/NtBXWV
//   Used under Shadertoy default licence (CC-BY-NC-SA 3.0) — see
//   ACKNOWLEDGEMENTS.md.
//   The noise primitive (hash33 + simplex noise) credits a snippet
//   at https://www.shadertoy.com/view/4sc3z2, kept intact.
//
// Adaptation notes:
//   • iTime → time; iResolution → uAspect; iMouse → not used.
//   • Original "portal opening" effect used `pow(iTime+0.5, 5) * 0.001`
//     which grew exponentially — the portal appeared dim, swirled,
//     opened over ~2 seconds, then animated with a constant offset.
//     For a battlemap we want a continuously-open portal, so the time
//     scaling is linear and the "event horizon" centre darkening is
//     constant (no fade-in).
//   • Centred UV with uScale division — uScale=1 gives a portal that
//     fits comfortably inside a typical polygon; higher uScale grows
//     the portal beyond the polygon edges (mask clips to polygon).
//   • Original hard-coded vec3(0.102, 0.5, 1.) blue tint replaced
//     with uColor so GM picks the portal hue. Default in the registry
//     is a magic blue close to the original.
//   • Output uses additive blending — portal energy adds light over
//     whatever the map shows beneath, so the centre dark spot reads
//     as a hole into the void and the swirl rim glows.

uniform sampler2D uMask;
uniform float     time;
uniform float     uAspect;
uniform vec3      uColor;
uniform float     uIntensity;
uniform float     uScale;
uniform float     uSpeed;

varying vec2 vUv;

// hash33 + simplex_noise — original credit:
//   https://www.shadertoy.com/view/4sc3z2
vec3 hash33(vec3 p3) {
  vec3 MOD3 = vec3(0.1031, 0.11369, 0.13787);
  p3 = fract(p3 * MOD3);
  p3 += dot(p3, p3.yxz + 19.19);
  return -1.0 + 2.0 * fract(vec3(
    (p3.x + p3.y) * p3.z,
    (p3.x + p3.z) * p3.y,
    (p3.y + p3.z) * p3.x
  ));
}

float simplex_noise(vec3 p) {
  const float K1 = 0.333333333;
  const float K2 = 0.166666667;
  vec3 i = floor(p + (p.x + p.y + p.z) * K1);
  vec3 d0 = p - (i - (i.x + i.y + i.z) * K2);
  vec3 e = step(vec3(0.0), d0 - d0.yzx);
  vec3 i1 = e * (1.0 - e.zxy);
  vec3 i2 = 1.0 - e.zxy * (1.0 - e);
  vec3 d1 = d0 - (i1 - 1.0 * K2);
  vec3 d2 = d0 - (i2 - 2.0 * K2);
  vec3 d3 = d0 - (1.0 - 3.0 * K2);
  vec4 h = max(0.6 - vec4(dot(d0, d0), dot(d1, d1), dot(d2, d2), dot(d3, d3)), 0.0);
  vec4 n = h * h * h * h * vec4(
    dot(d0, hash33(i)),
    dot(d1, hash33(i + i1)),
    dot(d2, hash33(i + i2)),
    dot(d3, hash33(i + 1.0))
  );
  return dot(vec4(31.316), n);
}

float renderPortal(vec2 uv, float t) {
  // Soft falloff so the portal disc fades out before the polygon edge.
  float side   = smoothstep(0.5, 0.3, length(uv));
  // Inner dark spot — the "event horizon".
  float center = smoothstep(0.1, 0.0, length(uv));

  vec3 rd = vec3(uv, 0.0);
  // Continuous animation — linear time, not the original's iTime^5
  // "opening" buildup. Length-warped sampling produces the radial
  // swirl signature.
  float n2 = simplex_noise((rd * t + t) * (1.0 / max(0.0001, length(rd * t + rd))) + t * 0.3);

  // Bright rim driven by the noise; divide by length to push energy
  // outward from centre into a ring shape.
  float flare = smoothstep(0.0, 1.0, 0.002 / max(0.0001, length(rd * length(rd) * n2))) * side;

  // Subtract the dark centre — constant strength (no fade-in).
  flare = flare - center * 5.0;

  return flare;
}

void main() {
  float maskAlpha = texture2D(uMask, vUv).r;
  if (maskAlpha < 0.01) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // Centred + aspect-corrected UV, divided by uScale so the portal
  // disc can be tuned to fit the polygon. At uScale=1 the natural
  // disc (~0.5 radius) sits inside the polygon for typical aspect
  // ratios.
  vec2 uv = (vUv - 0.5) / max(uScale, 0.01);
  uv.x *= uAspect;

  // Time advance for the swirl. Original used a slow exponential
  // buildup; we use linear time multiplied by uSpeed so the GM
  // chooses how fast the energy churns. The +5 offset gets us past
  // the original's "still opening" early frames into a stable look.
  float t = 5.0 + time * uSpeed * 1.5;

  float flare = renderPortal(uv, t);
  vec3 col = uColor * 2.0 * flare;

  // Additive blend on the material — adds energy over the map.
  gl_FragColor = vec4(col * uIntensity * maskAlpha, maskAlpha);
}
