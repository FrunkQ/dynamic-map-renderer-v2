// Hand Drawing
// Adapted from ShaderToy XtVGD1 by florian berger (flockaroo) — CC BY-NC-SA 3.0
// https://www.shadertoy.com/view/XtVGD1
//
// Simulates hatching and ink-line hand-drawing with halftone colour.
//
// tDiffuse: composited scene render target (map + fog)
#ifdef GL_ES
precision mediump float;
#endif

uniform sampler2D tDiffuse;
uniform vec2  resolution;
uniform float time;
uniform float uStrokeIntensity;  // ink-density exponent: low=soft, high=harsh
uniform float uStrokeSpread;     // perpendicular spread of stroke samples (width)
uniform float uStrokeCurl;       // along-stroke curvature amount
uniform float uColour;           // 1=full halftone colour, 0=greyscale ink
uniform float uJitter;           // static noise-based position jitter (hand-drawn shakiness)
uniform float uVignette;
uniform float uShowKaro;         // 1 = show subtle graph-paper grid
uniform sampler2D uNoise;        // 256×256 RGBA noise texture (ShaderToy iChannel1)

varying vec2 vUv;

#define PI2   6.28318530717959
#define ANGS  2   // number of hatching angles (2 = cross-hatch; originally 3)
#define SAMPS 8   // samples per angle (originally 16; halved for performance)

// Matches original: pos/Res1/iResolution.y*1080  (Res1 = 256×256)
vec4 getRand(vec2 pos) {
    return texture2D(uNoise, pos / 256.0 * (1080.0 / resolution.y));
}

// ─── Image sampling ────────────────────────────────────────────────────────────

// Sample source at pixel position pos, with edge-fade to white at borders
vec4 getCol(vec2 pos) {
    vec2 uv = pos / resolution;
    vec4 c1 = texture2D(tDiffuse, clamp(uv, 0.001, 0.999));
    // Fade to white near edges so strokes don't bleed onto the background colour
    vec4 e = smoothstep(vec4(-0.05), vec4(0.0), vec4(uv.x, uv.y, 1.0-uv.x, 1.0-uv.y));
    c1 = mix(vec4(1.0, 1.0, 1.0, 0.0), c1, e.x * e.y * e.z * e.w);
    float d = clamp(dot(c1.xyz, vec3(-0.5, 1.0, -0.5)), 0.0, 1.0);
    return min(mix(c1, vec4(0.7), 1.8 * d), 0.7);
}

// Halftone threshold version — noise-dithered posterisation
vec4 getColHT(vec2 pos) {
    return smoothstep(0.95, 1.05, getCol(pos) * 0.8 + 0.2 + getRand(pos * 0.7));
}

float getVal(vec2 pos) {
    return dot(getCol(pos).xyz, vec3(0.333));
}

// Finite-difference luminance gradient, magnitude soft-capped to prevent fog-edge artifacts
vec2 getGrad(vec2 pos, float eps) {
    vec2 d = vec2(eps, 0.0);
    vec2 g = vec2(
        getVal(pos + d.xy) - getVal(pos - d.xy),
        getVal(pos + d.yx) - getVal(pos - d.yx)
    ) / (eps * 2.0);
    float gLen = length(g);
    return gLen > 0.3 ? g * (0.3 / gLen) : g;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

void main() {
    // Static noise-based jitter — gives a hand-drawn shakiness without needing animation.
    // Uses two noise channels for independent x/y offset.
    vec2 jitter = (getRand(gl_FragCoord.xy * 0.03).xy - 0.5) * 2.0;
    vec2 pos = gl_FragCoord.xy + jitter * (resolution.y / 400.0) * uJitter;

    vec3  col  = vec3(0.0);
    vec3  col2 = vec3(0.0);
    float sum  = 0.0;

    for (int i = 0; i < ANGS; i++) {
        float ang = PI2 / float(ANGS) * (float(i) + 0.8);
        vec2  v   = vec2(cos(ang), sin(ang));

        for (int j = 0; j < SAMPS; j++) {
            float fj = float(j);
            // dpos: perpendicular spread — controls stroke width/coverage
            vec2 dpos  = v.yx * vec2(1.0, -1.0) * fj * (resolution.y / 400.0) * uStrokeSpread;
            // dpos2: along-stroke curvature — controls how much each stroke curves
            vec2 dpos2 = v.xy * fj * fj / float(SAMPS) * 0.5 * (resolution.y / 400.0) * uStrokeCurl;

            // Two symmetric samples either side of the stroke axis (s = -1 and +1)

            // s = -1
            {
                vec2 pos2 = pos - dpos + dpos2;
                vec2 pos3 = pos + (-dpos + dpos2).yx * vec2(1.0, -1.0) * 2.0;
                vec2 g    = getGrad(pos2, 0.4);
                float fact  = dot(g, v) - 0.5 * abs(dot(g, v.yx * vec2(1.0, -1.0)));
                float fact2 = abs(dot(normalize(g + vec2(0.0001)), v.yx * vec2(1.0, -1.0)));
                fact = clamp(fact, 0.0, 0.05) * (1.0 - fj / float(SAMPS));
                col  += fact;
                col2 += fact2 * getColHT(pos3).xyz;
                sum  += fact2;
            }

            // s = +1
            {
                vec2 pos2 = pos + dpos + dpos2;
                vec2 pos3 = pos + (dpos + dpos2).yx * vec2(1.0, -1.0) * 2.0;
                vec2 g    = getGrad(pos2, 0.4);
                float fact  = dot(g, v) - 0.5 * abs(dot(g, v.yx * vec2(1.0, -1.0)));
                float fact2 = abs(dot(normalize(g + vec2(0.0001)), v.yx * vec2(1.0, -1.0)));
                fact = clamp(fact, 0.0, 0.05) * (1.0 - fj / float(SAMPS));
                col  += fact;
                col2 += fact2 * getColHT(pos3).xyz;
                sum  += fact2;
            }
        }
    }

    col  /= float(SAMPS * ANGS) * 0.75 / sqrt(resolution.y);
    col2 /= max(sum, 0.001);

    // Desaturate col2 toward greyscale ink when uColour < 1.0
    float grey = dot(col2, vec3(0.333));
    col2 = mix(vec3(grey), col2, uColour);

    col.x *= 0.6 + 0.8 * getRand(pos * 0.7).x;
    col.x = 1.0 - col.x;
    // uStrokeIntensity is the exponent on the ink-density curve.
    // Low (1–2) = soft, barely-there hatching.  High (4–6) = dense, harsh strokes.
    // Default 3.0 matches the original ShaderToy cubic (pow(x, 3.0)).
    col.x = pow(col.x, uStrokeIntensity);

    // Optional faint graph-paper grid ("karo"), scale with screen height
    vec2 sc   = sin(gl_FragCoord.xy * 0.1 / sqrt(resolution.y / 400.0));
    vec3 karo = vec3(1.0);
    if (uShowKaro > 0.5) {
        karo -= 0.5 * vec3(0.25, 0.1, 0.1) * dot(exp(-sc * sc * 80.0), vec2(1.0));
    }

    float r    = length((gl_FragCoord.xy - resolution * 0.5) / resolution.x);
    float vign = 1.0 - r * r * r * uVignette;

    vec3 result = col.x * col2 * karo * vign;

    gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
}
