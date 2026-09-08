// v2.19.17 — ask for the managed relay's credentials NOW, so the answer is
// already here by the time anything dials. Inert until an endpoint is
// configured, and silent if it fails: no relay just means today's behaviour.
import { primeManagedIce } from './p2p/iceConfig.ts';
void primeManagedIce();

import { PlayerApp } from './player/PlayerApp.ts';

if (__VERCEL_DEPLOY__) {
  void import('@vercel/analytics').then((m) => m.inject()).catch(() => { /* silent */ });
}

const app = new PlayerApp();
app.init().catch(console.error);
