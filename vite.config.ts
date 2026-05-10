import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { networkInterfaces } from 'os';
import { readFileSync } from 'fs';

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string };

/** Returns the first non-loopback IPv4 address on this machine, or null. */
function getLanIp(): string | null {
  for (const ifaces of Object.values(networkInterfaces())) {
    if (!ifaces) continue;
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
}

export default defineConfig(({ command }) => ({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        // Stable identifier — Chrome uses this to decide whether two manifest
        // versions refer to the same installed app. Without it, install state
        // can drift between deploys.
        id:               '/?source=pwa',
        // Required for the browser install prompt to fire.
        start_url:        '/?source=pwa',
        scope:            '/',
        name:             'Mappadux — VTT@Home',
        short_name:       'Mappadux',
        description:      'Mappadux — VTT@Home. Free, serverless, browser-based virtual tabletop for in-person and online TTRPG play.',
        theme_color:      '#0a0e1a',
        background_color: '#0a0e1a',
        display:          'standalone',
        orientation:      'landscape',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webp}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/0\.peerjs\.com\/.*/,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],

  // Inject the host machine's LAN IP during dev so the QR code / player URL
  // uses a reachable address instead of localhost.  In production builds this
  // is null, and the code path that reads it only runs when hostname is
  // localhost anyway, so it is safe to include in all builds.
  define: {
    __DEV_LAN_IP__:    JSON.stringify(command === 'serve' ? getLanIp() : null),
    __APP_VERSION__:   JSON.stringify(version),
    /**
     * Vercel automatically sets `process.env.VERCEL='1'` during their build.
     * Self-hosters / local dev / other CIs leave it unset, so the analytics
     * import is dead code and tree-shaken out of the bundle entirely.
     */
    __VERCEL_DEPLOY__: JSON.stringify(process.env['VERCEL'] === '1'),
  },

  server: {
    host: true,   // bind to 0.0.0.0 so LAN devices can reach the dev server
    port: 5173,
  },

  build: {
    rollupOptions: {
      input: {
        main:      'index.html',
        player:    'player.html',
        projector: 'projector.html',
      },
    },
    target: 'es2023',
  },

  test: {
    environment: 'happy-dom',
    include: ['test/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
}));
