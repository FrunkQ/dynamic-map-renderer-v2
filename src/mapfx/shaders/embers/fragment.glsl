// Embers — parallax cell-grid sparks rising slowly through the
// polygon. Same algorithm as the Embers backdrop, ported to a
// polygon-masked MapFX kind so GMs can drop ember regions on the
// map (a smouldering campfire patch, a slag pit, glowing magma
// crack) without committing to a full-screen backdrop.
//
// Output uses additive blending so embers add light over the map —
// dark map regions read as "fire pit", lit ones as "extra sparks".
//
// Plane-local UV with aspect correction so each ember stays roughly
// circular and the layer density looks right on wide vs tall polys.

uniform sampler2D uMask;
uniform float     time;
uniform float     uAspect;
uniform vec3      uColor;        // per-poly ember tint (= uTint on backdrop)
uniform float     uIntensity;
uniform float     uSpeed;

varying vec2 vUv;

void main() {
  float maskAlpha = texture2D(uMask, vUv).a;
  if (maskAlpha < 0.01) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // Aspect-correct so embers stay roughly circular regardless of
  // the polygon's bbox.
  vec2 uv = vUv;
  uv.x *= max(1.0, uAspect);

  float t = time * uSpeed;
  vec3 col = vec3(0.0);

  // 8 parallax layers — each tile grid is offset and scrolling at
  // a slightly different rate so the eye picks up depth.
  for (int li = 0; li < 8; li++) {
    float fi = float(li);
    float scale = 6.0 + fi * 1.5;
    float speed = 0.04 + fi * 0.015;
    vec2 cell = vec2(
      uv.x * scale + fi * 7.13,
      uv.y * scale * 0.6 - t * speed
    );
    vec2 gv = fract(cell);
    vec2 id = floor(cell);
    // 2-step hash → stable per-cell position + size.
    vec2 p = fract(id * vec2(123.34, 456.21) + fi * 17.0);
    p += dot(p, p + 45.32);
    float h = fract(p.x * p.y);
    // Per-cell ember position + brightness + flicker.
    vec2 pos = vec2(h, fract(h * 7.0));
    float d = distance(gv, pos);
    float r = 0.05 + fract(h * 13.0) * 0.04;
    float ember = smoothstep(r, 0.0, d);
    ember *= 0.6 + sin(t * 3.0 + h * 31.4) * 0.4;
    // Per-cell hash variation so the field reads as a distribution
    // rather than a single hue — same approach as the backdrop.
    vec3 heat = uColor * (0.7 + h * 0.6);
    // Far layers dimmer than near ones to sell the parallax.
    float layerFade = 1.0 - fi * 0.08;
    col += ember * heat * 0.18 * layerFade;
  }

  // Additive blend. Pre-multiply by maskAlpha so polygon coverage
  // modulates contribution naturally at the edges.
  gl_FragColor = vec4(col * uIntensity * maskAlpha, maskAlpha);
}
