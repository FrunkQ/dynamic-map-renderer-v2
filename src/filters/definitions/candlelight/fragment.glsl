// Candlelight Flicker — soft radial pool of warm light at screen centre, with
// the rest of the frame dimming to the edges. Brightness modulated by a
// multi-frequency sine sum so the flicker reads as organic flame rather
// than a single sine wobble.

uniform sampler2D tDiffuse;
uniform vec2      resolution;
uniform float     time;
uniform float     uWarmth;
uniform float     uReach;
uniform float     uDarkness;
uniform float     uFlicker;
varying vec2      vUv;

void main() {
  vec4 color = texture2D(tDiffuse, vUv);

  // Distance from centre, aspect-corrected so the pool stays round.
  vec2 d = (vUv - 0.5) * vec2(resolution.x / resolution.y, 1.0);
  float r = length(d);

  // Soft vignette — bright inside reachR*0.3, fades to dark by reachR.
  float reachR  = mix(0.18, 0.95, uReach);
  float vig     = 1.0 - smoothstep(reachR * 0.3, reachR, r);
  float vignette = mix(1.0, vig, uDarkness);

  // Multi-frequency flicker. Three sines at incommensurate ratios give a
  // pattern that doesn't visibly repeat — feels alive.
  float wobble = sin(time * 9.0)  * 0.45
               + sin(time * 23.0) * 0.20
               + sin(time * 5.3)  * 0.35;
  float flick = 1.0 + wobble * 0.15 * uFlicker;

  // Warm grading toward firelight orange. mix() preserves the original tone
  // when warmth = 0 and pushes fully into amber territory at warmth = 1.
  vec3 warmTint = vec3(1.12, 0.90, 0.65);
  color.rgb = mix(color.rgb, color.rgb * warmTint, uWarmth);

  color.rgb *= vignette * flick;

  gl_FragColor = color;
}
