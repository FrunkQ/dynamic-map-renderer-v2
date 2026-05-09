import { PlayerApp } from './player/PlayerApp.ts';

if (__VERCEL_DEPLOY__) {
  void import('@vercel/analytics').then((m) => m.inject()).catch(() => { /* silent */ });
}

const app = new PlayerApp();
app.init().catch(console.error);
