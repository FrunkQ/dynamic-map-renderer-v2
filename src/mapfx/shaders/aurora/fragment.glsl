// Aurora — drifting horizontal curtain bands. One source for both
// MapFX (polygon-masked, painted on the map) and Backdrop (full-bars
// — the wrapper at src/rendering/backdrops/fromMapFx.ts lifts the
// marker block below and drops it into the clip-pass).
//
// Plane-local UV: vUv is the polygon plane (0..1 within the bbox) in
// MapFX mode, the full canvas in Backdrop mode. fxEffect treats both
// identically — the curtain folds within the supplied UV region.

// === BEGIN backdrop-shareable ===
// Everything between these markers is lifted by the backdrop wrapper
// and dropped into the clip-pass at top scope. Don't reference uMask
// or vUv here — those are MapFX-only and live below the END marker.

uniform float time;
uniform float uAspect;
uniform vec3  uColorA;   // curtain colour (primary)
uniform vec3  uColorB;   // curtain colour (secondary)
uniform float uIntensity;
uniform float uSpeed;

vec4 fxEffect(vec2 uv) {
  // Centred + aspect-corrected so curtain ripples don't squash on
  // wide / tall regions.
  uv -= 0.5;
  uv.x *= uAspect;

  float t = time * uSpeed * 0.1;
  // Two stacked wave systems give the curtain-folding motion.
  float band1 = sin(uv.y * 8.0 + t * 0.5 + sin(uv.x * 3.0 + t * 0.3) * 0.5) * 0.5 + 0.5;
  float band2 = sin(uv.y * 4.0 - t * 0.4 + cos(uv.x * 2.0 - t * 0.2) * 0.4) * 0.5 + 0.5;
  float band  = band1 * band2;

  // Vertical falloff so the aurora "hangs" in the middle of the
  // region rather than smearing edge-to-edge.
  float falloff = 1.0 - smoothstep(0.25, 0.5, abs(uv.y));

  vec3 hue = mix(uColorA, uColorB, sin(uv.x * 2.0 + t) * 0.5 + 0.5);
  vec3 col = hue * band * falloff * uIntensity;

  return vec4(col, 1.0);
}
// === END backdrop-shareable ===

// MapFX-only wrapper from here down.
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
  // additive contribution naturally at the polygon edges.
  gl_FragColor = vec4(c.rgb * maskAlpha, maskAlpha);
}
