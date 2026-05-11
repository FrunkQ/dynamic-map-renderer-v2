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

/** Resolve a single asset id to a renderable src (data URL for SVG /
 *  Unicode, object URL for raster). Exported so callers like the Text Map
 *  editor can resolve at insertion time and bake the data URL into the
 *  body HTML — avoids the editor showing a broken `asset:` reference.
 *
 *  `tintColor` (when provided) is baked into the resulting SVG in place of
 *  `currentColor`. This is required because an `<img src="data:image/svg+xml">`
 *  loads the SVG in its own sandboxed document — `currentColor` there
 *  defaults to black, regardless of the host page's text colour. The Text
 *  Map editor passes the handout's textColor so icons take the chosen
 *  foreground with a transparent background. */
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
