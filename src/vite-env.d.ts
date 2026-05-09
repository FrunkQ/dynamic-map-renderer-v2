/// <reference types="vite/client" />

/**
 * Primary LAN IPv4 address of the dev machine, injected by vite.config.ts
 * during `npm run dev`.  Null in production builds.
 * Used to build a reachable player URL / QR code when the GM is on localhost.
 */
declare const __DEV_LAN_IP__: string | null;

/** App version string from package.json, injected at build time. */
declare const __APP_VERSION__: string;

/**
 * True when the build was produced by Vercel's CI (process.env.VERCEL='1').
 * Gates lazy import of @vercel/analytics so non-Vercel builds tree-shake it
 * out and stay analytics-free.
 */
declare const __VERCEL_DEPLOY__: boolean;
