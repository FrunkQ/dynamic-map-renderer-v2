/**
 * Overlay kind registry (v2.12 unified system) — one entry per `OverlayKind`.
 *
 * 'fog' is a kind like any other; it just happens to have an opaque fill and
 * normal blend so it hides what's beneath. Everything else (fire / light /
 * blood / etc.) has its own blend, default colour, animation behaviour.
 *
 * Each entry drives:
 *   • Selector-icon glyph (inline Lucide-style SVG body)
 *   • Default paint colour for new polygons (overridable per-polygon)
 *   • Default brush radius (in normalised map units)
 *   • Render blend mode
 *   • Animated flag (true → per-frame opacity wobble)
 *   • selectByInterior — fog uses interior clicks (big opaque area, easy
 *     target); other kinds are icon-only (ambient effects can cover the
 *     whole map and shouldn't capture every click)
 *
 * Adding a new kind: append to OverlayKind in types.ts and add an entry.
 */

import type { OverlayKind } from '../types.ts';

/**
 * Default edge-fade value applied to newly-painted polygons (and shown
 * by the slider when nothing else gives a value). 0.10 is the sweet
 * spot Alex tuned by eye -- removes pixelation on every kind without
 * dissolving the polygon shape. The slider's range narrows around it
 * so the GM tunes within a useful band rather than fighting heavy
 * fade.
 */
export const DEFAULT_EDGE_FADE = 0.10;

export type BlendMode =
  | 'normal'   // standard alpha blend
  | 'screen'   // additive — for light / fire
  | 'multiply' // subtractive — for shadow / fear
  ;

/**
 * Per-kind shader parameter declaration (v2.12). Mirrors the filter
 * `SliderParam` shape so the GM-panel renderer can build identical sliders
 * for both. Each param becomes a `u<PascalCase>` uniform in the kind's
 * fragment shader (e.g. id 'intensity' → uniform float uIntensity).
 *
 * Every param is per-polygon — stored on FogPolygon.shaderParams. The
 * matching kind-level entry on FogState.shaderParams[kind] holds the
 * "draft" / last-used values which new polygons inherit at paint time
 * and which the panel sliders fall back to when no polygon is selected.
 * This gives the GM:
 *   • Sliders that always edit the currently-selected polygon.
 *   • New polygons that inherit the previously-tuned look.
 *   • Reselecting a polygon snaps the sliders back to its own values.
 */
export interface ShaderParamDef {
  id:      string;
  label:   string;
  min:     number;
  max:     number;
  step:    number;
  default: number;
  /**
   * UI rendering hint. 'slider' (default) shows a continuous range
   * input; 'toggle' shows a styled on/off switch. Toggle params
   * still carry numeric uniform values to the shader (0 or 1) so
   * GLSL code reads them as plain floats. min/max/step are ignored
   * for toggles; default 0 = OFF, 1 = ON.
   */
  type?:   'slider' | 'toggle';
}

export interface OverlayKindEntry {
  id:                OverlayKind;
  label:             string;
  /** Inline SVG body markup (between <svg>...</svg>) for the selector icon. */
  iconSvg:           string;
  /** Default colour for new polygons of this kind — '#rrggbb'. */
  defaultColor:      string;
  /** Default brush radius in normalised map units (0..1; 1 = map width). */
  defaultRadius:     number;
  /** Render blend mode for this kind's painted layer. */
  blend:             BlendMode;
  /** Whether the renderer animates this kind (flicker, crackle, etc.). */
  animated:          boolean;
  /** True → interior clicks select the polygon (fog uses this). False →
   *  the GM must click the selector icon to select. */
  selectByInterior:  boolean;
  /** True → the colour swatch in the panel is enabled for this kind and
   *  per-polygon color overrides are honoured. False → kind defaultColor
   *  is canonical and the swatch is greyed out (e.g. electric is always
   *  electric-blue). */
  allowColor:        boolean;
  /** Optional render z-bias so kinds stack predictably. Higher = renders on
   *  top of lower. Fog is the highest so it covers MapFX effects beneath. */
  z:                 number;
  /**
   * v2.12 — Custom GLSL shader for this kind on the player view.
   * Undefined → FogCompositor renders the polygons as flat colour fills
   * (current behaviour for fog/blood/shadow/poison/etc.). Set → a
   * dedicated Three.js plane with the named shader handles this kind
   * instead, receiving an alpha mask of the polygon shape + a `time`
   * uniform. Shader files live in src/mapfx/shaders/<id>/.
   *
   * Kinds left undefined stay on the flat-fill path; we'll opt-in one at
   * a time as user picks shaders.
   */
  shader?:           string;
  /**
   * v2.12 — GM-tunable shader parameters for this kind. Each entry
   * declares a slider that appears in the FoW/MapFX panel whenever this
   * kind is active. Values persist per-map via FogState.shaderParams and
   * travel through the same fog_update P2P path. Only meaningful when
   * `shader` is set.
   */
  shaderParams?:     ShaderParamDef[];
}

// Only the four supported kinds keep their SVGs. The earlier flat-fill
// kinds (cold/smoke/blood/water/shadow/electric/poison/holy/healing/fear)
// were dev placeholders without shaders; they're removed pending real
// adaptations (incoming: smoke / starfield / etc.).
const SVG_FOG =
  '<path d="M3 14h13a3 3 0 0 0 0-6 5 5 0 0 0-9.78-1A4 4 0 0 0 3 14Z"/>' +
  '<path d="M5 18h14"/>' +
  '<path d="M7 21h10"/>';

const SVG_FLAME =
  '<path d="M12 2c1 4 4 5 4 9a4 4 0 0 1-8 0c0-3 2-3 2-6Z"/>' +
  '<path d="M12 22a6 6 0 0 0 6-6c0-2-1-3-2-4 0 3-2 5-4 5s-4-2-4-5c-1 1-2 2-2 4a6 6 0 0 0 6 6Z"/>';

const SVG_WATER =
  '<path d="M2 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>' +
  '<path d="M2 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>';

const SVG_LIGHT =
  '<path d="M12 2v3"/><path d="M12 19v3"/>' +
  '<path d="M2 12h3"/><path d="M19 12h3"/>' +
  '<path d="M5 5l2 2"/><path d="M17 17l2 2"/>' +
  '<path d="M5 19l2-2"/><path d="M17 7l2-2"/>' +
  '<circle cx="12" cy="12" r="4"/>';

const SVG_STAR =
  '<polygon points="12 2 14.85 8.66 22 9.27 16.5 14.13 18.18 21.34 12 17.5 5.82 21.34 7.5 14.13 2 9.27 9.15 8.66"/>';

const SVG_PORTAL =
  '<circle cx="12" cy="12" r="9"/>' +
  '<circle cx="12" cy="12" r="5"/>' +
  '<circle cx="12" cy="12" r="1.5"/>';

// Cloud body + lightning bolt cutting through it.
const SVG_THUNDERCLOUD =
  '<path d="M4 14h13a3 3 0 0 0 0-6 5 5 0 0 0-9.78-1A4 4 0 0 0 4 14Z"/>' +
  '<polyline points="11 15 8 20 12 20 9 23"/>';

// Three drifting horizontal wisps for the misty atmosphere.
const SVG_MIST =
  '<path d="M3 7h11"/>' +
  '<path d="M9 12h12"/>' +
  '<path d="M2 17h9"/>' +
  '<path d="M14 17h7"/>';

// defaultRadius is now in CSS pixels — see the type doc above. Brush stays
// visually the same size as you zoom in / out; the resulting map polygon
// shrinks at higher zoom which gives fine-detail painting for free.
//
// allowColor:
//   • fog / smoke / water / fire — these are "stuff" with a wide range of
//     natural / fictional colours (black/grey fog, white/green/poison smoke,
//     muddy or clean water; fire reads as fire even when tinted blue for
//     soulfire or green for wisp-flame). Per-polygon colour overrides honoured.
//   • everything else — the kind colour IS the kind's identity (electric is
//     electric blue, light is warm yellow). Per-polygon overrides aren't
//     honoured; the swatch is greyed out in the panel.
//
// Fire shader params:
//   • intensity — output multiplier. 1.0 = full additive glow, 0.05 = barely
//     perceptible ember haze. Lets the GM dial fire from "screen-dominating
//     inferno" down to "background warmth" without changing the polygons.
//   • scale — pre-scales the procedural fire volume so flame features fit
//     the polygon size. 1.0 = default, < 1 packs more (smaller) flames into
//     the same area, > 1 stretches features bigger. Tune by eye.
const FIRE_SHADER_PARAMS: ShaderParamDef[] = [
  { id: 'intensity', label: 'Intensity', min: 0.05, max: 1.5, step: 0.05, default: 1.0 },
  { id: 'scale',     label: 'Scale',     min: 0.25, max: 4.0, step: 0.05, default: 1.0 },
];

// River shader params:
//   • intensity — output multiplier (universal).
//   • scale     — wave feature density. < 1 = finer ripples; > 1 = lazy swells.
//   • speed     — flow rate. 0 = still pool; 1 = normal river; 2 = rapids.
//   • direction — flow direction in radians, compass convention. 0 = north
//     (water flows toward the top of the map). Polygon-scoped naturally:
//     every river bends differently and the inheritance pattern carries
//     the last-tuned direction onto the next-painted polygon.
// Ocean shader params (afl_ext / MIT). No direction — oceans have
// multi-directional swells, not a single flow vector. Wave size +
// speed + intensity is enough to cover "still mirror lake" through
// "stormy open sea". uScale's wide range supports painting anything
// from a small bay to a horizon-spanning ocean covering most of the
// map.
const OCEAN_SHADER_PARAMS: ShaderParamDef[] = [
  { id: 'intensity', label: 'Intensity', min: 0.05, max: 1.5, step: 0.05, default: 1.0 },
  // uScale tunes wave feature size relative to the polygon. Range
  // extended to 0.02 at the low end so vast horizon-ocean polygons
  // can dial down to fine-ripple texture; the original 0.25 minimum
  // left "huge polygon" still showing big swells. 4.0 max still
  // gives lazy-rollers on small polygons.
  { id: 'scale',     label: 'Scale',     min: 0.02, max: 4.0, step: 0.01, default: 1.0 },
  { id: 'speed',     label: 'Speed',     min: 0.0,  max: 4.0, step: 0.05, default: 1.0 },
  // uWaveHeight scales the surface displacement directly. Lets the GM
  // pick "mirror calm" (0) through "stormy" (2) without the
  // shader's old time-cycled sun making the surface appear to swell
  // on its own.
  { id: 'waveHeight', label: 'Wave Height', min: 0.0, max: 2.0, step: 0.05, default: 1.0 },
];

const RIVER_SHADER_PARAMS: ShaderParamDef[] = [
  { id: 'intensity', label: 'Intensity', min: 0.05, max: 1.5,            step: 0.05, default: 1.0 },
  // Same lower min as ocean — large river polys (deltas, lakes the
  // GM chose to treat as flowing water) need much smaller features.
  { id: 'scale',     label: 'Scale',     min: 0.02, max: 4.0,            step: 0.01, default: 1.0 },
  // uSpeed = 0 → still pool. 1 → gentle stream (default). 2 → brisk
  // river. 4 → proper rapids. Range widened from 0..2 once the base
  // time coefficient dropped to 0.08 so the slider stays useful at
  // both ends of the spectrum.
  { id: 'speed',     label: 'Speed',     min: 0.0,  max: 4.0,            step: 0.05, default: 1.0 },
  { id: 'direction', label: 'Direction', min: 0.0,  max: 6.2831853,      step: 0.087266, default: 0.0 },
  // Proper toggle. OFF = generic gem-pebble bed (loaded from
  // bed.jpg). ON = sample the actual map texture under the polygon,
  // so the GM's painted river bed shimmers beneath the surface.
  // Default OFF -- most maps don't have a painted bed to show
  // off, and the texture-bed look is the tested default.
  { id: 'refractBackground', label: 'Refract Map Background', min: 0.0, max: 1.0, step: 1.0, default: 0.0, type: 'toggle' },
];

// Light shader params (in-house Mappadux shader).
//   • intensity — overall brightness multiplier (universal).
//   • scale     — feature size (swirl wavelength + particle grid).
//   • speed     — animation rate for swirls + particle twinkling.
//   • swirls    — strength of the animated noise swirl overlay. 0 hides
//     swirls completely (just a soft radial glow + particles). 1 is
//     prominent magical-aura strands.
//   • particles — density of twinkling bright dots scattered through
//     the polygon. 0 = none, 1 = thick dust.
const LIGHT_SHADER_PARAMS: ShaderParamDef[] = [
  { id: 'intensity', label: 'Intensity', min: 0.05, max: 2.0, step: 0.05, default: 1.0 },
  { id: 'scale',     label: 'Scale',     min: 0.1,  max: 4.0, step: 0.05, default: 1.0 },
  { id: 'speed',     label: 'Speed',     min: 0.0,  max: 4.0, step: 0.05, default: 1.0 },
  { id: 'swirls',    label: 'Swirls',    min: 0.0,  max: 1.0, step: 0.05, default: 0.5 },
  { id: 'particles', label: 'Particles', min: 0.0,  max: 1.0, step: 0.05, default: 0.4 },
];

// Starfield shader params:
//   • intensity — brightness of the stars (universal).
//   • scale     — star density. Lower = larger / sparser stars, higher
//     = many small stars per polygon.
//   • speed     — warp travel rate. 0 = static starfield (no motion);
//     10 = proper "warp drive" feel. Range bumped from the previous
//     0..4 so genuine warp-speed reads as warp-speed.
//   • direction — 0..π sweep, replacing the original mouse-driven
//     view rotation with explicit control:
//       0     = stars approaching head-on
//       π/4   = angled approach
//       π/2   = pure sideways (stars stream past)
//       3π/4  = angled recede
//       π     = stars receding head-on
//     Per-polygon naturally, like river's flow direction.
const STARFIELD_SHADER_PARAMS: ShaderParamDef[] = [
  { id: 'intensity', label: 'Intensity', min: 0.05, max: 2.0,        step: 0.05,     default: 1.0 },
  { id: 'scale',     label: 'Scale',     min: 0.25, max: 4.0,        step: 0.05,     default: 1.0 },
  { id: 'speed',     label: 'Speed',     min: 0.0,  max: 10.0,       step: 0.1,      default: 1.0 },
  { id: 'direction', label: 'Direction', min: 0.0,  max: 3.1415927,  step: 0.087266, default: 0.0 },
];

// Portal shader params:
//   • intensity — energy multiplier (universal).
//   • scale     — portal disc size relative to the polygon. 1 fits
//     the disc inside a typical polygon; higher pushes the rim
//     outward (mask clips at the polygon edge); lower shrinks the
//     disc to occupy just the centre.
//   • speed     — how fast the energy swirls.
const PORTAL_SHADER_PARAMS: ShaderParamDef[] = [
  { id: 'intensity', label: 'Intensity', min: 0.05, max: 2.0, step: 0.05, default: 1.0 },
  { id: 'scale',     label: 'Scale',     min: 0.25, max: 2.5, step: 0.05, default: 1.0 },
  { id: 'speed',     label: 'Speed',     min: 0.0,  max: 4.0, step: 0.05, default: 1.0 },
];

// Thundercloud shader params:
//   • intensity — output multiplier (universal).
//   • scale     — cloud feature size (bigger = lazier wisps).
//   • speed     — noise drift + flash cadence rate. 0 = static cloud
//     with no lightning; default 1 ≈ original mahalis rate.
//   • lightning — flash brightness multiplier. 0 disables lightning
//     entirely (just the moody cloud), 1 is the natural rate, 1.5+
//     reads as a magical lightning-storm.
const THUNDERCLOUD_SHADER_PARAMS: ShaderParamDef[] = [
  { id: 'intensity', label: 'Intensity', min: 0.05, max: 2.0, step: 0.05, default: 1.0 },
  { id: 'scale',     label: 'Scale',     min: 0.1,  max: 4.0, step: 0.05, default: 1.0 },
  { id: 'speed',     label: 'Speed',     min: 0.0,  max: 4.0, step: 0.05, default: 1.0 },
  { id: 'lightning', label: 'Lightning', min: 0.0,  max: 2.0, step: 0.05, default: 1.0 },
];

// Smoke/Mist shader params:
//   • intensity — output multiplier (universal). Doubles for the
//     original INTENSITY constant absorbed from deusnovus's shader.
//   • scale     — wisp feature size; original ZOOM=3 baked in.
//   • speed     — drift rate. 0 = motionless mist; 4 = wind-driven
//     storm front.
//   • direction — flow direction in radians, compass convention.
//     0 = north (wisps drift toward the top of the map). Per-poly
//     natural: a wind-driven sea fret might roll in from one side
//     while swamp gas creeps in a different direction on the same
//     map.
const MIST_SHADER_PARAMS: ShaderParamDef[] = [
  { id: 'intensity', label: 'Intensity', min: 0.05, max: 2.0,        step: 0.05,     default: 1.0 },
  { id: 'scale',     label: 'Scale',     min: 0.2,  max: 4.0,        step: 0.05,     default: 1.0 },
  { id: 'speed',     label: 'Speed',     min: 0.0,  max: 4.0,        step: 0.05,     default: 1.0 },
  { id: 'direction', label: 'Direction', min: 0.0,  max: 6.2831853,  step: 0.087266, default: 0.0 },
];

export const OVERLAY_KIND_REGISTRY: Record<OverlayKind, OverlayKindEntry> = {
  fog:          { id: 'fog',          label: 'Fog of War',      iconSvg: SVG_FOG,          defaultColor: '#000000', defaultRadius: 25, blend: 'normal', animated: false, selectByInterior: true,  allowColor: true,  z: 100 },
  fire:         { id: 'fire',         label: 'Coloured Flames', iconSvg: SVG_FLAME,        defaultColor: '#ff5a14', defaultRadius: 30, blend: 'screen', animated: true,  selectByInterior: false, allowColor: true,  z: 10, shader: 'fire',         shaderParams: FIRE_SHADER_PARAMS         },
  river:        { id: 'river',        label: 'River',           iconSvg: SVG_WATER,        defaultColor: '#5aa9d6', defaultRadius: 35, blend: 'normal', animated: true,  selectByInterior: false, allowColor: true,  z: 5,  shader: 'river',        shaderParams: RIVER_SHADER_PARAMS        },
  ocean:        { id: 'ocean',        label: 'Ocean',           iconSvg: SVG_WATER,        defaultColor: '#5fa9d6', defaultRadius: 60, blend: 'normal', animated: true,  selectByInterior: false, allowColor: true,  z: 5,  shader: 'ocean',        shaderParams: OCEAN_SHADER_PARAMS        },
  light:        { id: 'light',        label: 'Magical Light',   iconSvg: SVG_LIGHT,        defaultColor: '#ffd76b', defaultRadius: 35, blend: 'screen', animated: true,  selectByInterior: false, allowColor: true,  z: 8,  shader: 'light',        shaderParams: LIGHT_SHADER_PARAMS        },
  starfield:    { id: 'starfield',    label: 'Starfield',       iconSvg: SVG_STAR,         defaultColor: '#b07fd6', defaultRadius: 80, blend: 'screen', animated: true,  selectByInterior: false, allowColor: true,  z: 3,  shader: 'starfield',    shaderParams: STARFIELD_SHADER_PARAMS    },
  portal:       { id: 'portal',       label: 'Magic Portal',    iconSvg: SVG_PORTAL,       defaultColor: '#1a80ff', defaultRadius: 40, blend: 'screen', animated: true,  selectByInterior: false, allowColor: true,  z: 8,  shader: 'portal',       shaderParams: PORTAL_SHADER_PARAMS       },
  // Thundercloud's defaultColor drives the LIGHTNING colour (cloud
  // body is hard-coded slate grey in the shader). Default is a
  // near-white blue tint matching real lightning; GM picks violet
  // for magical, green for eldritch, etc.
  thundercloud: { id: 'thundercloud', label: 'Thundercloud',    iconSvg: SVG_THUNDERCLOUD, defaultColor: '#dde4ff', defaultRadius: 60, blend: 'normal', animated: true,  selectByInterior: false, allowColor: true,  z: 25, shader: 'thundercloud', shaderParams: THUNDERCLOUD_SHADER_PARAMS },
  mist:         { id: 'mist',         label: 'Smoke / Mist',    iconSvg: SVG_MIST,         defaultColor: '#9aa3b5', defaultRadius: 60, blend: 'normal', animated: true,  selectByInterior: false, allowColor: true,  z: 22, shader: 'mist',         shaderParams: MIST_SHADER_PARAMS         },
};

/** Order for the kind dropdown — fog first (most-used + click-priority),
 *  then MapFX kinds in a natural elemental order. The dropdown order
 *  doubles as click-selection priority (see FogEditor.trySelect): when
 *  polygons overlap, the kind earlier in this list wins the click. */
export const OVERLAY_KIND_ORDER: OverlayKind[] = [
  'fog',
  'fire', 'river', 'ocean', 'light',
  'mist', 'thundercloud',
  'portal', 'starfield',
];

/** Quick lookup with a fall-back. Unknown kinds fall through to fog so
 *  pre-v2.12 polygons (no kind field) render as fog by default. */
export function overlayKind(id: OverlayKind | undefined): OverlayKindEntry {
  return OVERLAY_KIND_REGISTRY[id ?? 'fog'] ?? OVERLAY_KIND_REGISTRY.fog;
}
