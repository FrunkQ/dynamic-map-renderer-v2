// Cubemap A — volume density / velocity stored as a cubemap.
// Source: https://www.shadertoy.com/view/dsKfWR (al-ro, MIT)
// NOTE: Placeholder. See bufferB.glsl note — the upstream Cubemap A pass
// needs to be re-fetched from the Shadertoy link above if this shader is
// ever wired into the renderer for real.

void mainCubemap( out vec4 fragColor, in vec2 fragCoord, in vec3 rayOri, in vec3 rayDir ) {
    fragColor = vec4(0.0);
}
