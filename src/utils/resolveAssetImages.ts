import { ImageAssetStore } from '../images/ImageAssetStore.ts';

/**
 * Walk an HTML string for `<img src="asset:<uuid>">` references and rewrite
 * each one to a renderable data URL (or object URL for raster blobs) by
 * looking the asset up in the Small Assets Library. Used by the Text Map
 * preview / render pipelines.
 *
 * `asset:` URLs are how text maps store icon references in bundle-friendly
 * form — the actual bytes live in the imageAssets store and travel via
 * the bundle's customImages array, not inline in the text-map body.
 *
 * The returned HTML may include `blob:` URLs created via URL.createObjectURL.
 * Callers should hold onto those URLs only for the lifetime of the render
 * and let them be revoked when the containing element is removed (browsers
 * GC them when the document containing the reference unloads).
 */
export async function resolveAssetImages(html: string): Promise<string> {
  if (!html.includes('asset:')) return html;
  const container = document.createElement('div');
  container.innerHTML = html;
  const imgs = Array.from(container.querySelectorAll('img[src^="asset:"]'));
  for (const img of imgs) {
    const src = img.getAttribute('src') ?? '';
    const id = src.startsWith('asset:') ? src.slice(6) : '';
    if (!id) continue;
    const resolved = await renderAssetToSrc(id);
    if (resolved) {
      img.setAttribute('src', resolved);
    } else {
      // Asset missing from the library — strip the broken reference and
      // leave a small placeholder character so the layout doesn't shift.
      img.setAttribute('src', missingIconDataUrl());
      img.setAttribute('alt', 'missing icon');
    }
  }
  return container.innerHTML;
}

/** Resolve a single asset id to inline HTML for insertion into the
 *  rich-text body. Vector assets (SVG, Unicode) come back as inline
 *  `<svg>` markup so they live in the editor's DOM and inherit `color`
 *  from a surrounding span — `currentColor` then resolves to the
 *  handout's textColor automatically. Raster assets return an `<img>`
 *  with a blob: URL. Returns null when the asset is missing or has no
 *  renderable payload.
 *
 *  The vector path is what makes tinting actually work. The older
 *  `<img src="data:image/svg+xml">` path sandboxed the SVG in its own
 *  document where currentColor defaulted to black, producing the
 *  "black box" rendering bug regardless of what colour we baked in. */
export async function renderAssetToInlineHtml(
  id: string,
  opts: { sizeEm?: number } = {},
): Promise<string | null> {
  const asset = await ImageAssetStore.get(id);
  if (!asset) return null;
  const sizeEm = opts.sizeEm ?? 2;
  // Wrapper style — color is the inheritance point currentColor reads.
  // Caller sets the color via the editor's `color` CSS rule on the body;
  // we don't bake a specific colour here so live re-tinting works.
  const wrapStyle =
    `display:inline-block;`
    + `width:${sizeEm}em;`
    + `height:${sizeEm}em;`
    + `vertical-align:middle;`;
  // contenteditable="false" so the rich-text editor treats the icon as
  // an atomic unit — no caret inside the SVG, single Backspace deletes
  // the whole thing, but click-to-resize still fires.
  const wrapOpen = `<span contenteditable="false" style="${wrapStyle}">`;

  if (asset.svgSource) {
    let svg = asset.svgSource;
    if (asset.tintable) {
      svg = cleanTintableSvg(svg);
    }
    // Force-size the root svg so it lays out at the wrapper size. We
    // STRIP any existing width / height first — Lucide ships
    // width="24" height="24" and just prepending width="100%" would
    // leave duplicate attributes, which has undefined behaviour and
    // (in list-item contexts) makes some browsers fall back to the
    // SVG's intrinsic dimensions, blowing the icon out to fill the
    // page. Sources without explicit width / height previously
    // defaulted to 300x150 in HTML context — same fix.
    svg = svg.replace(/<svg\b([^>]*)>/i, (_match, attrs: string) => {
      const cleaned = attrs
        .replace(/\swidth\s*=\s*"[^"]*"/gi,  '')
        .replace(/\sheight\s*=\s*"[^"]*"/gi, '');
      return `<svg width="100%" height="100%"${cleaned}>`;
    });
    return `${wrapOpen}${svg}</span>`;
  }

  if (asset.unicodeChar) {
    const ch = asset.unicodeChar;
    // Inline SVG so currentColor inherits from the wrapper span. The
    // text uses the host page's font stack — no sandboxed fallback.
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="100%" height="100%">' +
      '<text x="16" y="24" text-anchor="middle" font-size="28" fill="currentColor">' +
      escapeXml(ch) +
      '</text></svg>';
    return `${wrapOpen}${svg}</span>`;
  }

  if (asset.blob) {
    // Raster blob — no tinting, just dimensions on the wrapper.
    const url = URL.createObjectURL(asset.blob);
    const imgStyle = wrapStyle.replace('display:inline-block;', '');
    return `<img src="${url}" alt="" style="${imgStyle}" />`;
  }

  return null;
}

/** Legacy: resolve a single asset id to a renderable src (data URL for
 *  SVG / Unicode, object URL for raster). Kept for the back-compat
 *  `<img src="asset:...">` rehydration path in resolveAssetImages.
 *  New callers should prefer renderAssetToInlineHtml — see above. */
export async function renderAssetToSrc(id: string, tintColor?: string): Promise<string | null> {
  const asset = await ImageAssetStore.get(id);
  if (!asset) return null;
  if (asset.svgSource) {
    let svg = asset.svgSource;
    if (asset.tintable) {
      // Normalise tintable fills to currentColor — but leave fill="none"
      // alone (Lucide icons are stroke-only with fill="none"; converting
      // that to currentColor turns each icon into a solid black square)
      // and leave fill="currentColor" alone (already correct).
      svg = svg.replace(
        /fill\s*=\s*"(?!none\b|currentColor\b)[^"]*"/gi,
        'fill="currentColor"',
      );
    }
    if (tintColor) {
      // Bake the host's text colour into the SVG so the sandboxed <img>
      // load can actually paint the icon in the requested colour.
      svg = svg.replace(/currentColor/gi, tintColor);
    }
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }
  if (asset.unicodeChar) {
    const ch = asset.unicodeChar;
    const fill = tintColor ?? 'currentColor';
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
      '<text x="16" y="24" text-anchor="middle" font-size="28" fill="' + fill + '">' +
      escapeXml(ch) +
      '</text></svg>';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }
  if (asset.blob) {
    return URL.createObjectURL(asset.blob);
  }
  return null;
}

/** Clean up a tintable SVG so it paints correctly on top of an arbitrary
 *  host text colour:
 *   1. Strip the full-viewBox background path that game-icons.net ships
 *      on every icon (`<path d="M0 0h512v512H0z"/>` with no fill — defaults
 *      to BLACK, then survives every fill-rewrite below because it has no
 *      fill attribute to rewrite). That path is the "white-on-black" the
 *      user reported.
 *   2. Convert explicit non-none / non-currentColor fills and strokes to
 *      currentColor so the icon glyph picks up the host's text colour.
 *      Leave fill="none" alone — Lucide's stroke-only icons rely on it.
 *  Idempotent — running twice on the same SVG is a no-op.
 */
export function cleanTintableSvg(svg: string): string {
  // BG-path strip: any <path> with a `d` matching the full-viewBox
  // rectangle pattern AND no explicit fill / stroke is treated as
  // background. We match the path element open-tag → self-close OR
  // path → close pair. Both forms appear in upstream SVGs.
  const bgPattern = /<path\b(?![^>]*\bfill\s*=)(?![^>]*\bstroke\s*=)[^>]*\bd\s*=\s*"M0\s*0\s*h\d+\s*v\d+\s*H0\s*z"[^>]*\/?\s*>/gi;
  svg = svg.replace(bgPattern, '');
  // Also handle `<path d="..."></path>` (non-self-closed) form just in
  // case the upstream serialiser ever switches to it.
  const bgPatternPaired = /<path\b(?![^>]*\bfill\s*=)(?![^>]*\bstroke\s*=)[^>]*\bd\s*=\s*"M0\s*0\s*h\d+\s*v\d+\s*H0\s*z"[^>]*>\s*<\/path>/gi;
  svg = svg.replace(bgPatternPaired, '');

  // Tint swap: non-none / non-currentColor fills + strokes → currentColor.
  svg = svg
    .replace(/fill\s*=\s*"(?!none\b|currentColor\b)[^"]*"/gi, 'fill="currentColor"')
    .replace(/stroke\s*=\s*"(?!none\b|currentColor\b)[^"]*"/gi, 'stroke="currentColor"');

  return svg;
}

function missingIconDataUrl(): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<rect width="32" height="32" fill="none" stroke="currentColor" stroke-dasharray="3 2"/>' +
    '<text x="16" y="22" text-anchor="middle" font-size="20" fill="currentColor">?</text>' +
    '</svg>';
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
