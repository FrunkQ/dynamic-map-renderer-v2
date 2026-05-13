// Rain — animated diagonal streaks with optional darken + desaturate.
// Three overlaid streak layers at different scales / speeds give parallax.
// Each layer hashes a 2D cell grid; cells above (1 - density) emit a streak.

uniform sampler2D tDiffuse;
uniform vec2      resolution;
uniform float     time;
uniform float     uIntensity;
uniform float     uDensity;
uniform float     uSpeed;
uniform float     uWind;
uniform float     uDarken;
varying vec2      vUv;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 78.233);
  return fract(p.x * p.y);
}

// One streak layer. cellScale = how many cells across one screen width.
// cellAspect = vertical stretch (>1 makes cells taller — longer streaks).
float rainLayer(vec2 uv, float cellScale, float cellAspect, float speedMul) {
  // Wind shears streaks diagonally — multiplier kept gentle so wind=1 looks
  // like a moderate slant, not horizontal.
  uv.x += uv.y * uWind * 0.6;
  uv.y -= time * uSpeed * speedMul;

  vec2 cell = vec2(floor(uv.x * cellScale), floor(uv.y * cellScale / cellAspect));
  vec2 f    = vec2(fract(uv.x * cellScale), fract(uv.y * cellScale / cellAspect));
  float h = hash21(cell);

  // Density gate — most cells are empty; only the brightest hashes emit.
  float gate = step(1.0 - uDensity, h);
  if (gate < 0.5) return 0.0;

  // Streak shape:
  //   • narrow vertical band on x (peaks at fract.x = h to avoid all streaks
  //     hugging the same side of the cell)
  //   • fades from top of cell (bright leading edge) downward
  float xCentre = mix(0.15, 0.85, h);
  float xWidth  = 1.0 - smoothstep(0.0, 0.04, abs(f.x - xCentre));
  float yShape  = pow(1.0 - f.y, 3.0); // sharp leading edge, soft tail
  return xWidth * yShape * h;
}

void main() {
  vec4 color = texture2D(tDiffuse, vUv);

  // Overcast tint: slight desaturation + darken, both scaled by darken slider
  // so the GM can keep streaks without dimming the map.
  if (uDarken > 0.001) {
    float grey = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    color.rgb = mix(color.rgb, vec3(grey), 0.25 * uDarken);
    color.rgb *= (1.0 - 0.30 * uDarken);
  }

  // Aspect-corrected UVs so streaks look the same width / spacing regardless
  // of screen shape. Multiplying x by resolution.x/resolution.y means our
  // cell grid is square in physical pixels.
  vec2 aUv = vUv * vec2(resolution.x / resolution.y, 1.0);

  float streaks = 0.0;
  streaks += rainLayer(aUv, 60.0,  3.5, 1.0) * 0.55;
  streaks += rainLayer(aUv, 95.0,  4.0, 1.7) * 0.30;
  streaks += rainLayer(aUv, 40.0,  3.0, 0.7) * 0.25;
  streaks = clamp(streaks * uIntensity, 0.0, 1.0);

  // Streak colour — cool pale blue, blended additively for a wet sheen.
  vec3 streakCol = vec3(0.75, 0.85, 1.0);
  color.rgb = mix(color.rgb, streakCol, streaks * 0.85);

  gl_FragColor = color;
}
