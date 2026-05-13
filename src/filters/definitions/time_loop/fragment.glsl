// Time-Loop Ghosting — three colour-channel echoes orbit around the current
// frame at different rates, plus a slow scale-breathing wobble. Together
// they read as "this moment is happening multiple times at once" — déjà
// vu, temporal slippage, repeating-day horror. WebGL 1 has no prior-frame
// texture exposed, so we fake the trail by sampling the live frame at
// rotating offsets — convincing enough for stationary maps.

uniform sampler2D tDiffuse;
uniform vec2      resolution;
uniform float     time;
uniform float     uGhost;
uniform float     uSpeed;
uniform float     uBreathe;
uniform float     uFlicker;
varying vec2      vUv;

void main() {
  // Slow scale wobble around the centre — the image breathes in and out.
  vec2 dC = vUv - 0.5;
  float scaleW = 1.0 + sin(time * 0.5 * uSpeed) * 0.006 * uBreathe;
  vec2 sUv = 0.5 + dC * scaleW;

  // Three orbiting offsets at different rates / phases. Magnitude grows
  // with the ghost slider; the channel that lags farthest is blue (cool
  // déjà-vu tint), then green, then red leading.
  float t = time * uSpeed;
  vec2 oR = vec2(cos(t * 1.0),       sin(t * 1.0)      ) * 0.008 * uGhost;
  vec2 oG = vec2(cos(t * 1.4 + 2.1), sin(t * 1.4 + 2.1)) * 0.014 * uGhost;
  vec2 oB = vec2(cos(t * 0.7 + 4.2), sin(t * 0.7 + 4.2)) * 0.020 * uGhost;

  float r = texture2D(tDiffuse, sUv + oR).r;
  float g = texture2D(tDiffuse, sUv + oG).g;
  float b = texture2D(tDiffuse, sUv + oB).b;
  vec3 color = vec3(r, g, b);

  // Subtle high-frequency flicker — the moment "skipping".
  float flick = 1.0 + sin(time * 17.0) * 0.04 * uFlicker;
  color *= flick;

  gl_FragColor = vec4(color, 1.0);
}
