// Snow — slow-drifting round flakes with parallax depth.
// Three layers (far/mid/near) at different scales + speeds; near flakes are
// bigger, brighter, and fall a touch faster. A gentle per-flake horizontal
// sway sells the "drifting" feel rather than straight fall.

uniform sampler2D tDiffuse;
uniform vec2      resolution;
uniform float     time;
uniform float     uIntensity;
uniform float     uDensity;
uniform float     uSpeed;
uniform float     uSway;
uniform float     uCoolTint;
varying vec2      vUv;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 78.233);
  return fract(p.x * p.y);
}

float snowLayer(vec2 uv, float cellScale, float fallSpeed, float flakeRadius) {
  // Wrap on Y so flakes loop seamlessly; add per-cell phase for sway so each
  // flake drifts independently.
  uv.y -= time * uSpeed * fallSpeed;
  vec2 cell = floor(uv * cellScale);
  vec2 f    = fract(uv * cellScale);
  float h   = hash21(cell);

  // Density gate before the expensive distance test.
  if (h < 1.0 - uDensity) return 0.0;

  // Per-flake horizontal phase offset — same hash drives sway frequency
  // & magnitude so each flake has its own pattern.
  float phase = h * 6.2831853;
  float swayX = sin(time * (1.0 + h * 0.7) + phase) * 0.18 * uSway;

  // Random anchor inside the cell so flakes don't grid-align visibly.
  vec2 anchor = vec2(0.5 + swayX, mix(0.3, 0.7, hash21(cell + 17.3)));
  float dist = length((f - anchor) / vec2(1.0, 1.4)); // slight vertical squish
  float r    = flakeRadius * (0.6 + h * 0.6);         // varying flake size
  return smoothstep(r, r * 0.4, dist) * (0.5 + 0.5 * h);
}

void main() {
  vec4 color = texture2D(tDiffuse, vUv);

  // Cool tint — push toward pale blue, scaled by slider. Lighter than rain's
  // overcast since snow scenes usually want a softer mood.
  if (uCoolTint > 0.001) {
    vec3 cold = color.rgb * vec3(0.92, 0.97, 1.08);
    color.rgb = mix(color.rgb, cold, uCoolTint);
  }

  vec2 aUv = vUv * vec2(resolution.x / resolution.y, 1.0);

  // Three layers: far (small, slow), mid, near (big, faster).
  float flakes = 0.0;
  flakes += snowLayer(aUv, 90.0, 0.5, 0.07) * 0.45;
  flakes += snowLayer(aUv, 55.0, 0.9, 0.10) * 0.65;
  flakes += snowLayer(aUv, 32.0, 1.4, 0.14) * 0.85;
  flakes = clamp(flakes * uIntensity, 0.0, 1.0);

  // Snow colour — faintly cool white, blended on top.
  vec3 flakeCol = vec3(0.97, 0.99, 1.0);
  color.rgb = mix(color.rgb, flakeCol, flakes);

  gl_FragColor = color;
}
