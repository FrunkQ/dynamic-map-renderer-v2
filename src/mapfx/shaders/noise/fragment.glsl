// Noise — colourable TV-static. Per-pixel-cell pseudo-random value
// tinted by uColor. One source for MapFX (polygon-masked sparkle
// patch on the map) and Backdrop (animated static filling the
// bars). Cheap: a single hash per fragment, no helper textures.

// === BEGIN backdrop-shareable ===
uniform float time;
uniform float uAspect;
uniform vec3  uColor;
uniform float uIntensity;
uniform float uScale;       // grain density: >1 finer, <1 chunkier cells
uniform float uSpeed;       // flicker rate: 0 freezes the pattern; 1 = original
                            //   per-frame churn; >1 doesn't go faster than the
                            //   framerate but introduces visible jumps.

float _noise_hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

vec4 fxEffect(vec2 uv) {
  // Aspect-correct so a wide letterbox region doesn't horizontally
  // stretch the noise cells. Multiply by a base cell-density factor
  // (~800 reads as natural TV-static grain on a typical canvas);
  // uScale lets the GM dial finer or chunkier.
  vec2 p = uv;
  p.x *= uAspect;
  p *= 800.0 * max(uScale, 0.01);

  // Time seed advances ~60 random samples per second of uSpeed —
  // so uSpeed=1 reads as live framerate-rate static; 0 freezes a
  // single snapshot; lower values introduce a visible chunkier
  // flicker as the pattern updates less often than the framerate.
  float t = time * uSpeed * 60.0;
  float n = _noise_hash(floor(p) + vec2(t, t * 1.7));

  // Tint by the chosen colour. Default white reads as classic
  // monochrome static; tint to cyan / green / amber for retro
  // CRT phosphor variants.
  vec3 col = uColor * n * uIntensity;
  return vec4(col, n);
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
  // Additive blend: noise adds light over the map at the polygon
  // edges fade gracefully via maskAlpha.
  gl_FragColor = vec4(c.rgb * maskAlpha, maskAlpha);
}
