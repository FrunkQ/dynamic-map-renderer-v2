/**
 * Backdrop wrapper that derives a BackdropEntry from a MapFX kind.
 *
 * The MapFX shader file (src/mapfx/shaders/<kind>/fragment.glsl)
 * must contain a region delimited by:
 *
 *   // === BEGIN backdrop-shareable ===
 *   ... uniforms + helper functions + `vec4 fxEffect(vec2 uv)` ...
 *   // === END backdrop-shareable ===
 *
 * Everything inside that block is what the backdrop wrapper lifts
 * into the clip-pass at top scope. The MapFX-only wrapper main()
 * lives outside the markers and is ignored here.
 *
 * Uniforms inside the marker block that collide with clip-pass
 * built-ins (uAspect, uSpeed, uBgColor, uRect, uResolution) get
 * stripped so the clip-pass's own declarations win — GLSL forbids
 * declaring the same uniform twice in a shader, and Three.js
 * silently fails to compile when it happens.
 *
 * The returned BackdropEntry uses the kind's defaultColor as the
 * primary colour param's default when allowColor is true; the
 * kind's shaderParams ride along verbatim. All visible params end
 * up in the GM's sparkle popover via the existing FxPopover plumbing.
 */

import type { BackdropEntry } from './backdropRegistry.ts';
import type { OverlayKindEntry, BlendMode } from '../../mapfx/overlayKindRegistry.ts';
import { getKindTextures } from '../../mapfx/shaders/shaderRegistry.ts';

const BEGIN_MARKER = '// === BEGIN backdrop-shareable ===';
const END_MARKER   = '// === END backdrop-shareable ===';

/** Extract the marker-delimited block from a MapFX fragment shader,
 *  stripping ALL uniform declarations. The clip-pass builder
 *  declares every uniform the backdrop needs on its own — both
 *  built-ins (time / uAspect / uSpeed / uBgColor / uRect /
 *  uResolution / tDiffuse) and per-param uniforms generated from
 *  BackdropEntry.params (uColor, uIntensity, etc.). The shader
 *  file's uniform decls in the marker block are MapFX-mode
 *  declarations; they would collide with the clip-pass's own
 *  declarations and break GLSL compilation if not removed here. */
function extractFxBlock(shaderText: string, kindId: string): string {
  const a = shaderText.indexOf(BEGIN_MARKER);
  const b = shaderText.indexOf(END_MARKER);
  if (a === -1 || b === -1) {
    throw new Error(
      `MapFX shader '${kindId}' is missing BEGIN / END backdrop-shareable markers. ` +
      `Add them around the uniforms + fxEffect function to make this kind usable as a backdrop.`,
    );
  }
  const inner = shaderText.slice(a + BEGIN_MARKER.length, b);
  // Drop every `uniform <type> <name>;` line, including
  // `uniform sampler2D` declarations — the clip-pass declares all
  // of them (built-ins + param uniforms + texture samplers) on its
  // own, so the lifted block only needs the helpers + fxEffect.
  const uniformLine = /^\s*uniform\s+[\w\d]+\s+\w+\s*;/;
  return inner
    .split('\n')
    .filter((line) => !uniformLine.test(line))
    .join('\n');
}

export interface BuildBackdropFromMapFxOpts {
  /** Kind id to derive the backdrop from. */
  kindId:        string;
  /** MapFX kind entry from OVERLAY_KIND_REGISTRY. Provides label,
   *  defaultColor, allowColor, shaderParams. */
  kind:          OverlayKindEntry;
  /** Raw GLSL fragment text loaded via `import shaderText from
   *  '...fragment.glsl?raw';` */
  shaderText:    string;
  /** Optional override label (e.g. backdrop dropdown wants a
   *  slightly different name from the MapFX kind). Defaults to
   *  kind.label. */
  label?:        string;
  /** Optional override label for the primary colour swatch when
   *  allowColor is true. Defaults to 'Colour'. */
  colourLabel?:  string;
}

export function buildBackdropFromMapFx(opts: BuildBackdropFromMapFxOpts): BackdropEntry {
  const helpers = extractFxBlock(opts.shaderText, opts.kindId);

  // The fragment snippet runs inside the clip-pass `if (outside-
  // viewport)` branch. Composite mode mirrors the MapFX blend mode:
  //   • screen   — additive (uBgColor + col); same maths as the
  //                MapFX additive blend at maskAlpha=1.
  //   • normal   — alpha composite (mix uBgColor → col by alpha);
  //                gives volumetric kinds (firestorm, mist) their
  //                "smoke obscures the bg" reading.
  //   • multiply — uBgColor * col (darkening kinds; not currently
  //                used by any registered effect but supported).
  const blend: BlendMode = opts.kind.blend;
  let composite: string;
  if (blend === 'normal') {
    composite = 'gl_FragColor = vec4(mix(uBgColor, _fx.rgb, _fx.a), 1.0);';
  } else if (blend === 'multiply') {
    composite = 'gl_FragColor = vec4(uBgColor * _fx.rgb, 1.0);';
  } else {
    composite = 'gl_FragColor = vec4(uBgColor + _fx.rgb, 1.0);';
  }
  const fragment = /* glsl */`
    {
      vec4 _fx = fxEffect(vUv);
      ${composite}
    }
  `;

  // Param list: primary colour (when the kind opts in) prepended,
  // then the kind's shader params verbatim. The clip-pass builder
  // auto-creates uniforms from these.
  const params = [
    ...(opts.kind.allowColor
      ? [{
          id:      'color',
          label:   opts.colourLabel ?? 'Colour',
          type:    'color' as const,
          default: opts.kind.defaultColor,
        }]
      : []),
    ...(opts.kind.shaderParams ?? []),
  ];

  // Texture assets the shader samples (uNoise, uBed, etc.). Loaded
  // through the same helper the MapFX side uses so both subsystems
  // share the texture cache + colour-space settings.
  const textures = getKindTextures(opts.kindId);

  return {
    id:       opts.kindId,
    label:    opts.label ?? opts.kind.label,
    fragment,
    helpers,
    params,
    ...(Object.keys(textures).length > 0 ? { textures } : {}),
  };
}
