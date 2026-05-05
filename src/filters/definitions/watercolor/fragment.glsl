// Watercolour
// Adapted from ShaderToy ltyGRV by florian berger (flockaroo) — CC BY-NC-SA 3.0
// https://www.shadertoy.com/view/ltyGRV
//
// Simulates a watercolour painting: ink outlines following luminance gradients,
// a colour wash that bleeds from dark to bright areas, paper grain and vignette.
// Replaces iChannel1 (noise texture) and iChannel2 (paper texture) with
// procedural equivalents.
//
// tDiffuse: composited scene render target (map + fog)
#ifdef GL_ES
precision mediump float;
#endif

uniform sampler2D tDiffuse;
uniform vec2  resolution;
uniform float uOutlineStrength;
uniform float uWashStrength;
uniform float uPaperGrain;
uniform float uWarmth;
uniform float uVignette;
uniform sampler2D uNoise;  // 256×256 RGBA noise (ShaderToy iChannel1)
uniform sampler2D uPaper;  // 512×512 paper texture (ShaderToy iChannel2)

varying vec2 vUv;

#define SAMP_NUM 16   // originally 24; reduced for performance

// Matches original: pos/Res1  (Res1 = 256×256, tiled with repeat wrapping)
vec4 getRand(vec2 pos) {
    return texture2D(uNoise, pos / 256.0);
}

// ─── Image sampling helpers ───────────────────────────────────────────────────

vec4 getCol(vec2 pos) {
    vec2 uv = pos / resolution;
    vec4 c1 = texture2D(tDiffuse, clamp(uv, 0.001, 0.999));
    // Green-screen removal (green cast → neutral grey)
    float d = clamp(dot(c1.xyz, vec3(-0.5, 1.0, -0.5)), 0.0, 1.0);
    return mix(c1, vec4(0.4), 1.8 * d);
}

// Bright-white version for wash bleed direction
vec4 getCol2(vec2 pos) {
    vec2 uv = pos / resolution;
    vec4 c1 = texture2D(tDiffuse, clamp(uv, 0.001, 0.999));
    float d = clamp(dot(c1.xyz, vec3(-0.5, 1.0, -0.5)), 0.0, 1.0);
    return mix(c1, vec4(1.5), 1.8 * d);
}

vec2 getGrad(vec2 pos, float delta) {
    vec2 d = vec2(delta, 0.0);
    vec2 g = vec2(
        dot((getCol(pos+d.xy) - getCol(pos-d.xy)).xyz, vec3(0.333)),
        dot((getCol(pos+d.yx) - getCol(pos-d.yx)).xyz, vec3(0.333))
    ) / delta;
    float gLen = length(g);
    return gLen > 0.3 ? g * (0.3 / gLen) : g;
}

vec2 getGrad2(vec2 pos, float delta) {
    vec2 d = vec2(delta, 0.0);
    vec2 g = vec2(
        dot((getCol2(pos+d.xy) - getCol2(pos-d.xy)).xyz, vec3(0.333)),
        dot((getCol2(pos+d.yx) - getCol2(pos-d.yx)).xyz, vec3(0.333))
    ) / delta;
    float gLen = length(g);
    return gLen > 0.3 ? g * (0.3 / gLen) : g;
}

// Halftone pattern for paper texture
float htPattern(vec2 pos) {
    float r = getRand(pos * 0.57).x;
    return clamp(pow(r + 0.3, 2.0) - 0.45, 0.0, 1.0);
}

float getVal(vec2 pos) {
    return length(getCol(pos).xyz) + 0.0001 * length(pos - 0.5 * resolution);
}

// Distance-field threshold: bright highlights vs dark areas, noise-dithered
vec4 getBWDist(vec2 pos) {
    return vec4(smoothstep(0.9, 1.1, getVal(pos) * 0.9 + htPattern(pos * 0.7)));
}

// ─── Main ──────────────────────────────────────────────────────────────────────

void main() {
    // Map fragment coordinate to source-image pixel space (preserving aspect ratio)
    vec2 pos  = gl_FragCoord.xy;
    vec2 pos2 = pos;
    vec2 pos3 = pos;
    vec2 pos4 = pos;
    vec2 pos0 = pos;

    vec3  col  = vec3(0.0);    // outline accumulator
    vec3  col2 = vec3(0.0);    // colour wash accumulator
    float cnt  = 0.0;
    float cnt2 = 0.0;

    for (int i = 0; i < SAMP_NUM; i++) {
        float fi = float(i);

        // Gradients with small noise jitter for organic look
        vec2 gr  = getGrad(pos,  2.0) + 0.0001 * (getRand(pos ).xy  - 0.5);
        vec2 gr2 = getGrad(pos2, 2.0) + 0.0001 * (getRand(pos2).xy  - 0.5);
        vec2 gr3 = getGrad2(pos3, 2.0) + 0.0001 * (getRand(pos3).xy - 0.5);
        vec2 gr4 = getGrad2(pos4, 2.0) + 0.0001 * (getRand(pos4).xy - 0.5);

        float grl  = clamp(10.0 * length(gr),  0.0, 1.0);
        float gr2l = clamp(10.0 * length(gr2), 0.0, 1.0);

        float safeGr  = max(length(gr),  0.00001);
        float safeGr2 = max(length(gr2), 0.00001);
        float safeGr3 = max(length(gr3), 0.00001);
        float safeGr4 = max(length(gr4), 0.00001);

        // Outline: stroke perpendicular to gradient
        pos  += 0.8 * (gr  / safeGr);
        pos2 -= 0.8 * (gr2 / safeGr2);

        float fact = 1.0 - fi / float(SAMP_NUM);
        col += fact * mix(vec3(1.2), getBWDist(pos ).xyz * 2.0, grl );
        col += fact * mix(vec3(1.2), getBWDist(pos2).xyz * 2.0, gr2l);

        // Wash: colour bleeds from dark to bright areas
        vec2 jitter = 0.5 * (getRand(pos0 * 0.07).xy - 0.5);
        pos3 += 0.25 * (gr3 / safeGr3) + jitter;
        pos4 -= 0.5  * (gr4 / safeGr4) + jitter;

        float f1 = 3.0 * fact;
        float f2 = 4.0 * (0.7 - fact);
        col2 += f1 * (getCol2(pos3).xyz + 0.25 + 0.4 * getRand(pos3).xyz);
        col2 += f2 * (getCol2(pos4).xyz + 0.25 + 0.4 * getRand(pos4).xyz);
        cnt2 += f1 + f2;
        cnt  += fact;
    }

    col  /= cnt  * 2.5;
    col2 /= max(cnt2 * 1.65, 0.001);

    // Blend outlines and wash colour
    vec3 result = clamp(clamp(col * uOutlineStrength, 0.0, 1.0) * col2 * uWashStrength, 0.0, 1.0);

    // Paper colour and grain — matches ltyGRV final composite:
    //   col * vec3(.93,.93,.85) * mix(iChannel2(fragCoord/res), vec3(1.2), .7) + .15*rand.x
    float paperNoise = getRand(pos0 * 2.5).x;
    vec3  paperTex   = texture2D(uPaper, gl_FragCoord.xy / resolution).rgb;
    vec3  paper      = vec3(0.93, 0.93, 0.85) * mix(paperTex, vec3(1.2), 0.7) * uWarmth;
    result = result * paper + uPaperGrain * 0.15 * paperNoise;

    // Vignette
    float r    = length((gl_FragCoord.xy - resolution * 0.5) / resolution.x);
    float vign = 1.0 - r * r * r * r * uVignette;
    result    *= vign;

    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
}
