// Horror Tint — slow heartbeat-style pulse drives a red vignette + breathing
// chromatic aberration. Colour-graded toward red-tinged sepia so the map
// reads as "something is wrong here" before the player even processes
// detail. Defaults amped from the first pass — full slasher at intensity 1.

uniform sampler2D tDiffuse;
uniform vec2      resolution;
uniform float     time;
uniform float     uIntensity;
uniform float     uPulseSpeed;
uniform float     uAberration;
uniform float     uRedShift;
varying vec2      vUv;

void main() {
  // Heartbeat pulse — two-thump envelope so it reads as a heartbeat rather
  // than a sine. Output is 0..1.
  float t = time * uPulseSpeed;
  float a = sin(t * 6.0);
  float b = sin(t * 6.0 + 1.2);
  float thump = clamp(a * 0.7 + b * 0.3, 0.0, 1.0);
  thump = thump * thump; // sharpen the peaks

  // Breathing chromatic aberration. Slider range doubled (max 0.04) and
  // pulse contribution is heavier so the heartbeat genuinely smears.
  vec2 d = vUv - 0.5;
  float ca = uAberration * (0.6 + thump * 1.2) * uIntensity;
  float r = texture2D(tDiffuse, vUv - d * ca).r;
  float g = texture2D(tDiffuse, vUv).g;
  float bC = texture2D(tDiffuse, vUv + d * ca).b;
  vec3 color = vec3(r, g, bC);

  // Red-shifted grading — luma weighted into a red-rich sepia. Coefficients
  // pushed for a richer blood-tone at max.
  float grey = dot(color, vec3(0.299, 0.587, 0.114));
  vec3 redSepia = vec3(grey * 1.30, grey * 0.45, grey * 0.35);
  color = mix(color, redSepia, uRedShift * uIntensity);

  // Pulsing red vignette — multiplier bumped to 0.95 so the edges genuinely
  // close in on the thump. Vigette colour deeper too.
  vec2 vd = (vUv - 0.5) * vec2(resolution.x / resolution.y, 1.0);
  float vig = smoothstep(0.20, 0.85, length(vd));
  vec3 vigCol = vec3(0.60, 0.0, 0.05) * (0.4 + thump * 0.8);
  color = mix(color, vigCol, vig * uIntensity * 0.95);

  gl_FragColor = vec4(color, 1.0);
}
