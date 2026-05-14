// Image — ray-marches the cubemap density to produce the final flame frame.
// Source: https://www.shadertoy.com/view/dsKfWR (al-ro, MIT)
// NOTE: Placeholder until the real Image pass is captured from the link above.
// Kept so the folder structure mirrors the upstream Shadertoy layout.

void mainImage( out vec4 fragColor, in vec2 fragCoord ) {
    vec2 uv = fragCoord / iResolution.xy;
    fragColor = vec4(uv, 0.0, 1.0);
}
