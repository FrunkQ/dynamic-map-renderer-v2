# fire-fluid (under evaluation, not wired)

Multi-pass semi-Lagrangian flow simulation for a volumetric fire.

- Source: https://www.shadertoy.com/view/dsKfWR
- Author: al-ro
- Licence: MIT (see `common.glsl` header)

## Status

This shader is saved here for evaluation only. It is NOT wired into the
renderer. The current MapFX fire effect uses the single-pass `fire/` shader
(Promethean by nimitz).

## Passes

The upstream Shadertoy uses five tabs which would map onto a multi-pass
WebGL pipeline:

| File           | Role |
| -------------- | ---- |
| `common.glsl`  | Shared helpers, constants, lookup utilities. |
| `bufferA.glsl` | Tracks mouse / resolution / camera state between frames. |
| `bufferB.glsl` | (placeholder) Fluid step / advection. |
| `cubemapA.glsl`| (placeholder) Volume density + velocity stored as a cubemap. |
| `image.glsl`   | (placeholder) Ray-marches the cubemap to produce the final RGBA. |

`bufferB.glsl`, `cubemapA.glsl`, and `image.glsl` currently contain stubs.
If we choose to actually wire this in, the real GLSL from the Shadertoy
link above needs to be pasted back into those files.

## To wire in

This is roughly a 1.5–2 day job. Notes for future-Alex:

- Add a multi-pass driver in `src/rendering/` that owns three render targets
  plus a `WebGLCubeRenderTarget` for the cubemap.
- Ping-pong the cubemap between frames (read-from / write-to).
- Drive uniforms: `iTime`, `iFrame`, `iResolution`, `iMouse`, plus our own
  `uColor` (replace mouse-driven flame colour) and `uMaskAlpha` (mask the
  output to the fire polygons).
- Final image pass blends additively over the player view, like `fire/` does.

If this proves too heavy for the perf budget, delete this whole folder and
the corresponding ACKNOWLEDGEMENTS entry — Promethean stays as the v1 fire.
