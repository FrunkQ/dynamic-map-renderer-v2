// Embers — parallax cell-grid sparks rising slowly through the
// polygon. Same algorithm shared by MapFX (polygon-masked here) and
// the Backdrop subsystem (which extracts the marker-delimited block
// below and inserts it into the clip-pass shader). Output uses
// additive blending so embers add light over the map — dark map
// regions read as "fire pit", lit ones as "extra sparks".

// === BEGIN backdrop-shareable ===
// Everything between these markers gets lifted by the backdrop
// wrapper (src/rendering/backdrops/fromMapFx.ts) and dropped into
// the clip-pass at top scope. Don't reference uMask or vUv here —
// those are MapFX-only and live below the END marker.

uniform float time;
uniform float uAspect;
uniform vec3  uColor;       // per-poly ember tint
uniform float uIntensity;
uniform float uSpeed;

vec4 fxEffect(vec2 uv) {
  // Aspect-correct so embers stay roughly circular regardless of the
  // region's bbox.
  uv.x *= max(1.0, uAspect);

  float t = time * uSpeed;
  vec3 col = vec3(0.0);

  // 8 parallax layers — each tile grid is offset and scrolling at a
  // slightly different rate so the eye picks up depth.
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
    // rather than a single hue.
    vec3 heat = uColor * (0.7 + h * 0.6);
    // Far layers dimmer than near ones to sell the parallax.
    float layerFade = 1.0 - fi * 0.08;
    col += ember * heat * 0.18 * layerFade;
  }

  // Additive contribution. Alpha component is unused by additive
  // MapFX blending (alpha comes from polygon mask there); the
  // backdrop wrapper ignores it too (composites rgb over uBgColor
  // opaquely). Reserved for future normal-blend variants.
  return vec4(col * uIntensity, 1.0);
}
// === END backdrop-shareable ===

// MapFX-only wrapper from here down. uMask + vUv are the polygon
// mask texture and plane-local UV varying provided by the per-poly
// ShaderMaterial. The backdrop wrapper supplies its own.
uniform sampler2D uMask;
varying vec2 vUv;

void main() {
  float maskAlpha = texture2D(uMask, vUv).a;
  if (maskAlpha < 0.01) {
    gl_FragColor = vec4(0.0);
    return;
  }
  vec4 c = fxEffect(vUv);
  // Pre-multiply by maskAlpha so polygon coverage modulates the
  // additive contribution naturally at the edges.
  gl_FragColor = vec4(c.rgb * maskAlpha, maskAlpha);
}
