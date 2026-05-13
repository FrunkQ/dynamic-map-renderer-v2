// Sandstorm — heavy horizontal noise streaks (sand whipping past) layered
// on a warm orange wash that crushes contrast and visibility. The streaks
// use stretched-cell hashing so each "line of sand" is its own organic blur
// rather than a uniform marching band.

uniform sampler2D tDiffuse;
uniform vec2      resolution;
uniform float     time;
uniform float     uIntensity;
uniform float     uSpeed;
uniform float     uDensity;
uniform float     uWash;
varying vec2      vUv;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 78.233);
  return fract(p.x * p.y);
}

// Horizontal streak layer — cells are very wide so each cell paints a
// streaky band that scrolls horizontally.
float sandLayer(vec2 uv, float scaleY, float speedMul) {
  uv.x -= time * uSpeed * speedMul;
  vec2 cell = vec2(floor(uv.x * scaleY * 0.20), floor(uv.y * scaleY));
  vec2 f    = vec2(fract(uv.x * scaleY * 0.20), fract(uv.y * scaleY));
  float h = hash21(cell);
  if (h < 1.0 - uDensity) return 0.0;
  // Smooth horizontal blur within the cell — peaks left, fades right.
  return smoothstep(0.0, 0.6, 1.0 - f.x) * h;
}

void main() {
  vec4 color = texture2D(tDiffuse, vUv);

  // Warm desaturation wash. Push everything toward dusty orange while
  // crushing midtone contrast — visibility drops the higher the wash slider.
  vec3 sand = vec3(0.85, 0.65, 0.40);
  float grey = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  vec3 dusty = mix(vec3(grey), sand, 0.5);
  color.rgb = mix(color.rgb, dusty * (color.rgb + 0.3), uWash);

  vec2 aUv = vUv * vec2(resolution.x / resolution.y, 1.0);

  // Two layers of streaks — coarse + fine.
  float streaks = 0.0;
  streaks += sandLayer(aUv, 80.0, 1.0)  * 0.55;
  streaks += sandLayer(aUv, 140.0, 1.7) * 0.40;
  streaks = clamp(streaks * uIntensity, 0.0, 1.0);

  // Streak colour — pale dust, brightens the underlying pixels rather than
  // overwriting so the map still bleeds through.
  vec3 dust = vec3(0.95, 0.80, 0.55);
  color.rgb += dust * streaks * 0.45;

  gl_FragColor = color;
}
