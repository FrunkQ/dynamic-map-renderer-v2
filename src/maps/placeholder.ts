/**
 * Generate a procedural "Missing Map Image" placeholder image at the given
 * dimensions. Used when a map's asset blob can't be fetched (broken web-link,
 * deleted asset, etc.) so fog polygons / marker positions / viewport rectangles
 * stay sensibly placed until the GM links a replacement.
 */
export async function generateMissingMapPlaceholder(width: number, height: number): Promise<Blob> {
  const w = Math.max(64, Math.min(4096, Math.round(width  || 1920)));
  const h = Math.max(64, Math.min(4096, Math.round(height || 1080)));

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;

  // Dark background
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, w, h);

  // Subtle diagonal warning stripes
  ctx.fillStyle = '#7f1d1d';
  const stripeW = 40;
  const gap = 40;
  for (let x = -h - stripeW; x < w; x += stripeW + gap) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + stripeW, 0);
    ctx.lineTo(x + stripeW + h, h);
    ctx.lineTo(x + h, h);
    ctx.closePath();
    ctx.fill();
  }

  // Centre label
  const fontSize = Math.max(14, Math.min(w, h) * 0.06);
  ctx.fillStyle    = '#fca5a5';
  ctx.font         = `bold ${fontSize}px system-ui, sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('⚠ Missing Map Image', w / 2, h / 2 - fontSize * 0.6);

  ctx.font      = `${Math.max(10, fontSize * 0.45)}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(252, 165, 165, 0.8)';
  ctx.fillText('Click "Fix Missing Map" in the side panel to relink an image.', w / 2, h / 2 + fontSize * 0.6);

  return canvas.convertToBlob({ type: 'image/png' });
}
