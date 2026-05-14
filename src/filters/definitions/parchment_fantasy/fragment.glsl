// Parchment Fantasy Filter
// Aged paper, sepia, candlelight — for fantasy/historical settings.
//
// uPaperTexture: a repeating paper grain texture (sampler2D)
//   - Loaded from paper_grain.webp by FilterRegistry
//   - If absent, FilterRegistry provides a procedural noise fallback
//   - Replace with a photographed paper scan for maximum realism
//
// tDiffuse: composited scene render target (map + fog layers)
#ifdef GL_ES
precision mediump float;
#endif

uniform sampler2D tDiffuse;
uniform sampler2D uPaperTexture;

uniform float uSepiaStrength;
uniform float uWarmth;
uniform float uBrightness;
uniform float uContrast;
uniform float uAgeSpots;
uniform float uPaperGrain;
uniform float uPaperScale;
uniform float uPaperContrast;
uniform float uEdgeBurn;
uniform float uInkSoftening;
uniform float uFlicker;
uniform float uRaggedBorder;
uniform float time;

varying vec2 vUv;

// ─── Helpers ──────────────────────────────────────────────────────────────────

float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

// fBm: fractal Brownian motion — layered noise for organic patterns
float noise(vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm(vec2 st) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for (int i = 0; i < 5; i++) {
        value += amplitude * noise(st * frequency);
        frequency *= 2.0;
        amplitude *= 0.5;
    }
    return value;
}

// Classic sepia matrix
vec3 sepia(vec3 color) {
    return vec3(
        dot(color, vec3(0.393, 0.769, 0.189)),
        dot(color, vec3(0.349, 0.686, 0.168)),
        dot(color, vec3(0.272, 0.534, 0.131))
    );
}

// Gentle box-blur approximation using 5 taps for ink softening
vec3 softBlur(sampler2D tex, vec2 uv, float radius) {
    vec3 col = texture2D(tex, uv).rgb;
    col += texture2D(tex, uv + vec2( radius,  0.0)).rgb;
    col += texture2D(tex, uv + vec2(-radius,  0.0)).rgb;
    col += texture2D(tex, uv + vec2( 0.0,  radius)).rgb;
    col += texture2D(tex, uv + vec2( 0.0, -radius)).rgb;
    return col / 5.0;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

void main() {
    // 1. Sample the scene — with optional ink softening (mild blur)
    float blurRadius = uInkSoftening * 0.003;
    vec3 sceneColor = (blurRadius > 0.0005)
        ? softBlur(tDiffuse, vUv, blurRadius)
        : texture2D(tDiffuse, vUv).rgb;

    // 2. Brightness / contrast
    sceneColor = (sceneColor - 0.5) * uContrast + 0.5;
    sceneColor = sceneColor * uBrightness;

    // 3. Sepia tone
    vec3 sepiaColor = sepia(sceneColor);
    sceneColor = mix(sceneColor, sepiaColor, uSepiaStrength);

    // 4. Extra warmth — shift red/green up, blue down
    sceneColor.r = min(sceneColor.r + uWarmth * 0.08, 1.0);
    sceneColor.g = min(sceneColor.g + uWarmth * 0.04, 1.0);
    sceneColor.b = max(sceneColor.b - uWarmth * 0.12, 0.0);

    // 5. Paper texture overlay (samples uPaperTexture; falls back gracefully if white)
    vec2 paperUv = vUv * uPaperScale;
    float paperSample = texture2D(uPaperTexture, paperUv).r;
    // Remap to -0.5..0.5 range, scale by contrast and grain intensity
    float paperOffset = (paperSample - 0.5) * uPaperContrast;
    sceneColor += vec3(paperOffset * uPaperGrain);

    // 6. Age spots / foxing — multi-scale brown stains
    //
    // Rebuilt 2026-05-14 because the previous incarnation was too
    // subtle even at uAgeSpots=1 (just a mild darkening). Real foxing
    // shows distinct rust-brown blotches of varied sizes, so we
    // sample three octaves of low-frequency noise (large patches,
    // medium spots, small flecks), pick the high tail of each via
    // smoothstep, and mix toward a warm rust-brown rather than
    // simply subtracting RGB. The result reads as proper foxing at
    // moderate values and heavy aged-paper at the top of the range.
    if (uAgeSpots > 0.0) {
        float spotA = fbm(vUv * 4.0  + vec2(13.7, 5.3));
        float spotB = fbm(vUv * 10.0 + vec2( 2.1, 8.9));
        float spotC = fbm(vUv * 22.0 + vec2( 7.8, 3.2));
        // Large patches start at noise > 0.55, fade to fully visible
        // at 0.70. Medium and small fade in at higher thresholds and
        // contribute less so they read as accents on the patches.
        float patchLarge  = smoothstep(0.55, 0.70, spotA);
        float patchMedium = smoothstep(0.55, 0.72, spotB) * 0.70;
        float patchSmall  = smoothstep(0.62, 0.78, spotC) * 0.45;
        float spots = clamp((patchLarge + patchMedium + patchSmall) * uAgeSpots, 0.0, 1.0);
        // Rust-brown stain colour. Multiply the existing scene by it
        // (so light parchment areas pick up the warm brown, dark ink
        // areas stay dark). The mix factor is capped below 1.0 so
        // even heavy foxing doesn't completely overwrite the map.
        vec3 foxingTint = vec3(0.42, 0.22, 0.10);
        sceneColor = mix(sceneColor, sceneColor * foxingTint * 2.4, spots * 0.85);
    }

    // 7. Edge burn — vignetted darkening towards corners
    {
        vec2 edgeUv = vUv - 0.5;
        float edgeDist = dot(edgeUv, edgeUv) * 4.0;
        float burnFactor = 1.0 - smoothstep(0.3, 1.6, edgeDist) * uEdgeBurn;
        sceneColor *= burnFactor;
    }

    // 8. Ragged black border — torn / burned parchment edge.
    //    Distance from the nearest edge is perturbed by noise so the
    //    border eats into the image in irregular tatters rather than
    //    a clean vignette. The border darkens to near-black at the
    //    image edge and fades into the parchment over a soft band.
    //    Independent of uEdgeBurn (which is a soft vignette);
    //    uRaggedBorder is the harder, blacker, more "torn" look.
    if (uRaggedBorder > 0.0) {
        vec2 fromCentre = abs(vUv - 0.5) * 2.0; // 0 centre, 1 at edge
        float edgeDist  = max(fromCentre.x, fromCentre.y);
        // Two-octave noise gives the tatter shape: lower-freq for
        // big bites, higher-freq for fine ragged detail.
        float raggedA = fbm(vUv * 14.0 + vec2(3.7, 11.1));
        float raggedB = fbm(vUv * 38.0 + vec2(9.2,  2.4));
        float rag     = (raggedA - 0.5) * 0.18 + (raggedB - 0.5) * 0.06;
        float raggedEdgeDist = edgeDist + rag;
        // Border zone: 0.82..1.0 of the noise-perturbed distance.
        // Start of band = faint; end = near-black, scaled by slider.
        float borderAmount = smoothstep(0.82, 1.0, raggedEdgeDist) * uRaggedBorder;
        sceneColor *= 1.0 - clamp(borderAmount, 0.0, 0.98);
    }

    // 9. Candlelight flicker — low-frequency brightness variation
    if (uFlicker > 0.0) {
        float f1 = random(vec2(floor(time * 7.0), 0.0));
        float f2 = random(vec2(floor(time * 13.0), 1.0));
        float flicker = (mix(f1, f2, fract(time * 7.0)) - 0.5) * uFlicker;
        // Flicker also slightly shifts colour temperature for candle realism
        sceneColor.r += flicker * 0.8;
        sceneColor.g += flicker * 0.5;
        sceneColor.b += flicker * 0.2;
    }

    gl_FragColor = vec4(clamp(sceneColor, 0.0, 1.0), 1.0);
}
