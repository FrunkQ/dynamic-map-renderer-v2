// Rain — top-down view. The frame is the ground seen from above, so rain
// reads as expanding ring-ripples where individual drops strike, not
// falling streaks. A hash-cell grid picks splash locations; each cell
// uses an INDEPENDENT hash seed for its time phase so active cells don't
// march in lockstep (they did in the first cut, producing a uniform
// pulse). Two layered grids with their own seeds give size + timing
// variety. Slight darken + saturation lift sells the "wet surface" look.

uniform sampler2D tDiffuse;
uniform vec2      resolution;
uniform float     time;
uniform float     uIntensity;
uniform float     uDensity;
uniform float     uSpeed;
uniform float     uDarken;
varying vec2      vUv;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 78.233);
  return fract(p.x * p.y);
}

// One ripple layer.
//   • hGate decides if/how-much this cell splashes (density gate)
//   • hPhase (different seed) is the time offset so active cells scatter
//     through the splash cycle rather than firing in sync
//   • hPos jitters the splash position inside the cell so they don't grid-align
//   • hSize varies the splash radius cell-to-cell
float ripple(vec2 uv, float cellScale, float seedSalt) {
  vec2 cell = floor(uv * cellScale);
  vec2 f    = fract(uv * cellScale) - 0.5;

  float hGate  = hash21(cell + vec2(seedSalt, 0.0));
  if (hGate < 1.0 - uDensity) return 0.0;

  float hPhase = hash21(cell + vec2(seedSalt + 31.7, 17.3));
  float hPos1  = hash21(cell + vec2(seedSalt + 7.1,  41.9));
  float hPos2  = hash21(cell + vec2(seedSalt + 13.6, 5.2));
  float hSize  = hash21(cell + vec2(seedSalt + 51.4, 23.8));

  // Jitter splash position within the cell so splashes don't grid-align.
  vec2 jitter = (vec2(hPos1, hPos2) - 0.5) * 0.6;
  vec2 fc = f - jitter;

  float period = 1.4;
  float lifeT = fract(time * uSpeed / period + hPhase);

  float r = length(fc);

  // Ring shape: thin band at lifeT * 0.5, softening as it expands.
  float maxR  = mix(0.35, 0.55, hSize);
  float ringR = lifeT * maxR;
  float ringW = mix(0.03, 0.09, lifeT);
  float ring  = exp(-pow((r - ringR) / ringW, 2.0));

  // Bright impact dot in the first ~10% of the cycle.
  float impact = smoothstep(0.05, 0.0, r) * smoothstep(0.10, 0.0, lifeT);

  // Quadratic fade-out so the ring is brightest at birth and dies by life=1.
  float life = (1.0 - lifeT) * (1.0 - lifeT);

  return ring * life + impact;
}

void main() {
  vec4 color = texture2D(tDiffuse, vUv);

  // Wet-surface tint: slight darken + saturation lift.
  if (uDarken > 0.001) {
    float grey = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    color.rgb = mix(vec3(grey), color.rgb, 1.0 + 0.20 * uDarken);
    color.rgb *= (1.0 - 0.25 * uDarken);
  }

  vec2 aUv = vUv * vec2(resolution.x / resolution.y, 1.0);

  // Two grids — broad + dense, with DIFFERENT seed salts so the two layers
  // don't share a splash schedule either.
  float ripples = 0.0;
  ripples += ripple(aUv, 35.0, 0.0)   * 0.95;
  ripples += ripple(aUv, 70.0, 19.4)  * 0.55;
  ripples = clamp(ripples * uIntensity, 0.0, 1.0);

  // Splash colour — pale wet highlight.
  vec3 wetCol = vec3(0.80, 0.92, 1.08);
  color.rgb = mix(color.rgb, wetCol, ripples * 0.85);

  gl_FragColor = color;
}
