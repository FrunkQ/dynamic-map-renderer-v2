/**
 * Bundle gzip helpers — wraps the browser-native CompressionStream /
 * DecompressionStream APIs so bundleIO can cheaply shrink JSON before
 * writing to disk or feeding into AES-GCM.
 *
 * Why bother: a 12 MB bundle is mostly base64-encoded image bytes, but the
 * surrounding JSON (keys, license strings, repeated structure) gzips well —
 * 10-25% shaved on a typical pack. Bigger win on the encrypted path, where
 * the cipher is then base64'd into the envelope; gzip-first knocks several
 * MB off the resulting file.
 */

/** First two bytes of every gzip stream. */
const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

/** Compress a UTF-8 string to a gzip byte array. */
export async function gzipString(s: string): Promise<Uint8Array> {
  const inputBytes = new TextEncoder().encode(s);
  const compressed = await new Response(
    new Blob([inputBytes]).stream().pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer();
  return new Uint8Array(compressed);
}

/** Decompress gzip bytes back to a UTF-8 string. */
export async function gunzipToString(bytes: Uint8Array): Promise<string> {
  const decompressed = await new Response(
    new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip')),
  ).arrayBuffer();
  return new TextDecoder().decode(decompressed);
}

/** Magic-byte check for a gzip stream. */
export function startsWithGzipMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1;
}
