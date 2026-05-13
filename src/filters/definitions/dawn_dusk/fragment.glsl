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

  // Two anchor tints — cool dawn (slight cyan + magenta toe) and warm dusk
  // (orange highlight, dim shadow). The slider walks between them.
  vec3 cool = vec3(0.86, 0.97, 1.12);
  vec3 warm = vec3(1.22, 1.02, 0.78);
  vec3 grade = mix(cool, warm, uWarmth);
  color.rgb = mix(color.rgb, color.rgb * grade, uIntensity);

  // Saturation tweak (centred at 1.0 — slider can de-sat or boost).
  float grey = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  color.rgb = mix(vec3(grey), color.rgb, uSaturation);

  // Aspect-correct radial vignette darkens edges so the sun-lit centre pops.
  vec2 d = (vUv - 0.5) * vec2(resolution.x / resolution.y, 1.0);
  float vAmt = smoothstep(0.30, 0.80, length(d)) * uVignette;
  color.rgb *= 1.0 - vAmt * 0.35;

  gl_FragColor = color;
}
