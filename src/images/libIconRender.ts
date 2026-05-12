import type { ImageAsset } from '../types.ts';
import { ImageAssetStore } from './ImageAssetStore.ts';
import { cleanTintableSvg } from '../utils/resolveAssetImages.ts';

export const LIB_ICON_PREFIX = 'libAsset:';

export function isLibAssetIcon(icon: string): boolean {
  return icon.startsWith(LIB_ICON_PREFIX);
}

export function libAssetId(icon: string): string {
  return icon.slice(LIB_ICON_PREFIX.length);
}

/**
 * Compound cache / broadcast key. Tintable assets bake the colour into
 * the bitmap, so different colours need different cache entries; raster
 * assets render the same regardless of colour and use the bare icon.
 */
export function libIconCacheKey(icon: string, color: string, tintable: boolean): string {
  return tintable ? `${icon}#${color}` : icon;
}

/** Result of a successful render — both forms callers want. */
export interface LibIconRender {
  bitmap:   ImageBitmap;
  dataUrl:  string;
  tintable: boolean;
  key:      string;
}

/**
 * Look up a library asset by id and rasterise it for marker use.
 *
 * - Tintable SVGs are passed through cleanTintableSvg (which normalises
 *   fills / strokes to currentColor) and then `currentColor` is replaced
 *   with the literal hex so the bitmap is colour-baked.
 * - Raster blobs render verbatim — colour input has no effect.
 * - Non-tintable SVG sources are rasterised as-is (multi-colour SVGs).
 *
 * Returns null if the asset doesn't exist or carries no usable payload
 * (e.g. font-only or unicode-only records).
 */
export async function renderLibIcon(
  iconOrId: string,
  color: string,
): Promise<LibIconRender | null> {
  const id = isLibAssetIcon(iconOrId) ? libAssetId(iconOrId) : iconOrId;
  const asset = await ImageAssetStore.get(id);
  if (!asset) return null;
  return renderLibIconFromAsset(asset, color);
}

export async function renderLibIconFromAsset(
  asset: ImageAsset,
  color: string,
): Promise<LibIconRender | null> {
  const icon = LIB_ICON_PREFIX + asset.id;
  const key  = libIconCacheKey(icon, color, asset.tintable);

  if (asset.tintable && asset.svgSource) {
    const tinted  = cleanTintableSvg(asset.svgSource).replace(/currentColor/gi, color);
    const dataUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent(tinted);
    const bitmap  = await fetchBitmap(dataUrl);
    return { bitmap, dataUrl, tintable: true, key };
  }
  if (asset.blob) {
    const dataUrl = await blobToDataUrl(asset.blob);
    const bitmap  = await createImageBitmap(asset.blob);
    return { bitmap, dataUrl, tintable: false, key };
  }
  if (asset.svgSource) {
    const dataUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent(asset.svgSource);
    const bitmap  = await fetchBitmap(dataUrl);
    return { bitmap, dataUrl, tintable: false, key };
  }
  return null;
}

async function fetchBitmap(dataUrl: string): Promise<ImageBitmap> {
  const res  = await fetch(dataUrl);
  const blob = await res.blob();
  return createImageBitmap(blob);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
