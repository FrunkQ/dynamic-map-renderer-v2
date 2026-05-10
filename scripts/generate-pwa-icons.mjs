/**
 * Rasterise src/assets/Mappadux-Icon.png → favicon + PWA icon set.
 * Run with: node scripts/generate-pwa-icons.mjs
 *
 * Outputs:
 *   public/favicon.png            32×32  (default browser tab fallback)
 *   public/favicon-16.png         16×16
 *   public/favicon-32.png         32×32
 *   public/favicon-48.png         48×48
 *   public/apple-touch-icon.png   180×180
 *   public/icons/icon-192.png     192×192  (PWA manifest)
 *   public/icons/icon-512.png     512×512  (PWA manifest, also maskable)
 */
import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const srcPath = resolve(root, 'src', 'assets', 'Mappadux-Icon.png');
const publicDir = resolve(root, 'public');
const iconsDir = resolve(publicDir, 'icons');
mkdirSync(iconsDir, { recursive: true });

const src = readFileSync(srcPath);

const targets = [
  { out: resolve(publicDir, 'favicon.png'),         size: 32  },
  { out: resolve(publicDir, 'favicon-16.png'),      size: 16  },
  { out: resolve(publicDir, 'favicon-32.png'),      size: 32  },
  { out: resolve(publicDir, 'favicon-48.png'),      size: 48  },
  { out: resolve(publicDir, 'apple-touch-icon.png'), size: 180 },
  { out: resolve(iconsDir,  'icon-192.png'),        size: 192 },
  { out: resolve(iconsDir,  'icon-512.png'),        size: 512 },
];

for (const { out, size } of targets) {
  await sharp(src)
    .resize(size, size, { fit: 'cover', position: 'centre' })
    .png()
    .toFile(out);
  console.log(`wrote ${out}`);
}
