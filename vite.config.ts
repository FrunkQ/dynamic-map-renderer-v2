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
      includeAssets: ['icons/*.png', 'favicon.png', 'favicon-*.png', 'apple-touch-icon.png'],
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
        // Without these two, a newly-deployed SW sits in 'waiting'
        // until every Mappadux tab closes — which means "I just
        // pushed a fix" deploys silently don't take effect for users
        // still on the old bundle until they restart the browser.
        // skipWaiting: new SW activates as soon as it's installed.
        // clientsClaim: it then takes ownership of existing tabs on
        // their next navigation/reload (not a forced reload — the
        // user's current session keeps running its cached bundle).
        skipWaiting:  true,
        clientsClaim: true,
        // v2.14.96 — Critical for the second-instance feature.
        // Without ignoreURLParametersMatching, a precached file
        // (player.html, projector.html, etc.) requested with a
        // query string like ?instance=foo does NOT match the
        // precache route. workbox's default SPA navigateFallback
        // then returns index.html (the GM bundle) instead — which
        // is why opening /player.html?instance=foo was showing
        // the GM screen.
        ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, /^instance$/],
        // Also exclude /player.html + /projector.html paths from
        // the navigateFallback entirely so they always go to the
        // network (or precache) and never fall through to the SPA
        // shell. Defence in depth.
        navigateFallbackDenylist: [/\/player\.html/, /\/projector\.html/],
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

  // The Vamper engine ships as TypeScript source with a module worker
  // (new URL('../analysis/worker.ts', import.meta.url)); pre-bundling
  // would break that URL, so Vite serves it as-is.
  optimizeDeps: { exclude: ['vamper'] },

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
        calibrate: 'calibrate.html',
      },
    },
    target: 'es2023',
  },

  test: {
    environment: 'happy-dom',
    include: ['test/unit/**/*.test.ts'],
    // vamper is TypeScript source in node_modules: transform it rather
    // than handing it to Node as-is.
    server: { deps: { inline: ['vamper'] } },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
}));
