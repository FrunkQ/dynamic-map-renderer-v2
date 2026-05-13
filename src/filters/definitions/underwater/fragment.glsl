// Underwater Shimmer — UV distortion via slow cross-cut sin waves gives the
// look of refraction through moving water. Adds an animated caustic-bright
// band overlay and a blue-green tint to seal the deal. Slight cyan vignette
// pulls toward darker depths at the edges.

uniform sampler2D tDiffuse;
uniform vec2      resolution;
uniform float     time;
uniform float     uDistortion;
uniform float     uSpeed;
uniform float     uCaustics;
uniform float     uTint;
varying vec2      vUv;

void main() {
  // Cross-cut sin waves give a believable refraction wiggle. Different
  // frequencies / phases on each axis prevent the wave from reading as
  // marching bands.
  float t = time * uSpeed;
  vec2 wiggle = vec2(
    sin(vUv.y * 32.0 + t * 1.7) * 0.5 + sin(vUv.y * 12.0 - t * 0.9) * 0.5,
    cos(vUv.x * 24.0 + t * 1.3) * 0.5 + cos(vUv.x *  8.0 + t * 0.7) * 0.5
  ) * 0.012 * uDistortion;

  vec4 color = texture2D(tDiffuse, vUv + wiggle);

  // Caustic-bright bands — cheap pseudo-caustic by overlaying a tilted sin
  // pattern that scrolls. Adds a sun-through-ripples shimmer.
  if (uCaustics > 0.001) {
    vec2 cUv = vUv * vec2(resolution.x / resolution.y, 1.0);
    float c = sin((cUv.x + cUv.y) * 22.0 + t * 1.1)
            + sin((cUv.x - cUv.y) * 17.0 - t * 0.9);
    c = max(0.0, c) * 0.5;
    color.rgb += vec3(0.50, 0.85, 1.00) * c * 0.20 * uCaustics;
  }

  // Blue-green tint — push reds down, greens slightly, blues up. Linear
  // mix on the slider so the GM can pick "barely wet" or "deep aquatic".
  vec3 water = color.rgb * vec3(0.55, 0.92, 1.20);
  color.rgb = mix(color.rgb, water, uTint);

  // Cyan-edged vignette — depth darkening.
  vec2 d = (vUv - 0.5) * vec2(resolution.x / resolution.y, 1.0);
  float vig = smoothstep(0.30, 0.85, length(d));
  color.rgb = mix(color.rgb, color.rgb * vec3(0.4, 0.6, 0.8), vig * 0.4);

  gl_FragColor = color;
}
