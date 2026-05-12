/**
 * Decode a data URL (PNG / SVG / WebP) into an ImageBitmap via an Image
 * element + canvas instead of `createImageBitmap(blob)`.
 *
 * Why this exists: Chrome rejects `createImageBitmap` on SVG blobs that
 * lack intrinsic width/height (viewBox-only SVGs — exactly what
 * game-icons.net and Lucide ship), throwing the useless "InvalidStateError:
 * The source image could not be decoded". An Image element honours the
 * viewBox during decode and createImageBitmap on the resulting canvas is
 * universally reliable across formats.
 *
 * The output preserves the source aspect ratio with the longer side capped
 * at 64 px. For SVGs we read viewBox / width-height attributes directly
 * because `img.naturalWidth/Height` falls back to the W3C 300×150 default
 * for viewBox-only SVGs and would give the wrong aspect. Non-square aspect
 * is honoured so markers can render as rectangles (a 2:1 dragon stays 2:1).
 */
export async function decodeImageBitmap(dataUrl: string): Promise<ImageBitmap> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();

  const MAX = 64;
  const aspect = dataUrl.startsWith('data:image/svg')
    ? (getSvgAspect(dataUrl) ?? 1)
    : (img.naturalWidth || 1) / (img.naturalHeight || 1);

  const w = aspect >= 1 ? MAX : Math.max(1, Math.round(MAX * aspect));
  const h = aspect >= 1 ? Math.max(1, Math.round(MAX / aspect)) : MAX;

  const canvas = document.createElement('canvas');
  canvas.width  = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.drawImage(img, 0, 0, w, h);
  return createImageBitmap(canvas);
}

/** Extract aspect ratio from an inline-SVG data URL. Returns null if unparseable. */
function getSvgAspect(svgUrl: string): number | null {
  try {
    const comma = svgUrl.indexOf(',');
    if (comma < 0) return null;
    const src = decodeURIComponent(svgUrl.slice(comma + 1));
    const vbMatch = /viewBox\s*=\s*["']([^"']+)["']/.exec(src);
    if (vbMatch) {
      const parts = vbMatch[1]!.trim().split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts[2]! > 0 && parts[3]! > 0) return parts[2]! / parts[3]!;
    }
    const wMatch = /\swidth\s*=\s*["']([\d.]+)/.exec(src);
    const hMatch = /\sheight\s*=\s*["']([\d.]+)/.exec(src);
    if (wMatch && hMatch) {
      const w = parseFloat(wMatch[1]!);
      const h = parseFloat(hMatch[1]!);
      if (w > 0 && h > 0) return w / h;
    }
  } catch { /* fall through to null */ }
  return null;
}
