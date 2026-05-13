// Dawn / Dusk — pure colour grading. A single warmth slider blends between
// cool pre-dawn blue-pink and warm dusk orange-red, with a soft vignette to
// pull attention inward as if the sun is just out of frame.

uniform sampler2D tDiffuse;
uniform vec2      resolution;
uniform float     uIntensity;
uniform float     uWarmth;
uniform float     uVignette;
uniform float     uSaturation;
varying vec2      vUv;

void main() {
  vec4 color = texture2D(tDiffuse, vUv);

  // Two anchor tints — deeper now after first-pass feedback that the look
  // was too subtle. Cool dawn pushes magenta-blue; warm dusk drops red-
  // saturated and crushes blue for a richer orange.
  vec3 cool = vec3(0.65, 0.88, 1.35);
  vec3 warm = vec3(1.55, 0.95, 0.50);
  vec3 grade = mix(cool, warm, uWarmth);
  color.rgb = mix(color.rgb, color.rgb * grade, uIntensity);

  // Saturation tweak (centred at 1.0 — slider can de-sat or boost).
  float grey = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  color.rgb = mix(vec3(grey), color.rgb, uSaturation);

  // Aspect-correct radial vignette darkens edges so the sun-lit centre pops.
  // Third pass: start 0.08 (very near centre), fade complete by 0.60, and
  // multiplier 1.0 — corners crush to true black at vignette = 1.
  vec2 d = (vUv - 0.5) * vec2(resolution.x / resolution.y, 1.0);
  float vAmt = smoothstep(0.08, 0.60, length(d)) * uVignette;
  color.rgb *= 1.0 - vAmt;

  gl_FragColor = color;
}
