/**
 * Rasterise a TextMapConfig (handout) into a PNG blob so it can flow
 * through the same map → texture → mesh pipeline as a real map image.
 *
 * Approach: build an SVG that wraps the sanitised body HTML in a
 * foreignObject, load it into an <img>, paint to a canvas, export PNG.
 * The SVG-foreignObject path keeps the browser doing the HTML layout —
 * fonts, line-breaking, lists, inline SVG icons all just work — without
 * pulling in a heavyweight html2canvas dependency.
 *
 * Known limitation: custom @font-face fonts loaded via the Google Fonts
 * CSS API may not be accessible inside the SVG document context. The
 * fallback is the system serif/sans, which is acceptable for M3 — the
 * preview pane stays the source of design truth, and we can inline
 * base64-encoded font binaries in a follow-up if creators ask for it.
 */

import type { TextMapConfig } from '../types.ts';
import { sanitizeSplashHtml } from '../utils/sanitizeHtml.ts';
import { ensureFontsLoaded } from '../images/fontCatalog.ts';

/** Cache of @font-face rules with base64-embedded woff2 bytes, keyed by
 *  font family. The SVG document context can't reach fonts loaded by the
 *  host page, so we embed the font binary inside a <style> inside the
 *  SVG itself. Per-session cache — fonts don't change mid-run. */
const fontFaceCache = new Map<string, string | null>();

async function fetchFontFaceForSvg(family: string): Promise<string | null> {
  const cached = fontFaceCache.get(family);
  if (cached !== undefined) return cached;

  try {
    // Fetch the Google Fonts CSS as the browser sees it — that path
    // returns woff2 URLs (other agents see ttf).
    const cssUrl =
      `https://fonts.googleapis.com/css2?family=`
      + encodeURIComponent(family).replace(/%20/g, '+')
      + `&display=swap`;
    const cssRes = await fetch(cssUrl);
    if (!cssRes.ok) { fontFaceCache.set(family, null); return null; }
    const css = await cssRes.text();
    // Pull every woff2 URL out of the CSS — most families ship multiple
    // unicode-range variants, all of which we want available inside the
    // SVG document so glyph fallbacks work. Build a single <style> with
    // all the @font-face blocks, woff2 bodies inlined as data URIs.
    const blocks: string[] = [];
    const woff2Pattern = /url\((https:\/\/[^)]+\.woff2)\)/g;
    const ffPattern    = /@font-face\s*\{([^}]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = ffPattern.exec(css)) !== null) {
      const body = m[1] ?? '';
      const urlMatch = woff2Pattern.exec(body);
      if (!urlMatch) continue;
      const woffUrl = urlMatch[1];
      if (!woffUrl) continue;
      const fontRes = await fetch(woffUrl);
      if (!fontRes.ok) continue;
      const buf = await fontRes.arrayBuffer();
      const b64 = arrayBufferToBase64(buf);
      const dataUri = `data:font/woff2;base64,${b64}`;
      // Rewrite the original block: swap the http url() for the data
      // URI, leave font-family / font-style / font-weight / unicode-range
      // intact so the browser still picks the right variant per glyph.
      const rewritten = body.replace(woff2Pattern, `url(${dataUri})`);
      blocks.push(`@font-face{${rewritten}}`);
      woff2Pattern.lastIndex = 0;
    }
    const out = blocks.length > 0 ? blocks.join('\n') : null;
    fontFaceCache.set(family, out);
    return out;
  } catch {
    fontFaceCache.set(family, null);
    return null;
  }
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  // btoa expects a binary string; chunk to avoid call-stack blowups on
  // larger font files.
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(bin);
}

export interface RasterizeOpts {
  /** Pixels on the long side. Defaults to 1080 — enough for a sharp
   *  player view at typical viewport sizes; the projector path can ask
   *  for higher when calibration is in play. */
  longSidePx?: number;
}

// 2048 px on the long side gives crisp text on a typical 1440p / 4K GM
// canvas without upscaling artefacts. 1080 was too low — the GM canvas
// often displays the handout at 1500–1900 px wide, which forced a
// 1.4–1.7x upscale and produced the "magnified, lo-res" look the user
// reported (text looking ~2x its proper size and visibly soft).
export const DEFAULT_LONG_SIDE = 2048;

/** Predict the pixel dimensions the rasteriser would produce for this
 *  config at the default long-side. Used by the editor save path so the
 *  asset's imageWidth / imageHeight match the rasterised output —
 *  downstream code (marker placement, calibration) assumes pixel-accurate
 *  dimensions, not pure ratios. */
export function predictTextMapPixelDimensions(
  cfg: Pick<TextMapConfig, 'width' | 'height'>,
  longSidePx: number = DEFAULT_LONG_SIDE,
): { pxW: number; pxH: number } {
  const aspect = cfg.width / cfg.height;
  if (aspect >= 1) {
    return { pxW: longSidePx, pxH: Math.max(1, Math.round(longSidePx / aspect)) };
  }
  return { pxW: Math.max(1, Math.round(longSidePx * aspect)), pxH: longSidePx };
}

export async function rasterizeTextMap(
  cfg: TextMapConfig,
  opts: RasterizeOpts = {},
): Promise<Blob> {
  const { pxW, pxH } = predictTextMapPixelDimensions(cfg, opts.longSidePx);

  // Kick off the host-page font load so the editor preview catches the
  // font even though that path isn't what the rasteriser uses.
  try { ensureFontsLoaded([cfg.fontFamily]); } catch { /* non-fatal */ }

  // Sanitise the body, then re-serialise as well-formed XHTML. The
  // sanitiser emits HTML5 (`<br>`, `<img>` not self-closed) but
  // SVG-foreignObject content is parsed as strict XML when loaded via
  // <img>, which rejects any non-self-closed void element. XMLSerializer
  // produces XML-compliant output with correct void-element handling
  // and preserved namespace declarations on inline SVG icons. This is
  // the root cause of the "image load failed" the user kept hitting.
  const sanitised = sanitizeSplashHtml(cfg.bodyHtml ?? '');
  const bodyXhtml = htmlToXhtml(sanitised);
  const padPx = Math.round(pxW * 0.06);
  // Scale the base font size so a font-scale of 1 renders at a
  // comfortable reading size on the page. The editor preview uses ems
  // against the host page; here we anchor to page width.
  const basePx = Math.round((pxW / 60) * cfg.fontScale);

  // Try font embedding first; fall back to system font if anything goes
  // sideways. Embedding adds an external fetch (Google Fonts CSS + the
  // woff2 binary) and a big base64 blob inside the SVG — any failure
  // mode in that chain shouldn't break the rasterisation altogether.
  let fontFaceCss: string | null = null;
  try {
    fontFaceCss = await withTimeout(fetchFontFaceForSvg(cfg.fontFamily), 6000);
  } catch (err) {
    console.warn('[rasterizeTextMap] font embedding skipped:', err);
  }

  const buildSvg = (withFontCss: boolean): string => {
    const styleBlock = withFontCss && fontFaceCss
      ? `<style xmlns="http://www.w3.org/1999/xhtml">${fontFaceCss}</style>`
      : '';
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" `
      + `width="${pxW}" height="${pxH}" viewBox="0 0 ${pxW} ${pxH}">`
      + `<foreignObject x="0" y="0" width="100%" height="100%">`
      + `<div xmlns="http://www.w3.org/1999/xhtml" style="`
      +   `box-sizing:border-box;`
      +   `width:${pxW}px;height:${pxH}px;`
      +   `padding:${padPx}px;`
      +   `background:${cfg.backgroundColor};`
      +   `color:${cfg.textColor};`
      +   `font-family:'${escapeAttr(cfg.fontFamily)}', Georgia, serif;`
      +   `font-size:${basePx}px;`
      +   `line-height:1.45;`
      +   `overflow:hidden;`
      + `">${styleBlock}${bodyXhtml}</div>`
      + `</foreignObject>`
      + `</svg>`
    );
  };

  // Try the rich SVG-foreignObject path with fonts → without fonts → and
  // if both still fail (Chrome / Firefox have version-dependent
  // restrictions on what SVG-with-foreignObject loaded via <img> will
  // accept), fall back to a plain Canvas-2D render. That fallback loses
  // HTML formatting (bold / italic / lists / inline icons) but always
  // produces a readable handout — better than the "Missing Map Image"
  // placeholder.
  try {
    return await renderSvgToPng(buildSvg(true), pxW, pxH, cfg.backgroundColor);
  } catch (err) {
    console.warn('[rasterizeTextMap] retry without font embedding:', err);
  }
  try {
    return await renderSvgToPng(buildSvg(false), pxW, pxH, cfg.backgroundColor);
  } catch (err) {
    console.warn('[rasterizeTextMap] SVG-foreignObject path failed entirely; falling back to Canvas-2D plain text:', err);
    // Log the SVG that broke at warn level so the user / dev can see it
    // in the console without enabling verbose mode. Trimmed so the
    // console isn't a wall of base64 if font embedding was in play.
    const failedSvg = buildSvg(false);
    const trimmed = failedSvg.length > 4000
      ? failedSvg.slice(0, 2000) + '\n...\n[truncated ' + (failedSvg.length - 4000) + ' chars]\n...\n' + failedSvg.slice(-2000)
      : failedSvg;
    console.warn('[rasterizeTextMap] failed SVG markup was:\n', trimmed);
  }
  return await renderPlainTextFallback(cfg, pxW, pxH, basePx, padPx, sanitised);
}

/** Convert sanitised HTML5 body markup into well-formed XHTML so it can
 *  live inside an SVG foreignObject. The parser is HTML5 (lenient enough
 *  to accept `<br>` / `<img>` without slashes) and the serialiser is
 *  XMLSerializer (strict — emits self-closing void elements and explicit
 *  namespace declarations on SVG / MathML descendants).
 *
 *  Idempotent on already-well-formed input. Returns empty string for
 *  empty / parse-fail input. */
function htmlToXhtml(html: string): string {
  if (!html) return '';
  try {
    const doc = new DOMParser().parseFromString(
      `<div xmlns="http://www.w3.org/1999/xhtml">${html}</div>`,
      'text/html',
    );
    const div = doc.body.firstElementChild;
    if (!div) return '';
    // Serialise children, not the wrapper div — the wrapper is provided
    // by our buildSvg() with its own styling.
    const ser = new XMLSerializer();
    return Array.from(div.childNodes)
      .map((node) => {
        if (node.nodeType === 1) return ser.serializeToString(node as Element);
        if (node.nodeType === 3) return escapeXmlText(node.textContent ?? '');
        return '';
      })
      .join('');
  } catch {
    return html; // Last-resort: pass through and let the foreignObject loader complain.
  }
}

function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function renderSvgToPng(
  svgMarkup: string,
  pxW: number,
  pxH: number,
  bgColor: string,
): Promise<Blob> {
  // Use a base64 data: URL rather than a blob: URL. Some Chrome versions
  // reject SVG-with-foreignObject loaded from blob: URLs but accept the
  // same content via data:. base64 also sidesteps any URI-encoding
  // edge cases with unicode characters in the body.
  const b64 = utf8ToBase64(svgMarkup);
  const svgUrl = `data:image/svg+xml;base64,${b64}`;
  const img = await withTimeout(loadImage(svgUrl), 8000);
  const canvas = document.createElement('canvas');
  canvas.width = pxW;
  canvas.height = pxH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2D context unavailable');
  // Paint the background first as a safety net — some browsers don't
  // composite the foreignObject div's background-color reliably.
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, pxW, pxH);
  ctx.drawImage(img, 0, 0, pxW, pxH);
  return await canvasToBlob(canvas);
}

/** Canvas-2D fallback: paint the background, then word-wrap the body's
 *  plain text. Strips HTML markup entirely — no inline icons, no
 *  formatting, just legible text on the chosen background in the chosen
 *  colour. Last line of defence so a handout always produces SOME image
 *  rather than the placeholder. */
async function renderPlainTextFallback(
  cfg: TextMapConfig,
  pxW: number,
  pxH: number,
  basePx: number,
  padPx: number,
  sanitisedBodyHtml: string,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width  = pxW;
  canvas.height = pxH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2D context unavailable');
  ctx.fillStyle = cfg.backgroundColor;
  ctx.fillRect(0, 0, pxW, pxH);

  const plain = htmlToPlainText(sanitisedBodyHtml);
  ctx.fillStyle = cfg.textColor;
  ctx.font = `${basePx}px "${cfg.fontFamily}", Georgia, serif`;
  ctx.textBaseline = 'top';
  const maxWidth = pxW - padPx * 2;
  const lineHeight = Math.round(basePx * 1.45);
  let y = padPx;
  for (const paragraph of plain.split(/\n{2,}/)) {
    for (const wrapped of wrapToLines(ctx, paragraph, maxWidth)) {
      if (y + lineHeight > pxH - padPx) break;
      ctx.fillText(wrapped, padPx, y);
      y += lineHeight;
    }
    y += Math.round(lineHeight * 0.4); // paragraph spacing
  }
  return await canvasToBlob(canvas);
}

function htmlToPlainText(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  // Block elements end with a paragraph break; everything else inlines.
  for (const block of doc.querySelectorAll('p, div, li, br')) {
    block.appendChild(doc.createTextNode('\n'));
  }
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

function wrapToLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const probe = line ? `${line} ${word}` : word;
    if (ctx.measureText(probe).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = probe;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(bin);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = url;
  });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))),
      'image/png',
    );
  });
}

function escapeAttr(s: string): string {
  return s.replace(/'/g, '&apos;').replace(/"/g, '&quot;');
}
