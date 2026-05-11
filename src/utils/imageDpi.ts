/**
 * Extract the X-axis DPI from a PNG or JPEG image blob by parsing the
 * relevant metadata chunk/marker. Returns null when the metadata is absent,
 * uses non-DPI units, or the format isn't supported. Browsers don't expose
 * image DPI through any standard API, so we read the bytes ourselves.
 *
 * Only the first 64 KB are read — pHYs (PNG) and APP0/JFIF (JPEG) both sit
 * near the start of the file. WebP density metadata is rare and intentionally
 * unsupported here; callers fall back to filename / GCD signals.
 */
export async function extractImageDpi(blob: Blob): Promise<number | null> {
  const sample = await blob.slice(0, 65_536).arrayBuffer();
  const bytes = new Uint8Array(sample);
  if (isPngSignature(bytes)) return parsePngDpi(bytes);
  if (isJpegSignature(bytes)) return parseJpegDpi(bytes);
  return null;
}

function isPngSignature(b: Uint8Array): boolean {
  return b.length >= 8
    && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47
    && b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A;
}

function isJpegSignature(b: Uint8Array): boolean {
  return b.length >= 2 && b[0] === 0xFF && b[1] === 0xD8;
}

/**
 * PNG chunk layout: [length:4][type:4][data:length][crc:4]. The pHYs chunk
 * carries (X pixels/unit, Y pixels/unit, unit specifier 0/1). Unit 1 = metre,
 * so DPI = ppm × 0.0254. Unit 0 = unknown (aspect ratio only) → return null.
 */
function parsePngDpi(b: Uint8Array): number | null {
  let pos = 8;
  while (pos + 8 <= b.length) {
    const length = readU32(b, pos);
    const type = String.fromCharCode(b[pos + 4]!, b[pos + 5]!, b[pos + 6]!, b[pos + 7]!);
    const dataStart = pos + 8;
    if (dataStart + length > b.length) return null;
    if (type === 'pHYs') {
      if (length < 9) return null;
      const xPpu = readU32(b, dataStart);
      const unit = b[dataStart + 8]!;
      if (unit !== 1) return null;
      return Math.round(xPpu * 0.0254);
    }
    if (type === 'IDAT') return null;
    pos = dataStart + length + 4;
  }
  return null;
}

/**
 * JPEG marker layout after SOI (FFD8): FF XX [length:2] [data:length−2].
 * APP0 (FFE0) with identifier "JFIF\0" carries: version (2), units (1),
 * X density (2), Y density (2). Units 1 = DPI, 2 = dots/cm.
 */
function parseJpegDpi(b: Uint8Array): number | null {
  let pos = 2;
  while (pos + 4 <= b.length) {
    if (b[pos] !== 0xFF) return null;
    const marker = b[pos + 1]!;
    if (marker === 0xD8 || marker === 0xD9) { pos += 2; continue; }
    if (marker >= 0xD0 && marker <= 0xD7) { pos += 2; continue; }
    const length = (b[pos + 2]! << 8) | b[pos + 3]!;
    if (pos + 2 + length > b.length) return null;
    if (marker === 0xE0) {
      const dataStart = pos + 4;
      if (dataStart + 14 <= b.length) {
        const id = String.fromCharCode(
          b[dataStart]!, b[dataStart + 1]!, b[dataStart + 2]!, b[dataStart + 3]!,
        );
        if (id === 'JFIF') {
          const unit = b[dataStart + 7]!;
          const xDensity = (b[dataStart + 8]! << 8) | b[dataStart + 9]!;
          if (unit === 1) return xDensity;
          if (unit === 2) return Math.round(xDensity * 2.54);
          return null;
        }
      }
    }
    if (marker === 0xDA) return null;
    pos += 2 + length;
  }
  return null;
}

function readU32(b: Uint8Array, off: number): number {
  return ((b[off]! << 24) | (b[off + 1]! << 16) | (b[off + 2]! << 8) | b[off + 3]!) >>> 0;
}
