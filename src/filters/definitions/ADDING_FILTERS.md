# Adding a New Filter

Filters are fully self-contained. Adding one requires a new folder with two files — no registry edits, no imports elsewhere.

## How it works

Filters are full-screen post-processing effects applied to the player's view only. The GM always sees the raw unfiltered map.

The rendering pipeline is:

```
Scene (map + fog)
  → RenderPass (renders to texture)
  → ClipPass (fills letterbox/pillarbox bars with background colour)
  → ShaderPass (your filter GLSL runs here — sees the full composited frame)
  → OutputPass (SRGB colour space conversion)
  → Screen
```

Your fragment shader receives the full composited frame (map + fog, already clipped) as `tDiffuse` and writes the filtered result to `gl_FragColor`.

## File structure

```
src/filters/definitions/
  your_filter_id/
    config.ts          ← FilterDefinition (params, shader file refs, metadata)
    vertex.glsl        ← vertex shader (usually the passthrough below)
    fragment.glsl      ← fragment shader (your effect)
    texture.webp       ← optional — any extra textures declared in config.ts
```

The registry auto-discovers `config.ts` files via `import.meta.glob`. Any module with a valid default export is added to the filter dropdown automatically.

## Minimal example

**`config.ts`**
```typescript
import type { FilterDefinition } from '../../schema.ts';
import vertexShader   from './vertex.glsl?raw';
import fragmentShader from './fragment.glsl?raw';

export default {
  id:          'my_filter',    // must be unique; matches folder name by convention
  name:        'My Filter',    // shown in the GM dropdown
  description: 'One-line description shown as tooltip.',
  vertexShader,
  fragmentShader,
  animated: false,             // true only if your shader uses the `time` uniform
  params: [
    {
      type: 'slider',
      id: 'intensity',
      label: 'Intensity',
      min: 0, max: 1, step: 0.01, default: 0.5,
    },
  ],
} satisfies FilterDefinition;
```

**`vertex.glsl`** (standard passthrough — copy this verbatim)
```glsl
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
```

**`fragment.glsl`** (your effect)
```glsl
uniform sampler2D tDiffuse;
uniform vec2      resolution;
uniform float     intensity;   // matches param id
varying vec2      vUv;

void main() {
  vec4 color = texture2D(tDiffuse, vUv);
  // example: desaturate by intensity
  float grey  = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  gl_FragColor = vec4(mix(color.rgb, vec3(grey), intensity), color.a);
}
```

## Built-in uniforms (always available)

| Uniform | Type | Description |
|---|---|---|
| `tDiffuse` | `sampler2D` | The composited scene (map + fog, clipped) |
| `resolution` | `vec2` | Framebuffer size in physical pixels |
| `time` | `float` | Seconds since page load — only updated when `animated: true` |

## Param uniforms

Every param declared in `config.ts` is automatically injected as a GLSL uniform with a **`u`-prefixed PascalCase** name derived from its `id`. The runtime applies this transform — your shader must declare the uniform under the prefixed name or the value won't flow through.

| Param `id` (in config.ts) | GLSL uniform (in shader) |
|---|---|
| `intensity` | `uIntensity` |
| `scanlineThickness` | `uScanlineThickness` |
| `chromaticAberration` | `uChromaticAberration` |

| Param type | GLSL type |
|---|---|
| `slider` | `float` |
| `toggle` | `float` (0.0 / 1.0 — declare as `float`, not `bool`) |
| `color` | `vec3` (linear sRGB, 0–1) |
| `select` (numeric value) | `float` |
| `select` (string value) | not injectable — handle via multiple shader variants or map to int |

## Texture uniforms

Declare image files in `config.ts` and they are loaded, cached, and passed as `sampler2D` uniforms automatically:

```typescript
textures: [
  {
    uniformName: 'uPaperTexture',  // name in your fragment shader
    file: 'paper_grain.webp',      // path relative to the filter folder
    wrapS: 'repeat',               // 'repeat' (default) or 'clamp'
    wrapT: 'repeat',
  },
],
```

Then in your fragment shader:
```glsl
uniform sampler2D uPaperTexture;
// ...
vec4 grain = texture2D(uPaperTexture, vUv * scale);
```

## Param groups

Group params into collapsible sections in the filter panel:

```typescript
groups: [
  { id: 'color',   label: 'Colour' },
  { id: 'effects', label: 'Effects', collapsed: true },
],
params: [
  { type: 'slider', id: 'hue',       label: 'Hue',       ..., group: 'color'   },
  { type: 'slider', id: 'scanlines', label: 'Scanlines',  ..., group: 'effects' },
],
```

Params without a `group` appear above all groups.

## Animated filters

If your shader uses the `time` uniform for visible animation (flickering, scrolling, pulsing), set `animated: true`. The renderer then runs at full 60 fps for your filter instead of rendering once per state change.

```glsl
uniform float time;
// ...
float flicker = 1.0 + sin(time * 12.0) * 0.02;
```

Only set `animated: true` when the animation is actually visible — static filters that declare it unnecessarily burn GPU continuously.

## Tips

- **Write GLSL ES 1.00** — Three.js EffectComposer targets WebGL 1. Avoid `texture()` (use `texture2D()`), no `in`/`out` qualifiers, no layout qualifiers.
- **`vUv` is 0–1 UV space** — `(0,0)` is bottom-left in GL convention but top-left in screen space due to Three.js's default flip. Test carefully with asymmetric effects.
- **`resolution` is physical pixels** — multiply by `devicePixelRatio`-adjusted values for pixel-accurate effects like scanlines or halftone.
- **Colour space** — `tDiffuse` arrives in linear sRGB (before `OutputPass` converts to display sRGB). Keep your maths in linear space; `OutputPass` handles the final gamma/SRGB conversion.
- **Performance** — heavy shaders (many texture lookups, large loops) run every frame on the player's machine. Profile on a mid-range device. Expose iteration counts as sliders so players can tune performance.
