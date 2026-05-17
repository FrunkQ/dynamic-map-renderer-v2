// Aurora — drifting horizontal curtain bands. Same algorithm as the
// Aurora backdrop (src/rendering/backdrops/aurora.ts), ported to a
// polygon-masked MapFX kind so GMs can paint an aurora region on the
// map itself (e.g. a frozen north strip, an arctic encounter map's
// upper third) without committing to a full-screen backdrop.
//
// Output uses additive blending so the aurora reads as light over
// the map — paint over snowfields, arctic seas, or dark plains and
// the underlying terrain still shows through faintly.
//
// Plane-local UV: vUv is the polygon plane (0..1 within the bbox),
// not the canvas. The curtain bands fold vertically within the
// polygon, which is the natural fit for a "looking up at the sky"
// reading on a battlemap.

uniform sampler2D uMask;
uniform float     time;
uniform float     uAspect;
uniform vec3      uColorA;       // curtain colour (primary)
uniform vec3      uColorB;       // curtain colour (secondary)
uniform float     uIntensity;
uniform float     uSpeed;

varying vec2 vUv;

void main() {
  float maskAlpha = texture2D(uMask, vUv).a;
  if (maskAlpha < 0.01) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // Centred UV with aspect correction so curtain ripples don't squash
  // on wide rectangular polygons.
  vec2 uv = vUv - 0.5;
  uv.x *= uAspect;

  float t = time * uSpeed * 0.1;
  // Two stacked wave systems give the curtain-folding motion.
  float band1 = sin(uv.y * 8.0 + t * 0.5 + sin(uv.x * 3.0 + t * 0.3) * 0.5) * 0.5 + 0.5;
  float band2 = sin(uv.y * 4.0 - t * 0.4 + cos(uv.x * 2.0 - t * 0.2) * 0.4) * 0.5 + 0.5;
  float band  = band1 * band2;

  // Vertical falloff: stronger curtain near the polygon's vertical
  // midline, fading out toward top + bottom edges. Reads as an
  // aurora "hanging" in the polygon rather than smearing edge-to-edge.
  float falloff = 1.0 - smoothstep(0.25, 0.5, abs(uv.y));

  // Hue drift between the two curtain colours across the horizontal
  // axis + time — same recipe as the backdrop.
  vec3 hue = mix(uColorA, uColorB, sin(uv.x * 2.0 + t) * 0.5 + 0.5);
  vec3 col = hue * band * falloff * uIntensity;

  // Additive over the map. Multiply by maskAlpha so polygon coverage
  // modulates contribution naturally at the polygon edges.
  gl_FragColor = vec4(col * maskAlpha, maskAlpha);
}
