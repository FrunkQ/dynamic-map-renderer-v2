/**
 * dieShapes (v2.19.2) — a die that looks like a die: the right silhouette for
 * its type, cut into facets that catch the light.
 *
 * Deliberately NOT 3D. There is no geometry, no physics and no dependency: each
 * die is one clipped <div> with a handful of flat SVG polygons inside it. The
 * "shine" is one gradient sweep and a static rim highlight. Everything that
 * moves is a transform, and no filter runs while anything is moving — the table
 * screen is usually the weakest device in the house, and a phone is the second
 * weakest.
 *
 * ONE source of truth for each shape: the outline drives both the SVG facets
 * and the CSS clip-path on the wrapper, so the silhouette can never drift from
 * the shading.
 *
 * Faces are given, never decided here (see DiceLayer).
 */

type Pt = [number, number];
/** Light comes from the top left, so `hi` faces it and `lo` turns away. */
type Tone = 'hi' | 'mid' | 'lo';

interface Shape {
  /** Silhouette, in a 0-100 square. Also becomes the wrapper's clip-path. */
  outline: Pt[];
  /** Flat faces, painted in order. The FIRST one is the face you read. */
  facets: { pts: Pt[]; tone: Tone }[];
  /** Where the numeral sits — the visual centre of the reading face. */
  textY: number;
}

const HEX: Pt[] = [[50, 3], [95, 28], [95, 72], [50, 97], [5, 72], [5, 28]];

/** d20: the icon everyone knows — a hexagon with a triangle looking at you. */
const D20: Shape = {
  outline: HEX,
  facets: [
    { pts: [[50, 25], [79, 74], [21, 74]], tone: 'hi' },
    { pts: [[5, 28], [50, 3], [50, 25], [21, 74]], tone: 'mid' },
    { pts: [[50, 3], [95, 28], [79, 74], [50, 25]], tone: 'lo' },
    { pts: [[5, 72], [21, 74], [79, 74], [95, 72], [50, 97]], tone: 'lo' },
  ],
  textY: 60,
};

const D12: Shape = {
  outline: [[50, 3], [96, 37], [78, 92], [22, 92], [4, 37]],
  facets: [
    { pts: [[50, 28], [74, 46], [65, 74], [35, 74], [26, 46]], tone: 'hi' },
    { pts: [[4, 37], [50, 3], [50, 28], [26, 46]], tone: 'mid' },
    { pts: [[50, 3], [96, 37], [74, 46], [50, 28]], tone: 'lo' },
    { pts: [[4, 37], [26, 46], [35, 74], [22, 92]], tone: 'lo' },
    { pts: [[96, 37], [78, 92], [65, 74], [74, 46]], tone: 'lo' },
    { pts: [[22, 92], [35, 74], [65, 74], [78, 92]], tone: 'mid' },
  ],
  textY: 58,
};

const D10: Shape = {
  outline: [[50, 2], [93, 37], [50, 98], [7, 37]],
  facets: [
    { pts: [[50, 20], [74, 44], [50, 72], [26, 44]], tone: 'hi' },
    { pts: [[7, 37], [50, 2], [50, 20], [26, 44]], tone: 'mid' },
    { pts: [[50, 2], [93, 37], [74, 44], [50, 20]], tone: 'lo' },
    { pts: [[7, 37], [26, 44], [50, 72], [50, 98]], tone: 'lo' },
    { pts: [[93, 37], [50, 98], [50, 72], [74, 44]], tone: 'mid' },
  ],
  textY: 50,
};

const D8: Shape = {
  outline: [[50, 2], [95, 50], [50, 98], [5, 50]],
  facets: [
    { pts: [[50, 16], [80, 50], [20, 50]], tone: 'hi' },
    { pts: [[50, 2], [5, 50], [20, 50], [50, 16]], tone: 'mid' },
    { pts: [[50, 2], [95, 50], [80, 50], [50, 16]], tone: 'lo' },
    { pts: [[5, 50], [95, 50], [50, 98]], tone: 'lo' },
  ],
  textY: 44,
};

/** A cube read face-on: a bevelled square, the bevels doing the shading. */
const D6: Shape = {
  outline: [[18, 4], [82, 4], [96, 18], [96, 82], [82, 96], [18, 96], [4, 82], [4, 18]],
  facets: [
    { pts: [[18, 18], [82, 18], [82, 82], [18, 82]], tone: 'hi' },
    { pts: [[18, 4], [82, 4], [82, 18], [18, 18]], tone: 'hi' },
    { pts: [[4, 18], [18, 4], [18, 18], [18, 82], [4, 82]], tone: 'mid' },
    { pts: [[82, 4], [96, 18], [96, 82], [82, 82], [82, 18]], tone: 'lo' },
    { pts: [[18, 82], [82, 82], [82, 96], [18, 96]], tone: 'lo' },
  ],
  textY: 58,
};

const D4: Shape = {
  outline: [[50, 5], [95, 88], [5, 88]],
  facets: [
    { pts: [[50, 30], [77, 80], [23, 80]], tone: 'hi' },
    { pts: [[5, 88], [50, 5], [50, 30], [23, 80]], tone: 'mid' },
    { pts: [[50, 5], [95, 88], [77, 80], [50, 30]], tone: 'lo' },
    { pts: [[23, 80], [77, 80], [95, 88], [5, 88]], tone: 'lo' },
  ],
  textY: 68,
};

/** Anything else — d3, d100, a house die — reads as a cube. */
const SHAPES: Record<string, Shape> = {
  4: D4, 6: D6, 8: D8, 10: D10, 12: D12, 20: D20, F: D6,
};

export function shapeFor(sides: number | 'F'): Shape {
  return SHAPES[String(sides)] ?? D6;
}

/** Name of the silhouette used, for tests and for a data attribute. */
export function shapeNameFor(sides: number | 'F'): string {
  return SHAPES[String(sides)] ? `d${sides}` : 'generic';
}

const pointsAttr = (pts: Pt[]) => pts.map(([x, y]) => `${x},${y}`).join(' ');
/** The same outline as a CSS clip-path, so silhouette and shading cannot drift. */
export const clipPathFor = (sides: number | 'F'): string =>
  `polygon(${shapeFor(sides).outline.map(([x, y]) => `${x}% ${y}%`).join(', ')})`;

export interface DieElement {
  el: HTMLElement;
  /** Set the numeral — used by the tumble and to land on the real face. */
  setValue: (text: string) => void;
}

/**
 * Build one die. `dropped` marks a die advantage threw away: struck through
 * rather than hidden, because seeing what you beat is half the pleasure.
 */
export function buildDie(sides: number | 'F', faceText: string, dropped = false): DieElement {
  const shape = shapeFor(sides);
  const el = document.createElement('span');
  el.className = 'die' + (dropped ? ' die--dropped' : '');
  el.dataset.shape = shapeNameFor(sides);
  el.style.clipPath = clipPathFor(sides);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('die-svg');

  for (const facet of shape.facets) {
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', pointsAttr(facet.pts));
    poly.setAttribute('fill', `var(--die-${facet.tone})`);
    // A hairline of the facet's own colour closes the seams antialiasing leaves
    // between neighbouring polygons; no stroke colour of its own, so no outline
    // look and nothing to recolour per theme.
    poly.setAttribute('stroke', `var(--die-${facet.tone})`);
    poly.setAttribute('stroke-width', '0.6');
    svg.appendChild(poly);
  }

  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', '50');
  text.setAttribute('y', String(shape.textY));
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('dominant-baseline', 'middle');
  text.setAttribute('class', 'die-text');
  text.setAttribute('font-size', String(fontSizeFor(faceText)));
  text.textContent = faceText;
  svg.appendChild(text);

  if (dropped) {
    const slash = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    slash.setAttribute('x1', '16'); slash.setAttribute('y1', '78');
    slash.setAttribute('x2', '84'); slash.setAttribute('y2', '22');
    slash.setAttribute('class', 'die-slash');
    svg.appendChild(slash);
  }

  el.appendChild(svg);
  return {
    el,
    setValue: (next: string) => {
      text.textContent = next;
      text.setAttribute('font-size', String(fontSizeFor(next)));
    },
  };
}

/** Two- and three-digit faces have to fit the same die. */
function fontSizeFor(faceText: string): number {
  const n = faceText.length;
  return n >= 3 ? 30 : n === 2 ? 38 : 46;
}
