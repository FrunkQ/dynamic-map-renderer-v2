// Buffer B — semi-Lagrangian advection / fluid step.
// Source: https://www.shadertoy.com/view/dsKfWR (al-ro, MIT)
// NOTE: This is a placeholder copy of the Buffer B pass; full content was not
// pasted in the source conversation. If you wire this shader in for real,
// replace this file with the actual Buffer B GLSL from the Shadertoy link
// above. Kept here only so the folder structure mirrors the original work.

void mainImage( out vec4 fragColor, in vec2 fragCoord ) {
    // Pass-through stub until the real Buffer B is captured.
    fragColor = texture(iChannel0, fragCoord / iResolution.xy);
}
