/**
 * Whitelist-based HTML sanitiser for the splash / About body editor.
 *
 * Allows only the small set of tags / styles that the rich-text toolbar
 * actually produces (execCommand output): bold, italic, underline, lists,
 * alignment, colour, font-family, plus structural <p>/<br>/<div>/<span>.
 * Everything else is stripped — including any `<script>`, event handlers,
 * `href`, `src`, `srcset`, etc. Bundles travel between machines, so this
 * is the cross-creator trust boundary.
 */

const ALLOWED_TAGS = new Set([
  'P', 'BR', 'DIV', 'SPAN',
  'B', 'STRONG', 'I', 'EM', 'U',
  'UL', 'OL', 'LI',
  'FONT', // execCommand still emits <font color="…" face="…">
  'IMG',  // Inline images (raster). For raster icons in the text-map body
          // src is locked to "asset:<uuid>" or data:image/<type> by the
          // attribute filter below.
  // Inline SVG icons from the Small Assets Library. We render vector
  // icons inline (not via <img src="data:image/svg+xml">) so the SVG can
  // inherit `color` from the host page and resolve `currentColor` to the
  // handout's textColor. The data-URL approach sandboxes the SVG in its
  // own document where currentColor defaults to black — that's the
  // source of the "black box" rendering bug. Per-element attribute
  // filtering below blocks JS / event handlers / external refs.
  'SVG', 'G', 'PATH', 'RECT', 'CIRCLE', 'ELLIPSE', 'LINE',
  'POLYLINE', 'POLYGON', 'TEXT', 'TSPAN',
  'TITLE', 'DESC', 'DEFS', 'USE', 'SYMBOL',
]);

const SVG_TAGS = new Set([
  'SVG', 'G', 'PATH', 'RECT', 'CIRCLE', 'ELLIPSE', 'LINE',
  'POLYLINE', 'POLYGON', 'TEXT', 'TSPAN',
  'TITLE', 'DESC', 'DEFS', 'USE', 'SYMBOL',
]);

// Attribute names that are safe on SVG-namespaced elements. Everything
// else (especially anything that starts with "on", or external href on
// <use>) is stripped. Matches Lucide / game-icons.net / our own Unicode
// renderer output without leaving any obvious JS-execution vectors.
const ALLOWED_SVG_ATTRS = new Set([
  // Common painting + transform
  'id', 'class', 'style', 'fill', 'stroke', 'stroke-width',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'stroke-dasharray', 'stroke-dashoffset',
  'opacity', 'fill-opacity', 'stroke-opacity',
  'fill-rule', 'clip-rule', 'transform', 'color',
  // svg root + viewport
  'xmlns', 'viewbox', 'width', 'height', 'preserveaspectratio',
  // path / rect / circle / ellipse / line / poly
  'd', 'x', 'y', 'rx', 'ry', 'cx', 'cy', 'r',
  'x1', 'y1', 'x2', 'y2', 'points',
  // text / tspan
  'dx', 'dy', 'text-anchor', 'font-size', 'font-family', 'font-weight',
  'font-style', 'text-decoration', 'dominant-baseline',
]);

const ALLOWED_STYLE_PROPS = new Set([
  'color',
  'font-family',
  'text-align',
  'font-weight',
  'font-style',
  'text-decoration',
  // Inline image / SVG sizing — used by text-map handouts when icons are
  // dropped into the body via the rich-text editor.
  'width',
  'height',
  'vertical-align',
  'display',
]);

const ALLOWED_FONT_ATTRS = new Set(['color', 'face']);

export function sanitizeSplashHtml(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<div id="__root__">${html}</div>`, 'text/html');
  const root = doc.getElementById('__root__');
  if (!root) return '';
  cleanNode(root);
  return root.innerHTML;
}

function cleanNode(node: Element): void {
  // Recurse into a snapshot of children first so mutations during cleanup
  // don't break the live HTMLCollection.
  const children = Array.from(node.children);
  for (const child of children) cleanNode(child);

  // The root container is always kept; skip the tag-allowlist check for it.
  if (node.id === '__root__') return;

  // SVG-namespaced elements have a lowercase tagName ("svg", "path"); HTML
  // elements come through uppercase. Normalise once so the same allowlist
  // checks work for both.
  const tag = node.tagName.toUpperCase();

  if (!ALLOWED_TAGS.has(tag)) {
    // Unwrap: move children up to parent, then drop the node.
    const parent = node.parentNode;
    if (!parent) return;
    while (node.firstChild) parent.insertBefore(node.firstChild, node);
    parent.removeChild(node);
    return;
  }

  const isSvg = SVG_TAGS.has(tag);

  // Filter attributes — only `style` (with whitelisted props) on every tag,
  // plus `color` / `face` on <font>, plus locked-down image attrs, plus
  // the SVG attribute set on inline-SVG icons.
  for (const attr of Array.from(node.attributes)) {
    const name = attr.name.toLowerCase();
    // Catch-all: drop any attribute that starts with "on" — even if it
    // somehow landed in an allow-list it would be a JS handler. This
    // also protects against SVG-specific event hooks like onbegin.
    if (name.startsWith('on')) {
      node.removeAttribute(attr.name);
      continue;
    }
    if (name === 'style') {
      const filtered = filterStyle((node as HTMLElement).style.cssText);
      if (filtered.length > 0) node.setAttribute('style', filtered);
      else node.removeAttribute('style');
    } else if (name === 'contenteditable' && attr.value === 'false') {
      // Allow contenteditable="false" on icon wrapper spans so the
      // rich-text editor treats them as atomic units. Any other value
      // is dropped — we never want to opt arbitrary subtrees back
      // INTO editability.
    } else if (tag === 'FONT' && ALLOWED_FONT_ATTRS.has(name)) {
      // Keep — bare colour / face values, no JS-loadable URLs.
    } else if (tag === 'IMG' && (name === 'src' || name === 'width' || name === 'height' || name === 'alt')) {
      if (name === 'src') {
        const src = attr.value.trim();
        // Only allow our internal asset references and inline data: images.
        // Bare http(s) URLs are intentionally rejected so a malicious
        // bundle can't smuggle in tracking pixels or remote loads.
        if (!/^(asset:[A-Za-z0-9_-]+|data:image\/[a-z+]+;[^"'<>]*)$/i.test(src)) {
          node.removeAttribute('src');
        }
      }
      // width / height / alt: keep verbatim — no XSS risk via dimension attrs.
    } else if (isSvg && ALLOWED_SVG_ATTRS.has(name)) {
      // Defence in depth — any attribute value that looks like JS / URL
      // injection is dropped. Lucide / game-icons / our renderers
      // never produce these, so this only fires on hostile bundles.
      if (/javascript:|expression\s*\(|url\s*\(/i.test(attr.value)) {
        node.removeAttribute(attr.name);
      }
    } else {
      node.removeAttribute(attr.name);
    }
  }
}

function filterStyle(cssText: string): string {
  const out: string[] = [];
  for (const rawDecl of cssText.split(';')) {
    const decl = rawDecl.trim();
    if (!decl) continue;
    const colon = decl.indexOf(':');
    if (colon < 0) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const val  = decl.slice(colon + 1).trim();
    if (!ALLOWED_STYLE_PROPS.has(prop)) continue;
    // Reject anything that smells like JS / data URIs in values.
    if (/url\s*\(|javascript:|expression\s*\(/i.test(val)) continue;
    out.push(`${prop}: ${val}`);
  }
  return out.join('; ');
}

/** Escape plain text for use inside an HTML context. Used to migrate legacy
 *  plain-text bodies to the new HTML body field on display. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
