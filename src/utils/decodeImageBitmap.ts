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
 * Output is fixed at 64 px square — matches the GM-side render scale used
 * by libIconRender so markers look identical wherever they're drawn.
 */
export async function decodeImageBitmap(dataUrl: string): Promise<ImageBitmap> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const size   = 64;
  const canvas = document.createElement('canvas');
  canvas.width  = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.drawImage(img, 0, 0, size, size);
  return createImageBitmap(canvas);
}
