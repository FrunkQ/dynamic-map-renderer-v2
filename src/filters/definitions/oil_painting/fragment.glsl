// Oil Painting
// Adapted from ShaderToy Mlcczf by florian berger (flockaroo) — CC BY-NC-SA 3.0
// https://www.shadertoy.com/view/Mlcczf
//
// Single-pass combination of:
//   Buffer A — kubelka-munk-style painterly stroke simulation
//   Image    — relief/impasto lighting from luminance gradients
//
// The original uses two render passes (Buffer A → Image). Here both are inlined;
// the Image pass reads from tDiffuse (source) at manually-blurred LOD levels
// instead of the Buffer A render target.
//
// tDiffuse: composited scene render target (map + fog)
#ifdef GL_ES
precision mediump float;
#endif

uniform sampler2D tDiffuse;
uniform vec2  resolution;
uniform float uStrokeSize;
uniform float uReliefStrength;
uniform float uLightAngle;    // degrees 0–360
uniform float uSaturation;
uniform float uVignette;
uniform sampler2D uNoise;  // 256×256 RGBA noise (ShaderToy iChannel1)

varying vec2 vUv;

#define SAMP_NUM 16   // stroke samples (original Buffer A uses 24)

// ─── Noise — matches original: pos/Res1  (Res1 = 256×256) ────────────────────

vec4 getRand(vec2 pos) {
    return texture2D(uNoise, pos / 256.0);
}

// Blue-noise: two samples offset by half-texture-period (matches getRandBlue in original)
vec4 getRandBlue(vec2 pos) {
    vec2 uv = pos / 256.0;
    vec4 c  = clamp((texture2D(uNoise, uv) - texture2D(uNoise, uv + 0.5)) * 1.2 + 0.5, 0.0, 1.0);
    return mix(c.xxxx, c, 0.3);
}

// ─── Buffer A helpers ─────────────────────────────────────────────────────────

// Simplified getCol: original had green-screen removal (vec3(-0.5,1,-0.5) test),
// irrelevant for map images since no green-screen pixels will trigger it.
vec4 getCol(vec2 pos) {
    vec2 uv = pos / resolution;
    return texture2D(tDiffuse, clamp(uv, 0.001, 0.999));
}

float getVal(vec2 pos) {
    return length(getCol(pos).xyz) + 0.0002 * length(pos - 0.5 * resolution);
}

vec2 getGradA(vec2 pos, float delta) {
    vec2 d = vec2(delta, 0.0);
    vec2 g = vec2(
        getVal(pos + d.xy) - getVal(pos - d.xy),
        getVal(pos + d.yx) - getVal(pos - d.yx)
    ) / delta;
    float gLen = length(g);
    return gLen > 0.3 ? g * (0.3 / gLen) : g;
}

// Dithered colour distribution (Buffer A "getColDist")
vec4 getColDist(vec2 pos) {
    vec4 srcCol = getCol(pos);
    vec4 noise  = pow(getRandBlue(pos), vec4(0.75)) * 0.75;
    return 1.0 - smoothstep(0.5, 1.5, (1.0 - srcCol) + noise);
}

// ─── Image pass helpers (relief lighting) ────────────────────────────────────

// Box blur at radius r pixels (5-tap approximation of LOD level in original)
float blurVal(vec2 uv, float r) {
    vec2 step = vec2(r) / resolution;
    float v  = length(texture2D(tDiffuse, uv).rgb);
    v += length(texture2D(tDiffuse, uv + step * vec2( 1.0,  0.0)).rgb);
    v += length(texture2D(tDiffuse, uv + step * vec2(-1.0,  0.0)).rgb);
    v += length(texture2D(tDiffuse, uv + step * vec2( 0.0,  1.0)).rgb);
    v += length(texture2D(tDiffuse, uv + step * vec2( 0.0, -1.0)).rgb);
    return v / 5.0;
}

// Multi-scale luminance value for surface-normal computation
float getSurfaceVal(vec2 uv) {
    return blurVal(uv, 6.0) * 0.6
         + blurVal(uv, 3.0) * 0.3
         + blurVal(uv, 1.5) * 0.2;
}

vec2 getSurfaceGrad(vec2 uv, float delta) {
    vec2 d = vec2(delta / resolution.y, 0.0);
    return vec2(
        getSurfaceVal(uv + d.xy) - getSurfaceVal(uv - d.xy),
        getSurfaceVal(uv + d.yx) - getSurfaceVal(uv - d.yx)
    ) / (delta / resolution.y);
}

// ─── Main ──────────────────────────────────────────────────────────────────────

void main() {
    vec2 uv   = vUv;
    vec2 pos0 = gl_FragCoord.xy;

    // ── Buffer A: oil-paint stroke pass ──────────────────────────────────────
    vec2  spos = pos0;
    vec3  bufA = vec3(0.0);
    float cnt  = 0.0;
    float scale = uStrokeSize * resolution.x / 600.0;

    for (int i = 0; i < SAMP_NUM; i++) {
        bufA += getColDist(spos).xyz;

        // Follow gradient contours (three spatial scales summed)
        vec2 gr = getGradA(spos, 8.0 * scale)
                + getGradA(spos, 4.0 * scale)
                + getGradA(spos, 2.0 * scale);

        float grLen = length(gr);
        if (grLen > 0.0001) {
            // Move perpendicular to gradient (along iso-luminance contour)
            vec2 d = gr.yx * vec2(1.0, -1.0);
            spos += 0.5 * scale * d / grLen;
        }
        cnt += 1.0;
    }
    bufA /= max(cnt, 1.0);

    // ── Image pass: relief / impasto lighting ─────────────────────────────────
    vec2  grad   = getSurfaceGrad(uv, 1.0);
    vec3  normal = normalize(vec3(grad, 150.0 / uReliefStrength));

    float rad   = (uLightAngle - 45.0) * 3.14159265 / 180.0;
    vec3  light = normalize(vec3(cos(rad), -sin(rad), 0.8));

    float diff  = clamp(dot(normal, light), 0.0, 1.0);
    float spec  = pow(clamp(dot(reflect(light, normal), vec3(0.0, 0.0, -1.0)), 0.0, 1.0), 12.0) * 0.5;
    float sh    = pow(clamp(dot(reflect(light * vec3(-1.0,-1.0, 1.0), normal), vec3(0.0, 0.0, -1.0)), 0.0, 1.0), 4.0) * 0.1;

    // Blend Buffer A output with diffuse/specular lighting
    vec3 lit = bufA * mix(diff, 1.0, 0.8) + spec * vec3(0.85, 1.0, 1.15) - sh * vec3(0.85, 1.0, 1.15);

    // Saturation control
    float luma = dot(lit, vec3(0.299, 0.587, 0.114));
    lit = mix(vec3(luma), lit, uSaturation);

    // Vignette
    vec2 scc   = (gl_FragCoord.xy - 0.5 * resolution) / resolution.x;
    float vign = 1.3 - 2.5 * dot(scc, scc);
    vign *= 1.0 - 0.8 * exp(-sin(uv.x * 3.1416) * 20.0);
    vign *= 1.0 - 0.8 * exp(-sin(uv.y * 3.1416) * 10.0);
    vign  = mix(1.0, vign, uVignette);
    lit  *= vign;

    gl_FragColor = vec4(clamp(lit, 0.0, 1.0), 1.0);
}
