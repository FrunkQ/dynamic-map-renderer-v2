/**
 * MapFX kind registry — one entry per `MapFXKind` value.
 *
 * Each kind drives:
 *   • Selector-icon glyph (inline Lucide-style SVG; rendered in MarkerOverlay)
 *   • Default paint colour (RGBA hex, no `#` prefix — the alpha channel
 *     determines stroke softness)
 *   • Default brush radius in normalised map units
 *   • Tint blend mode used when compositing the painted layer over the map
 *
 * Adding a new kind: append to the `MapFXKind` union in types.ts and add an
 * entry below. No other code needs touching for the basic render path; the
 * fancier per-kind effects (fire flicker, electric crackle) layer on top in
 * the renderer's per-kind pass.
 */

import type { MapFXKind } from '../types.ts';

export type BlendMode =
  | 'normal'   // standard alpha blend
  | 'screen'   // additive — for light / fire
  | 'multiply' // subtractive — for shadow / fear
  ;

export interface MapFXKindEntry {
  id:           MapFXKind;
  label:        string;
  /** Inline SVG body markup (between <svg>...</svg>) for the selector icon. */
  iconSvg:      string;
  /** Default paint colour for new strokes of this kind — '#rrggbb'. */
  defaultColor: string;
  /** Default brush radius in normalised map units (0..1; 1 = map width). */
  defaultRadius: number;
  /** Render blend mode for this kind's painted layer. */
  blend:        BlendMode;
  /** Whether the renderer animates this kind (flicker, crackle, etc.). */
  animated:     boolean;
}

const SVG_FLAME =
  '<path d="M12 2c1 4 4 5 4 9a4 4 0 0 1-8 0c0-3 2-3 2-6Z"/>' +
  '<path d="M12 22a6 6 0 0 0 6-6c0-2-1-3-2-4 0 3-2 5-4 5s-4-2-4-5c-1 1-2 2-2 4a6 6 0 0 0 6 6Z"/>';

const SVG_SNOWFLAKE =
  '<line x1="12" y1="2"  x2="12" y2="22"/>' +
  '<line x1="2"  y1="12" x2="22" y2="12"/>' +
  '<line x1="5"  y1="5"  x2="19" y2="19"/>' +
  '<line x1="5"  y1="19" x2="19" y2="5"/>';

const SVG_SMOKE =
  '<path d="M5 14c0-3 2-4 5-4s4 2 4 4-2 3-4 3-5-1-5-3Z"/>' +
  '<path d="M9 7c0-2 2-3 4-3s3 1 3 3-1 2-3 2"/>' +
  '<path d="M14 19c0 2 1 3 3 3s3-1 3-3"/>';

const SVG_LIGHT =
  '<path d="M12 2v3"/><path d="M12 19v3"/>' +
  '<path d="M2 12h3"/><path d="M19 12h3"/>' +
  '<path d="M5 5l2 2"/><path d="M17 17l2 2"/>' +
  '<path d="M5 19l2-2"/><path d="M17 7l2-2"/>' +
  '<circle cx="12" cy="12" r="4"/>';

const SVG_BLOOD =
  '<path d="M12 2c4 5 6 9 6 13a6 6 0 0 1-12 0c0-4 2-8 6-13Z"/>';

const SVG_WATER =
  '<path d="M2 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>' +
  '<path d="M2 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>';

const SVG_SHADOW =
  '<path d="M21 12.8A8 8 0 1 1 11.2 3a6 6 0 0 0 9.8 9.8Z"/>';

const SVG_ELECTRIC =
  '<polygon points="13 2 4 14 11 14 9 22 20 10 13 10 13 2"/>';

const SVG_POISON =
  '<path d="M9 2h6v3l-1 2v4l3 7a3 3 0 0 1-3 4H10a3 3 0 0 1-3-4l3-7V7L9 5Z"/>';

const SVG_HOLY =
  '<circle cx="12" cy="12" r="4"/>' +
  '<line x1="12" y1="2"  x2="12" y2="6"/>' +
  '<line x1="12" y1="18" x2="12" y2="22"/>' +
  '<line x1="2"  y1="12" x2="6"  y2="12"/>' +
  '<line x1="18" y1="12" x2="22" y2="12"/>' +
  '<line x1="4.5"  y1="4.5"  x2="7.5"  y2="7.5"/>' +
  '<line x1="16.5" y1="16.5" x2="19.5" y2="19.5"/>' +
  '<line x1="4.5"  y1="19.5" x2="7.5"  y2="16.5"/>' +
  '<line x1="16.5" y1="7.5"  x2="19.5" y2="4.5"/>';

const SVG_HEALING =
  '<path d="M12 4v16"/><path d="M4 12h16"/>' +
  '<circle cx="12" cy="12" r="9"/>';

const SVG_FEAR =
  '<path d="M12 3a9 9 0 0 1 9 9c0 4-3 7-7 7s-6-2-6-5 1-4 3-4 3 1 3 3"/>';

export const MAPFX_REGISTRY: Record<MapFXKind, MapFXKindEntry> = {
  fire:     { id: 'fire',     label: 'Fire',          iconSvg: SVG_FLAME,     defaultColor: '#ff5a14', defaultRadius: 0.06, blend: 'screen',   animated: true  },
  cold:     { id: 'cold',     label: 'Ice / Cold',    iconSvg: SVG_SNOWFLAKE, defaultColor: '#9fd6ff', defaultRadius: 0.06, blend: 'screen',   animated: false },
  smoke:    { id: 'smoke',    label: 'Smoke',         iconSvg: SVG_SMOKE,     defaultColor: '#9aa3ad', defaultRadius: 0.10, blend: 'normal',   animated: true  },
  light:    { id: 'light',    label: 'Magical Light', iconSvg: SVG_LIGHT,     defaultColor: '#ffd76b', defaultRadius: 0.08, blend: 'screen',   animated: false },
  blood:    { id: 'blood',    label: 'Blood',         iconSvg: SVG_BLOOD,     defaultColor: '#8a0d18', defaultRadius: 0.04, blend: 'multiply', animated: false },
  water:    { id: 'water',    label: 'Water',         iconSvg: SVG_WATER,     defaultColor: '#4aa3ff', defaultRadius: 0.08, blend: 'screen',   animated: true  },
  shadow:   { id: 'shadow',   label: 'Shadow',        iconSvg: SVG_SHADOW,    defaultColor: '#10131c', defaultRadius: 0.08, blend: 'multiply', animated: false },
  electric: { id: 'electric', label: 'Lightning',     iconSvg: SVG_ELECTRIC,  defaultColor: '#a0c8ff', defaultRadius: 0.03, blend: 'screen',   animated: true  },
  poison:   { id: 'poison',   label: 'Poison',        iconSvg: SVG_POISON,    defaultColor: '#7dd23a', defaultRadius: 0.05, blend: 'screen',   animated: false },
  holy:     { id: 'holy',     label: 'Holy',          iconSvg: SVG_HOLY,      defaultColor: '#ffe9a0', defaultRadius: 0.08, blend: 'screen',   animated: false },
  healing:  { id: 'healing',  label: 'Healing',       iconSvg: SVG_HEALING,   defaultColor: '#a3e8a0', defaultRadius: 0.06, blend: 'screen',   animated: false },
  fear:     { id: 'fear',     label: 'Fear',          iconSvg: SVG_FEAR,      defaultColor: '#3c0a4a', defaultRadius: 0.07, blend: 'multiply', animated: true  },
};

export const MAPFX_KIND_ORDER: MapFXKind[] = [
  'fire', 'cold', 'water', 'smoke', 'electric',
  'light', 'holy', 'healing', 'blood', 'shadow', 'poison', 'fear',
];

/** Quick lookup with a fall-back. Unknown kinds fall through to fire — the
 *  registry should always have everything but this guards future code paths
 *  that ingest unknown kind strings (from old bundles, malformed sync). */
export function mapfxKind(id: MapFXKind): MapFXKindEntry {
  return MAPFX_REGISTRY[id] ?? MAPFX_REGISTRY.fire;
}
