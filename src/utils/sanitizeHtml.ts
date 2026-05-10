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
]);

const ALLOWED_STYLE_PROPS = new Set([
  'color',
  'font-family',
  'text-align',
  'font-weight',
  'font-style',
  'text-decoration',
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

  if (!ALLOWED_TAGS.has(node.tagName)) {
    // Unwrap: move children up to parent, then drop the node.
    const parent = node.parentNode;
    if (!parent) return;
    while (node.firstChild) parent.insertBefore(node.firstChild, node);
    parent.removeChild(node);
    return;
  }

  // Filter attributes — only `style` (with whitelisted props) on every tag,
  // plus `color` / `face` on <font>.
  for (const attr of Array.from(node.attributes)) {
    const name = attr.name.toLowerCase();
    if (name === 'style') {
      const filtered = filterStyle((node as HTMLElement).style.cssText);
      if (filtered.length > 0) node.setAttribute('style', filtered);
      else node.removeAttribute('style');
    } else if (node.tagName === 'FONT' && ALLOWED_FONT_ATTRS.has(name)) {
      // Keep — bare colour / face values, no JS-loadable URLs.
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
