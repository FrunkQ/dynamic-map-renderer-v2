import { GMApp } from './gm/GMApp.ts';

// Vercel Web Analytics — only injected on builds produced by Vercel's CI
// (process.env.VERCEL='1'). The conditional + dynamic import lets the bundler
// drop the package on every other build, so self-hosters and local dev get
// a fully analytics-free bundle.
if (__VERCEL_DEPLOY__) {
  void import('@vercel/analytics').then((m) => m.inject()).catch(() => { /* silent */ });
}

const app = new GMApp();
app.init().catch(console.error);

const verEl = document.getElementById('app-version');
if (verEl) verEl.textContent = `v${__APP_VERSION__}`;

// Subtle storage usage indicator — uses navigator.storage.estimate() so
// users can see how close they are to the browser quota. Refreshes every
// 30 s and after init finishes (so first render captures any seed work).
async function refreshStorageGauge(): Promise<void> {
  const el = document.getElementById('storage-gauge');
  if (!el || !navigator.storage?.estimate) return;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    const usedMB = usage / (1024 * 1024);
    const quotaMB = quota / (1024 * 1024);
    const fmt = (n: number) => n >= 100 ? n.toFixed(0) : n.toFixed(1);
    el.textContent = quotaMB > 0
      ? `${fmt(usedMB)} / ${fmt(quotaMB)} MB`
      : `${fmt(usedMB)} MB`;
    el.title = quotaMB > 0
      ? `Browser storage: ${fmt(usedMB)} MB used of ~${fmt(quotaMB)} MB available for this app.`
      : `Browser storage: ${fmt(usedMB)} MB used.`;
    // Warn (orange tint) when above 80% of quota.
    el.classList.toggle('storage-gauge--warn', quotaMB > 0 && usedMB / quotaMB > 0.8);
  } catch {
    el.textContent = '';
  }
}
void refreshStorageGauge();
setInterval(() => void refreshStorageGauge(), 30_000);
