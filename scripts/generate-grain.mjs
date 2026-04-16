/**
 * Generates a tileable paper grain texture (512x512, greyscale) and saves it
 * alongside the parchment_fantasy filter definition.
 *
 * Run once:  node scripts/generate-grain.mjs
 * Output:    src/filters/definitions/parchment_fantasy/paper_grain.webp
 *            (falls back to PNG if sharp/canvas not available)
 */

import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '../src/filters/definitions/parchment_fantasy/paper_grain.png');

const SIZE = 512;
const canvas = createCanvas(SIZE, SIZE);
const ctx = canvas.getContext('2d');
const imageData = ctx.createImageData(SIZE, SIZE);

// Layered noise — fine grain + coarse fibre
function random(x, y, seed = 0) {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed) * 43758.5453123;
  return n - Math.floor(n);
}

function smoothNoise(x, y, freq) {
  const ix = Math.floor(x * freq);
  const iy = Math.floor(y * freq);
  const fx = (x * freq) - ix;
  const fy = (y * freq) - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = random(ix, iy);
  const b = random(ix + 1, iy);
  const c = random(ix, iy + 1);
  const d = random(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy * (1 - ux) + (d - b) * ux * uy;
}

for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    const nx = px / SIZE;
    const ny = py / SIZE;

    // Fine grain
    const grain = smoothNoise(nx, ny, 64) * 0.5
      + smoothNoise(nx, ny, 128) * 0.3
      + smoothNoise(nx, ny, 256) * 0.2;

    // Coarse paper fibre (long horizontal streaks)
    const fibre = smoothNoise(nx * 0.3, ny, 16) * 0.4
      + smoothNoise(nx * 0.5, ny, 32) * 0.3;

    // Combine: mostly grain, hint of fibre
    const combined = grain * 0.7 + fibre * 0.3;

    // Remap 0..1 around mid-grey
    const value = Math.min(255, Math.max(0, Math.round(combined * 255)));

    const i = (py * SIZE + px) * 4;
    imageData.data[i]     = value;
    imageData.data[i + 1] = value;
    imageData.data[i + 2] = value;
    imageData.data[i + 3] = 255;
  }
}

ctx.putImageData(imageData, 0, 0);

try {
  mkdirSync(dirname(OUT), { recursive: true });
  const buf = canvas.toBuffer('image/png');
  writeFileSync(OUT, buf);
  console.log(`Generated: ${OUT}  (${SIZE}x${SIZE})`);
} catch (e) {
  console.error('Failed to write grain texture:', e.message);
  process.exit(1);
}
