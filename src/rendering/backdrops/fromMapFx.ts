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
import type { OverlayKindEntry } from '../../mapfx/overlayKindRegistry.ts';

const BEGIN_MARKER = '// === BEGIN backdrop-shareable ===';
const END_MARKER   = '// === END backdrop-shareable ===';

/** Uniforms the clip-pass declares on its own. The MapFX shader may
 *  also declare any of these (it shares the same uniform names by
 *  design); we strip the duplicate decl when extracting so the
 *  fragment compiles. */
const CLIP_PASS_BUILT_INS = new Set([
  'uAspect',
  'uSpeed',
  'uBgColor',
  'uRect',
  'uResolution',
  'tDiffuse',
  'time',
]);

/** Extract the marker-delimited block from a MapFX fragment shader,
 *  stripping any uniform declarations that conflict with clip-pass
 *  built-ins. */
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
  // Strip lines that declare a uniform whose name is in CLIP_PASS_
  // BUILT_INS. Comments + non-uniform lines pass through verbatim.
  const uniformLine = /^\s*uniform\s+\w+\s+(\w+)\s*;/;
  return inner
    .split('\n')
    .filter((line) => {
      const m = uniformLine.exec(line);
      if (!m) return true;
      return !CLIP_PASS_BUILT_INS.has(m[1]!);
    })
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
  // viewport)` branch. It calls fxEffect with vUv and composites
  // the additive result over the pack's background colour.
  const fragment = /* glsl */`
    {
      vec4 _fx = fxEffect(vUv);
      gl_FragColor = vec4(uBgColor + _fx.rgb, 1.0);
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

  return {
    id:       opts.kindId,
    label:    opts.label ?? opts.kind.label,
    fragment,
    helpers,
    params,
  };
}
