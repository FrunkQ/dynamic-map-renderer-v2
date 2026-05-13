// Rain — top-down view. The frame is the ground seen from above, so rain
// reads as expanding ring-ripples where individual drops strike, not
// falling streaks. A hash-cell grid picks splash locations; each cell
// runs its own offset loop so the splashes don't pulse in sync. Two
// layered grids (broad + dense) give visual variety. Slight darken +
// saturation lift sells the "wet surface" look.

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

// One ripple layer. Each cell in the grid runs an independent ripple cycle:
//   • picks a phase from its hash so cells don't all splash in lockstep
//   • ring expands from 0 → 0.5 over the cycle
//   • brightness fades quadratically so the splash starts bright and dies
float ripple(vec2 uv, float cellScale) {
  vec2 cell = floor(uv * cellScale);
  vec2 f    = fract(uv * cellScale) - 0.5;
  float h   = hash21(cell);

  // Density gate — most cells never splash.
  if (h < 1.0 - uDensity) return 0.0;

  // Cycle length ~1.4s, per-cell phase from the hash so splashes scatter
  // through time. Speed slider scales the cycle.
  float period = 1.4;
  float lifeT = fract(time * uSpeed / period + h);

  // Distance from cell centre (already centred on 0 by the -0.5).
  float r = length(f);

  // Ring expands; smoothstep gives the bright leading edge fading inward.
  float ringR = lifeT * 0.45;
  float ringW = mix(0.04, 0.10, lifeT); // ring softens as it expands
  float ring  = exp(-pow((r - ringR) / ringW, 2.0));

  // Tiny central impact dot for the first frames of the splash.
  float impact = smoothstep(0.06, 0.0, r) * smoothstep(0.10, 0.0, lifeT);

  // Quadratic fade-out over the cycle.
  float life = (1.0 - lifeT) * (1.0 - lifeT);

  return (ring * life + impact) * 1.2;
}

void main() {
  vec4 color = texture2D(tDiffuse, vUv);

  // Wet-surface tint: slight darken + saturation lift. Same slider as the
  // side-view's overcast control so the GM has consistent semantics.
  if (uDarken > 0.001) {
    float grey = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    // Saturation boost (wet things look more saturated), then a darken.
    color.rgb = mix(vec3(grey), color.rgb, 1.0 + 0.20 * uDarken);
    color.rgb *= (1.0 - 0.25 * uDarken);
  }

  vec2 aUv = vUv * vec2(resolution.x / resolution.y, 1.0);

  // Two grids — broad + dense — for splash size variety.
  float ripples = 0.0;
  ripples += ripple(aUv, 40.0)  * 0.85;
  ripples += ripple(aUv, 75.0)  * 0.50;
  ripples = clamp(ripples * uIntensity, 0.0, 1.0);

  // Splash colour — pale wet highlight, blended additively so the underlying
  // map texture still shows through the bright leading ring.
  vec3 wetCol = vec3(0.80, 0.90, 1.05);
  color.rgb = mix(color.rgb, wetCol, ripples * 0.85);

  gl_FragColor = color;
}
