// Ballpoint Blue
// Adapted from ShaderToy tsV3Rw by florian berger (flockaroo) — CC BY-NC-SA 3.0
// https://www.shadertoy.com/view/tsV3Rw
//
// Traces ballpoint pen strokes that follow luminance gradients of the source image.
// The scene is redrawn as if sketched with a ballpoint pen on paper.
//
// tDiffuse: composited scene render target (map + fog)
#ifdef GL_ES
precision mediump float;
#endif

uniform sampler2D tDiffuse;
uniform vec2  resolution;
uniform float uLineScale;
uniform vec3  uInkColour;
uniform vec3  uPaperColour;
uniform float uOverlayMode;  // 0 = paper, 1 = overlay strokes on source

varying vec2 vUv;

// Sample green channel (luminance proxy) at pixel position p
#define V(p) texture2D(tDiffuse, clamp((p) / resolution, 0.001, 0.999)).g

void main() {
    vec2 R = resolution;
    vec2 f = gl_FragCoord.xy;

    // Stroke width: scales with sqrt(width) so it looks consistent across resolutions
    float S = sqrt(R.x) / 30.0 * uLineScale;
    float h, s;

    vec4  c  = vec4(1.0);          // accumulated ink density (1=paper, lower=ink)
    vec2  d  = R / 200.0;          // cell size in pixels
    vec2  e  = vec2(d.x * 0.2, 0.0);
    vec2  p  = vec2(0.0);
    vec2  q  = vec2(0.0);
    vec2  v  = vec2(0.0);
    vec2  ij = vec2(0.0);

    // 1664 iterations = 104 strokes × 16 trace steps each.
    // Each stroke starts in one cell of a 13×8 grid centred on the current fragment.
    for (int j = 0; j < 1664; j++) {
        int k = j / 16;

        if (j % 16 == 0) {
            // New stroke: initialise at grid cell (k%13, k/13) offset from current fragment
            float km = float(k) - floor(float(k) / 13.0) * 13.0;
            ij = floor(f / d) + vec2(km, float(k / 13)) - 6.0;
            s  = mod(ij.y, 2.0) - 0.5;
            p  = (ij + s) * d;
            v  = vec2(0.0);
        }

        // Compute luminance gradient at current stroke position
        q      = p;
        vec2 g = V(p) - vec2(V(p - e), V(p - e.yx));

        // Soft-cap gradient magnitude: prevents fog-polygon hard edges from locking strokes
        // into straight-line rectangular artifacts. Natural image gradients are << 0.25;
        // fog boundaries produce ~1.0 which would otherwise dominate stroke direction.
        float gLen = length(g);
        if (gLen > 0.25) g *= 0.25 / gLen;

        h      = pow(dot(g, g), 0.3) * 20.0;
        gLen   = length(g);
        vec2  gN   = gLen > 0.00001 ? g / gLen : vec2(0.0, 1.0);

        // Steer stroke direction along the gradient using a cos-based rotation
        vec4 cosArg = 0.8 * vec4(4.0, 2.0, 6.0, 4.0) + atan(h) * 1.3 * s + s;
        v = mix(v, mat2(cos(cosArg)) * gN, atan(h * h / 8.0));
        p += v * d.x;

        // Accumulate ink where the stroke line passes close to this fragment
        g       = q - p;
        q       = f - p;
        float l = length(g);
        g      /= max(l, 0.00001);
        float hd   = dot(q, g);
        float perp = abs(dot(q, g.yx * vec2(1.0, -1.0)));
        c -= vec4(0.3, 0.2, 0.1, 0.0) * max(S - max(S - min(l - hd, hd), perp), 0.0);
    }

    // c.rgb: 1.0 = paper, dark = ink (blue-biased channels give characteristic ballpoint look)
    float inkLuma = 1.0 - clamp((c.r + c.g + c.b) / 3.0, 0.0, 1.0);
    vec3  src     = texture2D(tDiffuse, vUv).rgb;

    vec3 col;
    if (uOverlayMode > 0.5) {
        // Overlay: multiply stroke darkening onto the original image
        col = src * clamp(c.rgb * 1.2, 0.0, 1.0);
    } else {
        // Paper: pure pen sketch on a paper background
        col = mix(uPaperColour, uInkColour, clamp(inkLuma * 2.5, 0.0, 1.0));
    }

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
