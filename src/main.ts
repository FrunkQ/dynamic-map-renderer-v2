import { GMApp } from './gm/GMApp.ts';

const app = new GMApp();
app.init().catch(console.error);

const verEl = document.getElementById('app-version');
if (verEl) verEl.textContent = `v${__APP_VERSION__}`;
