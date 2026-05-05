/// <reference types="vite/client" />

/**
 * Primary LAN IPv4 address of the dev machine, injected by vite.config.ts
 * during `npm run dev`.  Null in production builds.
 * Used to build a reachable player URL / QR code when the GM is on localhost.
 */
declare const __DEV_LAN_IP__: string | null;
