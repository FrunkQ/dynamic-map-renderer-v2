// Drunk / Poisoned — slow swooning UV wobble + breathing chromatic split +
// optional sickly green wash. Different feel from Underwater: that one is
// fast-wiggle refraction; this is slow-pendulum disorientation. Pair the
// "tint" slider with a green colour for poison or push toward blue for
// cold-sweat horror.

uniform sampler2D tDiffuse;
uniform vec2      resolution;
uniform float     time;
uniform float     uWobble;
uniform float     uAberration;
uniform float     uTint;
uniform vec3      uTintColor;
varying vec2      vUv;

void main() {
  // Pendulum sway — slow, broad, on two axes at different rates so the
  // motion never lines up into a circle or back-and-forth band.
  // Amplitudes doubled vs the first pass — the wobble was too polite to
  // sell disorientation at max slider.
  vec2 sway = vec2(
    sin(time * 0.55 + 0.7) * 0.040,
    cos(time * 0.38)       * 0.027
  ) * uWobble;

  vec2 sUv = vUv + sway;

  // Breathing chromatic aberration — slow envelope. Magnitude is driven
  // entirely by the slider now (no implicit clamp) so cranking it really
  // smears the channels apart.
  vec2 d = vUv - 0.5;
  float caEnv = 0.6 + sin(time * 0.7) * 0.4;
  float caAmt = uAberration * caEnv;

  float r = texture2D(tDiffuse, sUv - d * caAmt).r;
  float g = texture2D(tDiffuse, sUv).g;
  float b = texture2D(tDiffuse, sUv + d * caAmt).b;
  vec3 color = vec3(r, g, b);

  // Sickly tint — apply as a multiplicative wash so the underlying map
  // still bleeds through. Default colour is poison green; user can pick.
  color = mix(color, color * uTintColor, uTint);

  gl_FragColor = vec4(color, 1.0);
}
