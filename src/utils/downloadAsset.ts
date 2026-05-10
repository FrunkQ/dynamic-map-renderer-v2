import { saveBlob } from './saveBlob.ts';

/**
 * Trigger a per-asset download — used from the Sound / Map / Icon libraries
 * to let the user pull individual assets back out to disk (recover a single
 * map image from an old pack, share a sound, etc.).
 *
 * Routes through `saveBlob` so the user gets the native OS save picker on
 * browsers that support the File System Access API, and a classic anchor
 * download elsewhere. MIME hint is the blob's own type so the picker shows
 * sensible filter extensions.
 */
export async function downloadAsset(filename: string, blob: Blob): Promise<void> {
  // Pick a description based on the blob mime so the save dialog reads well.
  const description = describe(blob.type);
  const ext = filename.includes('.')
    ? filename.slice(filename.lastIndexOf('.'))
    : '';
  const accept: Record<string, string[]> | undefined = blob.type && ext
    ? { [blob.type]: [ext] }
    : undefined;

  await saveBlob({
    blob,
    suggestedName: filename,
    ...(description ? { description } : {}),
    ...(accept ? { accept } : {}),
  });
}

function describe(mime: string): string {
  if (!mime) return 'Asset file';
  if (mime.startsWith('image/')) return 'Image';
  if (mime.startsWith('audio/')) return 'Audio';
  if (mime === 'application/json') return 'JSON file';
  return 'Asset file';
}
